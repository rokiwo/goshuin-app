// 全国の神社・お寺を名前から検索し、同名社寺を含めて「現在地から近い順」に複数住所候補を返すサービス
// ★外部の従量課金APIは一切使用せず、完全無料のオープンデータ（OpenStreetMap Nominatim ＆ 国土地理院API）のみを使用します

import { DEFAULT_CENTER } from '../data/seedSpots.js';

/**
 * 2点間の距離（メートル）を計算
 */
function calcDistanceMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * 距離（メートル）を見やすい文字列（「850m」「2.4km」など）に整形
 */
function formatDistanceLabel(meters) {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) {
    return `${Math.round(meters / 10) * 10}m`;
  }
  const km = meters / 1000;
  return km < 10 ? `${km.toFixed(1)}km` : `${Math.round(km)}km`;
}

/**
 * 名称から神社（shrine）か寺院（temple）かを自動判定
 */
export function inferSpotTypeFromName(name = '', defaultType = 'shrine') {
  const n = name.trim();
  if (
    /(?:寺|院|堂|庵|大師|観音|不動|薬師|地蔵|阿弥陀|本願|山)$/.test(n) &&
    !/(?:神社|神宮|大社|天満宮|八幡宮)$/.test(n)
  ) {
    return 'temple';
  }
  if (/(?:神社|神宮|大社|天満宮|八幡宮|稲荷|権現|天神|明神|社|宮)$/.test(n)) {
    return 'shrine';
  }
  return defaultType;
}

/**
 * Nominatimのaddressオブジェクトおよびdisplay_nameから自然な日本語住所（「都道府県市区町村町名」）を組み立てる
 */
function formatJapaneseAddress(item) {
  const addr = item.address || {};
  const pref = addr.province || addr.state || addr.region || '';
  const city =
    addr.city ||
    addr.county ||
    addr.town ||
    addr.village ||
    addr.municipality ||
    '';
  const ward =
    addr.suburb ||
    addr.city_district ||
    addr.ward ||
    addr.borough ||
    (addr.city && (addr.town || addr.village) ? addr.town || addr.village : '') ||
    '';
  const area =
    addr.quarter ||
    addr.neighbourhood ||
    addr.hamlet ||
    addr.road ||
    '';
  const houseNum = addr.house_number || '';

  let combined = `${pref}${city}${ward === city ? '' : ward}${area}${
    houseNum ? ' ' + houseNum : ''
  }`.trim();

  if (!combined && item.display_name) {
    const parts = item.display_name
      .split(',')
      .map((s) => s.trim())
      .filter(
        (s) =>
          s &&
          s !== '日本' &&
          !/^\d{3}-?\d{4}$/.test(s) &&
          s !== item.name
      );
    combined = parts.reverse().join('');
  }

  return combined || '住所情報あり';
}

/**
 * 神社・お寺の名前（＋任意の地域キーワード）から全国の候補リスト（住所・座標・現在地からの距離付き）を検索し、
 * **現在地から近い順**にソートして返す（完全無料・API課金ゼロ）
 *
 * @param {string} nameQuery 神社・お寺の名前（例: "住吉神社", "貴船神社", "生田神社"）
 * @param {string} areaHint 絞り込み地域キーワード（例: "兵庫", "京都" など任意）
 * @param {Array} localSpots アプリ内既存のスポット配列
 * @param {{lat: number, lng: number}} userLocation ユーザーの現在地座標
 */
