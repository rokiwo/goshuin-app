import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Camera,
  BookOpen,
  Calendar,
  Check,
  RotateCw,
  Trash2,
  Loader2,
  Sparkles
} from 'lucide-react';
import {
  saveGoshuinBook,
  deleteGoshuinBook,
  compressImageToBase64,
  rotateBase64Image90
} from '../db/database.js';

/**
 * 実際に使っている「実物の御朱印帳」（表紙・裏表紙の写真つき）を
 * 新規作成・編集するモーダル
 */
export default function BookManageModal({
  isOpen,
  onClose,
  book = null,
  onSaved,
  onDeleted
}) {
  const [name, setName] = useState('');
  const [coverPhoto, setCoverPhoto] = useState(null);
  const [backPhoto, setBackPhoto] = useState(null);
  const [startedDate, setStartedDate] = useState('');
  const [memo, setMemo] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [isRotatingCover, setIsRotatingCover] = useState(false);
  const [isRotatingBack, setIsRotatingBack] = useState(false);

  const coverInputRef = useRef(null);
  const backInputRef = useRef(null);

  useEffect(() => {
    if (book) {
      setName(book.name || '');
      setCoverPhoto(book.coverPhoto || null);
      setBackPhoto(book.backPhoto || null);
      setStartedDate(book.startedDate || '');
      setMemo(book.memo || '');
    } else {
      setName('');
      setCoverPhoto(null);
      setBackPhoto(null);
      setStartedDate(new Date().toISOString().slice(0, 10));
      setMemo('');
    }
  }, [book, isOpen]);

  if (!isOpen) return null;

  // 表紙写真のアップロード
  const handleCoverUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsProcessing(true);
      const base64 = await compressImageToBase64(file);
      setCoverPhoto(base64);
    } catch {
      alert('表紙画像の読み込みに失敗しました。');
    } finally {
      setIsProcessing(false);
      if (coverInputRef.current) coverInputRef.current.value = '';
    }
  };

  // 裏表紙写真のアップロード
  const handleBackUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setIsProcessing(true);
      const base64 = await compressImageToBase64(file);
      setBackPhoto(base64);
    } catch {
      alert('裏表紙画像の読み込みに失敗しました。');
    } finally {
      setIsProcessing(false);
      if (backInputRef.current) backInputRef.current.value = '';
    }
  };

  // 表紙の90度回転
  const handleRotateCover = async () => {
    if (!coverPhoto || isRotatingCover) return;
    try {
      setIsRotatingCover(true);
      const rotated = await rotateBase64Image90(coverPhoto, true);
      setCoverPhoto(rotated);
    } finally {
      setIsRotatingCover(false);
    }
  };

  // 裏表紙の90度回転
  const handleRotateBack = async () => {
    if (!backPhoto || isRotatingBack) return;
    try {
      setIsRotatingBack(true);
      const rotated = await rotateBase64Image90(backPhoto, true);
      setBackPhoto(rotated);
    } finally {
      setIsRotatingBack(false);
    }
  };

  // 保存処理
  const handleSave = async (e) => {
    e.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      alert('御朱印帳の名前を入力してください。');
      return;
    }

    try {
      setIsProcessing(true);
      const targetId = book?.id || `book-${Date.now()}`;
      const saved = await saveGoshuinBook({
        id: targetId,
        name: cleanName,
        coverPhoto: coverPhoto || null,
        backPhoto: backPhoto || null,
        startedDate: startedDate || '',
        memo: memo.trim()
      });
      if (onSaved) onSaved(saved);
      onClose();
    } catch (err) {
      console.error('御朱印帳の保存に失敗:', err);
      alert('保存中にエラーが発生しました。');
    } finally {
      setIsProcessing(false);
    }
  };

  // 削除処理（中の御朱印は消さず未分類に戻る）
  const handleDelete = async () => {
    if (!book?.id) return;
    const ok = window.confirm(
      `実物御朱印帳「${book.name}」を削除しますか？\n（※この御朱印帳に登録した御朱印記録自体は削除されず、「全体の御朱印帳（未分類）」に戻ります）`
    );
    if (!ok) return;

    try {
      setIsProcessing(true);
      await deleteGoshuinBook(book.id);
      if (onDeleted) onDeleted(book.id);
      onClose();
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-sumi/75 backdrop-blur-sm">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 w-full max-w-[430px] max-h-[90vh] washi-pattern rounded-t-3xl sm:rounded-3xl border-t-2 sm:border-2 border-kin shadow-2xl flex flex-col animate-slide-up overflow-hidden">
        {/* ヘッダー */}
        <div className="bg-sumi text-washi px-5 py-3.5 border-b border-kin/40 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-shuiro border border-kin flex items-center justify-center font-serif font-black text-xs text-washi">
              冊
            </div>
            <div>
              <h3 className="font-serif font-black text-sm text-kin">
                {book ? '実物御朱印帳の編集' : '新しい御朱印帳を登録'}
              </h3>
              <p className="text-[10px] text-washi/70">
                表紙・裏表紙を登録して実際の冊ごとに分ける
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/10 text-washi/80 hover:text-washi transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* フォーム入力部 */}
        <form onSubmit={handleSave} className="flex-1 overflow-y-auto p-4 space-y-4 text-sumi">
          {/* 御朱印帳の名前 */}
          <div className="space-y-1.5">
            <label className="font-serif font-bold text-xs flex items-center gap-1.5 text-sumi">
              <BookOpen className="w-3.5 h-3.5 text-shuiro" />
              御朱印帳の名前 <span className="text-[10px] text-shuiro">※必須</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例：伊勢神宮の蒔絵御朱印帳、京都社寺めぐり用 など"
              className="w-full rounded-xl border border-washi-border bg-washi px-3.5 py-2.5 text-xs font-serif font-bold text-sumi focus:outline-none focus:border-kin"
              maxLength={30}
              required
            />
          </div>

          {/* 表紙・裏表紙の写真登録グリッド */}
          <div className="space-y-2">
            <label className="font-serif font-bold text-xs flex items-center gap-1.5 text-sumi">
              <Camera className="w-3.5 h-3.5 text-kin-dark" />
              御朱印帳の表紙・裏表紙写真
            </label>

            <div className="grid grid-cols-2 gap-3">
              {/* 表紙写真 */}
              <div className="space-y-1.5 text-center">
                <span className="text-[11px] font-serif font-bold text-sumi">
                  表紙の写真
                </span>
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleCoverUpload}
                  className="hidden"
                />
                <div
                  onClick={() => coverInputRef.current?.click()}
                  className="w-full aspect-[3/4] rounded-2xl border-2 border-dashed border-kin/60 bg-washi hover:bg-washi-dark transition flex flex-col items-center justify-center p-2 cursor-pointer shadow-sm relative overflow-hidden group"
                >
                  {coverPhoto ? (
                    <>
                      <img
                        src={coverPhoto}
                        alt="表紙プレビュー"
                        className="w-full h-full object-contain rounded-xl"
                      />
                      <div className="absolute inset-0 bg-sumi/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-washi text-[11px] font-bold">
                        変更する
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-sumi-muted">
                      <div className="w-9 h-9 rounded-full bg-shuiro/10 text-shuiro flex items-center justify-center">
                        <Camera className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-serif font-bold">表紙を撮影</span>
                    </div>
                  )}
                </div>
                {coverPhoto && (
                  <div className="flex items-center justify-center gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={handleRotateCover}
                      disabled={isRotatingCover}
                      className="px-2 py-0.5 rounded-lg bg-washi border border-kin/40 text-[10px] font-serif text-sumi flex items-center gap-1 hover:bg-kin/20"
                    >
                      <RotateCw className={`w-2.5 h-2.5 ${isRotatingCover ? 'animate-spin' : ''}`} />
                      回転
                    </button>
                    <button
                      type="button"
                      onClick={() => setCoverPhoto(null)}
                      className="px-2 py-0.5 rounded-lg bg-shuiro/10 border border-shuiro/30 text-[10px] font-serif text-shuiro hover:bg-shuiro/20"
                    >
                      解除
                    </button>
                  </div>
                )}
              </div>

              {/* 裏表紙写真 */}
              <div className="space-y-1.5 text-center">
                <span className="text-[11px] font-serif font-bold text-sumi">
                  裏表紙の写真（任意）
                </span>
                <input
                  ref={backInputRef}
                  type="file"
                  accept="image/*"
                  onChange={handleBackUpload}
                  className="hidden"
                />
                <div
                  onClick={() => backInputRef.current?.click()}
                  className="w-full aspect-[3/4] rounded-2xl border-2 border-dashed border-kin/60 bg-washi hover:bg-washi-dark transition flex flex-col items-center justify-center p-2 cursor-pointer shadow-sm relative overflow-hidden group"
                >
                  {backPhoto ? (
                    <>
                      <img
                        src={backPhoto}
                        alt="裏表紙プレビュー"
                        className="w-full h-full object-contain rounded-xl"
                      />
                      <div className="absolute inset-0 bg-sumi/40 opacity-0 group-hover:opacity-100 transition flex items-center justify-center text-washi text-[11px] font-bold">
                        変更する
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-1 text-sumi-muted">
                      <div className="w-9 h-9 rounded-full bg-kin/20 text-sumi flex items-center justify-center">
                        <Camera className="w-4 h-4" />
                      </div>
                      <span className="text-[10px] font-serif font-bold">裏表紙を撮影</span>
                    </div>
                  )}
                </div>
                {backPhoto && (
                  <div className="flex items-center justify-center gap-1 pt-0.5">
                    <button
                      type="button"
                      onClick={handleRotateBack}
                      disabled={isRotatingBack}
                      className="px-2 py-0.5 rounded-lg bg-washi border border-kin/40 text-[10px] font-serif text-sumi flex items-center gap-1 hover:bg-kin/20"
                    >
                      <RotateCw className={`w-2.5 h-2.5 ${isRotatingBack ? 'animate-spin' : ''}`} />
                      回転
                    </button>
                    <button
                      type="button"
                      onClick={() => setBackPhoto(null)}
                      className="px-2 py-0.5 rounded-lg bg-shuiro/10 border border-shuiro/30 text-[10px] font-serif text-shuiro hover:bg-shuiro/20"
                    >
                      解除
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 使い始め日 */}
          <div className="space-y-1.5">
            <label className="font-serif font-bold text-xs flex items-center gap-1.5 text-sumi">
              <Calendar className="w-3.5 h-3.5 text-shuiro" />
              使い始めた日・拝受日（任意）
            </label>
            <input
              type="date"
              value={startedDate}
              onChange={(e) => setStartedDate(e.target.value)}
              className="w-full rounded-xl border border-washi-border bg-washi px-3 py-2 text-xs text-sumi focus:outline-none focus:border-kin"
            />
          </div>

          {/* 思い出・メモ */}
          <div className="space-y-1.5">
            <label className="font-serif font-bold text-xs flex items-center gap-1.5 text-sumi">
              御朱印帳についてのメモ（任意）
            </label>
            <input
              type="text"
              value={memo}
              onChange={(e) => setMemo(e.target.value)}
              placeholder="例：伊勢神宮の内宮参集殿で購入。紺地に金糸の織り"
              className="w-full rounded-xl border border-washi-border bg-washi px-3 py-2 text-xs text-sumi focus:outline-none focus:border-kin"
            />
          </div>

          {/* 保存ボタン & 削除ボタン */}
          <div className="pt-2 space-y-2">
            <button
              type="submit"
              disabled={isProcessing}
              className="w-full py-3 rounded-2xl bg-shuiro text-washi font-serif font-bold text-sm shadow-md border border-kin/40 flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-60"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-kin" />
                  <span>保存中...</span>
                </>
              ) : (
                <>
                  <Check className="w-4 h-4 text-kin" />
                  <span>{book ? '更新する' : 'この御朱印帳を登録する'}</span>
                </>
              )}
            </button>

            {book && (
              <button
                type="button"
                onClick={handleDelete}
                disabled={isProcessing}
                className="w-full py-2.5 rounded-2xl bg-washi border border-shuiro/40 text-shuiro font-serif font-bold text-xs flex items-center justify-center gap-1.5 hover:bg-shuiro/10 transition active:scale-95"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>この御朱印帳を削除（中の御朱印は未分類に戻ります）</span>
              </button>
            )}
          </div>
        </form>
      </div>
    </div>
  );
}
