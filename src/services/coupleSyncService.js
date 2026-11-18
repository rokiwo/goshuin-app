import { db } from '../db/database.js';
import {
  getGeminiApiKey,
  setGeminiApiKey,
  getGeminiModel,
  setGeminiModel
} from './geminiService.js';

const STORAGE_KEY_PASSCODE = 'goshuin_couple_passcode';
const STORAGE_KEY_LAST_SYNC = 'goshuin_couple_last_sync';

/**
 * 夫婦専用の合言葉の正規化チェック（「0731」および旧形式に対応）
 */
export function isValidCouplePasscodeClient(rawCode) {
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
 * クラウド（Netlify Blobs）から指定した御朱印記録を削除する関数
 */
export async function deleteCoupleGoshuinRecord(spotId) {
  const passcode = getSavedCouplePasscode().trim();
  if (!passcode || !spotId) return { ok: false, skipped: true };

  const response = await fetch('/api/couple-sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      passcode,
      action: 'delete',
      spotId
    })
  });

  const data = await response.json();
  return data;
}

/**
 * クラウドから実物御朱印帳を削除する関数
 */
export async function deleteCoupleGoshuinBook(bookId) {
  const passcode = getSavedCouplePasscode().trim();
  if (!passcode || !bookId) return { ok: false, skipped: true };
  const response = await fetch('/api/couple-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode, action: 'deleteBook', bookId })
  });
  return response.json();
}

/**
 * クラウドからお気に入り社寺を削除する関数
 */
export async function deleteCoupleFavoriteSpot(spotId) {
  const passcode = getSavedCouplePasscode().trim();
  if (!passcode || !spotId) return { ok: false, skipped: true };
  const response = await fetch('/api/couple-sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ passcode, action: 'deleteFavorite', spotId })
  });
  return response.json();
}

/**
 * クラウド（Netlify Blobs）と端末内（IndexedDB）の御朱印帳データを双方向同期する関数
 * @param {string} customPasscode 入力された合言葉（省略時は保存済み合言葉を使用）
 */
export async function syncCoupleGoshuinData(customPasscode = null) {
  const passcode = (customPasscode !== null ? customPasscode : getSavedCouplePasscode()).trim();
  if (!passcode) {
    return { ok: false, skipped: true };
  }

  if (!isValidCouplePasscodeClient(passcode)) {
    throw new Error('合言葉が正しくありません。');
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

  let data = null;

  try {
    // 3. /api/couple-sync へ送信して双方向マージ（Netlify環境用）
    const response = await fetch('/api/couple-sync', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        passcode,
        action: 'sync',
        visits: localVisits,
        books: localBooks,
        favorites: localFavorites,
        settings: currentSettings
      })
    });

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
      if (!response.ok || !data.ok) {
        if (response.status === 403) {
          throw new Error(data.error || '合言葉が正しくありません。');
        }
        data = null;
      }
    }
  } catch (err) {
    if (err.message === '合言葉が正しくありません。') {
      throw err;
    }
    // GitHub Pages等の静的環境で /api/couple-sync が404になる場合はローカル認証で合言葉を有効化
    data = null;
  }

  if (data && data.ok) {
    // 4. クラウド側で削除済みのスポットIDがあれば端末内からも削除
    if (Array.isArray(data.deletedSpotIds) && data.deletedSpotIds.length > 0) {
      await db.visits.bulkDelete(data.deletedSpotIds);
    }
    if (Array.isArray(data.deletedBookIds) && data.deletedBookIds.length > 0) {
      await db.books.bulkDelete(data.deletedBookIds);
    }
    if (Array.isArray(data.deletedFavoriteIds) && data.deletedFavoriteIds.length > 0) {
      await db.favorites.bulkDelete(data.deletedFavoriteIds);
    }

    // 5. クラウドから返ってきた統合済み参拝レコード・お気に入りをスマホ内IndexedDBに反映
    if (Array.isArray(data.visits) && data.visits.length > 0) {
      await db.visits.bulkPut(data.visits);
    }
    if (Array.isArray(data.books) && data.books.length > 0) {
      await db.books.bulkPut(data.books);
    }
    if (Array.isArray(data.favorites) && data.favorites.length > 0) {
      await db.favorites.bulkPut(data.favorites);
    }

    // 6. クラウド側にGemini APIキーがあり、このスマホにまだ未設定なら自動で引き継ぐ
    if (data.settings?.geminiApiKey && !getGeminiApiKey()) {
      setGeminiApiKey(data.settings.geminiApiKey);
    }
    if (data.settings?.geminiModel) {
      setGeminiModel(data.settings.geminiModel);
    }
  }

  // 7. 合言葉と最終同期時刻を保存
  setSavedCouplePasscode(passcode);
  const nowDisplay = new Date().toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit'
  });
  localStorage.setItem(STORAGE_KEY_LAST_SYNC, nowDisplay);

  const finalVisits = data?.visits || localVisits;

  return {
    ok: true,
    totalSynced: (finalVisits || []).filter((v) => v.visited).length,
    syncedAt: nowDisplay,
    hasApiKeyNow: Boolean(getGeminiApiKey())
  };
}
