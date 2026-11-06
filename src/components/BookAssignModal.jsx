import React, { useState, useEffect } from 'react';
import {
  X,
  BookOpen,
  Check,
  Calendar,
  Layers,
  ChevronLeft
} from 'lucide-react';
import { assignVisitsToBook, db } from '../db/database.js';

/**
 * 登録済みの御朱印を、特定の実物御朱印帳（冊）に
 * チェックボックスで後からまとめて追加・解除（振り分け）できるモーダル
 */
export default function BookAssignModal({
  isOpen,
  onClose,
  activeBook,
  allVisits = []
}) {
  const [selectedSpotIds, setSelectedSpotIds] = useState([]);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (activeBook && isOpen) {
      // 現在この冊に入っている御朱印を初期選択状態にする
      const currentMemberIds = allVisits
        .filter((r) => r.bookId === activeBook.id)
        .map((r) => r.spotId);
      setSelectedSpotIds(currentMemberIds);
    }
  }, [activeBook, isOpen, allVisits]);

  if (!isOpen || !activeBook) return null;

  // 選択トグル
  const handleToggle = (spotId) => {
    setSelectedSpotIds((prev) =>
      prev.includes(spotId) ? prev.filter((id) => id !== spotId) : [...prev, spotId]
    );
  };

  // 保存処理
  const handleSave = async (e) => {
    e.preventDefault();
    try {
      setIsSaving(true);
      const now = new Date().toISOString();
      const currentMemberIds = allVisits
        .filter((r) => r.bookId === activeBook.id)
        .map((r) => r.spotId);

      // 1. チェックされたものは activeBook.id を設定
      for (const id of selectedSpotIds) {
        const rec = await db.visits.get(id);
        if (rec) {
          await db.visits.put({ ...rec, bookId: activeBook.id, updatedAt: now });
        }
      }

      // 2. もともと入っていたがチェックを外されたものは bookId を空（未分類）に戻す
      for (const id of currentMemberIds) {
        if (!selectedSpotIds.includes(id)) {
          const rec = await db.visits.get(id);
          if (rec) {
            await db.visits.put({ ...rec, bookId: '', updatedAt: now });
          }
        }
      }

      // クラウド同期トリガー
      try {
        const savedPasscode = localStorage.getItem('goshuin_couple_passcode');
        if (savedPasscode) {
          const { syncCoupleGoshuinData } = await import('../services/coupleSyncService.js');
          syncCoupleGoshuinData().catch(() => {});
        }
      } catch {}

      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-sumi/75 backdrop-blur-sm p-0 sm:p-4">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 w-full max-w-[440px] max-h-[90vh] washi-pattern rounded-t-3xl sm:rounded-3xl border-t-2 sm:border-2 border-kin shadow-2xl flex flex-col animate-slide-up overflow-hidden">
        {/* スマホ用グラブバー */}
        <div className="w-full flex justify-center pt-2 pb-1 bg-sumi sm:hidden">
          <div className="w-12 h-1 rounded-full bg-washi/30" />
        </div>

        {/* ヘッダー: 左に戻るボタン、右に閉じるボタン */}
        <div className="bg-sumi text-washi px-3 sm:px-5 py-3 border-b border-kin/40 flex items-center justify-between shrink-0 gap-2">
          {/* 左: 戻るボタン */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-washi/10 hover:bg-washi/20 text-washi text-xs font-serif font-bold active:scale-95 transition border border-washi/20"
            title="前の画面に戻る"
          >
            <ChevronLeft className="w-4 h-4 text-kin" />
            <span>戻る</span>
          </button>

          {/* 中央: タイトル */}
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="w-6 h-6 rounded-lg bg-shuiro border border-kin flex items-center justify-center font-serif font-black text-xs text-washi shrink-0">
              冊
            </div>
            <h3 className="font-serif font-black text-xs sm:text-sm text-kin truncate">
              「{activeBook.name}」振り分け
            </h3>
          </div>

          {/* 右: 閉じるボタン */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-shuiro/30 hover:bg-shuiro/50 text-washi text-xs font-serif font-bold active:scale-95 transition border border-shuiro/50"
            title="閉じる"
          >
            <span>閉じる</span>
            <X className="w-4 h-4 text-washi" />
          </button>
        </div>

        {/* フォーム */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 space-y-3.5 text-sumi">
          <div className="flex items-center justify-between">
            <span className="font-serif font-bold text-xs text-sumi flex items-center gap-1.5">
              <BookOpen className="w-3.5 h-3.5 text-shuiro" />
              御朱印一覧（{selectedSpotIds.length} 選択中）
            </span>
            <button
              type="button"
              onClick={() => {
                if (selectedSpotIds.length === allVisits.length) {
                  setSelectedSpotIds([]);
                } else {
                  setSelectedSpotIds(allVisits.map((r) => r.spotId));
                }
              }}
              className="text-[10px] font-serif text-shuiro font-bold underline"
            >
              {selectedSpotIds.length === allVisits.length ? '全解除' : '全選択'}
            </button>
          </div>

          <div className="max-h-72 overflow-y-auto space-y-1.5 pr-0.5">
            {allVisits.map((r) => {
              const isSelected = selectedSpotIds.includes(r.spotId);
              const isCurrentBook = r.bookId === activeBook.id;

              return (
                <div
                  key={r.spotId}
                  onClick={() => handleToggle(r.spotId)}
                  className={`p-2 rounded-xl border flex items-center gap-2.5 cursor-pointer transition ${
                    isSelected
                      ? 'bg-shuiro/10 border-shuiro ring-1 ring-shuiro'
                      : 'bg-washi border-kin/25 hover:border-kin'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {}}
                    className="w-4 h-4 text-shuiro rounded border-kin focus:ring-0 cursor-pointer"
                  />

                  {/* サムネイル */}
                  <div className="w-10 h-10 rounded-lg bg-washi-dark border border-kin/30 overflow-hidden flex items-center justify-center shrink-0">
                    {r.photoDataUrl ? (
                      <img
                        src={r.photoDataUrl}
                        alt={r.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-[9px] font-serif text-shuiro font-bold">
                        {r.type === 'shrine' ? '神社' : '寺院'}
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="font-serif font-bold text-xs text-sumi truncate">
                      {r.name}
                    </p>
                    <p className="text-[10px] text-sumi-muted flex items-center gap-2">
                      <span>{r.visitedDate || '拝受済'}</span>
                      {isCurrentBook && (
                        <span className="text-[9px] bg-kin/25 text-sumi font-serif font-bold px-1.5 py-0.2 rounded">
                          この冊に登録中
                        </span>
                      )}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>

          {/* 保存ボタン */}
          <div className="pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="w-full py-3 rounded-2xl bg-shuiro text-washi font-serif font-bold text-xs shadow-md border border-kin/40 flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-60"
            >
              <Check className="w-4 h-4 text-kin" />
              <span>
                選択した {selectedSpotIds.length} 件を「{activeBook.name}」に収める
              </span>
            </button>

            {/* 前の画面に戻るボタン */}
            <button
              type="button"
              onClick={onClose}
              className="w-full py-2.5 mt-2 rounded-2xl bg-washi-dark/80 hover:bg-washi-dark text-sumi-muted hover:text-sumi font-serif font-bold text-xs border border-washi-border flex items-center justify-center gap-1.5 active:scale-95 transition shadow-sm"
            >
              <ChevronLeft className="w-3.5 h-3.5 text-sumi-muted" />
              <span>キャンセルして前の画面に戻る</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
