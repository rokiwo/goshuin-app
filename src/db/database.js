import Dexie from 'dexie';

// IndexedDB（Dexie.js）のデータベース定義
// 端末内に参拝記録・御朱印写真（Base64）・AI鑑定結果・AI寺社解説・AIルート履歴を完全永続化します
export const db = new Dexie('GoshuinAlbumDatabase');

db.version(2).stores({
  visits: 'spotId, name, type, visited, visitedAt, hasPhoto, updatedAt',
  aiRoutes: '++id, createdAt, areaName'
});

// v3: 実際に使っている「実物の御朱印帳」（表紙・裏表紙写真つき）を管理するテーブルを追加
db.version(3).stores({
  visits: 'spotId, name, type, visited, visitedAt, hasPhoto, updatedAt',
  aiRoutes: '++id, createdAt, areaName',
  books: 'id, name, createdAt, updatedAt'
});

/**
 * 夫婦共有が有効なら裏側でクラウド同期を走らせる共通ヘルパー
 */
function triggerBackgroundSync() {
  try {
    const savedPasscode = localStorage.getItem('goshuin_couple_passcode');
    if (savedPasscode) {
      import('../services/coupleSyncService.js').then(({ syncCoupleGoshuinData }) => {
        syncCoupleGoshuinData().catch(() => {});
      });
    }
  } catch {
    // オフライン時は次回起動時に自動同期
  }
}

/**
 * 御朱印レコードが属する「社寺そのもの」のID
 * （同じ社寺で2枚目以降の御朱印をもらった場合、spotIdは別IDになるが placeId は共通）
 */
export function getPlaceId(record) {
  if (!record) return '';
  return record.placeId || record.spotId;
}

/**
 * 同じ社寺で2枚目以降の御朱印を登録するための新しいレコードIDを発行
 */
export function createAdditionalEntryId(placeId) {
  return `${placeId}__g${Date.now().toString(36)}`;
}

/**
 * 参拝状態または写真・メモ・AI解析結果を保存・更新する関数
 * 夫婦の合言葉が設定されている場合は、保存と同時にバックグラウンドで自動クラウド同期も実行します
 */
export async function saveVisitRecord(spot, updates = {}) {
  const existing = await db.visits.get(spot.id);
  const now = new Date().toISOString();
  const todayStr = new Date().toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  const nextVisited = updates.visited !== undefined ? updates.visited : (existing?.visited ?? false);
  const nextPhoto = updates.photoDataUrl !== undefined ? updates.photoDataUrl : (existing?.photoDataUrl ?? null);
  const nextMemo = updates.memo !== undefined ? updates.memo : (existing?.memo ?? '');
  const nextVisitedDate = updates.visitedDate || existing?.visitedDate || todayStr;
  const nextAiSpotGuide = updates.aiSpotGuide !== undefined ? updates.aiSpotGuide : (existing?.aiSpotGuide ?? null);
  const nextAiPhotoAnalysis = updates.aiPhotoAnalysis !== undefined ? updates.aiPhotoAnalysis : (existing?.aiPhotoAnalysis ?? null);

  // 社寺ID・所属する実物御朱印帳・グループ名（未指定なら既存値を維持）
  const nextPlaceId =
    updates.placeId !== undefined
      ? updates.placeId
      : (existing?.placeId ?? spot.placeId ?? spot.id);
  const nextBookId =
    updates.bookId !== undefined ? updates.bookId : (existing?.bookId ?? '');
  const nextGroupName =
    updates.groupName !== undefined ? updates.groupName : (existing?.groupName ?? '');

  const record = {
    spotId: spot.id,
    placeId: nextPlaceId || spot.id,
    name: spot.name,
    type: spot.type, // 'shrine' | 'temple'
    denomination: spot.denomination || (spot.type === 'shrine' ? '神道' : '仏教'),
    address: spot.address || existing?.address || '',
    lat: spot.lat ?? existing?.lat,
    lng: spot.lng ?? existing?.lng,
    sampleGoshuin: spot.sampleGoshuin || existing?.sampleGoshuin || [],
    visited: Boolean(nextVisited),
    visitedDate: nextVisitedDate,
    visitedAt: existing?.visitedAt || now,
    updatedAt: now,
    photoDataUrl: nextPhoto,
    hasPhoto: Boolean(nextPhoto),
    memo: nextMemo,
    bookId: nextBookId || '',
    groupName: (nextGroupName || '').trim(),
    aiSpotGuide: nextAiSpotGuide,
    aiPhotoAnalysis: nextAiPhotoAnalysis
  };

  await db.visits.put(record);
  triggerBackgroundSync();
  return record;
}

