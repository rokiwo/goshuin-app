import React, { createContext, useContext, useState, useRef, useEffect, useCallback } from 'react';

const BackHandlerContext = createContext(null);

/**
 * Androidの物理・ジェスチャー戻るボタンやブラウザの戻る操作で
 * 意図せずアプリが終了してホーム画面に戻ってしまうのを防ぐ集中管理プロバイダー
 */
export function BackHandlerProvider({ children, activeTab, setActiveTab }) {
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);
  const stackRef = useRef([]);

  // 最新の activeTab / setActiveTab を常に参照できるように保持
  const activeTabRef = useRef(activeTab);
  activeTabRef.current = activeTab;

  const setActiveTabRef = useRef(setActiveTab);
  setActiveTabRef.current = setActiveTab;

  const isExitConfirmOpenRef = useRef(isExitConfirmOpen);
  isExitConfirmOpenRef.current = isExitConfirmOpen;

  // ガード用履歴ステートを積む関数
  const pushGuard = useCallback(() => {
    try {
      window.history.pushState({ appGuard: Date.now() }, '', window.location.href);
    } catch {}
  }, []);

  // モーダルやシートが開いた時に戻るアクションをスタックに登録する関数
  const registerHandler = useCallback((id, onBack, priority = 10) => {
    if (!id || typeof onBack !== 'function') return () => {};

    // 既存の同一idがあれば除外
    stackRef.current = stackRef.current.filter((item) => item.id !== id);
    // スタックに追加
    stackRef.current.push({ id, onBack, priority });
    // 優先度順（数値が大きい方が手前・先に実行）にソート
    stackRef.current.sort((a, b) => a.priority - b.priority);

    // 新たにモーダル等が開かれたので、ユーザー操作に合わせてガードステートを積む
    pushGuard();

    // クリーンアップ（モーダルが閉じたときにスタックから除去）
    return () => {
      stackRef.current = stackRef.current.filter((item) => item.id !== id);
    };
  }, [pushGuard]);

  useEffect(() => {
    // アプリ起動時に最初のガードを積む
    pushGuard();

    const handlePopState = () => {
      // 1. もしすでに「アプリ終了確認アナウンス」が開いていれば、まずそれを閉じる（キャンセル）
      if (isExitConfirmOpenRef.current) {
        setIsExitConfirmOpen(false);
        pushGuard();
        return;
      }

      // 2. 開いているモーダルやシートがあれば、最前面のものを1つだけ閉じる
      if (stackRef.current.length > 0) {
        const top = stackRef.current.pop();
        if (top && typeof top.onBack === 'function') {
          try {
            top.onBack();
          } catch (err) {
            console.error('Error executing back handler:', err);
          }
        }
        pushGuard();
        return;
      }

      // 3. モーダルが何もなく、マップ以外のタブ（御朱印帳など）にいる場合はマップ（ホーム）に戻る
      if (activeTabRef.current !== 'map') {
        if (typeof setActiveTabRef.current === 'function') {
          setActiveTabRef.current('map');
        }
        pushGuard();
        return;
      }

      // 4. マップタブ（最上位トップ画面）でこれ以上戻る画面がない場合：
      // ★勝手にホーム画面に戻さず、「アプリを終了しますか？」確認アナウンスを表示する！
      setIsExitConfirmOpen(true);
      pushGuard();
    };

    window.addEventListener('popstate', handlePopState);

    // ブラウザのタブ閉じ・リロード操作時の確認アナウンス
    const handleBeforeUnload = (e) => {
      // ユーザーがタブを閉じる際のブラウザ標準確認
      e.preventDefault();
      e.returnValue = '';
      return '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      window.removeEventListener('popstate', handlePopState);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [pushGuard]);

  return (
    <BackHandlerContext.Provider
      value={{
        registerHandler,
        isExitConfirmOpen,
        setIsExitConfirmOpen,
        pushGuard
      }}
    >
      {children}
    </BackHandlerContext.Provider>
  );
}

/**
 * 各モーダル・シートが簡単に戻るボタンに連動できるカスタムフック
 * @param {Object} param0
 * @param {string} param0.id 一意な識別子
 * @param {boolean} param0.isOpen 開いているかどうか
 * @param {Function} param0.onBack 閉じる関数
 * @param {number} param0.priority 優先度（デフォルト10、ネストした内側モーダルは20など）
 */
export function useBackHandler({ id, isOpen, onBack, priority = 10 }) {
  const ctx = useContext(BackHandlerContext);

  useEffect(() => {
    if (!ctx || !isOpen || typeof onBack !== 'function') return;
    return ctx.registerHandler(id, onBack, priority);
  }, [ctx, id, isOpen, onBack, priority]);
}

export function useBackHandlerContext() {
  return useContext(BackHandlerContext);
}
