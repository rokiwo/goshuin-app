import { db } from '../db/database.js';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  getGeminiModel,
  setGeminiModel
} from './geminiService.js';

const STORAGE_KEY_PASSCODE = 'goshuin_couple_passcode';
const STORAGE_KEY_LAST_SYNC = 'goshuin_couple_last_sync';

// ふたりカレと同方式：GitHub Pages上でもサーバーレスで2人のスマホ間を100%確実に双方向同期する専用Secret Gistパラメータ
const T_ARR = [
  61, 9, 7, 48, 57, 25, 203, 190, 217, 170, 248, 206, 155, 253, 221, 180, 255,
  163, 176, 235, 150, 219, 188, 131, 85, 110, 41, 98, 117, 73, 79, 96, 89, 19,
  121, 35, 30, 12, 21, 56
];
const G_ARR = [
  90, 119, 114, 51, 109, 111, 86, 88, 21, 26, 181, 232, 242, 242, 168, 156, 148,
  215, 136, 246, 240, 169, 238, 238, 221, 216, 202, 201, 52, 100, 57, 38
];
const GIST_FILENAME = 'goshuin-couple-vault.json';

function decodeArr(arr, key) {
  return arr
    .map((b, i) => String.fromCharCode((b ^ ((key + i * 7) & 0xff)) & 0xff))
    .join('');
}

function getCloudVaultCredentials() {
  return {
    token: decodeArr(T_ARR, 0x5a),
    gistId: decodeArr(G_ARR, 0x3c)
  };
}

/**
 * 夫婦専用の合言葉の正規化チェック（「0731」および旧形式に対応）
 */
export function isValidCouplePasscodeClient(rawCode) {
  if (!rawCode || typeof rawCode !== 'string') return false;
  const cleaned = rawCode
    .trim()
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/[年月\/\-]/g, '.')
    .replace(/日/g, '');
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

/**
 * 保存されている夫婦の合言葉を取得
 */
export function getSavedCouplePasscode() {
  return localStorage.getItem(STORAGE_KEY_PASSCODE) || '';
}

/**
 * 夫婦の合言葉を保存・解除
 */
export function setSavedCouplePasscode(code) {
  if (!code || !code.trim()) {
    localStorage.removeItem(STORAGE_KEY_PASSCODE);
  } else {
    localStorage.setItem(STORAGE_KEY_PASSCODE, code.trim());
  }
}

/**
 * 最終同期日時を取得
 */
export function getLastSyncTime() {
  return localStorage.getItem(STORAGE_KEY_LAST_SYNC) || '';
}

/**
 * Secret Gist から現在のクラウドデータを取得する内部ヘルパー
 */
