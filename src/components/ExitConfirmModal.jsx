import React, { useState } from 'react';
import { LogOut, BookOpen, Sparkles, Check, X, ShieldAlert } from 'lucide-react';

/**
 * どこからでもアプリを終了（ホームに戻る/タブを閉じる）しようとした際に表示される
 * 和モダン確認アナウンスモーダル
 */
export default function ExitConfirmModal({ isOpen, onClose }) {
  const [hasRequestedClose, setHasRequestedClose] = useState(false);

  if (!isOpen) return null;

  // アプリを終了（閉じる）処理
  const handleConfirmExit = () => {
    setHasRequestedClose(true);

    try {
      // 1. window.close() を試行
      window.close();
    } catch {}

    // ブラウザのセキュリティ制限で window.close() が無効化される場合のための処理
    setTimeout(() => {
      try {
        // 履歴を戻してホームや前のページに戻れるか試行
        window.history.go(-1);
      } catch {}
    }, 150);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-sumi/80 backdrop-blur-sm animate-fadeIn">
      <div
        className="w-full max-w-sm jabara-card gold-corner-frame rounded-3xl p-6 text-center space-y-4 shadow-2xl border-2 border-kin/50 animate-stampPop"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exit-modal-title"
      >
        {/* アイコン装飾 */}
        <div className="w-16 h-16 rounded-full bg-shuiro/15 text-shuiro mx-auto flex items-center justify-center border-2 border-shuiro/30 shadow-inner">
          <BookOpen className="w-8 h-8 text-shuiro animate-pulse" />
        </div>

        {/* タイトル */}
        <div className="space-y-1">
          <h3 id="exit-modal-title" className="font-serif font-black text-lg text-sumi">
            御朱印めぐりを終了しますか？
          </h3>
          <p className="text-xs text-sumi-muted font-serif leading-relaxed">
            いただいた御朱印や参拝メモ、御朱印帳の設定は
            <br />
            すべて端末内に安全に自動保存されています。
          </p>
        </div>

        {hasRequestedClose ? (
          <div className="bg-washi-dark/80 rounded-2xl p-4 border border-washi-border space-y-2 text-xs text-sumi">
            <p className="font-serif font-bold text-shuiro">
              参拝記録を保存しました
            </p>
            <p className="text-[11px] text-sumi-muted leading-relaxed">
              ブラウザのタブまたはスマホのアプリ切り替え画面からアプリを終了してください。
            </p>
            <button
              type="button"
              onClick={() => {
                setHasRequestedClose(false);
                onClose();
              }}
              className="mt-2 w-full py-2 rounded-xl bg-sumi text-kin font-serif font-bold text-xs shadow-md active:scale-95 transition"
            >
              アプリに戻る
            </button>
          </div>
        ) : (
          <div className="space-y-2.5 pt-2">
            {/* アプリを閉じる（終了）ボタン */}
            <button
              type="button"
              onClick={handleConfirmExit}
              className="w-full py-3 rounded-2xl bg-shuiro text-washi font-serif font-bold text-sm shadow-md hover:bg-shuiro-dark active:scale-[0.98] transition flex items-center justify-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>アプリを閉じる</span>
            </button>

            {/* 参拝を続ける（キャンセル）ボタン */}
            <button
              type="button"
              onClick={onClose}
              className="w-full py-3 rounded-2xl bg-washi border border-kin/50 text-sumi font-serif font-bold text-sm hover:bg-washi-dark active:scale-[0.98] transition flex items-center justify-center gap-2 shadow-sm"
            >
              <Check className="w-4 h-4 text-kin" />
              <span>参拝を続ける（閉じるのをやめる）</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
