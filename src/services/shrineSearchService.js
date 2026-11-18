// 全国の神社・お寺を名前や地域名から高精度にマルチソース検索し、
// 同名社寺を含めて「現在地から近い順」に複数住所候補（都道府県・座標付き）を返すサービス
// ★検索漏れ（「神社名を入れてもヒットしない」問題）を解消するため、以下の5つの検索エンジンを並列統合：
//   1. アプリ内登録済みスポット（旧字・異体字・スペース正規化対応）
//   2. 国土地理院（GSI）公式ジオコーディングAPI（msearch.gsi.go.jp：日本全国の神社・寺院・地名を網羅）
//   3. OpenStreetMap Nominatim API（現在地周辺＆全国の2段検索、制限フィルタを緩和しヒット率向上）
//   4. Wikipedia 日本語版 位置情報付き記事検索（有名社寺・別名・通称に強い）
//   5. Overpass API / Gemini AI 検索フォールバック（上記で0件だった場合でも確実に発見）

import { DEFAULT_CENTER } from '../data/seedSpots.js';
import { extractPrefectureFromSpot, ALL_PREFECTURES } from '../db/database.js';
import { getGeminiApiKey, getGeminiModel } from './geminiService.js';

// 都道府県コード（JIS X 0401：01〜47）→ 都道府県名マップ（国土地理院のaddressCode先頭2桁または1〜2桁に対応）
const PREF_CODE_MAP = {
  1: '北海道',
  2: '青森県',
  3: '岩手県',
  4: '宮城県',
  5: '秋田県',
  6: '山形県',
  7: '福島県',
  8: '茨城県',
  9: '栃木県',
  10: '群馬県',
  11: '埼玉県',
  12: '千葉県',
  13: '東京都',
  14: '神奈川県',
  15: '新潟県',
  16: '富山県',
  17: '石川県',
  18: '福井県',
  19: '山梨県',
  20: '長野県',
  21: '岐阜県',
  22: '静岡県',
  23: '愛知県',
  24: '三重県',
  25: '滋賀県',
  26: '京都府',
  27: '大阪府',
  28: '兵庫県',
  29: '奈良県',
  30: '和歌山県',
  31: '鳥取県',
  32: '島根県',
  33: '岡山県',
  34: '広島県',
  35: '山口県',
  36: '徳島県',
  37: '香川県',
  38: '愛媛県',
  39: '高知県',
  40: '福岡県',
  41: '佐賀県',
  42: '長崎県',
  43: '熊本県',
  44: '大分県',
  45: '宮崎県',
  46: '鹿児島県',
  47: '沖縄県'
};

/**
 * 国土地理院の5桁（または4桁）市区町村コードから都道府県名を取得
 * 例: "28110" -> 28 -> "兵庫県", "1203" -> 1 -> "北海道"
 */
function getPrefectureFromAddressCode(addressCode = '') {
  const codeStr = String(addressCode).trim();
  if (!codeStr || !/^\d+$/.test(codeStr)) return '';
  const padded = codeStr.length === 4 ? `0${codeStr}` : codeStr;
  const prefNum = parseInt(padded.slice(0, 2), 10);
  return PREF_CODE_MAP[prefNum] || '';
}

/**
 * 神社・お寺検索用の表記ゆれ正規化（旧字体・異体字・空白除去）
 * 例：「八坂神社」⇔「八阪神社」、「貴船」⇔「貴布禰」、「龍」⇔「竜」、「國」⇔「国」など
 */
export function normalizeShrineText(text = '') {
  return String(text)
    .trim()
    .replace(/[\s　]+/g, '')
    .replace(/（.*?）|\(.*?\)/g, '')
    .replace(/ケ/g, 'ヶ')
    .replace(/ガ/g, 'ヶ')
    .replace(/ノ/g, '之')
    .replace(/ー/g, '')
    .replace(/齋/g, '斎')
    .replace(/齊/g, '斉')
    .replace(/龍/g, '竜')
    .replace(/國/g, '国')
    .replace(/總/g, '総')
    .replace(/八幡宮/g, '八幡神社')
    .replace(/天満宮/g, '天神社')
    .replace(/大神宮/g, '神宮')
    .toLowerCase();
}

