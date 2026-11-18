// 地図上の任意の地点をタップしたとき、その座標周辺にある神社・お寺をマルチソースで即座に特定し、
// 別アプリを開かずにワンタップで「★お気に入り登録」できるようにする高速ピンポイント特定サービス

import { DEFAULT_CENTER } from '../data/seedSpots.js';
import { extractPrefectureFromSpot } from '../db/database.js';
import { getGeminiApiKey, getGeminiModel } from './geminiService.js';
import {
  inferSpotTypeFromName,
  buildDefaultSampleGoshuin,
  calcDistanceMeters,
  formatDistanceLabel,
  normalizeShrineText
} from './shrineSearchService.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

const EXCLUDE_NON_SHRINE =
  /(墓地|霊園|納骨堂|集会所|自治会館|公民館|詰所|キリスト|カトリック|プロテスタント|天理教|金光教|黒住教|創価|顕正|幸福の科学|エホバ|モスク)/;
const SHRINE_OR_TEMPLE_NAME =
  /(神社|神宮|大社|天満宮|天神|八幡|稲荷|戎|恵比寿|恵美須|住吉|春日|八坂|厳島|権現|明神|社|宮|祠|御旅所|遥拝所|寺|院|堂|庵|坊|閣|大師|観音|不動|薬師|地蔵|阿弥陀|毘沙門|弁天|妙見|荒神|聖天|霊場)/;

function isRelevantWorshipSpotName(name = '') {
  const n = String(name || '').trim();
  if (n.length < 2) return false;
  if (EXCLUDE_NON_SHRINE.test(n)) return false;
  return SHRINE_OR_TEMPLE_NAME.test(n);
}

/**
 * 超小範囲 Overpass API クエリ（タップ座標の半径260m以内）
 */
async function lookupOverpassAroundTap(lat, lng) {
  const query = `
[out:json][timeout:6];
(
  node(around:260,${lat},${lng})["amenity"="place_of_worship"]["name"];
  way(around:260,${lat},${lng})["amenity"="place_of_worship"]["name"];
  relation(around:260,${lat},${lng})["amenity"="place_of_worship"]["name"];
  node(around:260,${lat},${lng})["historic"="wayside_shrine"]["name"];
  node(around:260,${lat},${lng})["religion"~"shinto|buddhist"]["name"];
  way(around:260,${lat},${lng})["religion"~"shinto|buddhist"]["name"];
);
out center 25;
`;

  for (const url of OVERPASS_ENDPOINTS) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal
      });
      clearTimeout(timer);
      if (!res.ok) continue;

      const data = await res.json();
      const elements = Array.isArray(data?.elements) ? data.elements : [];
      return elements
        .map((el) => {
          const tags = el.tags || {};
          const name = (tags.name || tags['name:ja'] || '').trim();
          const sLat = el.lat ?? el.center?.lat;
          const sLng = el.lon ?? el.center?.lon;
          if (!name || typeof sLat !== 'number' || typeof sLng !== 'number') return null;
          if (EXCLUDE_NON_SHRINE.test(name)) return null;

          const isWorshipTag =
            tags.amenity === 'place_of_worship' ||
            tags.religion === 'shinto' ||
            tags.religion === 'buddhist' ||
            tags.historic === 'wayside_shrine';
          if (!isWorshipTag && !SHRINE_OR_TEMPLE_NAME.test(name)) return null;

          // 他宗教除外
          if (
            tags.religion &&
            !['shinto', 'buddhist', 'shinto;buddhist'].includes(tags.religion)
          ) {
            return null;
          }

          const type =
            tags.religion === 'buddhist'
              ? 'temple'
              : tags.religion === 'shinto'
              ? 'shrine'
              : inferSpotTypeFromName(name);

          const addr = `${tags['addr:province'] || ''}${tags['addr:city'] || ''}${
            tags['addr:suburb'] || tags['addr:quarter'] || ''
          }${tags['addr:block_number'] || ''}${tags['addr:housenumber'] || ''}`.trim();

          return {
            id: `tap-osm-${el.type}-${el.id}`,
            name,
            type,
            address: addr,
            lat: sLat,
            lng: sLng,
            source: 'マップタップ検出'
          };
        })
        .filter(Boolean);
    } catch {
      // 次エンドポイントへ
    }
  }
  return [];
}

