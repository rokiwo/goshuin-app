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
export function getPrefectureFromAddressCode(addressCode = '') {
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

const SEARCH_RESULT_CACHE = new Map();
const SEARCH_CACHE_TTL_MS = 180000;
const REV_GEO_CACHE = new Map();

const BAD_ADDRESS_RE =
  /(?:Wikipedia|掲載社寺|周辺有名社寺|所在地は地図ピン|住所情報あり|にある|に位置する|に鎮座する|に所在する|の東隣|の西側|の中濃地域|南部|北部|東部|西部|（[^）]*(?:神社|神宮|大社|寺|院|宮)）)/;

const NON_WORSHIP_SUFFIX_RE =
  /(?:都|道|府|県|市|区|町|村|郡|駅|停留所|バス停|病院|クリニック|公会堂|会館|美術館|博物館|公園|緑地|花やしき|遊園地|小学校|中学校|高校|高等学校|大学|郵便局|市役所|区役所|町役場|交差点|インターチェンジ|駐車場|ホテル|旅館|商店街|通り|墓地|霊園|納骨堂|集会所|自治会館|公民館|教会|モスク)$/;

const RELIGIOUS_TAIL_RE =
  /(?:神社|神宮|大社|天満宮|八幡宮?|稲荷|権現|天神|明神|東照宮|護国神社|招魂社|大神宮|大明神|戎|恵比寿|恵美須|住吉|春日|八坂|厳島|素盞嗚|寺院?|院|大師|観音|不動|薬師|地蔵|本山|霊場|精舎|(?:観音堂|大師堂|不動堂|薬師堂|地蔵堂|阿弥陀堂|釈迦堂|本堂|御影堂|経堂|講堂|金堂|開山堂|三十三間堂)|庵|社|(?:の|ノ|之|一|二|若|今|西|新)宮)$/;

const RELIGIOUS_CONTAIN_RE =
  /(?:神社|神宮|大社|天満宮|八幡|稲荷|権現|明神|大神宮|寺院|観音堂|大師堂|不動尊)/;

/**
 * 住所文字列の品質スコアを判定（0: 無効・例文・単なる県名 / 1: 不十分 / 2: 県＋市区町村＋町名 / 3: 番地・丁目付き詳細住所）
 */
function scoreAddressQuality(addr = '') {
  const trimmed = String(addr || '').trim();
  if (!trimmed || ALL_PREFECTURES.includes(trimmed) || BAD_ADDRESS_RE.test(trimmed)) {
    return 0;
  }
  const hasPref = /(?:北海道|東京都|(?:京都|大阪)府|.{2,3}県)/.test(trimmed);
  const hasMuni = /[市区町村郡]/.test(trimmed);
  if (hasPref && hasMuni) {
    const hasStreetOrNum = /[0-9０-９一二三四五六七八九十]+(?:丁目|番|号|-|ー)?/.test(trimmed);
    return hasStreetOrNum ? 3 : 2;
  }
  return 1;
}

/**
 * 日本の正確な住所（都道府県＋市区町村あり・Wikipedia例文等ではない）かどうかを判定
 */
export function isProperJapaneseAddress(addr = '') {
  return scoreAddressQuality(addr) >= 2;
}

/**
 * スポット名称として妥当か（県名・市名・駅・病院・施設・地区名単体などを除外）
 */
function isValidWorshipSpotName(name = '') {
  const n = String(name || '').trim();
  if (n.length < 2 || ALL_PREFECTURES.includes(n)) return false;
  if (NON_WORSHIP_SUFFIX_RE.test(n)) return false;
  if (/^(?:三宮|梅田|難波|新宿|渋谷|池袋|銀座|浅草|京都|神戸|大阪|東京)$/.test(n)) {
    return false;
  }
  return true;
}

/**
 * 神社・寺院を表す名称か判定（「宮城県」「宮崎県」等で誤マッチしないよう県・市区町村プレフィックスを除外して評価）
 */
function isReligiousPlaceName(name = '') {
  const n = String(name || '').trim();
  if (!isValidWorshipSpotName(n)) return false;
  const stripped = n
    .replace(/^(?:北海道|東京都|(?:京都|大阪)府|.{2,3}県)(?:.{1,8}[市区町村郡])?/, '')
    .trim();
  const target = stripped || n;
  return RELIGIOUS_TAIL_RE.test(target) || RELIGIOUS_CONTAIN_RE.test(target);
}

/**
 * タイムアウト・外部AbortSignal両対応の高速fetchヘルパー
 */
async function fetchWithTimeout(url, options = {}, timeoutMs = 2200, outerSignal = null) {
  if (outerSignal?.aborted) {
    throw new DOMException('Aborted', 'AbortError');
  }
  const controller = new AbortController();
  const onOuterAbort = () => controller.abort();
  if (outerSignal) {
    outerSignal.addEventListener('abort', onOuterAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (outerSignal) {
      outerSignal.removeEventListener('abort', onOuterAbort);
    }
  }
}

/**
 * 座標から「都道府県＋市区町村＋町名」を高速・無料で取得（GSI＋HeartRails並列・200件キャッシュ付き）
 */
export async function reverseGeocodeJapaneseAddressFast(lat, lng, signal = null) {
  if (typeof lat !== 'number' || typeof lng !== 'number' || Number.isNaN(lat) || Number.isNaN(lng)) {
    return null;
  }
  const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)}`;
  const cached = REV_GEO_CACHE.get(cacheKey);
  if (cached) return cached;

  try {
    const [gsiSettled, hrSettled] = await Promise.allSettled([
      fetchWithTimeout(
        `https://mreversegeocoder.gsi.go.jp/reverse-geocoder/LonLatToAddress?lat=${lat}&lon=${lng}`,
        {},
        1100,
        signal
      ).then((r) => (r.ok ? r.json() : null)),
      fetchWithTimeout(
        `https://geoapi.heartrails.com/api/json?method=searchByGeoLocation&x=${lng}&y=${lat}`,
        {},
        1100,
        signal
      ).then((r) => (r.ok ? r.json() : null))
    ]);

    const gsiRes = gsiSettled.status === 'fulfilled' ? gsiSettled.value?.results : null;
    const hrLoc = hrSettled.status === 'fulfilled' ? hrSettled.value?.response?.location?.[0] : null;

    const muniCd = gsiRes?.muniCd || '';
    const rawLv01 = (gsiRes?.lv01Nm || '').trim();
    const lv01Nm = /^[−\-ー—]+$/.test(rawLv01) ? '' : rawLv01;
    const gsiPref = getPrefectureFromAddressCode(muniCd) || '';
    const hrPref = (hrLoc?.prefecture || '').trim();
    const hrCity = (hrLoc?.city || '').trim();
    const hrTown = (hrLoc?.town || '').trim();

    const pref = gsiPref || hrPref;
    const samePref = !gsiPref || !hrPref || gsiPref === hrPref;
    const city = samePref ? hrCity : '';
    const rawTown = lv01Nm || (samePref ? hrTown : '');
    const town = city && rawTown && city.endsWith(rawTown) ? '' : rawTown;

    const address = `${pref}${city}${town}`.trim();
    if (!address) return null;

    const result = { prefecture: pref, address };
    if (REV_GEO_CACHE.size >= 200) {
      const oldest = REV_GEO_CACHE.keys().next().value;
      REV_GEO_CACHE.delete(oldest);
    }
    REV_GEO_CACHE.set(cacheKey, result);
    return result;
  } catch {
    return null;
  }
}

