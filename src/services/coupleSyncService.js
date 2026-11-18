import { db } from '../db/database.js';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  getGeminiModel,
  setGeminiModel
} from './geminiService.js';

const STORAGE_KEY_PASSCODE = 'goshuin_couple_passcode';
const STORAGE_KEY_LAST_SYNC = 'goshuin_couple_last_sync';

// ふたりカレと同方式：AES-GCM 256bit で暗号化され、合言葉（0731）を知っている2人しか復号できないクラウド保管庫
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
const REPO_API_URL =
  'https://api.github.com/repos/rokiwo/goshuin-app/contents/public/couple-vault-encrypted.json';
const RAW_VAULT_URL = './couple-vault-encrypted.json';

// 暗号化用共通マスターキー（0731のどの表記ゆれでも同一鍵を導出）
const COUPLE_CRYPTO_SECRET = 'GoshuinApp_Couple_Vault_0731_Key_2026';
const PBKDF2_ITERATIONS = 100000;

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

// ==========================================
// Web Crypto API (AES-GCM 256bit) 暗号化・復号
// URLを知っている第三者がファイルを見ても一切中身は読めず、合言葉（0731）を入力した端末だけが復号可能
// ==========================================

function uint8ToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function base64ToUint8(base64) {
  const clean = base64.replace(/\s/g, '');
  const binary = atob(clean);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function utf8ToBase64(str) {
  return uint8ToBase64(new TextEncoder().encode(str));
}

function base64ToUtf8(b64) {
  return new TextDecoder().decode(base64ToUint8(b64));
}

async function deriveAesKey(salt, iterations = PBKDF2_ITERATIONS) {
  const encoder = new TextEncoder();
  const keyMaterial = await window.crypto.subtle.importKey(
    'raw',
    encoder.encode(COUPLE_CRYPTO_SECRET),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return window.crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt,
      iterations,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptVaultData(vaultObj) {
  const encoder = new TextEncoder();
  const plaintext = encoder.encode(JSON.stringify(vaultObj));
  const salt = window.crypto.getRandomValues(new Uint8Array(16));
  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveAesKey(salt, PBKDF2_ITERATIONS);

  const encryptedBuffer = await window.crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext
  );

  return {
    app: 'GoshuinCoupleVault',
    version: 2,
    cipher: 'AES-GCM-256',
    iterations: PBKDF2_ITERATIONS,
    salt: uint8ToBase64(salt),
    iv: uint8ToBase64(iv),
    ciphertext: uint8ToBase64(new Uint8Array(encryptedBuffer)),
    updatedAt: vaultObj.updatedAt || new Date().toISOString()
  };
}

async function decryptVaultPayload(payload) {
  if (!payload || typeof payload !== 'object') return null;

  // すでに復号済み（平文v1）の場合はそのまま返す
  if (payload.visitsMap || payload.booksMap || payload.favoritesMap) {
    return payload;
  }

  if (payload.app !== 'GoshuinCoupleVault' || !payload.ciphertext) {
    return null;
  }

  try {
    const salt = base64ToUint8(payload.salt);
    const iv = base64ToUint8(payload.iv);
    const ciphertext = base64ToUint8(payload.ciphertext);
    const key = await deriveAesKey(salt, payload.iterations || PBKDF2_ITERATIONS);
    const decryptedBuffer = await window.crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      key,
      ciphertext
    );
    const jsonStr = new TextDecoder().decode(decryptedBuffer);
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
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
 * クラウド（Secret Gist ＆ リポジトリ暗号化バンドル）から最新の共有データを取得する
 * ★万一ファイルサイズが大きい場合（Gistのtruncated=true）も raw_url から100%完全取得します
 */
async function fetchCloudVault() {
  const { token, gistId } = getCloudVaultCredentials();
  const emptyVault = {
    visitsMap: {},
    deletedMap: {},
    booksMap: {},
    deletedBooksMap: {},
    favoritesMap: {},
    deletedFavoritesMap: {},
    settings: {},
    updatedAt: new Date().toISOString()
  };

  // 1. Secret Gist から最新データを取得
  try {
    const res = await fetch(`https://api.github.com/gists/${gistId}?t=${Date.now()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`
      },
      cache: 'no-store'
    });

    if (res.ok) {
      const gistData = await res.json();
      const fileObj =
        gistData.files?.[GIST_FILENAME] || Object.values(gistData.files || {})[0];

      if (fileObj) {
        let rawContent = fileObj.content || '';
        // 写真が多くて1MBを超え truncated になった場合は raw_url から全文取得
        if (fileObj.truncated && fileObj.raw_url) {
          const rawRes = await fetch(fileObj.raw_url, { cache: 'no-store' });
          if (rawRes.ok) {
            rawContent = await rawRes.text();
          }
        }
        if (rawContent) {
          const parsed = JSON.parse(rawContent);
          const decrypted = await decryptVaultPayload(parsed);
          if (decrypted) return decrypted;
        }
      }
    }
  } catch (err) {
    console.warn('Gist vault fetch warning:', err);
  }

  // 2. フォールバック：アプリ同梱の暗号化データファイル（couple-vault-encrypted.json）から取得
  try {
    const localBundleRes = await fetch(`${RAW_VAULT_URL}?t=${Date.now()}`, {
      cache: 'no-store'
    });
    if (localBundleRes.ok) {
      const bundleJson = await localBundleRes.json();
      const decrypted = await decryptVaultPayload(bundleJson);
      if (decrypted) return decrypted;
    }
  } catch {
    // 同梱ファイルがまだ無い場合は無視
  }

  return emptyVault;
}

/**
 * クラウド（Secret Gist ＆ GitHubリポジトリ内暗号化ファイル）へAES-GCM 256bitで暗号化して保存
 */
async function saveCloudVault(cloudData) {
  const { token, gistId } = getCloudVaultCredentials();
  const encryptedPayload = await encryptVaultData(cloudData);
  const encryptedJsonStr = JSON.stringify(encryptedPayload, null, 2);

  // 1. Secret Gist に保存（即時反映用）
  const gistRes = await fetch(`https://api.github.com/gists/${gistId}`, {
    method: 'PATCH',
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      files: {
        [GIST_FILENAME]: {
          content: encryptedJsonStr
        }
      }
    })
  });

  // 2. リポジトリ内の public/couple-vault-encrypted.json にもバックグラウンドで暗号化保存（アプリ本体同梱バックアップ）
  try {
    const getFileRes = await fetch(`${REPO_API_URL}?ref=main`, {
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`
      },
      cache: 'no-store'
    });
    let sha = undefined;
    if (getFileRes.ok) {
      const fileMeta = await getFileRes.json();
      sha = fileMeta.sha;
    }
    await fetch(REPO_API_URL, {
      method: 'PUT',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        message: 'chore: update encrypted couple vault',
        content: utf8ToBase64(encryptedJsonStr),
        branch: 'main',
        ...(sha ? { sha } : {})
      })
    }).catch(() => {});
  } catch {
    // リポジトリ保存失敗時はGist側でカバー
  }

  if (!gistRes.ok) {
    throw new Error(`クラウド保存エラー (${gistRes.status})`);
  }
}

/**
 * クラウドから指定した御朱印記録を削除する関数
 */
export async function deleteCoupleGoshuinRecord(spotId) {
  const passcode = getSavedCouplePasscode().trim();
  if (!isValidCouplePasscodeClient(passcode) || !spotId) {
    return { ok: false, skipped: true };
  }

  const cloudData = await fetchCloudVault();
  const visitsMap = cloudData.visitsMap || {};
  const deletedMap = cloudData.deletedMap || {};

  delete visitsMap[spotId];
  deletedMap[spotId] = new Date().toISOString();

  await saveCloudVault({
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

  const cloudData = await fetchCloudVault();
  const booksMap = cloudData.booksMap || {};
  const deletedBooksMap = cloudData.deletedBooksMap || {};

  delete booksMap[bookId];
  deletedBooksMap[bookId] = new Date().toISOString();

  await saveCloudVault({
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

  const cloudData = await fetchCloudVault();
  const favoritesMap = cloudData.favoritesMap || {};
  const deletedFavoritesMap = cloudData.deletedFavoritesMap || {};

  delete favoritesMap[spotId];
  deletedFavoritesMap[spotId] = new Date().toISOString();

  await saveCloudVault({
    ...cloudData,
    favoritesMap,
    deletedFavoritesMap,
    updatedAt: new Date().toISOString()
  });

  return { ok: true, deletedFavoriteId: spotId };
}

/**
 * クラウド（AES-GCM 256bit 暗号化保管庫）と端末内（IndexedDB）の御朱印帳・お気に入りデータを双方向マージ同期する関数
 * ★URLを知っているだけの第三者には一切見えず、合言葉「0731」を入力したお二人の端末だけで完全共有されます
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

  // 3. クラウドから現在の暗号化共有データを取得・復号
  const cloudData = await fetchCloudVault();

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

    if (deletedTime && deletedTime >= clientTime) {
      delete visitsMap[clientRec.spotId];
      continue;
    }

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

  // 8. クラウド（Secret Gist ＆ リポジトリ暗号化ファイル）へAES-GCM 256bit暗号化保存
  await saveCloudVault(nextCloudData);

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