/**
 * 実物の御朱印帳（名前・表紙写真・裏表紙写真）を保存
 */
export async function saveGoshuinBook(book) {
  const now = new Date().toISOString();
  const existing = book.id ? await db.books.get(book.id) : null;
  const record = {
    id: book.id || `book-${Date.now().toString(36)}`,
    name: (book.name || '').trim() || '御朱印帳',
    coverPhoto: book.coverPhoto !== undefined ? book.coverPhoto : (existing?.coverPhoto ?? null),
    backPhoto: book.backPhoto !== undefined ? book.backPhoto : (existing?.backPhoto ?? null),
    memo: book.memo !== undefined ? book.memo : (existing?.memo ?? ''),
    startedDate: book.startedDate !== undefined ? book.startedDate : (existing?.startedDate ?? ''),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };
  await db.books.put(record);
  triggerBackgroundSync();
  return record;
}

/**
 * 実物の御朱印帳を削除（中の御朱印記録は消さず「未分類」に戻す）
 */
export async function deleteGoshuinBook(bookId) {
  if (!bookId) return;
  await db.books.delete(bookId);
  const members = (await db.visits.toArray()).filter((v) => v.bookId === bookId);
  const now = new Date().toISOString();
  for (const m of members) {
    await db.visits.put({ ...m, bookId: '', updatedAt: now });
  }
  try {
    const savedPasscode = localStorage.getItem('goshuin_couple_passcode');
    if (savedPasscode) {
      const { deleteCoupleGoshuinBook } = await import('../services/coupleSyncService.js');
      await deleteCoupleGoshuinBook(bookId).catch(() => {});
    }
  } catch {
    // オフライン時は無視
  }
  triggerBackgroundSync();
}

/**
 * 複数の御朱印をまとめて実物御朱印帳に振り分ける
 */
export async function assignVisitsToBook(spotIds = [], bookId = '') {
  const now = new Date().toISOString();
  for (const id of spotIds) {
    const rec = await db.visits.get(id);
    if (rec) await db.visits.put({ ...rec, bookId, updatedAt: now });
  }
  triggerBackgroundSync();
}

/**
 * 複数の御朱印にまとめてグループ名を付ける（空文字でグループ解除）
 */
export async function assignVisitsToGroup(spotIds = [], groupName = '') {
  const now = new Date().toISOString();
  for (const id of spotIds) {
    const rec = await db.visits.get(id);
    if (rec) await db.visits.put({ ...rec, groupName: groupName.trim(), updatedAt: now });
  }
  triggerBackgroundSync();
}

/**
 * 社寺名から「巡拝グループ」の候補名を自動提案する
 * 例：生田裔神八社（一宮神社〜八宮神社）、七福神、霊場めぐり など
 */
export function suggestGroupNameForSpot(name = '') {
  const n = String(name);
  // 三宮周辺の一宮神社〜八宮神社（生田神社の裔神八社）
  if (/^[一二三四五六七八]宮神社/.test(n)) {
    return '生田裔神八社めぐり（一宮〜八宮）';
  }
  if (/(恵比寿|恵美須|戎|大黒|毘沙門|弁財天|弁天|福禄寿|寿老人|布袋)/.test(n)) {
    return '七福神めぐり';
  }
  if (/八十八/.test(n)) return '八十八ヶ所霊場めぐり';
  if (/三十三/.test(n)) return '三十三所観音霊場めぐり';
  return '';
}

/**
 * 社寺名の正規化キー（表記ゆれ吸収用）
 */
function normalizeSpotName(name = '') {
  return String(name).replace(/（.*?）|\(.*?\)|\s+/g, '').trim();
}

/**
 * 登録済みの全レコードからユーザーが作成した巡拝グループ名を一意に抽出して返す
 */
export function getAllCustomGroupNames(records = []) {
  const set = new Set();
  // 定番の巡拝グループ
  set.add('生田裔神八社めぐり（一宮〜八宮）');
  set.add('七福神めぐり');
  set.add('八十八ヶ所霊場めぐり');
  set.add('三十三所観音霊場めぐり');

  for (const r of records) {
    const g = (r.groupName || '').trim();
    if (g) set.add(g);
  }
  return Array.from(set);
}