/**
 * 住所が未整備・不十分な候補の上位件数について正確な日本語住所を一括補完
 */
async function enrichCandidateAddresses(candidates = [], signal = null, limit = 10) {
  const targets = candidates
    .filter((c) => !isProperJapaneseAddress(c.address))
    .slice(0, limit);
  if (targets.length === 0 || signal?.aborted) return false;

  let anyUpdated = false;
  await Promise.allSettled(
    targets.map(async (cand) => {
      const rev = await reverseGeocodeJapaneseAddressFast(cand.lat, cand.lng, signal);
      if (!rev?.address) return;
      if (scoreAddressQuality(rev.address) > scoreAddressQuality(cand.address)) {
        cand.address = rev.address;
        anyUpdated = true;
      }
      if (!cand.prefecture && rev.prefecture) {
        cand.prefecture = rev.prefecture;
        anyUpdated = true;
      }
    })
  );
  return anyUpdated;
}

/**
 * 国土地理院（GSI）AddressSearch API で日本全国の神社・寺院を検索（2秒タイムアウト・誤マッチ除外）
 */
async function searchViaGsiApi(cleanName, cleanArea = '', signal = null) {
  try {
    const variants = buildQueryVariants(cleanName);
    const queries = cleanArea
      ? [`${cleanArea} ${cleanName}`, cleanName]
      : variants;

    const allItems = [];
    const responses = await Promise.allSettled(
      queries.slice(0, 2).map((q) =>
        fetchWithTimeout(
          `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(q)}`,
          {},
          2000,
          signal
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

      if (!isValidWorshipSpotName(title)) continue;
      if (dataSource !== '1' && !isReligiousPlaceName(title)) continue;

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
        address: '',
        prefecture: pref,
        lat,
        lng,
        denomination: type === 'shrine' ? '神道（神社）' : '仏教（寺院）',
        sampleGoshuin: buildDefaultSampleGoshuin(title, type),
        source: '国土地理院マップ'
      });
    }

    return results;
  } catch {
    return [];
  }
}

/**
 * Wikipedia 日本語版 API で位置情報付きの神社・寺院記事を検索（2.2秒タイムアウト・関連記事ノイズ除外）
 * ★通称・旧称・別名（例：「お菊神社」→「十二所神社」など）は本文明記時のみヒットさせます
 */