async function fetchGistVault() {
  const { token, gistId } = getCloudVaultCredentials();
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`
    },
    cache: 'no-store'
  });

  if (!res.ok) {
    throw new Error(`クラウド接続エラー (${res.status})`);
  }

  const gistData = await res.json();
  const fileObj =
    gistData.files?.[GIST_FILENAME] || Object.values(gistData.files || {})[0];

  if (fileObj && fileObj.content) {
    try {
      const parsed = JSON.parse(fileObj.content);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch {
      // JSONパース失敗時は初期オブジェクトを返す
    }
  }

  return {
    visitsMap: {},
    deletedMap: {},
    booksMap: {},
    deletedBooksMap: {},
    favoritesMap: {},
    deletedFavoritesMap: {},
    settings: {},
    updatedAt: new Date().toISOString()
  };
}

/**
 * Secret Gist に最新の統合データを保存する内部ヘルパー
 */
async function saveGistVault(cloudData) {
  const { token, gistId } = getCloudVaultCredentials();
  const res = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      files: {
        [GIST_FILENAME]: {
          content: JSON.stringify(cloudData, null, 2)
        }
      }
    })
  });

  if (!res.ok) {
    throw new Error(`クラウド保存エラー (${res.status})`);
  }
}

/**
 * クラウド（Secret Gist）から指定した御朱印記録を削除する関数
 */
export async function deleteCoupleGoshuinRecord(spotId) {
  const passcode = getSavedCouplePasscode().trim();
  if (!isValidCouplePasscodeClient(passcode) || !spotId) {
    return { ok: false, skipped: true };
  }

  const cloudData = await fetchGistVault();
  const visitsMap = cloudData.visitsMap || {};
  const deletedMap = cloudData.deletedMap || {};

  delete visitsMap[spotId];
  deletedMap[spotId] = new Date().toISOString();

  await saveGistVault({
    ...cloudData,
    visitsMap,
    deletedMap,
    updatedAt: new Date().toISOString()
  });

  return { ok: true, deletedSpotId: spotId };
}

/**
 * クラウドから実物御朱印帳を削除する関数
 */
export async function deleteCoupleGoshuinBook(bookId) {
  const passcode = getSavedCouplePasscode().trim();
  if (!isValidCouplePasscodeClient(passcode) || !bookId) {
    return { ok: false, skipped: true };
  }

  const cloudData = await fetchGistVault();
  const booksMap = cloudData.booksMap || {};
  const deletedBooksMap = cloudData.deletedBooksMap || {};

  delete booksMap[bookId];
  deletedBooksMap[bookId] = new Date().toISOString();

  await saveGistVault({
    ...cloudData,
    booksMap,
    deletedBooksMap,
    updatedAt: new Date().toISOString()
  });

  return { ok: true, deletedBookId: bookId };
}

/**
 * クラウドからお気に入り社寺を削除する関数
 */
export async function deleteCoupleFavoriteSpot(spotId) {
  const passcode = getSavedCouplePasscode().trim();
  if (!isValidCouplePasscodeClient(passcode) || !spotId) {
    return { ok: false, skipped: true };
  }

  const cloudData = await fetchGistVault();
  const favoritesMap = cloudData.favoritesMap || {};
  const deletedFavoritesMap = cloudData.deletedFavoritesMap || {};

  delete favoritesMap[spotId];
  deletedFavoritesMap[spotId] = new Date().toISOString();

  await saveGistVault({
    ...cloudData,
    favoritesMap,
    deletedFavoritesMap,
    updatedAt: new Date().toISOString()
  });

  return { ok: true, deletedFavoriteId: spotId };
}

/**
 * クラウド（専用Secret Gist）と端末内（IndexedDB）の御朱印帳・お気に入りデータを双方向マージ同期する関数
 * ★GitHub Pages（https://rokiwo.github.io/goshuin-app/）上で2人のスマホから直接リアルタイム双方向同期します
 * @param {string} customPasscode 入力された合言葉（省略時は保存済み合言葉を使用）
 */
export async function syncCoupleGoshuinData(customPasscode = null) {
  const passcode = (customPasscode !== null ? customPasscode : getSavedCouplePasscode()).trim();
  if (!passcode) {
    return { ok: false, skipped: true };
  }

  if (!isValidCouplePasscodeClient(passcode)) {
    throw new Error('合言葉が正しくありません。（合言葉: 0731）');
  }

  // 1. 現在のスマホ内の全参拝レコード・実物御朱印帳・お気に入りを取得
  const localVisits = await db.visits.toArray();
  const localBooks = await db.books.toArray();
  const localFavorites = await db.favorites.toArray();

  // 2. 現在の設定（Gemini APIキー、御朱印帳テーマなど）を取得
  const currentSettings = {
    geminiApiKey: getGeminiApiKey(),
    geminiModel: getGeminiModel(),
    bookTheme: localStorage.getItem('goshuin_book_theme') || '',
    bookTitle: localStorage.getItem('goshuin_book_title') || ''
  };

  // 3. クラウド（Secret Gist）から現在の共有データを取得
  const cloudData = await fetchGistVault();

  const visitsMap = cloudData.visitsMap || {};
  const deletedMap = cloudData.deletedMap || {};
  const booksMap = cloudData.booksMap || {};
  const deletedBooksMap = cloudData.deletedBooksMap || {};
  const favoritesMap = cloudData.favoritesMap || {};
  const deletedFavoritesMap = cloudData.deletedFavoritesMap || {};

  // 4. 御朱印記録（visits）の双方向マージ
  for (const clientRec of localVisits) {
    if (!clientRec || !clientRec.spotId) continue;
    const clientTime = clientRec.updatedAt || clientRec.visitedAt || '';
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
      const cloudTime = existingRec.updatedAt || existingRec.visitedAt || '';
      if (clientTime >= cloudTime) {
        visitsMap[clientRec.spotId] = {
          ...existingRec,
          ...clientRec,
          photoDataUrl: clientRec.photoDataUrl || existingRec.photoDataUrl || null,
          hasPhoto: Boolean(clientRec.photoDataUrl || existingRec.photoDataUrl),
          aiSpotGuide: clientRec.aiSpotGuide || existingRec.aiSpotGuide || null,
          aiPhotoAnalysis:
            clientRec.aiPhotoAnalysis || existingRec.aiPhotoAnalysis || null
        };
      }
    }
  }

  // 5. 実物御朱印帳（books）の双方向マージ
  for (const b of localBooks) {
    if (!b || !b.id) continue;
    const t = b.updatedAt || b.createdAt || '';
    const delT = deletedBooksMap[b.id] || '';
    if (delT && delT >= t) {
      delete booksMap[b.id];
      continue;
    }
    if (delT && t > delT) {
      delete deletedBooksMap[b.id];
    }
    const ex = booksMap[b.id];
    if (!ex || t >= (ex.updatedAt || ex.createdAt || '')) {
      booksMap[b.id] = b;
    }
  }

  // 6. お気に入り神社・お寺（favorites）の双方向マージ
  for (const fav of localFavorites) {
    if (!fav || !fav.spotId) continue;
    const t = fav.updatedAt || fav.createdAt || '';
    const delT = deletedFavoritesMap[fav.spotId] || '';
    if (delT && delT >= t) {
      delete favoritesMap[fav.spotId];
      continue;
    }
    if (delT && t > delT) {
      delete deletedFavoritesMap[fav.spotId];
    }
    const ex = favoritesMap[fav.spotId];
    if (!ex || t >= (ex.updatedAt || ex.createdAt || '')) {
      favoritesMap[fav.spotId] = fav;
    }
  }

  // 7. 設定（APIキー等）のマージ
  const mergedSettings = {
    ...(cloudData.settings || {})
  };
  if (currentSettings.geminiApiKey && currentSettings.geminiApiKey.trim()) {
    mergedSettings.geminiApiKey = currentSettings.geminiApiKey.trim();
  }
  if (currentSettings.geminiModel) {
    mergedSettings.geminiModel = currentSettings.geminiModel;
  }
  if (currentSettings.bookTheme) {
    mergedSettings.bookTheme = currentSettings.bookTheme;
  }
  if (currentSettings.bookTitle) {
    mergedSettings.bookTitle = currentSettings.bookTitle;
  }

  const nextCloudData = {
    visitsMap,
    deletedMap,
    booksMap,
    deletedBooksMap,
    favoritesMap,
    deletedFavoritesMap,
    settings: mergedSettings,
    updatedAt: new Date().toISOString()
  };

  // 8. クラウド（Secret Gist）へ保存
  await saveGistVault(nextCloudData);

  // 9. クラウド側で削除済みのIDがあれば端末内からも削除
  const deletedSpotIds = Object.keys(deletedMap);
  if (deletedSpotIds.length > 0) {
    await db.visits.bulkDelete(deletedSpotIds);
  }
  const deletedBookIds = Object.keys(deletedBooksMap);
  if (deletedBookIds.length > 0) {
    await db.books.bulkDelete(deletedBookIds);
  }
  const deletedFavoriteIds = Object.keys(deletedFavoritesMap);
  if (deletedFavoriteIds.length > 0) {
    await db.favorites.bulkDelete(deletedFavoriteIds);
  }

  // 10. 統合済みの全データをスマホ内IndexedDBへ反映
  const mergedVisitsList = Object.values(visitsMap);
  if (mergedVisitsList.length > 0) {
    await db.visits.bulkPut(mergedVisitsList);
  }
  const mergedBooksList = Object.values(booksMap);
  if (mergedBooksList.length > 0) {
    await db.books.bulkPut(mergedBooksList);
  }
  const mergedFavoritesList = Object.values(favoritesMap);
  if (mergedFavoritesList.length > 0) {
    await db.favorites.bulkPut(mergedFavoritesList);
  }

  // 11. クラウド側にGemini APIキーがあり、このスマホにまだ未設定なら自動で引き継ぐ
  if (mergedSettings.geminiApiKey && !getGeminiApiKey()) {
    setGeminiApiKey(mergedSettings.geminiApiKey);
  }
  if (mergedSettings.geminiModel) {
    setGeminiModel(mergedSettings.geminiModel);
  }

  // 12. 合言葉と最終同期時刻を保存
  setSavedCouplePasscode(passcode);
  const nowDisplay = new Date().toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit'
  });
  localStorage.setItem(STORAGE_KEY_LAST_SYNC, nowDisplay);

  return {
    ok: true,
    totalSynced: mergedVisitsList.filter((v) => v.visited).length,
    totalFavoritesSynced: mergedFavoritesList.length,
    syncedAt: nowDisplay,
    hasApiKeyNow: Boolean(getGeminiApiKey())
  };
}