/**
 * 同じ社寺でいただいた御朱印を自動でまとめる
 * - placeId が同じもの
 * - placeId が違っても「同名」かつ「約400m以内」のもの（手動登録で別IDになったケースを吸収）
 * @returns {Array<{placeId:string,key:string,name:string,type:string,denomination:string,address:string,records:Array,count:number,latestDate:string}>}
 */
export function groupVisitsByPlace(records = []) {
  const groups = [];
  const byPlace = new Map();

  for (const rec of records) {
    const pid = getPlaceId(rec);
    let group = byPlace.get(pid);

    if (!group) {
      const nk = normalizeSpotName(rec.name);
      group = groups.find((g) => {
        if (g.normName !== nk) return false;
        if (typeof g.lat !== 'number' || typeof rec.lat !== 'number') return true;
        const dLat = (g.lat - rec.lat) * 111;
        const dLng = (g.lng - rec.lng) * 91;
        return Math.hypot(dLat, dLng) < 0.4;
      });
    }

    if (!group) {
      group = {
        placeId: pid,
        key: pid,
        name: rec.name,
        normName: normalizeSpotName(rec.name),
        type: rec.type,
        denomination: rec.denomination || '',
        address: rec.address || '',
        lat: rec.lat,
        lng: rec.lng,
        records: [],
        count: 0,
        latestDate: rec.visitedDate || ''
      };
      groups.push(group);
    }
    byPlace.set(pid, group);
    group.records.push(rec);
    group.count = group.records.length;
    if (rec.visitedDate) {
      group.latestDate = rec.visitedDate;
    }
    if (!group.address && rec.address) {
      group.address = rec.address;
    }
    if (!group.denomination && rec.denomination) {
      group.denomination = rec.denomination;
    }
  }

  // 同じ社寺内の御朱印を placeOrder 順にソート
  for (const g of groups) {
    g.records.sort((a, b) => {
      const oa = typeof a.placeOrder === 'number' ? a.placeOrder : 999999;
      const ob = typeof b.placeOrder === 'number' ? b.placeOrder : 999999;
      if (oa !== ob) return oa - ob;
      return (a.visitedDate || '').localeCompare(b.visitedDate || '');
    });
  }

  return groups;
}

/**
 * 利用者が付けたグループ名（巡拝グループ）ごとにまとめる
 * @returns {Array<{groupName:string,name:string,records:Array,count:number}>}
 */
export function groupVisitsByCustomGroup(records = []) {
  const map = new Map();
  const ungrouped = [];

  for (const rec of records) {
    const g = (rec.groupName || '').trim();
    if (!g) {
      ungrouped.push(rec);
      continue;
    }
    if (!map.has(g)) map.set(g, []);
    map.get(g).push(rec);
  }

  const result = [...map.entries()].map(([name, recs]) => ({
    groupName: name,
    name,
    records: recs,
    count: recs.length
  }));

  // 各巡拝グループ内の御朱印を groupOrder 順にソート
  for (const item of result) {
    item.records.sort((a, b) => {
      const oa = typeof a.groupOrder === 'number' ? a.groupOrder : 999999;
      const ob = typeof b.groupOrder === 'number' ? b.groupOrder : 999999;
      if (oa !== ob) return oa - ob;
      return (a.visitedDate || '').localeCompare(b.visitedDate || '');
    });
  }

  // 未設定の御朱印があれば末尾に追加
  if (ungrouped.length > 0) {
    ungrouped.sort((a, b) => {
      const oa = typeof a.groupOrder === 'number' ? a.groupOrder : 999999;
      const ob = typeof b.groupOrder === 'number' ? b.groupOrder : 999999;
      if (oa !== ob) return oa - ob;
      return (a.visitedDate || '').localeCompare(b.visitedDate || '');
    });
    result.push({
      groupName: 'その他の御朱印（グループ未設定）',
      name: 'その他の御朱印（グループ未設定）',
      records: ungrouped,
      count: ungrouped.length
    });
  }

  return result;
}

/**
 * 巡拝グループ内での御朱印の並び順（インデックス）を永続保存
 */
export async function reorderVisitsInGroup(orderedSpotIds = []) {
  const now = new Date().toISOString();
  for (let i = 0; i < orderedSpotIds.length; i++) {
    const id = orderedSpotIds[i];
    const rec = await db.visits.get(id);
    if (rec) {
      await db.visits.put({ ...rec, groupOrder: i, updatedAt: now });
    }
  }
  triggerBackgroundSync();
}

