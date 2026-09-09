(() => {
  'use strict';
  // Use the visitor's local time. Manual choices last until the next 06:00 / 18:00 boundary.
  const DAY_START = 6;
  const NIGHT_START = 18;
  const storageKey = 'moonlit-time-theme';
  let override;
  try { override = JSON.parse(sessionStorage.getItem(storageKey)); } catch (_) {}

  function period(now) {
    const hour = now.getHours();
    const light = hour >= DAY_START && hour < NIGHT_START;
    const boundary = new Date(now);
    if (hour < DAY_START) boundary.setDate(boundary.getDate() - 1);
    boundary.setHours(light ? DAY_START : NIGHT_START, 0, 0, 0);
    return { id: boundary.getTime(), mode: light ? 'light' : 'dark' };
  }

  function sync() {
    const current = period(new Date());
    const mode = override?.period === current.id && ['light', 'dark'].includes(override.mode)
      ? override.mode : current.mode;
    if (mode === 'dark') btf.activateDarkMode();
    else btf.activateLightMode();
  }

  // Run in the head, before the page is painted; old persistent theme choices no longer block the clock.
  sync();
  setInterval(sync, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  document.addEventListener('click', event => {
    if (!event.target.closest('#darkmode')) return;
    // Butterfly handles this click on the parent toolbar, so record its result after bubbling.
    setTimeout(() => {
      override = { period: period(new Date()).id, mode: document.documentElement.dataset.theme };
      try { sessionStorage.setItem(storageKey, JSON.stringify(override)); } catch (_) {}
    }, 0);
  });
})();
