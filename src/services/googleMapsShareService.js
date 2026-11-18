// 本家Googleマップアプリ／Webの共有テキスト・URLから神社・お寺情報を解析し、
// アプリ内検索（5ソース並列）や座標逆ジオコーディングと組み合わせてスポット候補を生成するサービス

import { DEFAULT_CENTER } from '../data/seedSpots.js';
import { ALL_PREFECTURES, extractPrefectureFromSpot } from '../db/database.js';
import {
  searchShrineCandidatesByName,
  inferSpotTypeFromName,
  buildDefaultSampleGoshuin,
  calcDistanceMeters,
  formatDistanceLabel
} from './shrineSearchService.js';

const GOOGLE_MAPS_URL_REGEX =
  /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.|maps\.)?google\.(?:com|co\.jp)\/maps)\S*/i;

/**
 * 入力文字列に本家GoogleマップのURLまたは共有リンクが含まれるか判定
 */
export function isGoogleMapsInput(rawText = '') {
  return GOOGLE_MAPS_URL_REGEX.test(String(rawText || ''));
}

/**
 * GoogleマップのURL1本から座標・場所名・検索クエリを抽出
 */
function parseSingleGoogleMapsUrl(urlStr) {
  const result = {
    name: '',
    addressHint: '',
    lat: null,
    lng: null,
    isShortUrl: false
  };
  if (!urlStr) return result;

  try {
    const parsedUrl = new URL(urlStr);
    const host = parsedUrl.hostname.toLowerCase();
    const fullPath = `${parsedUrl.pathname}${parsedUrl.search}${parsedUrl.hash}`;

    if (host.includes('maps.app.goo.gl') || (host.includes('goo.gl') && parsedUrl.pathname.startsWith('/maps'))) {
      result.isShortUrl = true;
    }

    // 1. 最優先：ピンの精密座標 (!3dLAT!4dLNG)
    const pinCoordMatch = fullPath.match(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/);
    if (pinCoordMatch) {
      result.lat = parseFloat(pinCoordMatch[1]);
      result.lng = parseFloat(pinCoordMatch[2]);
    } else {
      // 次点：URLパスの @lat,lng
      const atCoordMatch = fullPath.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (atCoordMatch) {
        result.lat = parseFloat(atCoordMatch[1]);
        result.lng = parseFloat(atCoordMatch[2]);
      }
    }

    // 2. /maps/place/場所名/... から名前と住所部分を抽出
    const placeMatch = parsedUrl.pathname.match(/\/place\/([^/@]+)/);
    if (placeMatch && placeMatch[1]) {
      const decoded = decodeURIComponent(placeMatch[1].replace(/\+/g, ' ')).trim();
      const coordOnly = decoded.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
      if (coordOnly) {
        if (result.lat == null) {
          result.lat = parseFloat(coordOnly[1]);
          result.lng = parseFloat(coordOnly[2]);
        }
      } else if (decoded) {
        const parts = decoded.split(/[、,]/).map((s) => s.trim()).filter(Boolean);
        result.name = parts[0] || decoded;
        if (parts.length > 1) {
          result.addressHint = parts.slice(1).join(' ');
        }
      }
    }

    // 3. ?q=... または ?query=... パラメータを抽出
    const qParam = (parsedUrl.searchParams.get('q') || parsedUrl.searchParams.get('query') || '').trim();
    if (qParam) {
      const qCoordMatch = qParam.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
      if (qCoordMatch) {
        if (result.lat == null) {
          result.lat = parseFloat(qCoordMatch[1]);
          result.lng = parseFloat(qCoordMatch[2]);
        }
      } else if (!result.name) {
        const cleanedQ = qParam
          .replace(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*/, '')
          .trim();
        if (cleanedQ) {
          result.name = cleanedQ;
        }
      }
    }

    // 4. ?ll=lat,lng または ?center=lat,lng のフォールバック
    const llParam = parsedUrl.searchParams.get('ll') || parsedUrl.searchParams.get('center') || '';
    const llMatch = llParam.match(/^(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)$/);
    if (llMatch && result.lat == null) {
      result.lat = parseFloat(llMatch[1]);
      result.lng = parseFloat(llMatch[2]);
    }
  } catch {
    // URLパース失敗時はテキスト解析のみ使用
  }

  return result;
}