/**
 * 同じ社寺内での御朱印の並び順（インデックス）を永続保存
 */
export async function reorderVisitsInPlace(orderedSpotIds = []) {
  const now = new Date().toISOString();
  for (let i = 0; i < orderedSpotIds.length; i++) {
    const id = orderedSpotIds[i];
    const rec = await db.visits.get(id);
    if (rec) {
      await db.visits.put({ ...rec, placeOrder: i, updatedAt: now });
    }
  }
  triggerBackgroundSync();
}

/**
 * 登録済みの御朱印記録を削除する関数
 * 夫婦の合言葉が設定されている場合はクラウド側のデータからも削除を同期します
 */
export async function deleteVisitRecord(spotId) {
  if (!spotId) return;
  await db.visits.delete(spotId);

  try {
    const savedPasscode = localStorage.getItem('goshuin_couple_passcode');
    if (savedPasscode) {
      const { deleteCoupleGoshuinRecord } = await import(
        '../services/coupleSyncService.js'
      );
      await deleteCoupleGoshuinRecord(spotId).catch(() => {});
    }
  } catch {
    // オフライン時は無視
  }
}

/**
 * 参拝日文字列（「2026年7月31日」「令和6年5月3日」「2026-07-31」等）を比較可能な「YYYY-MM-DD」形式へ変換する
 */
export function parseVisitedDateKey(record) {
  if (!record) return '9999-12-31';
  const raw = String(record.visitedDate || '').trim();

  // 1. 西暦「YYYY年M月D日」「YYYY-M-D」「YYYY/M/D」「YYYY.M.D」
  const westernMatch = raw.match(/(\d{4})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/);
  if (westernMatch) {
    const y = westernMatch[1];
    const m = String(Number(westernMatch[2])).padStart(2, '0');
    const d = String(Number(westernMatch[3])).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 2. 和暦「令和X年M月D日」「平成X年M月D日」
  const warekiMatch = raw.match(/(令和|平成|昭和)\s*(元|\d{1,2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/);
  if (warekiMatch) {
    const era = warekiMatch[1];
    const eraYear = warekiMatch[2] === '元' ? 1 : Number(warekiMatch[2]);
    let baseYear = 2018;
    if (era === '平成') baseYear = 1988;
    if (era === '昭和') baseYear = 1925;
    const y = String(baseYear + eraYear);
    const m = String(Number(warekiMatch[3])).padStart(2, '0');
    const d = String(Number(warekiMatch[4])).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 3. フォールバック：visitedAt または updatedAt の日付部分
  const fallbackIso = String(record.visitedAt || record.updatedAt || '').slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(fallbackIso)) {
    return fallbackIso;
  }

  return '9999-12-31';
}

/**
 * 登録された御朱印を並び替え、各レコードに第1頁〜第N頁の通し番号（pageNumber）を付与して返す
 * @param {Array} visitRecords
 * @param {'asc' | 'desc'} order 'asc': 古い順（拝受順）, 'desc': 新しい順（最新参拝順）
 */
export function sortVisitsByReceivedOrder(visitRecords = [], order = 'asc') {
  const chronological = [...visitRecords]
    .filter((r) => r && r.visited)
    .sort((a, b) => {
      const keyA = parseVisitedDateKey(a);
      const keyB = parseVisitedDateKey(b);
      if (keyA !== keyB) {
        return keyA.localeCompare(keyB);
      }
      // 同じ日に複数参拝した場合は登録時刻の古い順
      const timeA = a.visitedAt || a.updatedAt || '';
      const timeB = b.visitedAt || b.updatedAt || '';
      return timeA.localeCompare(timeB);
    });

  const numbered = chronological.map((rec, idx) => ({
    ...rec,
    pageNumber: idx + 1
  }));

  if (order === 'desc') {
    return numbered.reverse();
  }
  return numbered;
}

/**
 * 画像ファイルをスマホ保存＆クラウド同期向けに適切な解像度（長辺1300px・JPEG圧縮）のBase64に変換するヘルパー
 */
export function compressImageToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const maxDimension = 1300;
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width > height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        const compressedDataUrl = canvas.toDataURL('image/jpeg', 0.84);
        resolve(compressedDataUrl);
      };
      img.onerror = (err) => reject(err);
      img.src = event.target.result;
    };
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Base64画像データを90度回転させた新しいBase64データURLを返すヘルパー
 * （縦向きで撮影された見開き御朱印を横向きに直したいとき等にワンタップで使用）
 */
export function rotateBase64Image90(base64Url, clockwise = true) {
  return new Promise((resolve, reject) => {
    if (!base64Url) {
      reject(new Error('画像がありません'));
      return;
    }
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.height;
      canvas.height = img.width;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((clockwise ? 90 : -90) * (Math.PI / 180));
      ctx.drawImage(img, -img.width / 2, -img.height / 2);
      resolve(canvas.toDataURL('image/jpeg', 0.86));
    };
    img.onerror = (err) => reject(err);
    img.src = base64Url;
  });
}

