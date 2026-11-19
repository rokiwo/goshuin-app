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
  formatDistanceLabel,
  normalizeShrineText,
  getPrefectureFromAddressCode
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
    .split(/\n+|\s+[·・]\s+|\s+-\s+Google\s*マップ/i)
    .map((s) => s.replace(/^📍\s*/, '').trim())
    .filter(
      (s) =>
        s &&
        !/^(?:google\s*(?:maps|マップ)|神社|寺院|お寺|日本の場所|観光名所)$/i.test(s)
    );

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

  const hasGoogleUrl = Boolean(googleUrl && isGoogleMapsInput(googleUrl));
  const isShortUrlOnly =
    (urlParsed.isShortUrl || hasGoogleUrl) &&
    !extractedName &&
    (urlParsed.lat == null || Number.isNaN(urlParsed.lat));

  return {
    name: extractedName.trim(),
    addressHint: addressHint.trim(),
    areaHint,
    lat: urlParsed.lat,
    lng: urlParsed.lng,
    googleUrl,
    hasGoogleUrl,
    isShortUrlOnly
  };
}

/**
 * 座標から国土地理院逆ジオコーダ＋Nominatimで日本語の施設名・都道府県・住所を正確に補完
 */
async function reverseGeocodeJapaneseSpot(lat, lng) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const [nomRes, gsiRes] = await Promise.allSettled([
      fetch(
        `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
          lat
        )}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1&accept-language=ja`,
        { signal: controller.signal }
      ),
      fetch(
        `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${encodeURIComponent(
          lat
        )}&lon=${encodeURIComponent(lng)}`,
        { signal: controller.signal }
      )
    ]);
    clearTimeout(timer);

    let gsiPref = '';
    let gsiTown = '';
    if (gsiRes.status === 'fulfilled' && gsiRes.value.ok) {
      const gsiJson = await gsiRes.value.json();
      const r = gsiJson?.results;
      if (r?.muniCd) {
        gsiPref = getPrefectureFromAddressCode(r.muniCd);
      }
      if (r?.lv01Nm && r.lv01Nm !== '−') {
        gsiTown = r.lv01Nm;
      }
    }

    let nomName = '';
    let nomAddr = '';
    let nomPref = '';
    if (nomRes.status === 'fulfilled' && nomRes.value.ok) {
      const item = await nomRes.value.json();
      const addr = item.address || {};
      nomPref = addr.province || addr.state || '';
      const city = addr.city || addr.county || addr.town || addr.village || '';
      const area = addr.suburb || addr.ward || addr.quarter || addr.neighbourhood || addr.road || '';
      nomAddr = `${nomPref}${city}${area}`.trim() || item.display_name || '';
      nomName = item.name || '';
    }

    const pref = gsiPref || nomPref;
    const address = nomAddr || `${gsiPref}${gsiTown}`.trim();
    if (!address && !pref && !nomName) return null;

    return {
      name: nomName,
      address,
      prefecture: pref || extractPrefectureFromSpot({ address, lat, lng })
    };
  } catch {
    return null;
  }
}

/**
 * EU等の Google 同意画面 (consent.google.com?continue=...) を剥がして元の GoogleマップURL を取り出す
 */
function unwrapGoogleRedirectUrl(urlStr = '') {
  if (!urlStr) return '';
  try {
    const u = new URL(urlStr);
    if (u.hostname.includes('consent.google.')) {
      const cont = u.searchParams.get('continue');
      if (cont) return cont;
    }
  } catch {
    // ignore
  }
  return urlStr;
}

/**
 * 共有テキストに含まれた正確な住所文字列からピンポイント座標 (lat, lng) を特定
 */
