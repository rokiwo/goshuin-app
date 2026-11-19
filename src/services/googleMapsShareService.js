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

const SHORT_URL_RESOLVE_CACHE = new Map();
const SHORT_URL_CACHE_TTL_MS = 300000;

/**
 * 日本国内の妥当な緯度経度範囲か判定（海外サーバーIPの誤ジオロケーションを除外）
 */
function isValidJapanCoord(lat, lng) {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    !Number.isNaN(lat) &&
    !Number.isNaN(lng) &&
    lat >= 20 &&
    lat <= 46 &&
    lng >= 122 &&
    lng <= 154
  );
}

/**
 * 展開URL・タイトル・説明文・OGP静止画URLから場所メタデータを共通抽出するヘルパー
 */
function extractMetadataFromPreview({ urlList = [], rawTitle = '', rawDesc = '', imgUrl = '' }) {
  const unwrappedList = urlList.map((u) => unwrapGoogleRedirectUrl(u)).filter(Boolean);
  const expandedUrl =
    unwrappedList.find(
      (u) =>
        (/google\.[^/]+\/maps/i.test(u) || /maps\.google\./i.test(u)) &&
        (/!3d|-?\d+\.\d+,-?\d+\.\d+|\/place\//i.test(u))
    ) ||
    unwrappedList.find((u) => /google\.[^/]+\/maps/i.test(u) || /maps\.google\./i.test(u)) ||
    unwrappedList[0] ||
    '';

  const trimmedTitle = (rawTitle || '').trim();
  const usefulTitle =
    trimmedTitle &&
    !/^(?:google\s*(?:maps|マップ)|maps\.app\.goo\.gl|google|before you continue.*)$/i.test(
      trimmedTitle
    )
      ? trimmedTitle
      : '';

  const trimmedDesc = (rawDesc || '').trim();
  const usefulDesc =
    trimmedDesc && !/find local businesses|view maps and get driving directions/i.test(trimmedDesc)
      ? trimmedDesc
      : '';

  // OGP staticmap 画像URLは markers= 指定または zoom>=15 の日本国内座標のみ信頼する
  // （zoom=13 の center= はプロキシサーバー所在地のIP推測位置が入ることがあるため除外）
  let lat = null;
  let lng = null;
  const imgStr = imgUrl || '';
  const hasMarkers = /[?&]markers=/i.test(imgStr);
  const hasHighZoom = /[?&]zoom=(?:1[5-9]|2\d)/i.test(imgStr);
  if (hasMarkers || hasHighZoom) {
    const coordMatch = imgStr.match(
      /[?&](?:markers|center)=(-?\d+\.\d+)(?:,|%2C)(-?\d+\.\d+)/i
    );
    if (coordMatch) {
      const cLat = parseFloat(coordMatch[1]);
      const cLng = parseFloat(coordMatch[2]);
      if (isValidJapanCoord(cLat, cLng)) {
        lat = cLat;
        lng = cLng;
      }
    }
  }

  const fromExpandedUrl = expandedUrl ? parseSingleGoogleMapsUrl(expandedUrl) : {};
  const combinedText = [usefulTitle, usefulDesc].filter(Boolean).join('\n');
  const fromTitleAndDesc = combinedText
    ? parseGoogleMapsShareInput({ rawText: combinedText })
    : {};

  const name = (fromExpandedUrl.name || fromTitleAndDesc.name || '').trim();
  const addressHint = (
    fromExpandedUrl.addressHint ||
    fromTitleAndDesc.addressHint ||
    ''
  ).trim();
  const prefFromText = combinedText
    ? extractPrefectureFromSpot({ address: combinedText, name: '' })
    : '';
  const prefecture = (
    fromTitleAndDesc.areaHint ||
    prefFromText ||
    fromExpandedUrl.areaHint ||
    ''
  ).trim();
  const cityMatch = combinedText.match(/([^\s・·,、\d都道府県]{1,10}[市区町村郡])/);
  const cityHint = cityMatch?.[1] || '';

  const finalLat = typeof fromExpandedUrl.lat === 'number' ? fromExpandedUrl.lat : lat;
  const finalLng = typeof fromExpandedUrl.lng === 'number' ? fromExpandedUrl.lng : lng;

  if (!name && finalLat == null && !addressHint && !expandedUrl) return null;
  return {
    name,
    address: addressHint,
    prefecture,
    cityHint,
    lat: finalLat,
    lng: finalLng,
    expandedUrl
  };
}

/**
 * Microlink API 呼び出し（prerender無しの高速2.5秒・429時は即時フォールバック）
 */
async function fetchMicrolinkFast(googleUrl, signal = null) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const endpoint = `https://api.microlink.io/?url=${encodeURIComponent(
      googleUrl
    )}&palette=false&audio=false&video=false`;
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) return null;

    const json = await res.json();
    const data = json?.data;
    if (!data) return null;

    const redirectUrls = Array.isArray(json.redirects)
      ? json.redirects.map((r) => (typeof r === 'string' ? r : r?.url || ''))
      : [];

    return extractMetadataFromPreview({
      urlList: [data.url || '', ...redirectUrls.slice().reverse()],
      rawTitle: data.title || '',
      rawDesc: data.description || '',
      imgUrl: data.image?.url || ''
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * OpenGraph.ninja API 呼び出し（CORS対応・日次5件制限なし・2.8秒タイムアウト）
 */
async function fetchOpenGraphNinjaFast(googleUrl, signal = null) {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(), 2800);
  try {
    const endpoint = `https://opengraph.ninja/api/v1?url=${encodeURIComponent(googleUrl)}`;
    const res = await fetch(endpoint, { signal: controller.signal });
    if (!res.ok) return null;

    const json = await res.json();
    const ogImgUrl =
      json?.image?.url || json?.details?.ogImage?.[0]?.url || '';
    return extractMetadataFromPreview({
      urlList: [json?.requestUrl || ''],
      rawTitle: json?.title || json?.details?.ogTitle || '',
      rawDesc: json?.description || json?.details?.ogDescription || '',
      imgUrl: ogImgUrl
    });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/**
 * 2つの高速メタデータ／リダイレクト展開APIを同時実行し、座標または住所が取れた時点で即返す（最大2.8秒）
 */
async function expandShortGoogleUrlViaMicrolink(googleUrl) {
  if (!googleUrl) return null;
  const cached = SHORT_URL_RESOLVE_CACHE.get(googleUrl);
  if (cached && Date.now() - cached.ts < SHORT_URL_CACHE_TTL_MS) {
    return cached.value;
  }

  const controller = new AbortController();
  const tasks = [
    fetchMicrolinkFast(googleUrl, controller.signal),
    fetchOpenGraphNinjaFast(googleUrl, controller.signal)
  ];

  const merged = await new Promise((resolve) => {
    let pending = tasks.length;
    const settledValues = [];
    let resolvedEarly = false;

    const finalize = () => {
      if (resolvedEarly) return;
      const valid = settledValues.filter(Boolean);
      if (valid.length === 0) {
        resolve(null);
        return;
      }
      const best = valid.reduce((acc, cur) => ({
        name: acc.name || cur.name || '',
        address:
          (acc.address || '').length >= (cur.address || '').length
            ? acc.address || ''
            : cur.address || '',
        prefecture: acc.prefecture || cur.prefecture || '',
        cityHint: acc.cityHint || cur.cityHint || '',
        lat: typeof acc.lat === 'number' ? acc.lat : cur.lat ?? null,
        lng: typeof acc.lng === 'number' ? acc.lng : cur.lng ?? null,
        expandedUrl:
          /\/place\/.*(?:@|!3d)/i.test(acc.expandedUrl || '')
            ? acc.expandedUrl
            : cur.expandedUrl || acc.expandedUrl || ''
      }));
      resolve(best);
    };

    tasks.forEach((p) => {
      p.then((val) => {
        if (val) settledValues.push(val);
        // 座標または詳細住所が取れた瞬間に他方の完了を待たず即リターン
        if (!resolvedEarly && val && (typeof val.lat === 'number' || val.address)) {
          resolvedEarly = true;
          controller.abort();
          resolve(val);
          return;
        }
      })
        .catch(() => {})
        .finally(() => {
          pending -= 1;
          if (pending <= 0) finalize();
        });
    });
  });

  if (merged) {
    if (SHORT_URL_RESOLVE_CACHE.size >= 40) {
      const oldest = SHORT_URL_RESOLVE_CACHE.keys().next().value;
      SHORT_URL_RESOLVE_CACHE.delete(oldest);
    }
    SHORT_URL_RESOLVE_CACHE.set(googleUrl, { value: merged, ts: Date.now() });
  }
  return merged;
}

/**
 * Gemini url_context ＋ google_search ツールを使い、短縮URL・FTID付きURLからピン地点情報を補完（3.6秒上限）
 * ※不確実な場合に別地域の同名神社を推測で当てはめない厳格ガード付き
 */
async function resolveShortGoogleMapsUrlWithGemini(
  googleUrl,
  expandedUrl = '',
  knownName = ''
) {
  const apiKey = getGeminiApiKey();
  if (!apiKey || (!googleUrl && !expandedUrl)) return null;

  const primaryModel = getGeminiModel() || 'gemini-4-hydrogen';
  const modelCandidates = [primaryModel, 'gemini-3.8-flash'].filter(
    (m, idx, arr) => Boolean(m) && arr.indexOf(m) === idx
  );

  const prompt = `
次のGoogleマップURLが指している日本の「特定の1地点（神社・お寺・スポット）」の情報をJSONだけで返してください。
短縮URL: ${googleUrl || 'なし'}
${expandedUrl && expandedUrl !== googleUrl ? `展開先URL: ${expandedUrl}` : ''}
${knownName ? `判明済み名称: ${knownName}` : ''}

重要ルール:
- 展開先URLに含まれる /data=!4m2!3m1!1s0x... などのPlace識別子やURL参照結果から、そのURLが指す「特定の1件」の都道府県・住所・緯度経度を確実に特定できた場合のみ値を埋めてください。
- 日本全国に同名神社が複数あり、このURLだけからはどこの県・どの1社か確実に特定できない場合は、推測で有名な別地点を当てはめず、prefecture・address は空文字 ""、lat・lng は null にして返してください。

{
  "name": "施設・神社・お寺の正式名（取得不可なら空文字）",
  "prefecture": "確実に特定できた場合のみ都道府県名（不明なら空文字）",
  "address": "確実に特定できた場合のみ住所（不明なら空文字）",
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
      const timer = setTimeout(() => controller.abort(), 3600);
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          tools: [{ url_context: {} }, { google_search: {} }],
          generationConfig: { temperature: 0.0 }
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
      const expandedFromMeta =
        retrievedUrls.find((u) => /google\.[^/]+\/maps/i.test(u)) || '';

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

      const finalExpanded = parsedJson?.expandedUrl || expandedFromMeta || '';
      const name = (parsedJson?.name || knownName || '').trim();
      const address = (parsedJson?.address || '').trim();
      const prefecture = (parsedJson?.prefecture || '').trim();
      const lat =
        typeof parsedJson?.lat === 'number' &&
        isValidJapanCoord(parsedJson.lat, parsedJson.lng)
          ? parsedJson.lat
          : null;
      const lng =
        lat != null && typeof parsedJson?.lng === 'number'
          ? parsedJson.lng
          : null;

      if (finalExpanded || name || address || lat != null) {
        return {
          name,
          prefecture,
          address,
          lat,
          lng,
          expandedUrl: finalExpanded
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
  let expandedUrlResolved = '';
  let cityHint = '';

  // 座標がまだ不明な GoogleマップURL（短縮URL単体、または「名前・住所＋URL」）なら
  // 短縮URLはリダイレクト展開(Microlink/OpenGraph.ninja) と 正確な住所ジオコーディング を並列で走らせる
  const isShortRedirectUrl = Boolean(
    parsed.googleUrl && /(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/maps)/i.test(parsed.googleUrl)
  );
  if ((parsed.lat == null || Number.isNaN(parsed.lat)) && (parsed.hasGoogleUrl || parsed.addressHint)) {
    const [fastExpanded, addrGeoRes] = await Promise.all([
      isShortRedirectUrl
        ? expandShortGoogleUrlViaMicrolink(parsed.googleUrl)
        : Promise.resolve(null),
      parsed.addressHint
        ? geocodeExactJapaneseAddress(parsed.addressHint, queryName)
        : Promise.resolve(null)
    ]);

    let expanded = fastExpanded;
    const missingCoordsAndLocation =
      expanded?.lat == null &&
      addrGeoRes == null &&
      !(expanded?.address || parsed.addressHint) &&
      !(expanded?.prefecture || parsed.areaHint);

    // 高速展開で名称しか取れなかった（またはレート制限等で取得不可）のときだけ Gemini url_context を追加試行
    if (missingCoordsAndLocation && parsed.hasGoogleUrl && parsed.googleUrl && getGeminiApiKey()) {
      const geminiExpanded = await resolveShortGoogleMapsUrlWithGemini(
        parsed.googleUrl,
        expanded?.expandedUrl || '',
        queryName || expanded?.name || ''
      );
      if (geminiExpanded) {
        expanded = {
          name: geminiExpanded.name || expanded?.name || '',
          address: geminiExpanded.address || expanded?.address || '',
          prefecture: geminiExpanded.prefecture || expanded?.prefecture || '',
          cityHint: expanded?.cityHint || '',
          lat: typeof geminiExpanded.lat === 'number' ? geminiExpanded.lat : expanded?.lat ?? null,
          lng: typeof geminiExpanded.lng === 'number' ? geminiExpanded.lng : expanded?.lng ?? null,
          expandedUrl: geminiExpanded.expandedUrl || expanded?.expandedUrl || ''
        };
      }
    }

    if (expanded) {
      expandedUrlResolved = expanded.expandedUrl || '';
      cityHint = expanded.cityHint || '';
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

    // 展開結果が住所のみ返して座標がまだない場合は、その住所もピンポイント座標へ変換
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
      isExactPinMatch: false,
      isShortUrlNameOnlyFallback: false,
      shortUrlResolvedName: '',
      expandedUrl: expandedUrlResolved
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
      isExactPinMatch: true,
      isShortUrlNameOnlyFallback: false,
      shortUrlResolvedName: exactSpot.name,
      expandedUrl: expandedUrlResolved
    };
  }

  // 座標が取れなかった短縮URL（Google側が@lat,lngを省略した形式）または ?q=神社名 型URLの検索フォールバック
  const searchCandidates = queryName
    ? await searchShrineCandidatesByName(queryName, parsed.areaHint, localSpots, userLocation)
    : [];

  let filtered = searchCandidates;
  const effectiveCityHint =
    cityHint || parsed.addressHint?.match(/([^\s都道府県]{1,10}[市区町村郡])/)?.[1] || '';
  if (effectiveCityHint) {
    const cityScoped = searchCandidates.filter((c) =>
      (c.address || '').includes(effectiveCityHint)
    );
    if (cityScoped.length > 0) {
      filtered = cityScoped;
    }
  }

  const isShortFallback = Boolean(
    parsed.hasGoogleUrl &&
      filtered.length > 1 &&
      !parsed.addressHint &&
      !parsed.areaHint &&
      parsed.lat == null
  );

  return {
    parsed: { ...parsed, name: queryName || parsed.name },
    candidates: filtered.slice(0, 15),
    needsManualName: false,
    isExactPinMatch: filtered.length === 1,
    isShortUrlNameOnlyFallback: isShortFallback,
    shortUrlResolvedName: queryName || parsed.name || '',
    expandedUrl: expandedUrlResolved
  };
}