/**
 * 共有された title / text / url やペースト文字列から神社・お寺の手がかりを解析
 */
export function parseGoogleMapsShareInput({ title = '', text = '', url = '', rawText = '' } = {}) {
  const combinedSource = [title, text, url, rawText].filter(Boolean).join('\n').trim();
  const urlMatches = combinedSource.match(/https?:\/\/[^\s]+/gi) || [];
  const googleUrl = urlMatches.find((u) => isGoogleMapsInput(u)) || urlMatches[0] || '';
  const urlParsed = parseSingleGoogleMapsUrl(googleUrl);

  // URLを除いた共有文面（「神社名 · 〒郵便番号 住所」等）を整理
  const textWithoutUrls = [title, text, rawText]
    .filter(Boolean)
    .join('\n')
    .replace(/https?:\/\/[^\s]+/gi, ' ')
    .replace(/\r/g, '\n');

  const rawSegments = textWithoutUrls
    .split(/\n+|\s+·\s+|\s+-\s+Google\s*マップ/i)
    .map((s) => s.replace(/^📍\s*/, '').trim())
    .filter((s) => s && !/^google\s*(maps|マップ)$/i.test(s));

  let extractedName = urlParsed.name || '';
  let addressHint = urlParsed.addressHint || '';

  // 重複除去しつつ、場所名候補と住所候補を振り分け
  const uniqueSegments = [...new Set(rawSegments)];
  for (const seg of uniqueSegments) {
    const looksLikeAddress =
      /^〒?\d{3}-?\d{4}/.test(seg) ||
      ALL_PREFECTURES.some((p) => seg.startsWith(p) || seg.includes(p));

    if (looksLikeAddress && (!addressHint || seg.length > addressHint.length)) {
      addressHint = seg.replace(/^〒?\d{3}-?\d{4}\s*/, '').trim();
      if (!extractedName) {
        // 「兵庫県神戸市 生田神社」のように1行に混在している場合の末尾社寺名抽出に備える
        continue;
      }
    } else if (!extractedName && !/^★+$/.test(seg)) {
      extractedName = seg;
    }
  }

  // 都道府県ヒントを抽出
  let areaHint = '';
  const areaTarget = `${addressHint} ${extractedName}`;
  for (const pref of ALL_PREFECTURES) {
    if (areaTarget.includes(pref)) {
      areaHint = pref;
      break;
    }
  }

  const isShortUrlOnly =
    urlParsed.isShortUrl &&
    !extractedName &&
    (urlParsed.lat == null || Number.isNaN(urlParsed.lat));

  return {
    name: extractedName.trim(),
    addressHint: addressHint.trim(),
    areaHint,
    lat: urlParsed.lat,
    lng: urlParsed.lng,
    googleUrl,
    hasGoogleUrl: Boolean(googleUrl && isGoogleMapsInput(googleUrl)),
    isShortUrlOnly
  };
}

/**
 * 座標からOpenStreetMap Nominatimで日本語の施設名・住所を補完
 */
