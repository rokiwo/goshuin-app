// 本家Googleマップアプリ／Webの共有テキスト・URLから神社・お寺情報を解析し、
// アプリ内検索（5ソース並列）や座標逆ジオコーディングと組み合わせてスポット候補を生成するサービス

import { DEFAULT_CENTER } from '../data/seedSpots.js';
import { ALL_PREFECTURES, extractPrefectureFromSpot } from '../db/database.js';
import { getGeminiApiKey, getGeminiModel } from './geminiService.js';
import {
  searchShrineCandidatesByName,
  inferSpotTypeFromName,
  buildDefaultSampleGoshuin,
  calcDistanceMeters,
  formatDistanceLabel
} from './shrineSearchService.js';

const GOOGLE_MAPS_URL_REGEX =
  /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|share\.google|g\.co\/kgs|maps\.google\.(?:com|co\.jp)|(?:www\.)?google\.(?:com|co\.jp)\/maps)\S*/i;

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

    if (
      host.includes('maps.app.goo.gl') ||
      host.includes('share.google') ||
      (host.includes('goo.gl') && parsedUrl.pathname.startsWith('/maps')) ||
      (host.includes('g.co') && parsedUrl.pathname.startsWith('/kgs'))
    ) {
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

    // 2. /maps/place/場所名/... または /maps/search/検索語/... または /maps/dir//目的地/... を抽出
    const placeOrSearchMatch =
      parsedUrl.pathname.match(/\/(?:place|search)\/([^/@?#]+)/) ||
      parsedUrl.pathname.match(/\/dir\/[^/]*\/([^/@?#]+)/);
    if (placeOrSearchMatch && placeOrSearchMatch[1]) {
      const decoded = decodeURIComponent(placeOrSearchMatch[1].replace(/\+/g, ' ')).trim();
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

    // 3. ?q=... / ?query=... / ?destination=... パラメータを抽出
    const qParam = (
      parsedUrl.searchParams.get('q') ||
      parsedUrl.searchParams.get('query') ||
      parsedUrl.searchParams.get('destination') ||
      ''
    ).trim();
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

  // 重複除去しつつ、場所名候補と住所候補を振り分け（「北海道神宮」「沖縄県護国神社」等を住所誤判定しない）
  const shrineEndingPattern =
    /(?:神社|神宮|大社|天満宮|八幡宮|護国神社|東照宮|稲荷|権現|天神|明神|寺|院|堂|大師|観音|不動)$/;
  const uniqueSegments = [...new Set(rawSegments)];
  for (const seg of uniqueSegments) {
    const hasPref = ALL_PREFECTURES.some((p) => seg.includes(p));
    const hasPostal = /^〒\d{3}-?\d{4}/.test(seg) || /^\d{3}-\d{4}/.test(seg);
    const hasMunicipalDetail = /(?:都|道|府|県).+(?:市|区|町|村|郡|丁目|番|号|\d)/.test(seg);
    const endsWithShrineName = shrineEndingPattern.test(seg);

    // 1行に「兵庫県神戸市... 生田神社」のように住所と社寺名が空白区切りで混在する場合は末尾を抽出
    if ((hasPostal || hasMunicipalDetail) && endsWithShrineName && /[\s　]/.test(seg)) {
      const tokens = seg.split(/[\s　]+/).filter(Boolean);
      const lastToken = tokens[tokens.length - 1];
      if (shrineEndingPattern.test(lastToken) && tokens.length >= 2) {
        if (!extractedName) extractedName = lastToken;
        const addrPart = tokens
          .slice(0, -1)
          .join(' ')
          .replace(/^〒?\d{3}-?\d{4}\s*/, '')
          .trim();
        if (addrPart && (!addressHint || addrPart.length > addressHint.length)) {
          addressHint = addrPart;
        }
        continue;
      }
    }

    const looksLikeAddressOnly =
      hasPostal ||
      (hasPref && hasMunicipalDetail && !endsWithShrineName) ||
      (hasPref && !endsWithShrineName && !/[\s　]/.test(seg));

    if (looksLikeAddressOnly) {
      const cleanedAddr = seg.replace(/^〒?\d{3}-?\d{4}\s*/, '').trim();
      if (cleanedAddr && (!addressHint || cleanedAddr.length > addressHint.length)) {
        addressHint = cleanedAddr;
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
 * Gemini url_context ＋ google_search ツールを使い、短縮URL (maps.app.goo.gl 等) の飛び先情報をサーバー側で展開・取得
 */
async function resolveShortGoogleMapsUrlWithGemini(googleUrl) {
  const apiKey = getGeminiApiKey();
  if (!apiKey || !googleUrl) return null;

  const modelCandidates = [
    'gemini-2.5-flash',
    getGeminiModel(),
    'gemini-4-hydrogen',
    'gemini-3.8-flash'
  ].filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

  const prompt = `
次のGoogleマップ短縮リンクが指している日本の場所（神社・お寺・スポット等）を開いて確認し、正式な名称・住所・都道府県・緯度経度をJSONだけで返してください。
URL: ${googleUrl}

{
  "name": "施設・神社・お寺の正式名（取得不可なら空文字）",
  "prefecture": "都道府県名",
  "address": "住所",
  "lat": null,
  "lng": null,
  "expandedUrl": "リダイレクト先のGoogleマップURL"
}
`.trim();

  for (const modelId of modelCandidates) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
        modelId
      )}:generateContent?key=${encodeURIComponent(apiKey)}`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8000);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ url_context: {} }, { google_search: {} }],
          generationConfig: { temperature: 0.1 }
        })
      });
      clearTimeout(timer);
      if (!res.ok) continue;

      const data = await res.json();
      const cand = data?.candidates?.[0];

      // urlContextMetadata から展開後の実URLを抽出
      const retrievedUrls = (cand?.urlContextMetadata?.urlMetadata || [])
        .map((u) => u?.retrievedUrl || '')
        .filter(Boolean);
      const expandedFromMeta = retrievedUrls.find((u) => /google\.[^/]+\/maps/i.test(u)) || '';

      const rawText = cand?.content?.parts?.map((p) => p.text || '').join('\n') || '';
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      let parsedJson = null;
      if (jsonMatch) {
        try {
          parsedJson = JSON.parse(jsonMatch[0]);
        } catch {
          parsedJson = null;
        }
      }

      const expandedUrl = parsedJson?.expandedUrl || expandedFromMeta || '';
      const name = (parsedJson?.name || '').trim();
      if (expandedUrl || name) {
        return {
          name,
          prefecture: (parsedJson?.prefecture || '').trim(),
          address: (parsedJson?.address || '').trim(),
          lat: typeof parsedJson?.lat === 'number' ? parsedJson.lat : null,
          lng: typeof parsedJson?.lng === 'number' ? parsedJson.lng : null,
          expandedUrl
        };
      }
    } catch {
      // 次のモデルで再試行
    }
  }
  return null;
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
  let parsed = parseGoogleMapsShareInput(sharePayload);
  let queryName = (manualNameOverride || parsed.name || '').trim();

  // 短縮URL単体（名前も座標もない）場合は、まず Gemini url_context で自動展開を試みる
  if (parsed.isShortUrlOnly && !queryName && parsed.googleUrl) {
    const expanded = await resolveShortGoogleMapsUrlWithGemini(parsed.googleUrl);
    if (expanded) {
      const fromExpandedUrl = expanded.expandedUrl
        ? parseSingleGoogleMapsUrl(expanded.expandedUrl)
        : {};
      const resolvedName = (expanded.name || fromExpandedUrl.name || '').trim();
      const resolvedAddr = (expanded.address || fromExpandedUrl.addressHint || '').trim();
      const resolvedPref =
        expanded.prefecture ||
        extractPrefectureFromSpot({ address: resolvedAddr, name: resolvedName });
      const resolvedLat =
        typeof expanded.lat === 'number' ? expanded.lat : fromExpandedUrl.lat ?? null;
      const resolvedLng =
        typeof expanded.lng === 'number' ? expanded.lng : fromExpandedUrl.lng ?? null;

      parsed = {
        ...parsed,
        name: resolvedName,
        addressHint: resolvedAddr || parsed.addressHint,
        areaHint:
          resolvedPref && ALL_PREFECTURES.includes(resolvedPref)
            ? resolvedPref
            : parsed.areaHint,
        lat: resolvedLat,
        lng: resolvedLng,
        isShortUrlOnly: !resolvedName && resolvedLat == null
      };
      queryName = resolvedName;
    }
  }

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

    // 座標のみURLで名前がない場合、近傍250mの既登録社寺からも候補補完
    if (!resolvedName && Array.isArray(localSpots) && localSpots.length > 0) {
      const nearLocal = localSpots.find(
        (s) =>
          typeof s.lat === 'number' &&
          typeof s.lng === 'number' &&
          calcDistanceMeters(s.lat, s.lng, parsed.lat, parsed.lng) < 250
      );
      if (nearLocal) {
        resolvedName = nearLocal.name;
        if (!resolvedAddr) resolvedAddr = nearLocal.address || '';
      }
    }

    if (!resolvedName || !resolvedAddr) {
      const rev = await reverseGeocodeJapaneseSpot(parsed.lat, parsed.lng);
      if (rev) {
        if (!resolvedName && rev.name) resolvedName = rev.name;
        if (!resolvedAddr && rev.address) resolvedAddr = rev.address;
      }
    }

    // 逆ジオコーディングで施設名が空（町名・番地のみ）の場合も、座標地点スポットとして必ず候補生成
    const finalName = resolvedName || resolvedAddr || 'Googleマップ指定地点';
    const spotType = inferSpotTypeFromName(finalName);
    const pref = extractPrefectureFromSpot({
      address: resolvedAddr,
      lat: parsed.lat,
      lng: parsed.lng
    });
    const distMeters = calcDistanceMeters(baseLat, baseLng, parsed.lat, parsed.lng);
    exactPinCandidate = {
      id: `gmap-pin-${parsed.lat.toFixed(5)}-${parsed.lng.toFixed(5)}`,
      name: finalName,
      type: spotType,
      denomination: spotType === 'temple' ? '仏教（寺院）' : '神道（神社）',
      address: resolvedAddr || pref || 'Googleマップ指定地点',
      prefecture: pref,
      lat: parsed.lat,
      lng: parsed.lng,
      distanceMeters: distMeters,
      distanceKm: Math.round((distMeters / 1000) * 10) / 10,
      distanceLabel: formatDistanceLabel(distMeters),
      sampleGoshuin: buildDefaultSampleGoshuin(finalName, spotType),
      source: 'Googleマップ指定地点'
    };
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
