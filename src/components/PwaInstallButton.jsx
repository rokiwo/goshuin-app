import React, { useState, useEffect } from 'react';
import { Download, Share, PlusSquare, X, Smartphone, CheckCircle } from 'lucide-react';

/**
 * PWAアプリインストール誘導ボタン ＆ ガイドモーダル
 * - Android/PC Chrome: beforeinstallprompt で直接インストールダイアログを起動
 * - iOS Safari: ホーム画面追加の手順を分かりやすく図解モーダルで表示
 * - 既にインストール済みの場合は非表示
 */
export default function PwaInstallButton() {
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [isIosGuideOpen, setIsIosGuideOpen] = useState(false);
  const [isIosDevice, setIsIosDevice] = useState(false);
  const [installedSuccess, setInstalledSuccess] = useState(false);

  useEffect(() => {
    // 既にPWA（ホーム画面から起動されたスタンドアロン）かチェック
    const checkStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      window.navigator.standalone === true;
    setIsStandalone(Boolean(checkStandalone));

    // iOS端末判定
    const isIos =
      /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    setIsIosDevice(isIos);

    // Chrome/Android等のインストールプロンプトイベントを監視
    const handleBeforeInstallPrompt = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
    };

    const handleAppInstalled = () => {
      setDeferredPrompt(null);
      setIsStandalone(true);
      setInstalledSuccess(true);
      setTimeout(() => setInstalledSuccess(false), 4000);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  // 既にPWAとして開いている場合は表示不要
  if (isStandalone) {
    return null;
  }

  const handleInstallClick = async () => {
    if (deferredPrompt) {
      // Android / Chrome: ネイティブインストールプロンプトを表示
      deferredPrompt.prompt();
      const choice = await deferredPrompt.userChoice;
      if (choice.outcome === 'accepted') {
        setDeferredPrompt(null);
      }
    } else if (isIosDevice) {
      // iOS: Safariでのホーム追加ガイドを表示
      setIsIosGuideOpen(true);
    } else {
      // その他のブラウザ用ガイド
      setIsIosGuideOpen(true);
    }
  };

  return (
    <>
      {/* ヘッダーやメニューに置くインストールボタン */}
      <button
        type="button"
        onClick={handleInstallClick}
        className="px-2 py-1.5 rounded-xl bg-gradient-to-r from-amber-600 to-amber-700 text-white text-[10px] font-serif font-bold flex items-center gap-1 border border-amber-300 shadow active:scale-95 transition animate-pulse"
        title="スマホのホーム画面にアプリとしてダウンロード・追加"
      >
        <Download className="w-3 h-3 text-amber-200" />
        <span>アプリ保存</span>
      </button>

      {/* インストール成功トースト */}
      {installedSuccess && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-50 bg-sumi/95 text-washi border border-kin px-4 py-2 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-serif">
          <CheckCircle className="w-4 h-4 text-emerald-400" />
          <span>ホーム画面にアプリを追加しました！</span>
        </div>
      )}

      {/* iOS / 一般ブラウザ向けホーム画面追加ガイドモーダル */}
      {isIosGuideOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 animate-fade-in">
          <div className="w-full max-w-sm bg-washi rounded-3xl border-2 border-kin/50 p-5 shadow-2xl text-sumi space-y-4 animate-slide-up">
            <div className="flex items-center justify-between border-b border-kin/20 pb-2.5">
              <div className="flex items-center gap-2">
                <Smartphone className="w-5 h-5 text-shuiro" />
                <h3 className="font-serif font-bold text-sm text-sumi">
                  ホーム画面にアプリを追加
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setIsIosGuideOpen(false)}
                className="flex items-center gap-1 px-2.5 py-1 rounded-xl bg-sumi-light/10 hover:bg-sumi-light/20 text-sumi text-xs font-serif font-bold transition active:scale-95"
                title="閉じる"
              >
                <span>閉じる</span>
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-sumi-muted leading-relaxed font-sans">
              ブラウザの枠が消えて全画面で使えるようになり、スマホのホーム画面からいつでもワンタップで起動できます。
            </p>

            {isIosDevice ? (
              <div className="space-y-3 bg-white/70 p-3.5 rounded-2xl border border-washi-border text-xs">
                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-shuiro text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    1
                  </div>
                  <div>
                    Safari下部の「<Share className="w-3.5 h-3.5 inline mx-0.5 text-blue-600" />
                    <strong>共有ボタン</strong>」をタップします。
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-shuiro text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    2
                  </div>
                  <div>
                    メニューから「<PlusSquare className="w-3.5 h-3.5 inline mx-0.5 text-sumi" />
                    <strong>ホーム画面に追加</strong>」を選択します。
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-shuiro text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    3
                  </div>
                  <div>
                    右上の「<strong>追加</strong>」を押すと完了です！
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3 bg-white/70 p-3.5 rounded-2xl border border-washi-border text-xs">
                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-shuiro text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    1
                  </div>
                  <div>
                    ブラウザ右上のメニュー「<strong>︙</strong>」をタップします。
                  </div>
                </div>

                <div className="flex items-start gap-2.5">
                  <div className="w-6 h-6 rounded-full bg-shuiro text-white flex items-center justify-center font-bold text-xs shrink-0 mt-0.5">
                    2
                  </div>
                  <div>
                    「<strong>アプリをインストール</strong>」または「<strong>ホーム画面に追加</strong>」を選択します。
                  </div>
                </div>
              </div>
            )}

            <button
              type="button"
              onClick={() => setIsIosGuideOpen(false)}
              className="w-full py-2.5 rounded-2xl bg-sumi text-washi font-serif font-bold text-xs tracking-wider shadow active:scale-95 transition"
            >
              閉じる（前の画面に戻る）
            </button>
          </div>
        </div>
      )}
    </>
  );
}
