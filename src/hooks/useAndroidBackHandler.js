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

  // 最新のステートを常にRefで保持（useEffectの不要な再実行・再登録を防止）
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const setActiveTabRef = useRef(setActiveTab);
  setActiveTabRef.current = setActiveTab;

  const activeModalsRef = useRef(activeModals);
  activeModalsRef.current = activeModals;

  const closeTopModalRef = useRef(closeTopModal);
  closeTopModalRef.current = closeTopModal;

  const pushGuardState = useCallback(() => {
    try {
      window.history.pushState({ appGuard: true }, '', window.location.href);
    } catch {}
  }, []);

  useEffect(() => {
    // 初回マウント時にガード用履歴ステートを積む
    pushGuardState();

    const handlePopState = () => {
      // 1. 開いているモーダルがあれば一番上のモーダルを閉じる
      if (activeModalsRef.current && activeModalsRef.current.length > 0) {
        if (typeof closeTopModalRef.current === 'function') {
          closeTopModalRef.current();
        }
        pushGuardState();
        return;
      }

      // 2. マップ以外のタブにいる場合はマップタブに戻る
      if (activeTabRef.current !== 'map') {
        if (typeof setActiveTabRef.current === 'function') {
          setActiveTabRef.current('map');
        }
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
  }, [pushGuardState]);

  return { exitToastVisible };
}
