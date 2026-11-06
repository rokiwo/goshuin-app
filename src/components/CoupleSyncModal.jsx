import React, { useState, useEffect } from 'react';
import confetti from 'canvas-confetti';
import {
  X,
  Heart,
  RefreshCw,
  Check,
  Lock,
  ShieldCheck,
  LogOut,
  ChevronLeft
} from 'lucide-react';
import {
  getSavedCouplePasscode,
  setSavedCouplePasscode,
  getLastSyncTime,
  syncCoupleGoshuinData
} from '../services/coupleSyncService.js';

/**
 * 夫婦の合言葉で2人のスマホの御朱印帳・マップ・AIキーを共有するモーダル（例やヒント表記なし）
 */
export default function CoupleSyncModal({ isOpen, onClose, onSyncSuccess }) {
  const [passcodeInput, setPasscodeInput] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [successMsg, setSuccessMsg] = useState('');
  const [lastSync, setLastSync] = useState('');

  useEffect(() => {
    if (isOpen) {
      setPasscodeInput(getSavedCouplePasscode());
      setLastSync(getLastSyncTime());
      setErrorMsg('');
      setSuccessMsg('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isConnected = Boolean(getSavedCouplePasscode());

  const handleSyncSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    setSuccessMsg('');

    const code = passcodeInput.trim();
    if (!code) {
      setErrorMsg('夫婦の合言葉を入力してください。');
      return;
    }

    try {
      setIsSyncing(true);
      const res = await syncCoupleGoshuinData(code);
      if (res.ok) {
        setLastSync(res.syncedAt);
        setSuccessMsg(
          `夫婦共有が完了しました！（現在 ${res.totalSynced} 社寺の御朱印を共有中）`
        );
        confetti({
          particleCount: 55,
          spread: 65,
          origin: { y: 0.7 },
          colors: ['#e88b9c', '#c93a40', '#c5a059', '#fcfaf2']
        });
        if (onSyncSuccess) onSyncSuccess(res);
      }
    } catch (err) {
      setErrorMsg(err.message || '同期に失敗しました。');
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDisconnect = () => {
    setSavedCouplePasscode('');
    setPasscodeInput('');
    setSuccessMsg('');
    if (onSyncSuccess) onSyncSuccess({ ok: true, disconnected: true });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-sumi/75 backdrop-blur-sm p-4">
      <div className="absolute inset-0" onClick={onClose} />

      <div className="relative z-10 w-full max-w-[400px] washi-pattern rounded-3xl border-2 border-kin shadow-2xl overflow-hidden animate-slide-up">
        {/* スマホ用グラブバー */}
        <div className="w-full flex justify-center pt-2 pb-1 bg-[#b84a62] sm:hidden">
          <div className="w-12 h-1 rounded-full bg-washi/30" />
        </div>

        {/* ヘッダー: 左に戻るボタン、右に閉じるボタン */}
        <div className="bg-gradient-to-r from-[#b84a62] via-shuiro to-sumi text-washi px-3 sm:px-5 py-3 border-b border-kin/40 flex items-center justify-between gap-2">
          {/* 左: 戻るボタン */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-washi/15 hover:bg-washi/25 text-washi text-xs font-serif font-bold active:scale-95 transition border border-washi/30"
            title="前の画面に戻る"
          >
            <ChevronLeft className="w-4 h-4 text-pink-200" />
            <span>戻る</span>
          </button>

          {/* 中央: タイトル */}
          <div className="flex items-center gap-1.5 min-w-0">
            <Heart className="w-4 h-4 text-pink-200 fill-pink-200 shrink-0" />
            <h2 className="font-serif font-bold text-xs sm:text-sm tracking-wide text-washi truncate">
              夫婦で共有・同期
            </h2>
          </div>

          {/* 右: 閉じるボタン */}
          <button
            type="button"
            onClick={onClose}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-black/30 hover:bg-black/50 text-washi text-xs font-serif font-bold active:scale-95 transition border border-washi/30"
            title="閉じる"
          >
            <span>閉じる</span>
            <X className="w-4 h-4 text-washi" />
          </button>
        </div>

        {/* 本体 */}
        <form onSubmit={handleSyncSubmit} className="p-5 space-y-4 text-xs text-sumi">
          <div className="rounded-2xl bg-washi-dark p-3.5 border border-kin/40 space-y-1.5">
            <div className="flex items-center gap-1.5 font-serif font-bold text-sumi">
              <ShieldCheck className="w-4 h-4 text-shuiro shrink-0" />
              <span>夫婦2人だけで安全に自動同期</span>
            </div>
            <p className="text-[11px] text-sumi-muted leading-relaxed">
              お互いのスマホに同じ合言葉を設定しておくと、どちらが登録した御朱印・写真・日付・メモも自動で両方のスマホに反映されます。
            </p>
          </div>

          {errorMsg && (
            <div className="p-3 rounded-xl bg-shuiro-light border border-shuiro text-shuiro font-bold">
              {errorMsg}
            </div>
          )}

          {successMsg && (
            <div className="p-3 rounded-xl bg-[#eef6f0] border border-tera text-tera font-bold flex items-center gap-1.5">
              <Check className="w-4 h-4 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <label className="font-serif font-bold text-sm flex items-center justify-between">
              <span className="flex items-center gap-1.5">
                <Lock className="w-4 h-4 text-shuiro" />
                夫婦の合言葉
              </span>
              {isConnected && (
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-100 text-shuiro font-bold">
                  ♥ 共有中 {lastSync ? `(${lastSync}更新)` : ''}
                </span>
              )}
            </label>
            <input
              type="password"
              value={passcodeInput}
              onChange={(e) => setPasscodeInput(e.target.value)}
              placeholder=""
              className="w-full rounded-xl border-2 border-kin/60 bg-washi px-4 py-3 text-base font-serif font-black tracking-widest text-center text-sumi focus:outline-none focus:border-shuiro"
            />
          </div>

          <button
            type="submit"
            disabled={isSyncing}
            className="w-full py-3.5 rounded-2xl bg-gradient-to-r from-[#c93a40] to-[#b84a62] text-washi font-serif font-bold text-sm shadow-lg border border-kin/50 flex items-center justify-center gap-2 active:scale-95 transition disabled:opacity-60"
          >
            {isSyncing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin text-kin" />
                <span>2人の御朱印帳をクラウド同期中...</span>
              </>
            ) : (
              <>
                <Heart className="w-4 h-4 text-pink-200 fill-pink-200" />
                <span>
                  {isConnected ? '今すぐ最新状態に同期する' : '合言葉を保存して夫婦共有を開始'}
                </span>
              </>
            )}
          </button>

          {isConnected && (
            <div className="pt-2 border-t border-washi-border flex justify-end">
              <button
                type="button"
                onClick={handleDisconnect}
                className="text-[11px] text-sumi-muted hover:text-shuiro flex items-center gap-1"
              >
                <LogOut className="w-3 h-3" /> この端末の共有合言葉を解除
              </button>
            </div>
          )}

          {/* 前の画面に戻るボタン */}
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-2xl bg-washi-dark/80 hover:bg-washi-dark text-sumi-muted hover:text-sumi font-serif font-bold text-xs border border-washi-border flex items-center justify-center gap-1.5 active:scale-95 transition shadow-sm"
          >
            <ChevronLeft className="w-3.5 h-3.5 text-sumi-muted" />
            <span>前の画面に戻る</span>
          </button>
        </form>
      </div>
    </div>
  );
}
