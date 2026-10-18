// Same rhythm as the blog: light from 06:00 to 18:00, dark otherwise.
// A manual switch lasts until the next 06:00 / 18:00 boundary.
(() => {
  'use strict';
  const KEY = 'studio-theme-override', root = document.documentElement;
  const timeTheme = (date = new Date()) => date.getHours() >= 6 && date.getHours() < 18 ? 'light' : 'dark';
  function nextBoundary(date = new Date()) {
    const next = new Date(date); next.setMinutes(0, 0, 0);
    const hour = date.getHours();
    if (hour < 6) next.setHours(6); else if (hour < 18) next.setHours(18); else { next.setDate(next.getDate() + 1); next.setHours(6); }
    return next.getTime();
  }
  function override() {
    try { const saved = JSON.parse(localStorage.getItem(KEY)); if (saved && saved.until > Date.now() && /^(light|dark)$/.test(saved.theme)) return saved; localStorage.removeItem(KEY); } catch (_) {}
    return null;
  }
  function apply() {
    const manual = override(), theme = manual ? manual.theme : timeTheme();
    if (root.dataset.theme !== theme) root.dataset.theme = theme;
    root.dataset.themeSource = manual ? 'manual' : 'time';
    document.dispatchEvent(new CustomEvent('studio-theme', {detail: {theme, manual: Boolean(manual)}}));
  }
  apply();
  setInterval(apply, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) apply(); });
  window.StudioTheme = {
    get theme() { return root.dataset.theme; },
    get manual() { return Boolean(override()); },
    toggle() { const theme = root.dataset.theme === 'dark' ? 'light' : 'dark'; try { localStorage.setItem(KEY, JSON.stringify({theme, until: nextBoundary()})); } catch (_) {} apply(); return theme; },
    followTime() { try { localStorage.removeItem(KEY); } catch (_) {} apply(); }
  };
})();