/**
 * 全ての御朱印データ・実物御朱印帳・巡拝グループ・設定をJSON形式でエクスポートしてファイルダウンロード
 */
export async function exportGoshuinBackup() {
  const visits = await db.visits.toArray();
  const books = await db.books.toArray();
  const aiRoutes = await db.aiRoutes.toArray();

  const settings = {
    bookTheme: localStorage.getItem('goshuin_book_theme') || '',
    bookTitle: localStorage.getItem('goshuin_book_title') || '',
    viewMode: localStorage.getItem('goshuin_book_viewmode') || '',
    couplePasscode: localStorage.getItem('goshuin_couple_passcode') || '',
    coupleIsHost: localStorage.getItem('goshuin_couple_is_host') || '',
    geminiApiKey: localStorage.getItem('gemini_api_key') || ''
  };

  const backupData = {
    app: 'GoshuinAlbum',
    version: 3,
    exportedAt: new Date().toISOString(),
    totalVisits: visits.length,
    totalBooks: books.length,
    visits,
    books,
    aiRoutes,
    settings
  };

  const jsonStr = JSON.stringify(backupData, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const now = new Date();
  const nowStr = now.toISOString().slice(0, 10);
  const timeStr = `${String(now.getHours()).padStart(2, '0')}${String(now.getMinutes()).padStart(2, '0')}`;
  const fileName = `goshuin_backup_${nowStr}_${timeStr}.json`;

  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(link.href);

  return { fileName, visitsCount: visits.length, booksCount: books.length };
}

/**
 * JSONバックアップファイルの内容を読み込み、IndexedDBに復元する
 * @param {string|object} content 
 * @param {'replace'|'merge'} mode 
 */
export async function importGoshuinBackup(content, mode = 'merge') {
  let data = content;
  if (typeof content === 'string') {
    data = JSON.parse(content);
  }
  if (!data || (!Array.isArray(data.visits) && !Array.isArray(data.books))) {
    throw new Error('有効な御朱印バックアップファイル形式ではありません。');
  }

  const visitsToImport = Array.isArray(data.visits) ? data.visits : [];
  const booksToImport = Array.isArray(data.books) ? data.books : [];
  const routesToImport = Array.isArray(data.aiRoutes) ? data.aiRoutes : [];

  if (mode === 'replace') {
    await db.visits.clear();
    await db.books.clear();
    await db.aiRoutes.clear();
  }

  // visits を保存
  for (const v of visitsToImport) {
    if (v && v.spotId) {
      await db.visits.put(v);
    }
  }

  // books を保存
  for (const b of booksToImport) {
    if (b && b.id) {
      await db.books.put(b);
    }
  }

  // aiRoutes を保存
  for (const r of routesToImport) {
    if (r) {
      const { id, ...rest } = r;
      await db.aiRoutes.add(rest);
    }
  }

  // settings の復元（存在すれば）
  if (data.settings) {
    if (data.settings.bookTheme) localStorage.setItem('goshuin_book_theme', data.settings.bookTheme);
    if (data.settings.bookTitle) localStorage.setItem('goshuin_book_title', data.settings.bookTitle);
    if (data.settings.viewMode) localStorage.setItem('goshuin_book_viewmode', data.settings.viewMode);
    if (data.settings.couplePasscode) localStorage.setItem('goshuin_couple_passcode', data.settings.couplePasscode);
    if (data.settings.coupleIsHost) localStorage.setItem('goshuin_couple_is_host', data.settings.coupleIsHost);
    if (data.settings.geminiApiKey) localStorage.setItem('gemini_api_key', data.settings.geminiApiKey);
  }

  triggerBackgroundSync();

  return {
    visitsCount: visitsToImport.length,
    booksCount: booksToImport.length
  };
}

