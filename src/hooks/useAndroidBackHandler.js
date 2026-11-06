import { useBackHandler, useBackHandlerContext } from '../contexts/BackHandlerContext.jsx';

/**
 * 互換性のためのエイリアス
 */
export function useAndroidBackHandler() {
  const { isExitConfirmOpen, setIsExitConfirmOpen } = useBackHandlerContext() || {};
  return {
    isExitConfirmOpen,
    setIsExitConfirmOpen
  };
}
