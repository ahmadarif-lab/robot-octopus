import { onLangChange, t } from './i18n.js';
const root = document.documentElement;
const request = root.requestFullscreen || root.webkitRequestFullscreen;
const current = () => document.fullscreenElement || document.webkitFullscreenElement;
const exit = () => (document.exitFullscreen || document.webkitExitFullscreen).call(document);
const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone), (display-mode: fullscreen)').matches;

/** Fullscreen toggle. iPhone Safari has no Fullscreen API, so it points to Add to Home Screen. */
export function initFullscreen() {
  const button = document.getElementById('btn-fs');
  const toast = document.getElementById('toast');
  let toastTimer = 0;

  const show = (text) => {
    toast.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 6000);
  };

  const refresh = () => {
    const on = Boolean(current());
    button.classList.toggle('on', on);
    button.setAttribute('aria-label', on ? t('Exit fullscreen') : t('Fullscreen'));
    button.title = on ? t('Exit fullscreen (F)') : t('Fullscreen (F)');
  };

  const toggle = async () => {
    if (!request) {
      show(t('On iPhone: tap Share, then Add to Home Screen. Open it from its icon for fullscreen.'));
      return;
    }
    try {
      if (current()) await exit();
      else await request.call(root);
    } catch {
      show(t('The browser refused fullscreen. Try tapping the button once more.'));
    }
  };

  // Installed to the home screen or running as the Android app, the page already fills the screen.
  const nativeApp = window.Capacitor?.isNativePlatform?.() === true;
  // The Android app draws edge to edge and ignores the camera cutout on purpose.
  document.documentElement.classList.toggle('native-app', nativeApp);
  if (nativeApp || (!request && isStandalone())) {
    button.hidden = true;
    return;
  }

  button.addEventListener('click', () => {
    button.blur();
    toggle();
  });
  addEventListener('keydown', (e) => {
    if (e.code === 'KeyF' && !e.repeat && !e.metaKey && !e.ctrlKey && !e.altKey) toggle();
  });
  document.addEventListener('fullscreenchange', refresh);
  document.addEventListener('webkitfullscreenchange', refresh);
  onLangChange(refresh);
  refresh();
}
