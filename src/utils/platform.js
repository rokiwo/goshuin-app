/**
 * iPhone (iOS) / Android / Desktop の判定ユーティリティ
 * index.html の事前スクリプトで <html> に data-platform / data-standalone を付与し、CSS と UI を同期させる
 */
export function getDevicePlatform() {
  if (typeof document !== 'undefined' && document.documentElement?.dataset?.platform) {
    return document.documentElement.dataset.platform;
  }
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent || '';
  const isIOS =
    /iPad|iPhone|iPod/i.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (isIOS) return 'ios';
  if (/Android/i.test(ua)) return 'android';
  return 'desktop';
}

export function isIOSDevice() {
  return getDevicePlatform() === 'ios';
}

export function isAndroidDevice() {
  return getDevicePlatform() === 'android';
}

export function isStandaloneApp() {
  if (typeof document !== 'undefined' && document.documentElement?.dataset?.standalone) {
    return document.documentElement.dataset.standalone === 'true';
  }
  if (typeof window === 'undefined') return false;
  return (
    (window.matchMedia &&
      (window.matchMedia('(display-mode: standalone)').matches ||
        window.matchMedia('(display-mode: fullscreen)').matches)) ||
    window.navigator.standalone === true
  );
}
