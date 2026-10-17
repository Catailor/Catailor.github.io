(() => {
  'use strict';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;

  function init() {
    const menus = document.querySelector('#menus');
    let themeButton = document.querySelector('.moonlit-theme');
    if (!themeButton && menus) {
      themeButton = document.createElement('button');
      themeButton.className = 'moonlit-theme';
      themeButton.type = 'button';
      menus.append(themeButton);
    }
    if (themeButton) {
      const syncTheme = () => {
        const dark = root.dataset.theme === 'dark';
        // The button ships with both moon and sun SVGs; CSS shows the right one.
        if (!themeButton.querySelector('svg')) themeButton.textContent = dark ? '☀' : '☾';
        themeButton.setAttribute('aria-label', dark ? '切换到日间模式' : '切换到夜间模式');
        themeButton.title = dark ? '切换到日间模式' : '切换到夜间模式';
      };
      syncTheme();
      themeButton.addEventListener('click', () => document.querySelector('#darkmode')?.click());
      new MutationObserver(syncTheme).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    }

    const cards = [...document.querySelectorAll('.moonlit-card')];
    if (cards.length) {
      const filters = [...document.querySelectorAll('[data-filter]')];
      const more = document.querySelector('.moonlit-more');
      const status = document.querySelector('.moonlit-filter-status');
      let active = 'all';
      let limit = 8;
      document.querySelector('.moonlit-filters').hidden = false;
      function update(animate = false) {
        const matches = cards.filter(card => active === 'all' || card.dataset.kind === active);
        const visible = new Set(matches.slice(0, limit));
        cards.forEach(card => {
          const wasHidden = card.hidden;
          card.hidden = !visible.has(card);
          if (animate && wasHidden && !card.hidden && !reducedMotion.matches) {
            card.classList.add('moonlit-enter');
            card.addEventListener('animationend', () => card.classList.remove('moonlit-enter'), { once: true });
          }
        });
        filters.forEach(button => {
          const selected = button.dataset.filter === active;
          button.classList.toggle('is-active', selected);
          button.setAttribute('aria-pressed', String(selected));
        });
        more.hidden = matches.length <= limit;
        const label = { study: '学习手记', life: '日常', moment: '碎碎念' }[active] || '全部手记';
        status.textContent = `${label}共 ${matches.length} 篇，已显示 ${visible.size} 篇`;
        document.querySelectorAll('[data-note-nav]').forEach(link => link.classList.toggle('is-current', link.dataset.noteNav === active));
        document.querySelector('.moonlit-links > a[aria-current]')?.classList.toggle('is-current', active === 'all');
      }
      function select(kind) { active = kind; limit = 8; update(true); }
      filters.forEach(button => button.addEventListener('click', () => {
        select(button.dataset.filter);
        history.replaceState(null, '', active === 'all' ? '#notes' : `#${active}`);
      }));
      function fromHash() {
        if (['#study', '#life', '#moment'].includes(location.hash) && filters.some(b => b.dataset.filter === location.hash.slice(1))) {
          select(location.hash.slice(1));
          document.querySelector('#notes').scrollIntoView({ behavior: reducedMotion.matches ? 'instant' : 'smooth', block: 'start' });
        }
      }
      document.querySelectorAll('[data-note-nav]').forEach(link => link.addEventListener('click', event => {
        event.preventDefault();
        history.replaceState(null, '', link.getAttribute('href'));
        fromHash();
      }));
      window.addEventListener('hashchange', fromHash);
      more.addEventListener('click', () => {
        const previous = cards.filter(card => !card.hidden).length;
        limit += 8;
        update(true);
        // Keep keyboard users in the newly revealed content when the button disappears.
        cards.filter(card => !card.hidden)[previous]?.querySelector('h3 a')?.focus({ preventScroll: true });
      });
      update();
      fromHash();
    }

    // Gentle parallax on the full-screen hero illustration.
    const hero = document.querySelector('.moonlit-hero');
    if (hero && window.matchMedia('(pointer: fine)').matches) {
      hero.addEventListener('pointermove', event => {
        if (reducedMotion.matches) return;
        const rect = hero.getBoundingClientRect();
        hero.style.setProperty('--scene-x', `${((event.clientX - rect.left) / rect.width - .5) * 14}px`);
        hero.style.setProperty('--scene-y', `${((event.clientY - rect.top) / rect.height - .5) * 10}px`);
      }, { passive: true });
      hero.addEventListener('pointerleave', () => {
        hero.style.setProperty('--scene-x', '0px');
        hero.style.setProperty('--scene-y', '0px');
      });
    }

    // Isolate Live2D in a small, disposable frame so closing it releases its resources.
    const companion = document.createElement('div');
    companion.className = 'moonlit-companion';
    const button = document.createElement('button');
    button.type = 'button';
    const syncCompanion = open => {
      button.innerHTML = open
        ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>'
        : '<svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><path d="M12 2.5v19M3.8 7.25l16.4 9.5M3.8 16.75l16.4-9.5M9.5 4l2.5 2.5L14.5 4M9.5 20l2.5-2.5 2.5 2.5"/></svg>';
      button.setAttribute('aria-label', open ? '收起琪露诺' : '召唤琪露诺');
      button.title = open ? '收起琪露诺' : '召唤琪露诺';
    };
    syncCompanion(false);
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-controls', 'moonlit-companion-frame');
    companion.append(button);
    document.body.append(companion);
    let frame;
    button.addEventListener('click', () => {
      if (frame) {
        frame.remove();
        frame = null;
        syncCompanion(false);
        button.setAttribute('aria-expanded', 'false');
        return;
      }
      frame = document.createElement('iframe');
      frame.id = 'moonlit-companion-frame';
      frame.className = 'moonlit-companion-frame';
      frame.title = '琪露诺 Live2D 小伙伴';
      frame.src = '/companion/';
      document.body.append(frame);
      syncCompanion(true);
      button.setAttribute('aria-expanded', 'true');
    });
  }
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
