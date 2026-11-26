// Web上の実在する寺社・御朱印写真の自動取得 ＆ ホトカミ / Instagram / Google画像（地域絞り込み・同名混入防止）連携サービス
import { extractPrefectureFromSpot } from '../db/database.js';
import { calcDistanceMeters } from './shrineSearchService.js';

/**
 * スポット情報から「都道府県」「市区町村」を抽出し、全国の同名神社との混同を防ぐ検索キーワードを作る
 */
export function extractSpotAreaKeywords(spot = {}) {
  const pref = extractPrefectureFromSpot(spot);
  const validPref = pref && pref !== '未分類' ? pref : '';
  const addr = String(spot.address || '').trim();
  const withoutPref = validPref && addr.startsWith(validPref)
    ? addr.slice(validPref.length).trim()
    : addr;
  // 政令市は「神戸市中央区」→「神戸市」のように市・郡・区単位を抽出
  const cityMatch = withoutPref.match(/^(.+?[市郡区町村])/);
  const rawCity = cityMatch ? cityMatch[1].trim() : '';
  const city = rawCity && rawCity !== validPref ? rawCity : '';
  const areaQuery = [validPref, city].filter(Boolean).join(' ');
  const areaLabel = `${validPref}${city}` || '所在地指定';

  return {
    prefecture: validPref,
    city,
    areaQuery,
    areaLabel
  };
}

/**
 * Wikipedia / Wikimedia Commons API から、その寺社や御朱印に関する実在写真を自動検索して取得する関数
 * ★座標距離チェック（5km以内）＋都道府県・市区町村指定により、別県の同名神社の写真混入を防止
 * @param {object|string} spotOrName スポットオブジェクトまたは寺社名
 */
export async function fetchRealWebPhotos(spotOrName) {
  const spot =
    typeof spotOrName === 'object' && spotOrName !== null
      ? spotOrName
      : { name: String(spotOrName || '') };
  const spotName = (spot.name || '').trim();
  if (!spotName) return [];

  const cleanName = spotName.replace(/（.*?）|\(.*?\)|\s+/g, '');
  const { prefecture, city, areaQuery } = extractSpotAreaKeywords(spot);
  const hasCoord =
    typeof spot.lat === 'number' &&
    typeof spot.lng === 'number' &&
    !Number.isNaN(spot.lat) &&
    !Number.isNaN(spot.lng);

  const photos = [];
  const seenUrls = new Set();

  try {
    // 1. 日本語版Wikipediaから「寺社名＋都道府県・市区町村」で検索し、座標が5km以内の同一社寺のみ採用
    const wpQuery = areaQuery ? `"${cleanName}" ${areaQuery}` : cleanName;
    const wpEndpoint = `https://ja.wikipedia.org/w/api.php?origin=*&action=query&format=json&prop=pageimages|info|coordinates&inprop=url&piprop=original|thumbnail&pithumbsize=600&generator=search&gsrsearch=${encodeURIComponent(
      wpQuery
    )}&gsrlimit=5`;

    const wpRes = await fetch(wpEndpoint);
    if (wpRes.ok) {
      const wpData = await wpRes.json();
      const pages = wpData?.query?.pages ? Object.values(wpData.query.pages) : [];
      for (const p of pages) {
        if (!p.title) continue;
        const cleanPageTitle = p.title.replace(/\s*[（(].*?[）)]\s*/g, '').trim();
        if (!cleanPageTitle.includes(cleanName) && !cleanName.includes(cleanPageTitle)) {
          continue;
        }
        // 座標がある場合は5km以上離れた別地域の同名神社を除外
        const coord = p.coordinates?.[0];
        if (hasCoord && coord && typeof coord.lat === 'number' && typeof coord.lon === 'number') {
          if (calcDistanceMeters(spot.lat, spot.lng, coord.lat, coord.lon) > 5000) {
            continue;
          }
        }
        const imgUrl = p.thumbnail?.source || p.original?.source;
        if (imgUrl && !seenUrls.has(imgUrl)) {
          seenUrls.add(imgUrl);
          photos.push({
            url: imgUrl,
            title: `${p.title}（Web公開写真）`,
            sourceUrl: p.fullurl || `https://ja.wikipedia.org/wiki/${encodeURIComponent(p.title)}`
          });
        }
      }
    }

    // 2. Wikimedia Commonsから「"寺社名" "市区町村または県名"」で検索して同名他社を除外
    const commonsQuery = city || prefecture
      ? `"${cleanName}" "${city || prefecture}"`
      : `"${cleanName}"`;
    const commonsEndpoint = `https://commons.wikimedia.org/w/api.php?origin=*&action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(
      commonsQuery
    )}&gsrlimit=4&prop=imageinfo&iiprop=url|extmetadata&iiurlwidth=600`;

    const commonsRes = await fetch(commonsEndpoint);
    if (commonsRes.ok) {
      const commonsData = await commonsRes.json();
      const pages = commonsData?.query?.pages ? Object.values(commonsData.query.pages) : [];
      for (const p of pages) {
        const info = p.imageinfo?.[0];
        const thumbUrl = info?.thumburl || info?.url;
        if (thumbUrl && !seenUrls.has(thumbUrl) && !thumbUrl.endsWith('.svg') && !thumbUrl.endsWith('.pdf')) {
          seenUrls.add(thumbUrl);
          const cleanTitle = (p.title || '').replace(/^File:/i, '').replace(/\.[^.]+$/, '');
          photos.push({
            url: thumbUrl,
            title: cleanTitle || cleanName,
            sourceUrl: info?.descriptionurl || thumbUrl
          });
        }
      }
    }
  } catch {
    // ネットワークエラー時は空配列を返す
  }

  return photos.slice(0, 5);
}

