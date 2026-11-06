import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Androidの物理・ジェスチャー戻るボタンでアプリが突然終了して
 * スマホのホーム画面に戻ってしまうのを防ぐカスタムフック
 *
 * 挙動:
 * 1. モーダル/シートが開いている場合は、戻るボタンでモーダルを閉じる
 * 2. マップ以外のタブにいる場合は、マップタブ（ホーム）に戻る
 * 3. トップ画面（マップ）の場合は「もう一度戻ると終了します」トーストを表示し、
 *    2秒以内の再タップでのみ終了を許可する
 */
export function useAndroidBackHandler({
  activeTab,
  setActiveTab,
  activeModals = [],
  closeTopModal
}) {
  const [exitToastVisible, setExitToastVisible] = useState(false);
  const lastBackPressRef = useRef(0);
  const exitTimerRef = useRef(null);

  // 履歴スタックにダミー状態を積んで戻る操作をキャッチできるようにする
  const pushGuardState = useCallback(() => {
    try {
      window.history.pushState({ appGuard: true, time: Date.now() }, '', window.location.href);
    } catch {
      // 一部環境でのエラー抑制
    }
  }, []);

  useEffect(() => {
    // 起動時にガード用の履歴ステートを積む
    pushGuardState();

    const handlePopState = (e) => {
      // 1. 開いているモーダルがあれば一番上のモーダルを閉じる
      if (activeModals.length > 0) {
        if (typeof closeTopModal === 'function') {
          closeTopModal();
        }
        pushGuardState();
        return;
      }

      // 2. マップ以外のタブにいる場合はマップタブに戻る
      if (activeTab !== 'map') {
        setActiveTab('map');
        pushGuardState();
        return;
      }

      // 3. トップ画面（マップタブかつモーダルなし）の場合
      const now = Date.now();
      if (now - lastBackPressRef.current < 2000) {
        // 2秒以内の再タップ: アプリの終了（履歴を戻す）を許可
        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        setExitToastVisible(false);
        window.history.back();
      } else {
        // 1回目のタップ: トーストを表示して離脱を防止
        lastBackPressRef.current = now;
        setExitToastVisible(true);
        pushGuardState();

        if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
        exitTimerRef.current = setTimeout(() => {
          setExitToastVisible(false);
        }, 2000);
      }
    };

    window.addEventListener('popstate', handlePopState);
    return () => {
      window.removeEventListener('popstate', handlePopState);
      if (exitTimerRef.current) clearTimeout(exitTimerRef.current);
    };
  }, [activeTab, setActiveTab, activeModals, closeTopModal, pushGuardState]);

  return { exitToastVisible };
}
