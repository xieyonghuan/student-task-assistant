import { isNativeApp } from './native.js';

// The Android container resizes WebView itself. In browsers, follow the visible
// viewport instead so a phone keyboard cannot cover the active dialog.
export function watchMobileViewport() {
  if (isNativeApp() || !window.visualViewport) return;
  const viewport = window.visualViewport;
  let scheduled = false;
  const update = () => {
    scheduled = false;
    const editing = document.activeElement?.matches('input:not([type="checkbox"]):not([type="radio"]), textarea, select');
    const keyboard = !!editing && innerHeight - viewport.height > 120;
    document.documentElement.classList.toggle('keyboard-open', keyboard);
    document.documentElement.style.setProperty('--dialog-visible-height', `${viewport.height}px`);
    document.documentElement.style.setProperty('--dialog-visible-top', `${viewport.offsetTop}px`);
  };
  const schedule = () => { if (!scheduled) { scheduled = true; requestAnimationFrame(update); } };
  viewport.addEventListener('resize', schedule);
  viewport.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);
  update();
}