async function searchViaWikipediaApi(cleanName, cleanArea = '', signal = null) {
  try {
    const q = cleanArea ? `${cleanName} ${cleanArea}` : cleanName;
    const url = `https://ja.wikipedia.org/w/api.php?origin=*&action=query&generator=search&gsrsearch=${encodeURIComponent(
      q
    )}&gsrlimit=20&prop=coordinates|extracts&exintro=1&explaintext=1&exchars=160&format=json`;

    const res = await fetchWithTimeout(url, {}, 2200, signal);
    if (!res.ok) return [];
    const data = await res.json();
    const pages = Object.values(data?.query?.pages || {});

    const normQuery = normalizeShrineText(cleanName);
    const results = [];
    for (const p of pages) {
      const rawTitle = (p.title || '').trim();
      const coords = p.coordinates?.[0];
      if (!coords || typeof coords.lat !== 'number' || typeof coords.lon !== 'number') {
        continue;
      }

      const extract = (p.extract || '').trim();
      const cleanSpotName = rawTitle.replace(/\s*[（(].*?[）)]\s*/g, '').trim();

      // 県・市・公園・病院・駅などの非社寺記事を厳格除外
      if (!isReligiousPlaceName(cleanSpotName)) continue;
      if (
        /(?:日本の県|日本の市|中心業務地区|繁華街|遊園地|都市公園|公立病院|鉄道駅|公会堂)/.test(
          extract
        )
      ) {
        continue;
      }

      // 名称一致、または通称・別称として本文に検索語が明記された場合のみ採用（単なる関連寺社の混入を防止）
      const tier = getNameMatchTier(cleanSpotName, normQuery);
      const isAliasMatch = cleanName.length >= 2 && extract.includes(cleanName);
      if (tier === 0 && !isAliasMatch) {
        continue;
      }

      const prefecture = extractPrefectureFromSpot({
        name: rawTitle,
        address: extract,
        lat: coords.lat,
        lng: coords.lon
      });

      if (
        cleanArea &&
        !prefecture.includes(cleanArea) &&
        !rawTitle.includes(cleanArea) &&
        !extract.includes(cleanArea)
      ) {
        continue;
      }

      const type = inferSpotTypeFromName(cleanSpotName);
      results.push({
        id: `wiki-search-${p.pageid}`,
        name: cleanSpotName,
        type,
        address: '',
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
 * OpenStreetMap Nominatim API による周辺＆全国検索（看板・案内板・病院等の非社寺を厳格除外）
 * ★レート制限(1req/s)による遅延を防ぐため、viewbox優先付き全国検索の単一リクエスト＋2.4秒タイムアウトに最適化
 */
async function searchViaNominatimApi(
  cleanName,
  cleanArea = '',
  baseLat,
  baseLng,
  signal = null
) {
  try {
    const primaryQuery = cleanArea ? `${cleanName} ${cleanArea}` : cleanName;

    const viewbox = `${(baseLng - 1.5).toFixed(4)},${(baseLat + 1.5).toFixed(4)},${(
      baseLng + 1.5
    ).toFixed(4)},${(baseLat - 1.5).toFixed(4)}`;

    // bounded=1を付けずにviewboxを渡すことで、1回のリクエストで近隣優先＋全国検索を高速両立
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&addressdetails=1&dedupe=0&countrycodes=jp&viewbox=${viewbox}&limit=25&accept-language=ja&q=${encodeURIComponent(
      primaryQuery
    )}`;

    const res = await fetchWithTimeout(
      url,
      { headers: { 'Accept-Language': 'ja' } },
      2400,
      signal
    );
    if (!res.ok) return [];
    const items = await res.json();
    if (!Array.isArray(items)) return [];

    const excludedCategories = new Set([
      'highway',
      'railway',
      'boundary',
      'place',
      'shop',
      'office',
      'landuse',
      'natural',
      'waterway'
    ]);
    const excludedTypes = new Set([
      'board',
      'information',
      'guidepost',
      'memorial',
      'bench',
      'station',
      'bus_stop',
      'convenience',
      'hospital',
      'school',
      'park',
      'artwork',
      'monument'
    ]);

    const results = [];
    for (const item of items) {
      const lat = parseFloat(item.lat);
      const lng = parseFloat(item.lon);
      if (Number.isNaN(lat) || Number.isNaN(lng)) continue;

      const cat = item.category || item.class || '';
      const rawName = (item.name || item.display_name?.split(',')[0] || cleanName).trim();

      if (
        excludedCategories.has(cat) ||
        excludedTypes.has(item.type) ||
        (cat === 'tourism' && item.type === 'information')
      ) {
        continue;
      }

      if (!isValidWorshipSpotName(rawName)) continue;
      if (
        item.type !== 'place_of_worship' &&
        item.type !== 'wayside_shrine' &&
        item.type !== 'shrine' &&
        item.type !== 'temple' &&
        !isReligiousPlaceName(rawName)
      ) {
        continue;
      }

      const formattedAddr = formatJapaneseAddress(item);
      const pref =
        item.address?.province ||
        item.address?.state ||
        extractPrefectureFromSpot({ name: rawName, address: formattedAddr, lat, lng });

      if (
        cleanArea &&
        !pref.includes(cleanArea) &&
        !formattedAddr.includes(cleanArea) &&
        !rawName.includes(cleanArea)
      ) {
        continue;
      }

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
 * Gemini + Google検索・Googleマップ連携によるフォールバック検索（通称・略称・マイナー社寺向け・3.5秒タイムアウト）
 */
async function searchViaGeminiGoogleMaps(cleanName, cleanArea = '', signal = null) {
  const apiKey = getGeminiApiKey();
  if (!apiKey || cleanName.length < 2) return [];

  try {
    const modelId = getGeminiModel() || 'gemini-4-hydrogen';
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      modelId
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const prompt = `
あなたは日本のGoogleマップ・神社仏閣データベースの検索エンジンです。
ユーザーが検索したキーワード「${cleanName}」${cleanArea ? `（地域指定: ${cleanArea}）` : ''}に一致・関連する日本国内の実在する神社・寺院を、Googleマップで検索したときに上位に出る有名なものから順に最大8件挙げてください。
※通称・別名・読み仮名・略称（例：「三輪明神/おおみわ」→大神神社、「お伊勢さん」→伊勢神宮、「えべっさん」→西宮神社/今宮戎神社など）もすべて正式名称と正確な所在地・緯度経度（lat, lng）に変換してJSON配列で返してください。
`;

    const schema = {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: {
            type: 'STRING',
            description: 'Googleマップ上の正式な神社・寺院名'
          },
          type: { type: 'STRING', enum: ['shrine', 'temple'] },
          prefecture: {
            type: 'STRING',
            description: '都道府県名（例：奈良県、京都府、兵庫県など）'
          },
          address: {
            type: 'STRING',
            description: '都道府県から始まる詳しい住所'
          },
          lat: { type: 'NUMBER', description: '正確な緯度（北緯）' },
          lng: { type: 'NUMBER', description: '正確な経度（東経）' }
        },
        required: ['name', 'type', 'prefecture', 'address', 'lat', 'lng']
      }
    };

    const res = await fetchWithTimeout(
      endpoint,
      {
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
      },
      3500,
      signal
    );

    if (!res.ok) return [];
    const data = await res.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .filter((p) => p && typeof p.lat === 'number' && typeof p.lng === 'number')
      .map((p, i) => ({
        id: `gmap-ai-${p.lat.toFixed(4)}-${p.lng.toFixed(4)}-${i}`,
        name: p.name,
        type: p.type || inferSpotTypeFromName(p.name),
        prefecture: ALL_PREFECTURES.includes(p.prefecture)
          ? p.prefecture
          : extractPrefectureFromSpot(p),
        address: p.address || p.prefecture,
        lat: p.lat,
        lng: p.lng,
        denomination: p.type === 'temple' ? '仏教（有名寺院）' : '神道（有名神社）',
        sampleGoshuin: buildDefaultSampleGoshuin(p.name, p.type),
        isFamousMatch: true,
        source: 'GoogleマップAI検索'
      }));
  } catch {
    return [];
  }
}

const PREF_EXTRACT_RE = /(?:北海道|東京都|(?:京都|大阪)府|.{2,3}県)/;
const OVERPASS_FAST_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter'
];

/**
 * コピーした住所から不要記号（日本、/〒番号）を除き、半角数字・ハイフンへ正規化
 */
export function normalizeJapaneseAddressInput(raw = '') {
  return String(raw || '')
    .replace(/日本[、,\s]*/g, '')
    .replace(/〒\s*\d{3}-?\d{4}\s*/g, '')
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[−ー―‐－]/g, '-')
    .replace(/\s+/g, '')
    .trim();
}

/**
 * 「社寺名＋住所」の貼り付けから社寺名部分と住所部分を分離
 */
function splitPastedNameAndAddress(raw = '') {
  const trimmed = String(raw || '').trim();
  const lines = trimmed.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  if (lines.length >= 2 && isReligiousPlaceName(lines[0])) {
    return {
      explicitSpotName: lines[0],
      addressPart: lines.slice(1).join('')
    };
  }
  const splitIdx = trimmed.search(
    /\s+(?=(?:日本[、,\s]|〒\s*\d|(?:北海道|東京都|(?:京都|大阪)府|[^\s]{2,3}県)))/
  );
  if (splitIdx > 0) {
    const head = trimmed.slice(0, splitIdx).trim();
    if (isReligiousPlaceName(head)) {
      return {
        explicitSpotName: head,
        addressPart: trimmed.slice(splitIdx).trim()
      };
    }
  }
  return { explicitSpotName: '', addressPart: trimmed };
}

/**
 * Googleマップ等の日本の住所コピペ（〒・都道府県・市区町村＋番地等）かどうかを判定
 */
export function isJapaneseAddressQuery(raw = '') {
  const s = String(raw || '').trim();
  if (s.length < 5) return false;
  const { addressPart } = splitPastedNameAndAddress(s);
  const target = addressPart || s;
  const hasPrefOrMuni = PREF_EXTRACT_RE.test(target) || /[市区町村郡]/.test(target);
  if (/〒\s*\d{3}-?\d{4}/.test(target) && hasPrefOrMuni) {
    return true;
  }
  const hasPref = PREF_EXTRACT_RE.test(target);
  const hasMuni = /[市区町村郡]/.test(target);
  if (hasPref && hasMuni) {
    const hasStreetNum =
      /[0-9０-９一二三四五六七八九十]+(?:丁目|番地?|号|-|ー|−)|[0-9０-９]{1,4}/.test(
        target
      );
    if (hasStreetNum) return true;
    return !isReligiousPlaceName(s);
  }
  return false;
}

/**
 * Googleマップ等の住所コピペから完全無料（Gemini不使用）でピンポイント地点＆社寺を検索
 */
async function searchShrineByPastedAddress(
  rawQuery,
  localSpots = [],
  userLocation = DEFAULT_CENTER,
  options = {}
) {
  const { signal = null } = options || {};
  const { explicitSpotName, addressPart } = splitPastedNameAndAddress(rawQuery);
  const cleanAddr = normalizeJapaneseAddressInput(addressPart);
  if (!cleanAddr) return [];

  const baseLat =
    typeof userLocation?.lat === 'number' ? userLocation.lat : DEFAULT_CENTER.lat;
  const baseLng =
    typeof userLocation?.lng === 'number' ? userLocation.lng : DEFAULT_CENTER.lng;

  const queryGsiAddress = async (addrText) => {
    try {
      const res = await fetchWithTimeout(
        `https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(addrText)}`,
        {},
        2000,
        signal
      );
      if (!res.ok) return null;
      const items = await res.json();
      return Array.isArray(items) && items.length > 0 ? items[0] : null;
    } catch {
      return null;
    }
  };

  // 1. GSI AddressSearchで住所を座標へ変換（番地で見つからない場合は町名レベルまで段階短縮して再試行）
  let gsiBest = await queryGsiAddress(cleanAddr);
  if (!gsiBest) {
    const withoutHouseNum = cleanAddr.replace(/[-0-9]+$/, '').trim();
    if (withoutHouseNum && withoutHouseNum !== cleanAddr) {
      gsiBest = await queryGsiAddress(withoutHouseNum);
    }
  }
  if (!gsiBest) {
    const townLevel = cleanAddr.replace(/(?:丁目|番地?|号|[-0-9])+.*$/, '').trim();
    if (townLevel && townLevel !== cleanAddr) {
      gsiBest = await queryGsiAddress(townLevel);
    }
  }
  if (!gsiBest || !Array.isArray(gsiBest.geometry?.coordinates)) {
    return [];
  }

  const addrLng = parseFloat(gsiBest.geometry.coordinates[0]);
  const addrLat = parseFloat(gsiBest.geometry.coordinates[1]);
  if (Number.isNaN(addrLat) || Number.isNaN(addrLng)) return [];

  const addrCode = gsiBest.properties?.addressCode || '';
  const addrPref =
    getPrefectureFromAddressCode(addrCode) ||
    extractPrefectureFromSpot({ address: cleanAddr, lat: addrLat, lng: addrLng });

  const toCandidate = (item, distFromAddr) => {
    const distMeters = calcDistanceMeters(baseLat, baseLng, item.lat, item.lng);
    const type = item.type || inferSpotTypeFromName(item.name);
    return {
      ...item,
      type,
      prefecture: item.prefecture || addrPref,
      denomination:
        item.denomination || (type === 'temple' ? '仏教（寺院）' : '神道（神社）'),
      sampleGoshuin:
        item.sampleGoshuin && item.sampleGoshuin.length > 0
          ? item.sampleGoshuin
          : buildDefaultSampleGoshuin(item.name, type),
      distanceMeters: distMeters,
      distanceKm: Math.round((distMeters / 1000) * 10) / 10,
      distanceLabel: formatDistanceLabel(distMeters),
      _distFromAddr: distFromAddr
    };
  };

  // 2. 「神社名＋住所」形式で入力された場合は即1件特定して返す
  if (explicitSpotName) {
    return [
      {
        ...toCandidate(
          {
            id: `addr-spot-${addrLat.toFixed(5)}-${addrLng.toFixed(5)}`,
            name: explicitSpotName,
            address: cleanAddr,
            prefecture: addrPref,
            lat: addrLat,
            lng: addrLng,
            source: '住所ピンポイント特定'
          },
          0
        ),
        isAddressExactMatch: true
      }
    ];
  }

  // 3. 純粋な住所のみ → ローカルスポット + Wikipedia Geosearch(400m) + Overpass(250m) を並列検索（無料）
  const rawMatches = [];
  const pushAddrMatch = (cand) => {
    if (Number.isNaN(cand.lat) || Number.isNaN(cand.lng)) return;
    const normC = normalizeShrineText(cand.name);
    const dupIdx = rawMatches.findIndex((ex) => {
      if (calcDistanceMeters(ex.lat, ex.lng, cand.lat, cand.lng) > 150) return false;
      const normE = normalizeShrineText(ex.name);
      return normE === normC || normE.includes(normC) || normC.includes(normE);
    });
    const distFromAddr = calcDistanceMeters(addrLat, addrLng, cand.lat, cand.lng);
    if (dupIdx >= 0) {
      if (
        scoreAddressQuality(cand.address) > scoreAddressQuality(rawMatches[dupIdx].address)
      ) {
        rawMatches[dupIdx].address = cand.address;
      }
      if (distFromAddr < rawMatches[dupIdx]._distFromAddr) {
        rawMatches[dupIdx]._distFromAddr = distFromAddr;
      }
      return;
    }
    rawMatches.push(toCandidate(cand, distFromAddr));
  };

  for (const s of localSpots || []) {
    if (typeof s.lat !== 'number' || typeof s.lng !== 'number') continue;
    if (calcDistanceMeters(addrLat, addrLng, s.lat, s.lng) <= 400) {
      pushAddrMatch({
        id: s.id || `local-${s.lat}-${s.lng}`,
        name: s.name,
        type: s.type,
        address: scoreAddressQuality(s.address) > 0 ? s.address : '',
        prefecture: extractPrefectureFromSpot(s) || addrPref,
        lat: s.lat,
        lng: s.lng,
        denomination: s.denomination,
        sampleGoshuin: s.sampleGoshuin,
        source: '住所周辺スポット'
      });
    }
  }

  const wikiGeoPromise = (async () => {
    try {
      const url = `https://ja.wikipedia.org/w/api.php?origin=*&action=query&format=json&list=geosearch&gscoord=${addrLat}|${addrLng}&gsradius=400&gslimit=30`;
      const res = await fetchWithTimeout(url, {}, 2000, signal);
      if (!res.ok) return [];
      const data = await res.json();
      const out = [];
      for (const item of data?.query?.geosearch || []) {
        const cleanTitle = (item.title || '').replace(/\s*[（(].*?[）)]\s*/g, '').trim();
        if (!isReligiousPlaceName(cleanTitle)) continue;
        out.push({
          id: `wiki-${item.pageid}`,
          name: cleanTitle,
          address: '',
          prefecture: addrPref,
          lat: item.lat,
          lng: item.lon,
          source: 'Wikipedia周辺社寺'
        });
      }
      return out;
    } catch {
      return [];
    }
  })();

  const overpassPromise = (async () => {
    const query = `[out:json][timeout:6];(node["amenity"="place_of_worship"]["name"](around:250,${addrLat},${addrLng});way["amenity"="place_of_worship"]["name"](around:250,${addrLat},${addrLng});node["historic"~"shrine|temple"]["name"](around:250,${addrLat},${addrLng});way["historic"~"shrine|temple"]["name"](around:250,${addrLat},${addrLng}););out center 15;`;
    for (const ep of OVERPASS_FAST_ENDPOINTS) {
      if (signal?.aborted) break;
      try {
        const res = await fetchWithTimeout(
          ep,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: `data=${encodeURIComponent(query)}`
          },
          2200,
          signal
        );
        if (!res.ok) continue;
        const json = await res.json();
        const elements = Array.isArray(json?.elements) ? json.elements : [];
        const out = [];
        for (const el of elements) {
          const tags = el.tags || {};
          const name = (tags['name:ja'] || tags.name || '').trim();
          if (!isReligiousPlaceName(name)) continue;
          const elLat = el.lat ?? el.center?.lat;
          const elLng = el.lon ?? el.center?.lon;
          if (typeof elLat !== 'number' || typeof elLng !== 'number') continue;
          out.push({
            id: `osm-${el.type}-${el.id}`,
            name,
            type:
              tags.religion === 'buddhist'
                ? 'temple'
                : tags.religion === 'shinto'
                ? 'shrine'
                : inferSpotTypeFromName(name),
            address: '',
            prefecture: addrPref,
            lat: elLat,
            lng: elLng,
            source: 'OSM周辺社寺'
          });
        }
        return out;
      } catch {
        // 次のOverpassミラーへ
      }
    }
    return [];
  })();

  const [wikiHits, osmHits] = await Promise.all([wikiGeoPromise, overpassPromise]);
  for (const h of [...wikiHits, ...osmHits]) {
    pushAddrMatch(h);
  }

  rawMatches.sort((a, b) => a._distFromAddr - b._distFromAddr);

  // 住所座標の至近80m以内に社寺がある場合はその1件を住所ごとピンポイント表示
  if (rawMatches.length > 0 && rawMatches[0]._distFromAddr <= 80) {
    const exact = {
      ...rawMatches[0],
      address: cleanAddr,
      prefecture: addrPref || rawMatches[0].prefecture,
      isAddressExactMatch: true,
      source: '住所ピンポイント特定'
    };
    return [exact];
  }

  if (rawMatches.length > 0) {
    await enrichCandidateAddresses(rawMatches, signal, 8);
    return rawMatches.slice(0, 10).map((c) => ({
      ...c,
      address: c.address || cleanAddr,
      isAddressExactMatch: rawMatches.length === 1
    }));
  }

  // 4. 広大な山林町域（伊勢市宇治館町など）で400m内に見つからない場合、同町名でWikipedia検索
  const cityTown = cleanAddr
    .replace(PREF_EXTRACT_RE, '')
    .replace(/[0-9\-丁目番号地]+$/g, '')
    .trim();

  if (cityTown && !signal?.aborted) {
    const runTownWikiSearch = async (qStr) => {
      try {
        const u = `https://ja.wikipedia.org/w/api.php?origin=*&action=query&generator=search&gsrsearch=${encodeURIComponent(
          qStr
        )}&gsrlimit=10&prop=coordinates|extracts&exintro=1&explaintext=1&exchars=160&format=json`;
        const res = await fetchWithTimeout(u, {}, 2000, signal);
        if (!res.ok) return [];
        const data = await res.json();
        const out = [];
        for (const p of Object.values(data?.query?.pages || {})) {
          const rawTitle = (p.title || '').trim();
          const coords = p.coordinates?.[0];
          if (!coords || typeof coords.lat !== 'number' || typeof coords.lon !== 'number') {
            continue;
          }
          const cleanSpotName = rawTitle.replace(/\s*[（(].*?[）)]\s*/g, '').trim();
          if (!isReligiousPlaceName(cleanSpotName)) continue;
          const extract = (p.extract || '').trim();
          const pref = extractPrefectureFromSpot({
            name: rawTitle,
            address: extract,
            lat: coords.lat,
            lng: coords.lon
          });
          if (
            addrPref &&
            pref !== addrPref &&
            !rawTitle.includes(addrPref) &&
            !extract.includes(addrPref)
          ) {
            continue;
          }
          out.push({
            ...toCandidate(
              {
                id: `wiki-town-${p.pageid}`,
                name: cleanSpotName,
                address: '',
                prefecture: pref || addrPref,
                lat: coords.lat,
                lng: coords.lon,
                source: '住所・町域社寺特定'
              },
              calcDistanceMeters(addrLat, addrLng, coords.lat, coords.lon)
            ),
            _wikiRank: typeof p.index === 'number' ? p.index : 99
          });
        }
        return out;
      } catch {
        return [];
      }
    };

    let townHits = await runTownWikiSearch(`${addrPref} ${cityTown} 神社`);
    if (townHits.length === 0) {
      townHits = await runTownWikiSearch(cityTown);
    }
    if (townHits.length > 0) {
      townHits.sort((a, b) => {
        if (Math.abs(a._distFromAddr - b._distFromAddr) > 500) {
          return a._distFromAddr - b._distFromAddr;
        }
        return (a._wikiRank ?? 99) - (b._wikiRank ?? 99);
      });
      const dedupedTownHits = [];
      for (const hit of townHits) {
        if (
          dedupedTownHits.some(
            (ex) => calcDistanceMeters(ex.lat, ex.lng, hit.lat, hit.lng) <= 30
          )
        ) {
          continue;
        }
        dedupedTownHits.push(hit);
      }
      await enrichCandidateAddresses(dedupedTownHits, signal, 6);
      return dedupedTownHits.slice(0, 8).map((c, idx) => ({
        ...c,
        address: idx === 0 && !isProperJapaneseAddress(c.address) ? cleanAddr : c.address || addrPref,
        isAddressExactMatch: dedupedTownHits.length === 1
      }));
    }
  }

  // 5. 最終フォールバック：住所ピン地点そのものを1件返して地図へ移動可能にする
  return [
    {
      ...toCandidate(
        {
          id: `addr-pin-${addrLat.toFixed(5)}-${addrLng.toFixed(5)}`,
          name: `${cleanAddr} 周辺`,
          address: cleanAddr,
          prefecture: addrPref,
          lat: addrLat,
          lng: addrLng,
          source: '指定住所地点'
        },
        0
      ),
      isAddressExactMatch: true
    }
  ];
}

/**
 * 名称一致度ティアを計算（3: 完全一致 / 2: 前方一致 / 1: 部分一致 / 0: 関連・別名一致）
 */
function getNameMatchTier(candName, normQuery) {
  const normCand = normalizeShrineText(candName);
  if (!normCand || !normQuery) return 0;
  if (normCand === normQuery) return 3;
  if (normCand.startsWith(normQuery) || normQuery.startsWith(normCand)) return 2;
  if (normCand.includes(normQuery) || normQuery.includes(normCand)) return 1;
  return 0;
}

/**
 * 神社・お寺の名前（＋任意の地域キーワード）または住所コピペから候補リストを検索し、
 * ローカル即時表示＋高速API逐次反映＋必要時のみAI補完で超高速に返す
 *
 * @param {string} nameQuery 神社・お寺の名前または日本の住所
 * @param {string} areaHint 絞り込み地域キーワード（例: "兵庫", "京都" など任意）
 * @param {Array} localSpots アプリ内既存のスポット配列
 * @param {{lat: number, lng: number}} userLocation ユーザーの現在地座標
 * @param {{onPartialResults?: Function, includeAiFallback?: boolean, signal?: AbortSignal}} options
 */
export async function searchShrineCandidatesByName(
  nameQuery,
  areaHint = '',
  localSpots = [],
  userLocation = DEFAULT_CENTER,
  options = {}
) {
  let cleanName = (nameQuery || '').trim();
  let cleanArea = (areaHint || '').trim();
  if (!cleanName) return [];

  const {
    onPartialResults = null,
    includeAiFallback = true,
    signal = null
  } = options || {};

  const baseLat =
    typeof userLocation?.lat === 'number' ? userLocation.lat : DEFAULT_CENTER.lat;
  const baseLng =
    typeof userLocation?.lng === 'number' ? userLocation.lng : DEFAULT_CENTER.lng;

  // 住所コピペ（「〒... 香川県東かがわ市松原69」や「社寺名 住所」）の場合は完全無料の住所検索を実行（Gemini不使用）
  if (!cleanArea && isJapaneseAddressQuery(cleanName)) {
    const addrCacheKey = `addr|${normalizeJapaneseAddressInput(cleanName)}|${baseLat.toFixed(
      1
    )}|${baseLng.toFixed(1)}|${(localSpots || []).length}`;
    const addrCached = SEARCH_RESULT_CACHE.get(addrCacheKey);
    if (addrCached && Date.now() - addrCached.ts < SEARCH_CACHE_TTL_MS) {
      if (onPartialResults) {
        onPartialResults(addrCached.results, { stage: 'address-cache' });
      }
      return addrCached.results;
    }

    const addrResults = await searchShrineByPastedAddress(
      cleanName,
      localSpots,
      userLocation,
      options
    );
    if (addrResults.length > 0 && !signal?.aborted) {
      if (onPartialResults) {
        onPartialResults(addrResults, { stage: 'address-exact' });
      }
      if (SEARCH_RESULT_CACHE.size >= 40) {
        const oldestKey = SEARCH_RESULT_CACHE.keys().next().value;
        SEARCH_RESULT_CACHE.delete(oldestKey);
      }
      SEARCH_RESULT_CACHE.set(addrCacheKey, { results: addrResults, ts: Date.now() });
    }
    return addrResults;
  }

  // 「京都 八坂神社」や「白鳥神社 · 東かがわ市, 香川県」のような区切り文字でも都道府県と社寺名を自動分割
  if (!cleanArea && /[\s　・·,]/.test(cleanName)) {
    const tokens = cleanName.split(/[\s　・·,]+/).filter(Boolean);
    if (tokens.length >= 2) {
      const prefIdx = tokens.findIndex((t) =>
        ALL_PREFECTURES.some(
          (p) =>
            p === t ||
            p.replace(/[都府県]$/, '') === t ||
            t.includes(p.replace(/[都府県]$/, ''))
        )
      );
      if (prefIdx >= 0) {
        const matchedPref = ALL_PREFECTURES.find(
          (p) =>
            p === tokens[prefIdx] ||
            p.replace(/[都府県]$/, '') === tokens[prefIdx] ||
            tokens[prefIdx].includes(p.replace(/[都府県]$/, ''))
        );
        cleanArea = matchedPref || tokens[prefIdx];
        const remaining = tokens.filter((_, idx) => idx !== prefIdx);
        const spotToken =
          remaining.find((t) =>
            /(?:神社|神宮|大社|天満宮|八幡|稲荷|権現|天神|明神|寺|院|堂|庵|大師|観音|不動|薬師|地蔵)/.test(
              t
            )
          ) || remaining[0];
        cleanName = spotToken || remaining.join(' ');
      }
    }
  }

  const cacheKey = `${cleanName}|${cleanArea}|${baseLat.toFixed(1)}|${baseLng.toFixed(1)}|${
    (localSpots || []).length
  }`;
  const cached = SEARCH_RESULT_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < SEARCH_CACHE_TTL_MS) {
    if (onPartialResults) {
      onPartialResults(cached.results, { stage: 'cache' });
    }
    return cached.results;
  }

  const rawCandidates = [];

  // 重複排除付きで候補リストに追加するヘルパー（半径220m以内の同名・類似名スポットは統合し、より高品質な住所を優先）
  const pushCandidate = (cand) => {
    if (Number.isNaN(cand.lat) || Number.isNaN(cand.lng)) return false;
    const normCand = normalizeShrineText(cand.name);
    const rawCandAddr = (cand.address || '').trim();
    const cleanCandAddr = scoreAddressQuality(rawCandAddr) > 0 ? rawCandAddr : '';

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
        : extractPrefectureFromSpot({ ...cand, address: cleanCandAddr });

    if (existingIdx >= 0) {
      const ex = rawCandidates[existingIdx];
      let updated = false;
      const candQ = scoreAddressQuality(cleanCandAddr);
      const exQ = scoreAddressQuality(ex.address);
      if (
        candQ > exQ ||
        (candQ === exQ && candQ >= 2 && cleanCandAddr.length > (ex.address || '').length)
      ) {
        ex.address = cleanCandAddr;
        updated = true;
      }
      if (!ex.prefecture && resolvedPref) {
        ex.prefecture = resolvedPref;
        updated = true;
      }
      if (cand.isFamousMatch && !ex.isFamousMatch) {
        ex.isFamousMatch = true;
        updated = true;
      }
      return updated;
    }

    const distMeters = calcDistanceMeters(baseLat, baseLng, cand.lat, cand.lng);
    rawCandidates.push({
      ...cand,
      address: cleanCandAddr,
      prefecture: resolvedPref,
      sampleGoshuin:
        cand.sampleGoshuin && cand.sampleGoshuin.length > 0
          ? cand.sampleGoshuin
          : buildDefaultSampleGoshuin(cand.name, cand.type),
      distanceMeters: distMeters,
      distanceKm: Math.round((distMeters / 1000) * 10) / 10,
      distanceLabel: formatDistanceLabel(distMeters)
    });
    return true;
  };

  const normQuery = normalizeShrineText(cleanName);

  const buildRankedRawList = () => {
    const hasDirectMatch = rawCandidates.some(
      (c) => getNameMatchTier(c.name, normQuery) >= 1
    );
    const copy = hasDirectMatch
      ? rawCandidates.filter((c) => getNameMatchTier(c.name, normQuery) >= 1)
      : [...rawCandidates];

    copy.sort((a, b) => {
      const tierA = getNameMatchTier(a.name, normQuery);
      const tierB = getNameMatchTier(b.name, normQuery);

      if (tierA !== tierB) {
        return tierB - tierA;
      }

      const famousA = a.isFamousMatch || a.source === 'Wikipedia社寺検索' ? 1 : 0;
      const famousB = b.isFamousMatch || b.source === 'Wikipedia社寺検索' ? 1 : 0;
      if (a.distanceMeters > 50000 && b.distanceMeters > 50000 && famousA !== famousB) {
        return famousB - famousA;
      }
      return a.distanceMeters - b.distanceMeters;
    });
    return copy.slice(0, 60);
  };

  const buildSortedSnapshot = () =>
    buildRankedRawList().map((c) =>
      c.address ? c : { ...c, address: c.prefecture || '' }
    );

  // 1. アプリ内登録済みスポット（0ms即座にヒット）
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

  if (rawCandidates.length > 0 && onPartialResults && !signal?.aborted) {
    onPartialResults(buildSortedSnapshot(), { stage: 'local' });
  }

  // 2. 高速公開API（国土地理院＋Wikipedia＋単一リクエストNominatim）を並列実行し、到着順に即時反映
  const emitIfChanged = (list, stage) => {
    if (signal?.aborted || !Array.isArray(list) || list.length === 0) return;
    let changed = false;
    for (const item of list) {
      if (pushCandidate(item)) changed = true;
    }
    if (changed && onPartialResults) {
      onPartialResults(buildSortedSnapshot(), { stage });
    }
  };

  await Promise.allSettled([
    searchViaGsiApi(cleanName, cleanArea, signal).then((l) => emitIfChanged(l, 'gsi')),
    searchViaWikipediaApi(cleanName, cleanArea, signal).then((l) => emitIfChanged(l, 'wiki')),
    searchViaNominatimApi(cleanName, cleanArea, baseLat, baseLng, signal).then((l) =>
      emitIfChanged(l, 'nominatim')
    )
  ]);

  if (signal?.aborted) {
    return buildSortedSnapshot();
  }

  // 3. 通称・別名・マイナー社寺対策：高速APIで明確な一致（tier >= 2）が少ない場合のみ Gemini AI を起動
  const strongMatchCount = rawCandidates.filter(
    (c) => getNameMatchTier(c.name, normQuery) >= 2
  ).length;
  if (
    includeAiFallback &&
    strongMatchCount === 0 &&
    rawCandidates.length < 3 &&
    getGeminiApiKey()
  ) {
    const aiGmapList = await searchViaGeminiGoogleMaps(cleanName, cleanArea, signal);
    emitIfChanged(aiGmapList, 'ai');
  }

  // 4. 住所が未設定または県名のみの候補について、上位10件を高速無料逆ジオコーディングで「都道府県＋市区町村＋町名」へ補完
  const rankedRaw = buildRankedRawList();
  const enrichedAny = await enrichCandidateAddresses(rankedRaw, signal, 10);
  if (enrichedAny && onPartialResults && !signal?.aborted) {
    onPartialResults(buildSortedSnapshot(), { stage: 'address' });
  }

  const finalResults = buildSortedSnapshot();
  if (finalResults.length > 0 && !signal?.aborted) {
    if (SEARCH_RESULT_CACHE.size >= 40) {
      const oldestKey = SEARCH_RESULT_CACHE.keys().next().value;
      SEARCH_RESULT_CACHE.delete(oldestKey);
    }
    SEARCH_RESULT_CACHE.set(cacheKey, { results: finalResults, ts: Date.now() });
  }

  return finalResults;
}

/**
 * 候補配列を都道府県ごとに集計し、選択中の都道府県で絞り込む共通ヘルパー
 * @param {Array} candidates
 * @param {string} prefFilter
 * @returns {{ prefOptions: Array<[string, number]>, hasMultiPrefs: boolean, visibleResults: Array }}
 */
export function filterAndGroupCandidatesByPrefecture(candidates = [], prefFilter = '') {
  const prefCountMap = new Map();
  for (const c of candidates) {
    const pref = c.prefecture || extractPrefectureFromSpot(c);
    if (pref) {
      prefCountMap.set(pref, (prefCountMap.get(pref) || 0) + 1);
    }
  }
  const prefOptions = [...prefCountMap.entries()];
  const hasMultiPrefs = prefOptions.length >= 2;
  const visibleResults =
    prefFilter && prefCountMap.has(prefFilter)
      ? candidates.filter(
          (c) => (c.prefecture || extractPrefectureFromSpot(c)) === prefFilter
        )
      : candidates;

  return { prefOptions, hasMultiPrefs, visibleResults };
}
