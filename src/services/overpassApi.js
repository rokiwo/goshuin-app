import { SEED_SPOTS } from '../data/seedSpots.js';

// Overpass APIのミラーエンドポイント一覧（通信失敗時の自動フォールバック用）
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter'
];

/**
 * 2点間の距離（km）をHaversine公式で計算する関数
 */
export function calculateDistanceKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371; // 地球半径 (km)
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * 街角の小さな祠・地蔵尊・集会所など（御朱印がない小規模オブジェクト）を除外し、
 * 御朱印が授与されている可能性が高い神社・寺院かどうかを判定するフィルタ関数
 */
function isGoshuinCandidateName(name) {
  if (!name || name.length < 2) return false;
  // 明らかに御朱印がない小祠・地蔵・墓地・教会・詰所などを除外
  const excludePattern = /(地蔵尊|地蔵堂|小祠|稲荷祠|墓地|霊園|納骨堂|集会所|会館|詰所|教会|天理教|金光教|黒住教|創価|顕正|幸福の科学|エホバ|モスク)/;
  if (excludePattern.test(name)) return false;

  // 神社・神宮・大社・天満宮・八幡宮・稲荷・戎・寺・院・大師・観音・不動・薬師などを含むものを採用
  const validPattern = /(神社|神宮|大社|天満宮|天神|八幡|稲荷|戎|恵比寿|皇大|住吉|春日|八坂|厳島|素盞嗚|権現|明神|寺|院|庵|大師|観音|不動|薬師|毘沙門|山門|本堂)/;
  return validPattern.test(name);
}

/**
 * 動的に取得した寺社データに対して御朱印見本カードを生成するヘルパー
 */
function buildDynamicSampleGoshuin(name, type, denomination) {
  const cleanName = name.replace(/\s+/g, '');
  const shortCalligraphy = cleanName.length <= 5 ? cleanName : cleanName.slice(0, 4);

  if (type === 'shrine') {
    return [
      {
        id: `${cleanName}-std`,
        title: `通常御朱印「${cleanName}」`,
        badge: '社務所授与（要確認）',
        fee: '初穂料 300〜500円目安',
        calligraphy: shortCalligraphy,
        subText: '奉拝 御神前',
        stampText: `${shortCalligraphy}印`,
        motif: 'torii',
        description: `${cleanName}の御朱印イメージです。上の「Instagram / Google画像 / ホトカミ」ボタンから実際の参拝者投稿写真を確認できます。`
      }
    ];
  } else {
    return [
      {
        id: `${cleanName}-std`,
        title: `本尊御朱印「大悲殿 / 奉拝」`,
        badge: '寺務所授与（要確認）',
        fee: '納経料 300〜500円目安',
        calligraphy: '大悲殿',
        subText: cleanName,
        stampText: `${shortCalligraphy}宝印`,
        motif: 'lotus',
        description: `${cleanName}（${denomination}）の納経御朱印イメージです。上の「Instagram / Google画像 / ホトカミ」ボタンから実際の参拝者投稿写真を確認できます。`
      }
    ];
  }
}

/**
 * 宗派タグ（denomination）を日本語表記に変換するヘルパー
 */
function formatDenomination(tags, type) {
  const denom = (tags['denomination'] || '').toLowerCase();
  if (type === 'shrine') {
    if (denom.includes('inari')) return '神道（稲荷信仰）';
    if (denom.includes('hachiman')) return '神道（八幡信仰）';
    if (denom.includes('tenjin') || denom.includes('tenmangu')) return '神道（天神信仰）';
    if (denom.includes('sumiyoshi')) return '神道（住吉信仰）';
    return '神道（神社）';
  }
  if (denom.includes('shingon')) return '真言宗';
  if (denom.includes('tendai')) return '天台宗';
  if (denom.includes('jodo_shin') || denom.includes('shin')) return '浄土真宗';
  if (denom.includes('jodo')) return '浄土宗';
  if (denom.includes('soto')) return '曹洞宗';
  if (denom.includes('rinzai')) return '臨済宗';
  if (denom.includes('nichiren')) return '日蓮宗';
  return '仏教（寺院）';
}

/**
 * Wikipedia Geosearch API を使って、指定座標の周辺にある「Wikipediaに記事が存在する有名神社・寺院」
 * （＝社務所・寺務所があり御朱印がもらえる確率が極めて高い寺社）を高速検索する関数
 */
