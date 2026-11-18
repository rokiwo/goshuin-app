import { getStore } from '@netlify/blobs';

// 夫婦専用の合言葉の正規化チェック
function isValidCouplePasscode(rawCode) {
  if (!rawCode || typeof rawCode !== 'string') return false;
  const cleaned = rawCode.trim().replace(/[年月\/\-]/g, '.').replace(/日/g, '');
  const validCodes = new Set([
    '0731',
    '731',
    '07.31',
    '7.31',
    '2026.7.31',
    '2026.07.31',
    '2026731',
    '20260731'
  ]);
  return validCodes.has(cleaned);
}

export default async (req) => {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers
    });
  }

  try {
    const body = await req.json();
    const {
      passcode,
      action = 'sync',
      spotId = '',
      visits = [],
      settings = {}
    } = body || {};

    // 合言葉が一致しない場合はヒントを一切出さずに拒否
    if (!isValidCouplePasscode(passcode)) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: '合言葉が正しくありません。'
        }),
        { status: 403, headers }
      );
    }

    const store = getStore('couple-goshuin-vault');
    const roomKey = 'room-2026-07-31';

    let cloudData = await store.get(roomKey, { type: 'json' });
    if (!cloudData || typeof cloudData !== 'object') {
      cloudData = {
        visitsMap: {},
        deletedMap: {},
        settings: {},
        updatedAt: new Date().toISOString()
      };
    }

    const visitsMap = cloudData.visitsMap || {};
    const deletedMap = cloudData.deletedMap || {};
    const booksMap = cloudData.booksMap || {};
    const deletedBooksMap = cloudData.deletedBooksMap || {};
    const favoritesMap = cloudData.favoritesMap || {};
    const deletedFavoritesMap = cloudData.deletedFavoritesMap || {};

    // ★お気に入り社寺の削除アクション
    if (action === 'deleteFavorite' && spotId) {
      delete favoritesMap[spotId];
      deletedFavoritesMap[spotId] = new Date().toISOString();
      cloudData = {
        ...cloudData,
        favoritesMap,
        deletedFavoritesMap,
        updatedAt: new Date().toISOString()
      };
      await store.setJSON(roomKey, cloudData);
      return new Response(JSON.stringify({ ok: true, deletedFavoriteId: spotId }), {
        status: 200,
        headers
      });
    }

    // ★実物御朱印帳の削除アクション
    if (action === 'deleteBook' && body.bookId) {
      delete booksMap[body.bookId];
      deletedBooksMap[body.bookId] = new Date().toISOString();
      cloudData = {
        ...cloudData,
        booksMap,
        deletedBooksMap,
        updatedAt: new Date().toISOString()
      };
      await store.setJSON(roomKey, cloudData);
      return new Response(JSON.stringify({ ok: true, deletedBookId: body.bookId }), {
        status: 200,
        headers
      });
    }

    // ★個別御朱印の削除アクション
    if (action === 'delete' && spotId) {
      delete visitsMap[spotId];
      deletedMap[spotId] = new Date().toISOString();

      cloudData = {
        ...cloudData,
        visitsMap,
        deletedMap,
        updatedAt: new Date().toISOString()
      };
      await store.setJSON(roomKey, cloudData);

      return new Response(
        JSON.stringify({
          ok: true,
          deletedSpotId: spotId,
          visits: Object.values(visitsMap),
          deletedMap
        }),
        { status: 200, headers }
      );
    }

    // ★双方向同期アクション
    if (action === 'sync' && Array.isArray(visits)) {
      for (const clientRec of visits) {
        if (!clientRec || !clientRec.spotId) continue;
        const clientTime = clientRec.updatedAt || '';
        const deletedTime = deletedMap[clientRec.spotId] || '';

        // クラウド側で後から削除された記録であれば復活させない
        if (deletedTime && deletedTime >= clientTime) {
          delete visitsMap[clientRec.spotId];
          continue;
        }

        // 新しく再登録・更新された場合は削除履歴をクリア
        if (deletedTime && clientTime > deletedTime) {
          delete deletedMap[clientRec.spotId];
        }

        const existingRec = visitsMap[clientRec.spotId];
        if (!existingRec) {
          visitsMap[clientRec.spotId] = clientRec;
        } else {
          const cloudTime = existingRec.updatedAt || '';
          if (clientTime >= cloudTime) {
            visitsMap[clientRec.spotId] = {
              ...existingRec,
              ...clientRec,
              aiSpotGuide: clientRec.aiSpotGuide || existingRec.aiSpotGuide || null,
              aiPhotoAnalysis:
                clientRec.aiPhotoAnalysis || existingRec.aiPhotoAnalysis || null
            };
          }
        }
      }

      // 実物御朱印帳（表紙・裏表紙）のマージ
      const clientBooks = Array.isArray(body.books) ? body.books : [];
      for (const b of clientBooks) {
        if (!b || !b.id) continue;
        const t = b.updatedAt || '';
        const delT = deletedBooksMap[b.id] || '';
        if (delT && delT >= t) {
          delete booksMap[b.id];
          continue;
        }
        const ex = booksMap[b.id];
        if (!ex || t >= (ex.updatedAt || '')) {
          booksMap[b.id] = b;
        }
      }

      // お気に入り社寺のマージ
      const clientFavorites = Array.isArray(body.favorites) ? body.favorites : [];
      for (const fav of clientFavorites) {
        if (!fav || !fav.spotId) continue;
        const t = fav.updatedAt || '';
        const delT = deletedFavoritesMap[fav.spotId] || '';
        if (delT && delT >= t) {
          delete favoritesMap[fav.spotId];
          continue;
        }
        if (delT && t > delT) {
          delete deletedFavoritesMap[fav.spotId];
        }
        const ex = favoritesMap[fav.spotId];
        if (!ex || t >= (ex.updatedAt || '')) {
          favoritesMap[fav.spotId] = fav;
        }
      }

      const mergedSettings = {
        ...(cloudData.settings || {})
      };
      if (settings.geminiApiKey && settings.geminiApiKey.trim()) {
        mergedSettings.geminiApiKey = settings.geminiApiKey.trim();
      }
      if (settings.geminiModel) {
        mergedSettings.geminiModel = settings.geminiModel;
      }
      if (settings.bookTheme) {
        mergedSettings.bookTheme = settings.bookTheme;
      }
      if (settings.bookTitle) {
        mergedSettings.bookTitle = settings.bookTitle;
      }

      cloudData = {
        visitsMap,
        deletedMap,
        booksMap,
        deletedBooksMap,
        favoritesMap,
        deletedFavoritesMap,
        settings: mergedSettings,
        updatedAt: new Date().toISOString()
      };

      await store.setJSON(roomKey, cloudData);
    }

    const mergedVisitsList = Object.values(cloudData.visitsMap || {});

    return new Response(
      JSON.stringify({
        ok: true,
        visits: mergedVisitsList,
        deletedSpotIds: Object.keys(cloudData.deletedMap || {}),
        books: Object.values(cloudData.booksMap || {}),
        deletedBookIds: Object.keys(cloudData.deletedBooksMap || {}),
        favorites: Object.values(cloudData.favoritesMap || {}),
        deletedFavoriteIds: Object.keys(cloudData.deletedFavoritesMap || {}),
        settings: cloudData.settings || {},
        updatedAt: cloudData.updatedAt
      }),
      { status: 200, headers }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        ok: false,
        error: `クラウド同期エラー: ${err.message || '不明なエラー'}`
      }),
      { status: 500, headers }
    );
  }
};
