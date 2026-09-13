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
        themeButton.textContent = dark ? '☀' : '☾';
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
      let limit = 5;
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
        const label = active === 'study' ? '学习手记' : active === 'life' ? '生活碎片' : '全部手记';
        status.textContent = `${label}共 ${matches.length} 篇，已显示 ${visible.size} 篇`;
        document.querySelectorAll('[data-note-nav]').forEach(link => link.classList.toggle('is-current', link.dataset.noteNav === active));
        document.querySelector('.moonlit-links > a[aria-current]')?.classList.toggle('is-current', active === 'all');
      }
      function select(kind) { active = kind; limit = kind === 'life' ? 6 : 5; update(true); }
      filters.forEach(button => button.addEventListener('click', () => {
        select(button.dataset.filter);
        history.replaceState(null, '', active === 'all' ? '#notes' : `#${active}`);
      }));
      function fromHash() {
        if (['#study', '#life'].includes(location.hash)) {
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
        limit += 6;
        update(true);
        // Keep keyboard users in the newly revealed content when the button disappears.
        cards.filter(card => !card.hidden)[previous]?.querySelector('h3 a')?.focus({ preventScroll: true });
      });
      update();
      fromHash();
    }

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
      button.textContent = open ? '×' : '❄';
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