export async function searchShrineCandidatesByName(
  nameQuery,
  areaHint = '',
  localSpots = [],
  userLocation = DEFAULT_CENTER
) {
  const cleanName = (nameQuery || '').trim();
  const cleanArea = (areaHint || '').trim();
  if (!cleanName) return [];

  const baseLat =
    typeof userLocation?.lat === 'number' ? userLocation.lat : DEFAULT_CENTER.lat;
  const baseLng =
    typeof userLocation?.lng === 'number' ? userLocation.lng : DEFAULT_CENTER.lng;

  const rawCandidates = [];

  // 重複排除付きで候補リストに追加するヘルパー（半径180m以内の同名スポットは統合）
  const pushCandidate = (cand) => {
    if (Number.isNaN(cand.lat) || Number.isNaN(cand.lng)) return;
    const existingIdx = rawCandidates.findIndex(
      (ex) =>
        calcDistanceMeters(ex.lat, ex.lng, cand.lat, cand.lng) < 180 &&
        (ex.name === cand.name ||
          ex.name.includes(cand.name) ||
          cand.name.includes(ex.name))
    );
    if (existingIdx >= 0) {
      // 既存より住所情報が詳しければ補完する
      if (
        (!rawCandidates[existingIdx].address ||
          rawCandidates[existingIdx].address === '住所情報あり') &&
        cand.address &&
        cand.address !== '住所情報あり'
      ) {
        rawCandidates[existingIdx].address = cand.address;
        rawCandidates[existingIdx].prefecture =
          cand.prefecture || rawCandidates[existingIdx].prefecture;
      }
      return;
    }

    const distMeters = calcDistanceMeters(baseLat, baseLng, cand.lat, cand.lng);
    rawCandidates.push({
      ...cand,
      distanceMeters: distMeters,
      distanceLabel: formatDistanceLabel(distMeters)
    });
  };

  // 1. アプリ内登録済みスポット（SEED_SPOTS＋周辺取得済みスポット）から検索
  for (const s of localSpots || []) {
    const matchName =
      s.name.includes(cleanName) ||
      cleanName.includes(s.name.replace(/（.*?）|\(.*?\)/g, ''));
    const matchArea =
      !cleanArea ||
      (s.address || '').includes(cleanArea) ||
      s.name.includes(cleanArea);

    if (matchName && matchArea) {
      pushCandidate({
        id: s.id || `local-${s.lat}-${s.lng}`,
        name: s.name,
        type: s.type || inferSpotTypeFromName(s.name),
        address: s.address || '',
        prefecture: (s.address || '').match(/^(.+?[都道府県])/)?.[1] || '',
        lat: s.lat,
        lng: s.lng,
        denomination: s.denomination,
        sampleGoshuin: s.sampleGoshuin,
        source: '周辺・登録スポット'
      });
    }
  }

  const q = cleanArea ? `${cleanName} ${cleanArea}` : cleanName;

  // 現在地周辺（約120km四方）の検索ボックス（近い順で漏れなく拾うため）
  const viewbox = `${(baseLng - 1.2).toFixed(4)},${(baseLat + 1.2).toFixed(4)},${(
    baseLng + 1.2
  ).toFixed(4)},${(baseLat - 1.2).toFixed(4)}`;

  const nearNominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&dedupe=0&countrycodes=jp&viewbox=${viewbox}&bounded=1&limit=25&accept-language=ja&q=${encodeURIComponent(
    q
  )}`;
  const nationNominatimUrl = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&dedupe=0&countrycodes=jp&limit=35&accept-language=ja&q=${encodeURIComponent(
    q
  )}`;

  // 2. 現在地周辺検索と全国検索を並列実行（いずれも完全無料のOpenStreetMap API）
  try {
    const [nearRes, nationRes] = await Promise.allSettled([
      fetch(nearNominatimUrl, { headers: { 'Accept-Language': 'ja' } }),
      fetch(nationNominatimUrl, { headers: { 'Accept-Language': 'ja' } })
    ]);

    const parseNominatimList = async (settled) => {
      if (settled.status !== 'fulfilled' || !settled.value.ok) return [];
      const json = await settled.value.json();
      return Array.isArray(json) ? json : [];
    };

    const [nearList, nationList] = await Promise.all([
      parseNominatimList(nearRes),
      parseNominatimList(nationRes)
    ]);

    for (const item of [...nearList, ...nationList]) {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

      const rawName = (item.name || cleanName).trim();
      const isWorshipPlace =
        item.type === 'place_of_worship' ||
        item.class === 'amenity' ||
        item.class === 'historic' ||
        item.class === 'tourism' ||
        /(?:神社|神宮|大社|宮|稲荷|天神|権現|寺|院|堂|大師|観音|不動|薬師|地蔵)/.test(
          rawName
        );

      if (!isWorshipPlace) continue;

      const formattedAddr = formatJapaneseAddress(item);
      const pref =
        item.address?.province ||
        item.address?.state ||
        formattedAddr.match(/^(.+?[都道府県])/)?.[1] ||
        '';

      pushCandidate({
        id: `nom-${item.place_id}`,
        name: rawName,
        type: inferSpotTypeFromName(rawName),
        address: formattedAddr,
        prefecture: pref,
        lat,
        lng,
        source: '全国検索'
      });
    }
  } catch (err) {
    console.warn('Nominatim search warning:', err);
  }

  // 3. ★現在地から近い順（昇順）に並び替えて返却
  rawCandidates.sort((a, b) => a.distanceMeters - b.distanceMeters);

  return rawCandidates.slice(0, 25);
}