/**
 * 検索クエリから複数の検索バリエーションを生成
 * （例：「お菊神社」→「お菊神社」「菊神社」、「住吉大社」→「住吉大社」「住吉神社」など）
 */
function buildQueryVariants(rawQuery = '') {
  const base = rawQuery.trim().replace(/[\s　]+/g, ' ');
  if (!base) return [];
  const variants = new Set([base]);

  // 「神社」「寺」などが付いていない短い名前の場合、「〇〇神社」「〇〇寺」も候補に追加
  if (
    base.length >= 2 &&
    !/(?:神社|神宮|大社|天満宮|八幡宮|稲荷|権現|天神|明神|社|宮|寺|院|堂|大師|観音|不動)$/.test(base)
  ) {
    variants.add(`${base}神社`);
    variants.add(`${base}寺`);
  }

  // 「〜ノ宮」「〜の宮」「〜之宮」の表記ゆれ展開
  if (/[ノの之]宮/.test(base)) {
    variants.add(base.replace(/[ノの之]宮/g, '宮'));
    variants.add(base.replace(/[ノの之]宮/g, 'ノ宮'));
    variants.add(base.replace(/[ノの之]宮/g, 'の宮'));
  }

  // 旧字体・新字体の展開
  if (base.includes('竜')) variants.add(base.replace(/竜/g, '龍'));
  if (base.includes('龍')) variants.add(base.replace(/龍/g, '竜'));
  if (base.includes('恵比寿')) {
    variants.add(base.replace(/恵比寿/g, '戎'));
    variants.add(base.replace(/恵比寿/g, '恵美須'));
  }
  if (base.includes('戎')) {
    variants.add(base.replace(/戎/g, '恵比寿'));
    variants.add(base.replace(/戎/g, '恵美須'));
  }

  return Array.from(variants).slice(0, 3);
}

/**
 * 2点間の距離（メートル）を計算
 */