async function geocodeExactJapaneseAddress(addressHint, shrineName = '') {
  const cleanAddr = String(addressHint || '').trim();
  if (!cleanAddr) return null;

  const queries = [];
  if (shrineName) queries.push(`${shrineName} ${cleanAddr}`);
  queries.push(cleanAddr);
  // 番地付きで失敗する場合に備えて町名レベルも用意
  const streetLevel = cleanAddr.replace(/[０-９0-9\-－−丁目番地号\s]+$/g, '').trim();

  try {
    // 国土地理院 AddressSearch ＋ Nominatim を並列実行
    const [gsiRes, nomRes] = await Promise.allSettled([
      fetch(
        `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(cleanAddr)}`
      ),
      fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(
          queries[0]
        )}&countrycodes=jp&limit=3&accept-language=ja`
      )
    ]);

    if (nomRes.status === 'fulfilled' && nomRes.value.ok) {
      const items = await nomRes.value.json();
      if (Array.isArray(items) && items.length > 0) {
        const lat = parseFloat(items[0].lat);
        const lng = parseFloat(items[0].lon);
        if (!Number.isNaN(lat) && !Number.isNaN(lng)) {
          return { lat, lng, address: cleanAddr };
        }
      }
    }

    if (gsiRes.status === 'fulfilled' && gsiRes.value.ok) {
      const items = await gsiRes.value.json();
      if (Array.isArray(items) && items.length > 0 && items[0]?.geometry?.coordinates) {
        const [lng, lat] = items[0].geometry.coordinates;
        if (typeof lat === 'number' && typeof lng === 'number') {
          return { lat, lng, address: items[0].properties?.title || cleanAddr };
        }
      }
    }

    if (streetLevel && streetLevel !== cleanAddr) {
      const fallbackRes = await fetch(
        `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(streetLevel)}`
      );
      if (fallbackRes.ok) {
        const items = await fallbackRes.json();
        if (Array.isArray(items) && items.length > 0 && items[0]?.geometry?.coordinates) {
          const [lng, lat] = items[0].geometry.coordinates;
          if (typeof lat === 'number' && typeof lng === 'number') {
            return { lat, lng, address: cleanAddr };
          }
        }
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Microlink API 1回分の呼び出し＆メタデータ解析ヘルパー
 */
async function fetchMicrolinkMetadata(googleUrl, usePrerender = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), usePrerender ? 9000 : 6000);
  const endpoint = `https://api.microlink.io/?url=${encodeURIComponent(googleUrl)}${
    usePrerender ? '&prerender=true' : ''
  }`;
  const res = await fetch(endpoint, { signal: controller.signal });
  clearTimeout(timer);
  if (!res.ok) return null;

  const json = await res.json();
  const data = json?.data;
  if (!data) return null;

  const redirectUrls = Array.isArray(json.redirects)
    ? json.redirects
        .map((r) => unwrapGoogleRedirectUrl(typeof r === 'string' ? r : r?.url || ''))
        .filter(Boolean)
    : [];
  const unwrappedDataUrl = unwrapGoogleRedirectUrl(data.url || '');
  const allUrls = [unwrappedDataUrl, ...redirectUrls.slice().reverse()].filter(Boolean);
  const expandedUrl =
    allUrls.find(
      (u) =>
        (/google\.[^/]+\/maps/i.test(u) || /maps\.google\./i.test(u)) &&
        (/!3d|-?\d+\.\d+,-?\d+\.\d+|\/place\//i.test(u))
    ) ||
    allUrls.find((u) => /google\.[^/]+\/maps/i.test(u) || /maps\.google\./i.test(u)) ||
    unwrappedDataUrl ||
    '';

  const rawTitle = (data.title || '').trim();
  const usefulTitle =
    rawTitle &&
    !/^(?:google\s*(?:maps|マップ)|maps\.app\.goo\.gl|google|before you continue.*)$/i.test(
      rawTitle
    )
      ? rawTitle
      : '';

  const rawDesc = (data.description || '').trim();
  const usefulDesc =
    rawDesc && !/find local businesses|view maps and get driving directions/i.test(rawDesc)
      ? rawDesc
      : '';

  // OGP staticmap 画像URLの center= または markers= から座標を抽出
  let lat = null;
  let lng = null;
  const imgUrl = data.image?.url || '';
  const coordMatch = imgUrl.match(
    /[?&](?:center|markers)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/i
  );
  if (coordMatch) {
    const cLat = parseFloat(coordMatch[1]);
    const cLng = parseFloat(coordMatch[2]);
    if (Math.abs(cLat) > 0.1 && Math.abs(cLng) > 0.1) {
      lat = cLat;
      lng = cLng;
    }
  }

  const fromExpandedUrl = expandedUrl ? parseSingleGoogleMapsUrl(expandedUrl) : {};
  const fromTitleAndDesc =
    usefulTitle || usefulDesc
      ? parseGoogleMapsShareInput({ rawText: [usefulTitle, usefulDesc].filter(Boolean).join('\n') })
      : {};

  const name = (fromExpandedUrl.name || fromTitleAndDesc.name || '').trim();
  const addressHint = (
    fromExpandedUrl.addressHint ||
    fromTitleAndDesc.addressHint ||
    ''
  ).trim();
  const finalLat = typeof fromExpandedUrl.lat === 'number' ? fromExpandedUrl.lat : lat;
  const finalLng = typeof fromExpandedUrl.lng === 'number' ? fromExpandedUrl.lng : lng;

  if (!name && finalLat == null && !addressHint) return null;
  return {
    name,
    address: addressHint,
    prefecture: fromTitleAndDesc.areaHint || '',
    lat: finalLat,
    lng: finalLng,
    expandedUrl
  };
}

/**
 * Microlink API（CORS対応・無料・認証不要）を使い、maps.app.goo.gl 等の短縮URLをサーバー側リダイレクト展開して
 * 展開後のURL・ページタイトル・OGP静的地図の緯度経度を抽出する（座標未取得時は prerender=true でもう一度試行）
 */
async function expandShortGoogleUrlViaMicrolink(googleUrl) {
  if (!googleUrl) return null;
  try {
    const first = await fetchMicrolinkMetadata(googleUrl, false);
    if (first && typeof first.lat === 'number' && typeof first.lng === 'number') {
      return first;
    }
    if (first && first.address) {
      return first;
    }
    // 通常取得で座標も住所も取れなかった場合は prerender=true でJS描画後の地図座標・タイトルも確認
    const rendered = await fetchMicrolinkMetadata(googleUrl, true);
    if (rendered) {
      return {
        name: rendered.name || first?.name || '',
        address: rendered.address || first?.address || '',
        prefecture: rendered.prefecture || first?.prefecture || '',
        lat: typeof rendered.lat === 'number' ? rendered.lat : first?.lat ?? null,
        lng: typeof rendered.lng === 'number' ? rendered.lng : first?.lng ?? null,
        expandedUrl: rendered.expandedUrl || first?.expandedUrl || ''
      };
    }
    return first;
  } catch {
    return null;
  }
}

/**
 * Gemini url_context ＋ google_search ツールを使い、短縮URL (maps.app.goo.gl 等) の飛び先情報を補完
 */
async function resolveShortGoogleMapsUrlWithGemini(googleUrl) {
  const apiKey = getGeminiApiKey();
  if (!apiKey || !googleUrl) return null;

  const modelCandidates = ['gemini-2.5-flash', getGeminiModel()]
    .filter((m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx);

  const prompt = `
次のGoogleマップ短縮リンクが指している日本の場所（神社・お寺・スポット等）の正式な名称・住所・都道府県・緯度経度をJSONだけで返してください。
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
      const timer = setTimeout(() => controller.abort(), 5000);
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

  // 座標がまだ不明な GoogleマップURL（短縮URL単体、または「名前・住所＋短縮URL」）なら
  // リダイレクト展開(Microlink) と 正確な住所ジオコーディング を並列で走らせてピン座標を1点特定する
  if ((parsed.lat == null || Number.isNaN(parsed.lat)) && (parsed.hasGoogleUrl || parsed.addressHint)) {
    const [microlinkRes, addrGeoRes] = await Promise.all([
      parsed.hasGoogleUrl && parsed.googleUrl
        ? expandShortGoogleUrlViaMicrolink(parsed.googleUrl)
        : Promise.resolve(null),
      parsed.addressHint
        ? geocodeExactJapaneseAddress(parsed.addressHint, queryName)
        : Promise.resolve(null)
    ]);

    let expanded = microlinkRes;
    if (!expanded && parsed.isShortUrlOnly && !queryName && parsed.googleUrl) {
      expanded = await resolveShortGoogleMapsUrlWithGemini(parsed.googleUrl);
    }

    if (expanded) {
      const fromExpandedUrl = expanded.expandedUrl
        ? parseSingleGoogleMapsUrl(expanded.expandedUrl)
        : {};
      const resolvedName = (queryName || expanded.name || fromExpandedUrl.name || '').trim();
      const resolvedAddr = (parsed.addressHint || expanded.address || fromExpandedUrl.addressHint || '').trim();
      const resolvedPref =
        expanded.prefecture ||
        parsed.areaHint ||
        extractPrefectureFromSpot({ address: resolvedAddr, name: resolvedName });
      const resolvedLat =
        typeof expanded.lat === 'number'
          ? expanded.lat
          : typeof fromExpandedUrl.lat === 'number'
          ? fromExpandedUrl.lat
          : addrGeoRes?.lat ?? null;
      const resolvedLng =
        typeof expanded.lng === 'number'
          ? expanded.lng
          : typeof fromExpandedUrl.lng === 'number'
          ? fromExpandedUrl.lng
          : addrGeoRes?.lng ?? null;

      parsed = {
        ...parsed,
        name: resolvedName,
        addressHint: resolvedAddr,
        areaHint:
          resolvedPref && ALL_PREFECTURES.includes(resolvedPref) ? resolvedPref : parsed.areaHint,
        lat: resolvedLat,
        lng: resolvedLng,
        isShortUrlOnly: !resolvedName && resolvedLat == null
      };
      queryName = resolvedName;
    } else if (addrGeoRes) {
      parsed = {
        ...parsed,
        lat: addrGeoRes.lat,
        lng: addrGeoRes.lng,
        addressHint: parsed.addressHint || addrGeoRes.address || ''
      };
    }

    // Microlink等が住所のみ返して座標がまだない場合は、その住所もピンポイント座標へ変換
    if (
      (parsed.lat == null || Number.isNaN(parsed.lat)) &&
      parsed.addressHint &&
      !addrGeoRes
    ) {
      const geoFromExpanded = await geocodeExactJapaneseAddress(parsed.addressHint, queryName);
      if (geoFromExpanded) {
        parsed.lat = geoFromExpanded.lat;
        parsed.lng = geoFromExpanded.lng;
      }
    }
  }

  if (parsed.isShortUrlOnly && !queryName) {
    return {
      parsed,
      candidates: [],
      needsManualName: true,
      isExactPinMatch: false
    };
  }

  const baseLat =
    typeof userLocation?.lat === 'number' ? userLocation.lat : DEFAULT_CENTER.lat;
  const baseLng =
    typeof userLocation?.lng === 'number' ? userLocation.lng : DEFAULT_CENTER.lng;

  // フルURL・展開後URL・共有住所から「その1件」の正確な座標が特定できた場合は、
  // 全国検索で同名神社を大量に出さず、その場所をバシッと1件だけ返す！
  if (
    typeof parsed.lat === 'number' &&
    typeof parsed.lng === 'number' &&
    !Number.isNaN(parsed.lat) &&
    !Number.isNaN(parsed.lng)
  ) {
    let resolvedName = queryName;
    let resolvedAddr = parsed.addressHint;

    const nearLocal =
      Array.isArray(localSpots) && localSpots.length > 0
        ? localSpots.find((s) => {
            if (typeof s.lat !== 'number' || typeof s.lng !== 'number') return false;
            const d = calcDistanceMeters(s.lat, s.lng, parsed.lat, parsed.lng);
            if (d >= 240) return false;
            if (!resolvedName) return true;
            const normQ = normalizeShrineText(resolvedName);
            const normS = normalizeShrineText(s.name);
            return normS === normQ || normS.includes(normQ) || normQ.includes(normS);
          })
        : null;

    if (nearLocal) {
      if (!resolvedName) resolvedName = nearLocal.name;
      if (!resolvedAddr) resolvedAddr = nearLocal.address || '';
    }

    let revPref = '';
    if (!resolvedName || !resolvedAddr) {
      const rev = await reverseGeocodeJapaneseSpot(parsed.lat, parsed.lng);
      if (rev) {
        if (!resolvedName && rev.name) resolvedName = rev.name;
        if (!resolvedAddr && rev.address) resolvedAddr = rev.address;
        if (rev.prefecture) revPref = rev.prefecture;
      }
    }

    const finalName = resolvedName || resolvedAddr || 'Googleマップ指定地点';
    const spotType = nearLocal?.type || inferSpotTypeFromName(finalName);
    const pref =
      revPref ||
      extractPrefectureFromSpot({
        address: resolvedAddr || nearLocal?.address,
        lat: parsed.lat,
        lng: parsed.lng
      });
    const distMeters = calcDistanceMeters(baseLat, baseLng, parsed.lat, parsed.lng);

    const exactSpot = {
      id: nearLocal?.id || `gmap-pin-${parsed.lat.toFixed(5)}-${parsed.lng.toFixed(5)}`,
      name: nearLocal?.name && !queryName ? nearLocal.name : finalName,
      type: spotType,
      denomination:
        nearLocal?.denomination ||
        (spotType === 'temple' ? '仏教（寺院）' : '神道（神社）'),
      address: resolvedAddr || nearLocal?.address || pref || 'Googleマップ指定地点',
      prefecture: pref,
      lat: parsed.lat,
      lng: parsed.lng,
      distanceMeters: distMeters,
      distanceKm: Math.round((distMeters / 1000) * 10) / 10,
      distanceLabel: formatDistanceLabel(distMeters),
      sampleGoshuin:
        nearLocal?.sampleGoshuin && nearLocal.sampleGoshuin.length > 0
          ? nearLocal.sampleGoshuin
          : buildDefaultSampleGoshuin(finalName, spotType),
      source: 'Googleマップ指定地点'
    };

    return {
      parsed: { ...parsed, name: exactSpot.name },
      candidates: [exactSpot],
      needsManualName: false,
      isExactPinMatch: true
    };
  }

  // 座標・詳細住所が一切ない検索ワード型URL (?q=神社名 のみ) の場合のみ全国検索へフォールバック
  const searchCandidates = queryName
    ? await searchShrineCandidatesByName(queryName, parsed.areaHint, localSpots, userLocation)
    : [];

  let filtered = searchCandidates;
  if (parsed.addressHint) {
    const cityMatch = parsed.addressHint.match(/([^\s都道県府]+[市区町村郡])/);
    if (cityMatch && cityMatch[1]) {
      const cityScoped = searchCandidates.filter((c) =>
        (c.address || '').includes(cityMatch[1])
      );
      if (cityScoped.length > 0) {
        filtered = cityScoped;
      }
    }
  }

  return {
    parsed: { ...parsed, name: queryName || parsed.name },
    candidates: filtered.slice(0, 8),
    needsManualName: false,
    isExactPinMatch: filtered.length === 1
  };
}