/**
 * Wikipedia Geosearch API（半径450m以内の有名寺社記事）
 */
async function lookupWikiAroundTap(lat, lng) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3500);
    const res = await fetch(
      `https://ja.wikipedia.org/w/api.php?action=query&list=geosearch&gscoord=${lat}|${lng}&gsradius=450&gslimit=10&format=json&origin=*`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return [];
    const data = await res.json();
    const rows = data?.query?.geosearch || [];
    return rows
      .filter((r) => isRelevantWorshipSpotName(r.title))
      .map((r) => ({
        id: `tap-wiki-${r.pageid}`,
        name: r.title,
        type: inferSpotTypeFromName(r.title),
        address: '',
        lat: r.lat,
        lng: r.lon,
        source: 'Wikipedia周辺'
      }));
  } catch {
    return [];
  }
}

/**
 * Nominatim Reverse Geocoding（タップ地点の住所取得＋施設名があれば候補化）
 */
async function reverseLookupAtTap(lat, lng) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        lat
      )}&lon=${encodeURIComponent(lng)}&zoom=18&addressdetails=1&accept-language=ja`,
      { signal: controller.signal }
    );
    clearTimeout(timer);
    if (!res.ok) return { address: '', candidate: null };

    const item = await res.json();
    const addr = item.address || {};
    const pref = addr.province || addr.state || '';
    const city = addr.city || addr.county || addr.town || addr.village || '';
    const area =
      addr.suburb || addr.ward || addr.quarter || addr.neighbourhood || addr.road || '';
    const combinedAddr = `${pref}${city}${area}`.trim() || '';

    const rawName = (item.name || '').trim();
    const isSpot = isRelevantWorshipSpotName(rawName);
    const candidate = isSpot
      ? {
          id: `tap-nom-${item.place_id || `${lat.toFixed(5)}-${lng.toFixed(5)}`}`,
          name: rawName,
          type: inferSpotTypeFromName(rawName),
          address: combinedAddr,
          lat: Number(item.lat) || lat,
          lng: Number(item.lon) || lng,
          source: '地図ピン特定'
        }
      : null;

    return { address: combinedAddr, candidate };
  } catch {
    return { address: '', candidate: null };
  }
}

/**
 * Gemini + Google検索による座標からの神社・お寺特定（他ソースで0件時のみ起動）
 */
async function lookupAtTapWithGemini(lat, lng, addressHint = '') {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return [];

  try {
    const modelId = getGeminiModel() || 'gemini-4-hydrogen';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelId
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const prompt = `
日本の地図上の座標（北緯 ${lat.toFixed(6)}, 東経 ${lng.toFixed(6)}、周辺住所: ${
      addressHint || '不明'
    }）のすぐ近く（半径250m以内）にある実在の神社・寺院を最大3件、JSON配列だけで返してください。