/**
 * ホトカミ・Instagram・Google画像・Omairi・X で「同名の別神社が混ざらない地域指定URL」を生成
 */
export function buildRealGoshuinLinks(spot) {
  const cleanName = (spot?.name || '').replace(/（.*?）|\(.*?\)|\s+/g, '');
  const { prefecture, city, areaQuery, areaLabel } = extractSpotAreaKeywords(spot);
  const locToken = city || prefecture;
  const scopedGoshuinKeyword = areaQuery
    ? `"${cleanName}" ${areaQuery} 御朱印`
    : `${cleanName} 御朱印`;
  const instaKeyword = [cleanName, locToken, '御朱印'].filter(Boolean).join(' ');

  return [
    {
      id: 'hotokami',
      label: 'ホトカミ（御朱印・授与実績）',
      subLabel: `${areaLabel}「${cleanName}」の授与レポート`,
      url: `https://www.google.com/search?q=${encodeURIComponent(
        `site:hotokami.jp "${cleanName}" ${areaQuery} 御朱印`.trim()
      )}`,
      badgeColor: 'bg-shuiro text-washi'
    },
    {
      id: 'hotokami-direct',
      label: 'ホトカミ公式内検索',
      subLabel: `ホトカミで「${cleanName} ${prefecture}」を開く`,
      url: `https://hotokami.jp/search/?keyword=${encodeURIComponent(
        [cleanName, prefecture, city].filter(Boolean).join(' ')
      )}`,
      badgeColor: 'bg-amber-600 text-white'
    },
    {
      id: 'instagram-scoped',
      label: 'Instagram（地域指定で検索）',
      subLabel: `「${instaKeyword}」で同名神社を除外`,
      url: `https://www.instagram.com/explore/search/keyword/?q=${encodeURIComponent(
        instaKeyword
      )}`,
      badgeColor: 'bg-gradient-to-r from-pink-600 via-rose-500 to-amber-500 text-white'
    },
    {
      id: 'google-images',
      label: 'Google画像（地域一致の御朱印）',
      subLabel: `${areaLabel}「${cleanName}」の実物写真`,
      url: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(scopedGoshuinKeyword)}`,
      badgeColor: 'bg-blue-600 text-white'
    },
    {
      id: 'omairi',
      label: 'Omairi（御朱印・初穂料）',
      subLabel: `${areaLabel}の初穂料・書置き情報`,
      url: `https://www.google.com/search?q=${encodeURIComponent(
        `site:omairi.club "${cleanName}" ${areaQuery} 御朱印`.trim()
      )}`,
      badgeColor: 'bg-tera text-washi'
    },
    {
      id: 'x-search',
      label: 'X / 旧Twitter（地域指定・最新）',
      subLabel: `「${cleanName} ${locToken} 御朱印」画像投稿`,
      url: `https://x.com/search?q=${encodeURIComponent(
        `"${cleanName}" ${locToken} 御朱印`.trim()
      )}&f=image`,
      badgeColor: 'bg-sumi text-washi'
    }
  ];
}