async function reverseGeocodeJapaneseSpot(lat, lng) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1&accept-language=ja`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return null;

    const item = await res.json();
    const addr = item.address || {};
    const pref = addr.province || addr.state || '';
    const city = addr.city || addr.county || addr.town || addr.village || '';
    const area = addr.suburb || addr.ward || addr.quarter || addr.neighbourhood || addr.road || '';
    const combinedAddr = `${pref}${city}${area}`.trim() || item.display_name || '';

    return {
      name: item.name || '',
      address: combinedAddr,
      prefecture: pref || extractPrefectureFromSpot({ address: combinedAddr, lat, lng })
    };
  } catch {
    return null;
  }
}

/**
 * 解析したGoogleマップ情報からアプリ用スポット候補リストを生成
 */
export async function resolveGoogleMapsShareToCandidates(
  sharePayload,
  localSpots = [],
  userLocation = DEFAULT_CENTER,
  manualNameOverride = ''
) {
  const parsed = parseGoogleMapsShareInput(sharePayload);
  const queryName = (manualNameOverride || parsed.name || '').trim();

  if (parsed.isShortUrlOnly && !queryName) {
    return {
      parsed,
      candidates: [],
      needsManualName: true
    };
  }

  const baseLat =
    typeof userLocation?.lat === 'number' ? userLocation.lat : DEFAULT_CENTER.lat;
  const baseLng =
    typeof userLocation?.lng === 'number' ? userLocation.lng : DEFAULT_CENTER.lng;

  let exactPinCandidate = null;

  // フルURL等から正確な座標が取れた場合はGoogleマップ直結スポットを生成
  if (
    typeof parsed.lat === 'number' &&
    typeof parsed.lng === 'number' &&
    !Number.isNaN(parsed.lat) &&
    !Number.isNaN(parsed.lng)
  ) {
    let resolvedName = queryName;
    let resolvedAddr = parsed.addressHint;
    if (!resolvedName || !resolvedAddr) {
      const rev = await reverseGeocodeJapaneseSpot(parsed.lat, parsed.lng);
      if (rev) {
        if (!resolvedName && rev.name) resolvedName = rev.name;
        if (!resolvedAddr && rev.address) resolvedAddr = rev.address;
      }
    }

    if (resolvedName) {
      const spotType = inferSpotTypeFromName(resolvedName);
      const pref = extractPrefectureFromSpot({
        address: resolvedAddr,
        lat: parsed.lat,
        lng: parsed.lng
      });
      const distMeters = calcDistanceMeters(baseLat, baseLng, parsed.lat, parsed.lng);
      exactPinCandidate = {
        id: `gmap-pin-${parsed.lat.toFixed(5)}-${parsed.lng.toFixed(5)}`,
        name: resolvedName,
        type: spotType,
        denomination: spotType === 'temple' ? '仏教（寺院）' : '神道（神社）',
        address: resolvedAddr || pref || 'Googleマップ指定地点',
        prefecture: pref,
        lat: parsed.lat,
        lng: parsed.lng,
        distanceMeters: distMeters,
        distanceKm: Math.round((distMeters / 1000) * 10) / 10,
        distanceLabel: formatDistanceLabel(distMeters),
        sampleGoshuin: buildDefaultSampleGoshuin(resolvedName, spotType),
        source: 'Googleマップ指定地点'
      };
    }
  }

  // 名前・地域の手がかりからアプリ内5ソース全国検索を実行
  const searchCandidates = queryName
    ? await searchShrineCandidatesByName(queryName, parsed.areaHint, localSpots, userLocation)
    : [];

  const merged = [];
  if (exactPinCandidate) {
    // 検索結果側に同一施設（250m以内）の詳細住所・既存IDがあれば引き継ぐ
    const nearbyMatch = searchCandidates.find(
      (c) => calcDistanceMeters(c.lat, c.lng, exactPinCandidate.lat, exactPinCandidate.lng) < 250
    );
    if (nearbyMatch) {
      merged.push({
        ...nearbyMatch,
        address:
          exactPinCandidate.address && exactPinCandidate.address !== 'Googleマップ指定地点'
            ? exactPinCandidate.address
            : nearbyMatch.address,
        source: 'Googleマップ共有'
      });
    } else {
      merged.push(exactPinCandidate);
    }
  }

  for (const c of searchCandidates) {
    if (
      !merged.some((m) => calcDistanceMeters(m.lat, m.lng, c.lat, c.lng) < 200 && m.name === c.name)
    ) {
      merged.push(c);
    }
  }

  return {
    parsed: { ...parsed, name: queryName || parsed.name },
    candidates: merged,
    needsManualName: false
  };
}