見つからない場合や不明な場合は空配列 [] のみ返してください。推測で架空の名称を作らないでください。
[
  { "name": "神社・寺院名", "type": "shrine または temple", "address": "住所", "lat": 数値, "lng": 数値 }
]
`.trim();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 7000);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        tools: [{ google_search: {} }],
        generationConfig: { temperature: 0.1 }
      })
    });
    clearTimeout(timer);
    if (!res.ok) return [];

    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || '').join('\n') || '';
    const arrMatch = text.match(/\[[\s\S]*\]/);
    if (!arrMatch) return [];

    const parsed = JSON.parse(arrMatch[0]);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && p.name && typeof p.lat === 'number' && typeof p.lng === 'number')
      .map((p, idx) => ({
        id: `tap-ai-${lat.toFixed(5)}-${lng.toFixed(5)}-${idx}`,
        name: String(p.name).trim(),
        type: p.type === 'temple' ? 'temple' : inferSpotTypeFromName(p.name),
        address: String(p.address || addressHint || '').trim(),
        lat: p.lat,
        lng: p.lng,
        source: 'AI周辺特定'
      }));
  } catch {
    return [];
  }
}

/**
 * 地図タップ座標（lat, lng）の周辺神社・お寺を高速検索して返す
 */
export async function lookupShrinesAtTapCoordinate(
  lat,
  lng,
  localSpots = [],
  userLocation = DEFAULT_CENTER
) {
  const baseLat = typeof userLocation?.lat === 'number' ? userLocation.lat : DEFAULT_CENTER.lat;
  const baseLng = typeof userLocation?.lng === 'number' ? userLocation.lng : DEFAULT_CENTER.lng;

  // 1. 既読スポット（280m以内）
  const nearLocal = (localSpots || [])
    .filter(
      (s) =>
        typeof s.lat === 'number' &&
        typeof s.lng === 'number' &&
        calcDistanceMeters(lat, lng, s.lat, s.lng) <= 280
    )
    .map((s) => ({
      ...s,
      source: '周辺取得済'
    }));

  // 2. Overpass + Wikipedia + Nominatim を並列高速実行
  const [osmList, wikiList, nomResult] = await Promise.all([
    lookupOverpassAroundTap(lat, lng),
    lookupWikiAroundTap(lat, lng),
    reverseLookupAtTap(lat, lng)
  ]);

  const fallbackAddress = nomResult.address || '';
  let rawAll = [
    ...nearLocal,
    ...(nomResult.candidate ? [nomResult.candidate] : []),
    ...osmList,
    ...wikiList
  ];

  // 3. 上記すべてで0件だった場合のみ Gemini Google検索フォールバック
  if (rawAll.length === 0) {
    const aiList = await lookupAtTapWithGemini(lat, lng, fallbackAddress);
    rawAll = [...aiList];
  }

  // 4. 重複統合＋タップ位置に近い順ソート
  const deduped = [];
  for (const item of rawAll) {
    const norm = normalizeShrineText(item.name);
    const tapDist = calcDistanceMeters(lat, lng, item.lat, item.lng);
    const existing = deduped.find(
      (ex) =>
        calcDistanceMeters(ex.lat, ex.lng, item.lat, item.lng) < 80 &&
        (normalizeShrineText(ex.name) === norm ||
          normalizeShrineText(ex.name).includes(norm) ||
          norm.includes(normalizeShrineText(ex.name)))
    );
    if (existing) {
      if ((!existing.address || existing.address.length < (item.address || '').length) && item.address) {
        existing.address = item.address;
      }
      continue;
    }

    const resolvedAddress = item.address || fallbackAddress;
    const pref = extractPrefectureFromSpot({
      address: resolvedAddress,
      lat: item.lat,
      lng: item.lng
    });
    const userDistMeters = calcDistanceMeters(baseLat, baseLng, item.lat, item.lng);
    const spotType = item.type || inferSpotTypeFromName(item.name);

    deduped.push({
      ...item,
      type: spotType,
      denomination:
        item.denomination || (spotType === 'temple' ? '仏教（寺院）' : '神道（神社）'),
      address: resolvedAddress || pref || '住所情報あり',
      prefecture: pref,
      distanceFromTapMeters: tapDist,
      distanceFromTapLabel: formatDistanceLabel(tapDist),
      distanceKm: Math.round((userDistMeters / 1000) * 10) / 10,
      distanceLabel: formatDistanceLabel(userDistMeters),
      sampleGoshuin:
        item.sampleGoshuin && item.sampleGoshuin.length > 0
          ? item.sampleGoshuin
          : buildDefaultSampleGoshuin(item.name, spotType)
    });
  }

  deduped.sort((a, b) => a.distanceFromTapMeters - b.distanceFromTapMeters);

  return {
    candidates: deduped.slice(0, 6),
    fallbackAddress,
    prefecture: extractPrefectureFromSpot({ address: fallbackAddress, lat, lng })
  };
}
