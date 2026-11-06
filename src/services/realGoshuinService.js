// Web上の実在する寺社・御朱印写真の自動取得 ＆ Instagram / Google画像 / ホトカミ連携サービス

/**
 * Wikipedia / Wikimedia Commons API から、その寺社や御朱印に関する実在写真を自動検索して取得する関数
 * @param {string} spotName 寺社名
 * @param {string} address 住所（市区町村の絞り込み補助用）
 * @returns {Promise<Array<{url: string, title: string, sourceUrl: string}>>}
 */
export async function fetchRealWebPhotos(spotName) {
  const photos = [];
  const seenUrls = new Set();

  try {
    // 1. 日本語版Wikipediaからその寺社ページのメイン画像＋ページ内画像を取得
    const wpEndpoint = `https://ja.wikipedia.org/w/api.php?origin=*&action=query&format=json&prop=pageimages|info&inprop=url&piprop=original|thumbnail&pithumbsize=600&generator=search&gsrsearch=${encodeURIComponent(
      `${spotName} 御朱印 OR ${spotName}`
    )}&gsrlimit=3`;

    const wpRes = await fetch(wpEndpoint);
    if (wpRes.ok) {
      const wpData = await wpRes.json();
      const pages = wpData?.query?.pages ? Object.values(wpData.query.pages) : [];
      for (const p of pages) {
        // 検索語と関係が深いページのみ抽出
        if (!p.title || (!p.title.includes(spotName.slice(0, 2)) && !spotName.includes(p.title))) {
          continue;
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

    // 2. Wikimedia Commonsから「{寺社名} 御朱印」または「{寺社名}」で画像ファイルを直接検索
    const commonsEndpoint = `https://commons.wikimedia.org/w/api.php?origin=*&action=query&format=json&generator=search&gsrnamespace=6&gsrsearch=${encodeURIComponent(
      `"${spotName}"`
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
            title: cleanTitle || spotName,
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
 * Instagram・Google画像・ホトカミ・Omairi・X で「本物の御朱印投稿写真」をワンタップで開くURL一覧を生成
 */
export function buildRealGoshuinLinks(spot) {
  const cleanName = spot.name.replace(/（.*?）|\(.*?\)|\s+/g, '');
  const goshuinKeyword = `${cleanName} 御朱印`;
  const tagKeyword = `${cleanName}御朱印`;

  return [
    {
      id: 'instagram-tag',
      label: 'Instagram（#御朱印タグ）',
      subLabel: `#${ cleanName } で投稿写真を見る`,
      url: `https://www.instagram.com/explore/tags/${encodeURIComponent(cleanName)}/`,
      badgeColor: 'bg-gradient-to-r from-pink-600 via-rose-500 to-amber-500 text-white'
    },
    {
      id: 'google-images',
      label: 'Google画像（実物の御朱印一覧）',
      subLabel: `「${goshuinKeyword}」の写真検索`,
      url: `https://www.google.com/search?tbm=isch&q=${encodeURIComponent(goshuinKeyword)}`,
      badgeColor: 'bg-blue-600 text-white'
    },
    {
      id: 'hotokami',
      label: 'ホトカミ（御朱印投稿サイト）',
      subLabel: `${cleanName}の実際の授与レポート`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`site:hotokami.jp ${cleanName} 御朱印`)}`,
      badgeColor: 'bg-shuiro text-washi'
    },
    {
      id: 'omairi',
      label: 'Omairi（おまいり御朱印検索）',
      subLabel: `${cleanName}の御朱印・初穂料情報`,
      url: `https://www.google.com/search?q=${encodeURIComponent(`site:omairi.club ${cleanName} 御朱印`)}`,
      badgeColor: 'bg-tera text-washi'
    },
    {
      id: 'x-search',
      label: 'X / 旧Twitter（最新の限定御朱印）',
      subLabel: `「#${tagKeyword}」のリアルタイム投稿`,
      url: `https://x.com/search?q=${encodeURIComponent(`${cleanName} 御朱印`)}&f=image`,
      badgeColor: 'bg-sumi text-washi'
    }
  ];
}
