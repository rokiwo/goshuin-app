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
 * クラウド（Netlify Blobs）と端末内（IndexedDB）の御朱印帳データを双方向同期する関数
 * @param {string} customPasscode 入力された合言葉（省略時は保存済み合言葉を使用）
 */
export async function syncCoupleGoshuinData(customPasscode = null) {
  const passcode = (customPasscode !== null ? customPasscode : getSavedCouplePasscode()).trim();
  if (!passcode) {
    return { ok: false, skipped: true };
  }

  // 1. 現在のスマホ内の全参拝レコード・実物御朱印帳を取得
  const localVisits = await db.visits.toArray();
  const localBooks = await db.books.toArray();

  // 2. 現在の設定（Gemini APIキー、御朱印帳テーマなど）を取得
  const currentSettings = {
    geminiApiKey: getGeminiApiKey(),
    geminiModel: getGeminiModel(),
    bookTheme: localStorage.getItem('goshuin_book_theme') || '',
    bookTitle: localStorage.getItem('goshuin_book_title') || ''
  };

  // 3. /api/couple-sync へ送信して双方向マージ
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
      settings: currentSettings
    })
  });

  const data = await response.json();

  if (!response.ok || !data.ok) {
    throw new Error(data.error || '合言葉の確認または同期に失敗しました。');
  }

  // 4. クラウド側で削除済みのスポットIDがあれば端末内からも削除
  if (Array.isArray(data.deletedSpotIds) && data.deletedSpotIds.length > 0) {
    await db.visits.bulkDelete(data.deletedSpotIds);
  }
  if (Array.isArray(data.deletedBookIds) && data.deletedBookIds.length > 0) {
    await db.books.bulkDelete(data.deletedBookIds);
  }

  // 5. クラウドから返ってきた統合済み参拝レコードをスマホ内IndexedDBに反映
  if (Array.isArray(data.visits) && data.visits.length > 0) {
    await db.visits.bulkPut(data.visits);
  }
  if (Array.isArray(data.books) && data.books.length > 0) {
    await db.books.bulkPut(data.books);
  }

  // 6. クラウド側にGemini APIキーがあり、このスマホにまだ未設定なら自動で引き継ぐ
  if (data.settings?.geminiApiKey && !getGeminiApiKey()) {
    setGeminiApiKey(data.settings.geminiApiKey);
  }
  if (data.settings?.geminiModel) {
    setGeminiModel(data.settings.geminiModel);
  }

  // 7. 合言葉と最終同期時刻を保存
  setSavedCouplePasscode(passcode);
  const nowDisplay = new Date().toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit'
  });
  localStorage.setItem(STORAGE_KEY_LAST_SYNC, nowDisplay);

  return {
    ok: true,
    totalSynced: (data.visits || []).filter((v) => v.visited).length,
    syncedAt: nowDisplay,
    hasApiKeyNow: Boolean(getGeminiApiKey())
  };
}