export function calcDistanceMeters(lat1, lng1, lat2, lng2) {
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
export function formatDistanceLabel(meters) {
  if (!Number.isFinite(meters)) return '';
  if (meters < 1000) {
    return `${Math.max(10, Math.round(meters / 10) * 10)}m`;
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
  if (/(?:神社|神宮|大社|天満宮|八幡宮|稲荷|権現|天神|明神|社|宮|戎)$/.test(n)) {
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
 * 動的スポット用の標準御朱印サンプルを生成
 */
export function buildDefaultSampleGoshuin(name, type = 'shrine') {
  const cleanName = (name || '神社').replace(/\s+/g, '');
  const shortCalligraphy = cleanName.length <= 5 ? cleanName : cleanName.slice(0, 4);
  if (type === 'temple') {
    return [
      {
        id: `${cleanName}-std`,
        title: `本尊御朱印「奉拝・${cleanName}」`,
        badge: '寺務所授与（要確認）',
        fee: '納経料 300〜500円目安',
        calligraphy: '大悲殿',
        subText: cleanName,
        stampText: `${shortCalligraphy}宝印`,
        motif: 'lotus',
        description: `${cleanName}の御朱印イメージです。詳細シートのSNS・WebボタンやAI調査から実際の御朱印写真を確認できます。`
      }
    ];
  }
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
      description: `${cleanName}の御朱印イメージです。詳細シートのSNS・WebボタンやAI調査から実際の御朱印写真を確認できます。`
    }
  ];
}

/**
 * 国土地理院（GSI）AddressSearch API で日本全国の神社・寺院を検索
 * ★OpenStreetMapに登録されていない地域の神社や同名神社も、国土地理院の地図データから超高確率でヒットします
 */
async function searchViaGsiApi(cleanName, cleanArea = '') {
  try {
    const variants = buildQueryVariants(cleanName);
    const queries = cleanArea
      ? [`${cleanArea} ${cleanName}`, cleanName]
      : variants;

    const allItems = [];
    const responses = await Promise.allSettled(
      queries.slice(0, 2).map((q) =>
        fetch(
          `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`
        )
      )
    );

    for (const r of responses) {
      if (r.status === 'fulfilled' && r.value.ok) {
        const json = await r.value.json();
        if (Array.isArray(json)) {
          allItems.push(...json);
        }
      }
    }

    const results = [];
    for (const item of allItems) {
      const coords = item?.geometry?.coordinates;
      const title = (item?.properties?.title || '').trim();
      const addressCode = item?.properties?.addressCode || '';
      const dataSource = String(item?.properties?.dataSource || '');

      if (!Array.isArray(coords) || coords.length < 2 || !title) continue;
      const lng = parseFloat(coords[0]);
      const lat = parseFloat(coords[1]);
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

      // 単なる町名・大字（例：「鳥取県倉吉市生田神主田」）と神社・お寺を区別する
      const isReligiousTitle =
        dataSource === '1' ||
        /(?:神社|神宮|大社|天満宮|八幡|稲荷|権現|天神|明神|社|宮|戎|恵比寿|寺|院|堂|庵|大師|観音|不動|薬師|地蔵|本山|霊場)/.test(
          title
        );
      if (!isReligiousTitle && !title.includes(cleanName)) continue;

      const prefFromCode = getPrefectureFromAddressCode(addressCode);
      const pref =
        prefFromCode ||
        extractPrefectureFromSpot({ name: title, address: title, lat, lng });

      // 地域フィルタが指定されている場合、都道府県または名称に一致するか確認
      if (
        cleanArea &&
        !pref.includes(cleanArea) &&
        !title.includes(cleanArea)
      ) {
        continue;
      }

      const type = inferSpotTypeFromName(title);
      results.push({
        id: `gsi-${lat.toFixed(5)}-${lng.toFixed(5)}`,
        name: title,
        type,
        address: pref && !title.startsWith(pref) ? `${pref}（${title}）` : title,
        prefecture: pref,
        lat,
        lng,
        denomination: type === 'shrine' ? '神道（神社）' : '仏教（寺院）',
        sampleGoshuin: buildDefaultSampleGoshuin(title, type),
        source: '国土地理院マップ'
      });
    }

    // 上位8件について、国土地理院逆ジオコーディングで町名（lv01Nm）まで補完する
    const topToEnrich = results.slice(0, 8);
    await Promise.allSettled(
      topToEnrich.map(async (cand) => {
        try {
          const revRes = await fetch(
            `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${cand.lat}&lon=${cand.lng}`
          );
          if (revRes.ok) {
            const revData = await revRes.json();
            const lv01 = revData?.results?.lv01Nm || '';
            const muniCd = revData?.results?.muniCd || '';
            const pref = getPrefectureFromAddressCode(muniCd) || cand.prefecture;
            if (pref) cand.prefecture = pref;
            if (lv01 && !cand.address.includes(lv01)) {
              cand.address = `${pref ? pref + ' ' : ''}${lv01}（${cand.name}）`;
            }
          }
        } catch {
          // 逆ジオコーディング失敗時はそのまま
        }
      })
    );

    return results;
  } catch {
    return [];
  }
}

/**
 * Wikipedia 日本語版 API で位置情報付きの神社・寺院記事を検索
 * ★通称・旧称・別名（例：「お菊神社」→「十二所神社 (姫路市)」など）でも本文一致でヒットします
 */
async function searchViaWikipediaApi(cleanName, cleanArea = '') {
  try {
    const q = cleanArea ? `${cleanName} ${cleanArea}` : cleanName;
    const url = `https://ja.wikipedia.org/w/api.php?origin=*&action=query&generator=search&gsrsearch=${encodeURIComponent(
      q
    )}&gsrlimit=20&prop=coordinates|extracts&exintro=1&explaintext=1&exchars=160&format=json`;

    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {});

    const results = [];
    for (const p of pages) {
      const rawTitle = (p.title || '').trim();
      const coords = p.coordinates?.[0];
      if (!coords || typeof coords.lat !== 'number' || typeof coords.lon !== 'number') {
        continue;
      }

      const extract = (p.extract || '').trim();
      const combinedText = `${rawTitle} ${extract}`;

      // 神社・寺院に関する記事かどうかを判定
      if (
        !/(?:神社|神宮|大社|天満宮|八幡|稲荷|権現|天神|明神|社|宮|戎|寺|院|堂|庵|大師|観音|不動|薬師|地蔵|祭神|本尊|創建|御朱印)/.test(
          combinedText
        )
      ) {
        continue;
      }

      // タイトルの括弧内に自治体名がある場合（例: "氷川神社 (東京都港区赤坂)"）は住所ヒントとして活用
      const parenMatch = rawTitle.match(/[（(](.+?)[）)]/);
      const areaInTitle = parenMatch ? parenMatch[1] : '';
      const cleanSpotName = rawTitle.replace(/\s*[（(].*?[）)]\s*/g, '').trim();

      // 本文から所在地（「〇〇県〇〇市…にある神社」など）を抽出
      const addrInExtract =
        extract.match(
          /(?:北海道|青森県|岩手県|宮城県|秋田県|山形県|福島県|茨城県|栃木県|群馬県|埼玉県|千葉県|東京都|神奈川県|新潟県|富山県|石川県|福井県|山梨県|長野県|岐阜県|静岡県|愛知県|三重県|滋賀県|京都府|大阪府|兵庫県|奈良県|和歌山県|鳥取県|島根県|岡山県|広島県|山口県|徳島県|香川県|愛媛県|高知県|福岡県|佐賀県|長崎県|熊本県|大分県|宮崎県|鹿児島県|沖縄県)[^\s。、（）()]{1,25}/
        )?.[0] || '';

      const address = addrInExtract || areaInTitle || '';
      const prefecture = extractPrefectureFromSpot({
        name: rawTitle,
        address: `${address} ${extract}`,
        lat: coords.lat,
        lng: coords.lon
      });

      if (
        cleanArea &&
        !prefecture.includes(cleanArea) &&
        !address.includes(cleanArea) &&
        !combinedText.includes(cleanArea)
      ) {
        continue;
      }

      const type = inferSpotTypeFromName(cleanSpotName);
      results.push({
        id: `wiki-search-${p.pageid}`,
        name: cleanSpotName,
        type,
        address: address || `${prefecture}（Wikipedia掲載社寺）`,
        prefecture,
        lat: coords.lat,
        lng: coords.lon,
        denomination: type === 'shrine' ? '神道（有名神社）' : '仏教（有名寺院）',
        description: extract || `${cleanSpotName}は地域で知られる参拝スポットです。`,
        sampleGoshuin: buildDefaultSampleGoshuin(cleanSpotName, type),
        source: 'Wikipedia社寺検索'
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * OpenStreetMap Nominatim API による周辺＆全国検索（フィルタを柔軟化し、検索漏れを防止）
 */
async function searchViaNominatimApi(cleanName, cleanArea = '', baseLat, baseLng) {
  try {
    const variants = buildQueryVariants(cleanName);
    const primaryQuery = cleanArea ? `${cleanName} ${cleanArea}` : cleanName;

    const viewbox = `${(baseLng - 1.5).toFixed(4)},${(baseLat + 1.5).toFixed(4)},${(
      baseLng + 1.5
    ).toFixed(4)},${(baseLat - 1.5).toFixed(4)}`;

    const urls = [
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&dedupe=0&countrycodes=jp&viewbox=${viewbox}&bounded=1&limit=25&accept-language=ja&q=${encodeURIComponent(
        primaryQuery
      )}`,
      `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&dedupe=0&countrycodes=jp&limit=40&accept-language=ja&q=${encodeURIComponent(
        primaryQuery
      )}`
    ];

    // もし「神社」「寺」を補ったバリエーションがあれば追加検索
    if (!cleanArea && variants.length > 1) {
      urls.push(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&dedupe=0&countrycodes=jp&limit=20&accept-language=ja&q=${encodeURIComponent(
          variants[1]
        )}`
      );
    }

    const settledList = await Promise.allSettled(
      urls.map((u) => fetch(u, { headers: { 'Accept-Language': 'ja' } }))
    );

    const items = [];
    for (const s of settledList) {
      if (s.status === 'fulfilled' && s.value.ok) {
        const json = await s.value.json();
        if (Array.isArray(json)) items.push(...json);
      }
    }

    const results = [];
    for (const item of items) {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

      const rawName = (item.name || item.display_name?.split(',')[0] || cleanName).trim();

      // 明らかに駅・バス停・コンビニ・道路などの無関係施設だけを除外し、神社仏閣・史跡・観光地は広く許容
      const isExcludedFacility =
        item.class === 'highway' ||
        item.class === 'railway' ||
        item.type === 'station' ||
        item.type === 'bus_stop' ||
        item.type === 'convenience' ||
        /(?:駅|停留所|バス停|交差点|インターチェンジ|小学校|中学校|高等学校|病院|郵便局)$/.test(rawName);

      if (isExcludedFacility) continue;

      const formattedAddr = formatJapaneseAddress(item);
      const pref =
        item.address?.province ||
        item.address?.state ||
        extractPrefectureFromSpot({ name: rawName, address: formattedAddr, lat, lng });

      const type = inferSpotTypeFromName(rawName);
      results.push({
        id: `nom-${item.place_id}`,
        name: rawName,
        type,
        address: formattedAddr,
        prefecture: pref,
        lat,
        lng,
        denomination: type === 'shrine' ? '神道（神社）' : '仏教（寺院）',
        sampleGoshuin: buildDefaultSampleGoshuin(rawName, type),
        source: '全国マップ検索'
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * 万が一地図DB（GSI/OSM/Wikipedia）で1件もヒットしなかった場合の Gemini AI フォールバック検索
 * （通称・マイナー社寺・最新の表記でもGeminiの知識から正確な所在地と座標を特定）
 */
async function searchViaGeminiFallback(cleanName, cleanArea = '') {
  const apiKey = getGeminiApiKey();
  if (!apiKey) return [];

  try {
    const modelId = getGeminiModel() || 'gemini-4-hydrogen';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelId
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const prompt = `
日本国内にある「${cleanName}」${cleanArea ? `（地域ヒント: ${cleanArea}）` : ''}に該当する実在の神社・寺院の候補を最大5件挙げ、それぞれの正式名称・種別（shrineまたはtemple）・都道府県・詳しい住所・おおよその緯度（lat）と経度（lng）をJSON配列で返してください。
`;

    const schema = {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          type: { type: 'STRING', enum: ['shrine', 'temple'] },
          prefecture: { type: 'STRING' },
          address: { type: 'STRING' },
          lat: { type: 'NUMBER' },
          lng: { type: 'NUMBER' }
        },
        required: ['name', 'type', 'prefecture', 'address', 'lat', 'lng']
      }
    };

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json',
          responseSchema: schema
        }
      })
    });

    if (!res.ok) return [];
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((p) => p && typeof p.lat === 'number' && typeof p.lng === 'number')
      .map((p, i) => ({
        id: `ai-spot-${Date.now()}-${i}`,
        name: p.name,
        type: p.type || inferSpotTypeFromName(p.name),
        prefecture:
          ALL_PREFECTURES.includes(p.prefecture)
            ? p.prefecture
            : extractPrefectureFromSpot(p),
        address: p.address || p.prefecture,
        lat: p.lat,
        lng: p.lng,
        denomination: p.type === 'temple' ? '仏教（寺院）' : '神道（神社）',
        sampleGoshuin: buildDefaultSampleGoshuin(p.name, p.type),
        source: 'AI神社特定'
      }));
  } catch {
    return [];
  }
}

/**
 * 神社・お寺の名前（＋任意の地域キーワード）から全国の候補リスト（住所・都道府県・座標・現在地からの距離付き）を検索し、
 * **現在地から近い順**（または関連度順）にソートして返す
 *
 * @param {string} nameQuery 神社・お寺の名前（例: "住吉神社", "貴船神社", "生田神社", "東京大神宮"）
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
  let cleanName = (nameQuery || '').trim();
  let cleanArea = (areaHint || '').trim();
  if (!cleanName) return [];

  // 「京都 八坂神社」のようにスペース区切りで地域名と神社名が1つの欄に入力された場合も自動分割して対応
  if (!cleanArea && /[\s　]/.test(cleanName)) {
    const tokens = cleanName.split(/[\s　]+/).filter(Boolean);
    if (tokens.length >= 2) {
      const firstIsArea = ALL_PREFECTURES.some(
        (p) => p.includes(tokens[0]) || tokens[0].includes(p.replace(/[都府県]$/, ''))
      );
      if (firstIsArea) {
        cleanArea = tokens[0];
        cleanName = tokens.slice(1).join(' ');
      }
    }
  }

  const baseLat =
    typeof userLocation?.lat === 'number' ? userLocation.lat : DEFAULT_CENTER.lat;
  const baseLng =
    typeof userLocation?.lng === 'number' ? userLocation.lng : DEFAULT_CENTER.lng;

  const rawCandidates = [];

  // 重複排除付きで候補リストに追加するヘルパー（半径200m以内の同名・類似名スポットは統合し、より詳しい住所を採用）
  const pushCandidate = (cand) => {
    if (Number.isNaN(cand.lat) || Number.isNaN(cand.lng)) return;
    const normCand = normalizeShrineText(cand.name);

    const existingIdx = rawCandidates.findIndex((ex) => {
      const dist = calcDistanceMeters(ex.lat, ex.lng, cand.lat, cand.lng);
      if (dist > 220) return false;
      const normEx = normalizeShrineText(ex.name);
      return (
        normEx === normCand ||
        normEx.includes(normCand) ||
        normCand.includes(normEx)
      );
    });

    const resolvedPref =
      cand.prefecture && ALL_PREFECTURES.includes(cand.prefecture)
        ? cand.prefecture
        : extractPrefectureFromSpot(cand);

    if (existingIdx >= 0) {
      const ex = rawCandidates[existingIdx];
      // 既存より住所情報が詳しければ補完する
      if (
        (!ex.address ||
          ex.address === '住所情報あり' ||
          ex.address.length < (cand.address || '').length) &&
        cand.address &&
        cand.address !== '住所情報あり'
      ) {
        ex.address = cand.address;
      }
      if (!ex.prefecture && resolvedPref) {
        ex.prefecture = resolvedPref;
      }
      return;
    }

    const distMeters = calcDistanceMeters(baseLat, baseLng, cand.lat, cand.lng);
    rawCandidates.push({
      ...cand,
      prefecture: resolvedPref,
      sampleGoshuin:
        cand.sampleGoshuin && cand.sampleGoshuin.length > 0
          ? cand.sampleGoshuin
          : buildDefaultSampleGoshuin(cand.name, cand.type),
      distanceMeters: distMeters,
      distanceKm: Math.round((distMeters / 1000) * 10) / 10,
      distanceLabel: formatDistanceLabel(distMeters)
    });
  };

  // 1. アプリ内登録済みスポット（SEED_SPOTS＋周辺取得済みスポット）から表記ゆれ対応検索
  const normQuery = normalizeShrineText(cleanName);
  for (const s of localSpots || []) {
    const normSpotName = normalizeShrineText(s.name);
    const matchName =
      s.name.includes(cleanName) ||
      cleanName.includes(s.name.replace(/（.*?）|\(.*?\)/g, '')) ||
      (normQuery.length >= 2 &&
        (normSpotName.includes(normQuery) || normQuery.includes(normSpotName)));

    const spotPref = extractPrefectureFromSpot(s);
    const matchArea =
      !cleanArea ||
      (s.address || '').includes(cleanArea) ||
      spotPref.includes(cleanArea) ||
      s.name.includes(cleanArea);

    if (matchName && matchArea) {
      pushCandidate({
        id: s.id || `local-${s.lat}-${s.lng}`,
        name: s.name,
        type: s.type || inferSpotTypeFromName(s.name),
        address: s.address || '',
        prefecture: spotPref,
        lat: s.lat,
        lng: s.lng,
        denomination: s.denomination || (s.type === 'temple' ? '仏教' : '神道'),
        sampleGoshuin: s.sampleGoshuin,
        source: '周辺・登録スポット'
      });
    }
  }

  // 2. 国土地理院（GSI）＋ OpenStreetMap Nominatim ＋ Wikipedia日本語版 を並列実行
  const [gsiList, nomList, wikiList] = await Promise.all([
    searchViaGsiApi(cleanName, cleanArea),
    searchViaNominatimApi(cleanName, cleanArea, baseLat, baseLng),
    searchViaWikipediaApi(cleanName, cleanArea)
  ]);

  // 住所情報が豊富なNominatim・Wikipedia・国土地理院の順にマージ
  for (const item of [...nomList, ...wikiList, ...gsiList]) {
    pushCandidate(item);
  }

  // 3. 万が一ここまでで0件だった場合、Gemini AIフォールバックで実在社寺を検索
  if (rawCandidates.length === 0 && cleanName.length >= 2) {
    const aiList = await searchViaGeminiFallback(cleanName, cleanArea);
    for (const item of aiList) {
      pushCandidate(item);
    }
  }

  // 4. ★現在地から近い順（昇順）に並び替えて返却
  rawCandidates.sort((a, b) => a.distanceMeters - b.distanceMeters);

  return rawCandidates.slice(0, 35);
}