async function fetchWikipediaFamousTemplesAndShrines(centerLat, centerLng, radiusMeters = 10000) {
  try {
    const safeRadius = Math.min(Math.max(radiusMeters, 1000), 10000);
    const url = `https://ja.wikipedia.org/w/api.php?origin=*&action=query&format=json&list=geosearch&gscoord=${centerLat}|${centerLng}&gsradius=${safeRadius}&gslimit=100`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const items = data?.query?.geosearch || [];

    const results = [];
    for (const item of items) {
      const title = item.title || '';
      if (!isGoshuinCandidateName(title)) continue;
      const cleanName = title.replace(/\s*\(.*?\)\s*/g, '').trim();
      const isShrine = /(神社|神宮|大社|天満宮|天神|八幡|稲荷|戎|恵比寿|皇大|住吉|春日|八坂|厳島|素盞嗚|権現|明神)$/.test(cleanName);
      const type = isShrine ? 'shrine' : 'temple';
      const denomination = isShrine ? '神道（有名神社）' : '仏教（有名寺院）';

      results.push({
        id: `wiki-${item.pageid}`,
        name: cleanName,
        reading: '',
        type,
        denomination,
        address: '周辺有名社寺（詳細はGoogleマップボタンで確認）',
        lat: item.lat,
        lng: item.lon,
        distanceKm: calculateDistanceKm(centerLat, centerLng, item.lat, item.lon),
        description: `${cleanName}はWikipediaにも掲載されている地域の主要な${
          isShrine ? '神社' : '寺院'
        }で、御朱印が授与されている可能性が高いスポットです。`,
        sampleGoshuin: buildDynamicSampleGoshuin(cleanName, type, denomination),
        hasGoshuin: true,
        isSeed: false
      });
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Overpass API と Wikipedia Geosearch API を並列実行し、
 * マスターデータ（確実に御朱印がある有名社寺）と統合して大量の神社・寺院を高速に返す関数
 */
export async function fetchNearbyWorshipSpots(centerLat, centerLng, radiusMeters = 12000) {
  // 1. マスターデータ全件に現在地からの距離を付与
  const enrichedSeeds = SEED_SPOTS.map((spot) => ({
    ...spot,
    distanceKm: calculateDistanceKm(centerLat, centerLng, spot.lat, spot.lng),
    isSeed: true
  }));

  // 2. Wikipedia Geosearch（有名社寺抽出）と Overpass API（OSM全社寺抽出）を並列スタート
  const wikiPromise = fetchWikipediaFamousTemplesAndShrines(centerLat, centerLng, radiusMeters);

  // Overpass QL: 正規表現を避けて高速化し、node / way 両方から最大500件取得（半径15〜20km対応）
  const query = `
    [out:json][timeout:20];
    (
      node["amenity"="place_of_worship"]["religion"="shinto"]["name"](around:${radiusMeters},${centerLat},${centerLng});
      way["amenity"="place_of_worship"]["religion"="shinto"]["name"](around:${radiusMeters},${centerLat},${centerLng});
      node["amenity"="place_of_worship"]["religion"="buddhist"]["name"](around:${radiusMeters},${centerLat},${centerLng});
      way["amenity"="place_of_worship"]["religion"="buddhist"]["name"](around:${radiusMeters},${centerLat},${centerLng});
    );
    out center 500;
  `;

  const overpassPromise = (async () => {
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 16000);

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8'
          },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal
        });

        clearTimeout(timeoutId);
        if (!response.ok) continue;

        const data = await response.json();
        if (data && Array.isArray(data.elements)) {
          return { elements: data.elements, ok: true };
        }
      } catch {
        // 次のミラーサーバーへ
      }
    }
    return { elements: [], ok: false };
  })();

  const [wikiSpots, overpassResult] = await Promise.all([wikiPromise, overpassPromise]);

  // 名前の正規化キー（重複排除用）
  const normalizeNameKey = (n) =>
    n.replace(/（.*?）|\(.*?\)|\s+/g, '').trim();

  const seenNames = new Set(enrichedSeeds.map((s) => normalizeNameKey(s.name)));
  const dynamicSpots = [];

  // まずWikipediaの有名寺社を追加
  for (const wSpot of wikiSpots) {
    const key = normalizeNameKey(wSpot.name);
    if (!key || seenNames.has(key)) continue;
    seenNames.add(key);
    dynamicSpots.push(wSpot);
  }

  // 次にOverpass APIの寺社を追加（小祠などを除外し、本物の神社・寺院を優先）
  for (const el of overpassResult.elements) {
    const tags = el.tags || {};
    const name = (tags['name:ja'] || tags['name'] || '').trim();
    if (!isGoshuinCandidateName(name)) continue;

    const key = normalizeNameKey(name);
    if (seenNames.has(key)) continue;

    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;

    const type = tags.religion === 'shinto' ? 'shrine' : 'temple';
    const denomination = formatDenomination(tags, type);

    const city = tags['addr:city'] || '';
    const sub = tags['addr:suburb'] || tags['addr:quarter'] || tags['addr:neighbourhood'] || '';
    const block = tags['addr:block_number'] || tags['addr:housenumber'] || '';
    const fullAddr = tags['addr:full'] || `${tags['addr:province'] || ''}${city}${sub}${block}`.trim();

    // ウェブサイトやwikidataタグがある寺社は御朱印授与確率が特に高い
    const hasRichTag = Boolean(tags.website || tags.wikidata || tags.wikipedia);

    seenNames.add(key);

    dynamicSpots.push({
      id: `osm-${el.type}-${el.id}`,
      name,
      reading: tags['name:ja-Hira'] || tags['name:reading'] || '',
      type,
      denomination,
      address: fullAddr || '所在地は地図ピンまたはGoogleマップボタンでご確認ください',
      lat,
      lng,
      distanceKm: calculateDistanceKm(centerLat, centerLng, lat, lng),
      description:
        tags.description ||
        (type === 'shrine'
          ? `${name}は地域で篤く崇敬される神社です。詳細シートのInstagram・ホトカミ・AI検索から御朱印の授与状況を確認できます。`
          : `${name}は歴史と信仰を伝える寺院です。詳細シートのInstagram・ホトカミ・AI検索から御朱印の授与状況を確認できます。`),
      sampleGoshuin: buildDynamicSampleGoshuin(name, type, denomination),
      hasGoshuin: hasRichTag,
      isSeed: false
    });
  }

  // 統合して「指定半径内」のみに絞り込み、現在地から近い順にソート
  const radiusKm = radiusMeters / 1000;
  const combined = [...enrichedSeeds, ...dynamicSpots]
    .filter((s) => s.distanceKm <= radiusKm)
    .sort((a, b) => a.distanceKm - b.distanceKm);

  return {
    spots: combined,
    source: overpassResult.ok || wikiSpots.length > 0 ? 'overpass+wiki+seed' : 'seed-fallback',
    dynamicCount: dynamicSpots.length
  };
}
