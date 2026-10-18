(() => {
  'use strict';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const root = document.documentElement;
  const effects = new Set((root.dataset.moonlitEffects || '').split(/\s+/).filter(Boolean));
  const motionOk = () => !reducedMotion.matches;

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
      const toggleTheme = () => document.querySelector('#darkmode')?.click();
      themeButton.addEventListener('click', () => {
        if (!effects.has('theme') || !document.startViewTransition || !motionOk()) return toggleTheme();
        // Day/night switch spreads out from the button as a circular ripple.
        const rect = themeButton.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
        root.classList.add('moonlit-theme-switching');
        const transition = document.startViewTransition(toggleTheme);
        transition.ready.then(() => {
          root.animate({ clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
            { duration: 650, easing: 'cubic-bezier(.4, 0, .2, 1)', pseudoElement: '::view-transition-new(root)' });
        }).catch(() => {});
        transition.finished.finally(() => root.classList.remove('moonlit-theme-switching'));
      });
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

    // Hero: layered pointer parallax plus scroll-linked depth.
    const hero = document.querySelector('.moonlit-hero');
    if (hero && effects.has('hero') && motionOk()) {
      if (window.matchMedia('(pointer: fine)').matches) {
        hero.addEventListener('pointermove', event => {
          const rect = hero.getBoundingClientRect();
          hero.style.setProperty('--scene-x', `${((event.clientX - rect.left) / rect.width - .5) * 14}px`);
          hero.style.setProperty('--scene-y', `${((event.clientY - rect.top) / rect.height - .5) * 10}px`);
        }, { passive: true });
        hero.addEventListener('pointerleave', () => {
          hero.style.setProperty('--scene-x', '0px');
          hero.style.setProperty('--scene-y', '0px');
        });
      }
      let heroTick = false;
      const heroScroll = () => {
        heroTick = false;
        const progress = Math.min(Math.max(window.scrollY / (hero.offsetHeight || 1), 0), 1);
        hero.style.setProperty('--hero-p', progress.toFixed(4));
      };
      window.addEventListener('scroll', () => { if (!heroTick) { heroTick = true; requestAnimationFrame(heroScroll); } }, { passive: true });
      heroScroll();
    }

    // Reading progress bar on letters.
    const progressBar = document.querySelector('.moonlit-progress');
    if (progressBar && effects.has('progress')) {
      let readTick = false;
      const readScroll = () => {
        readTick = false;
        const max = document.documentElement.scrollHeight - window.innerHeight;
        progressBar.style.setProperty('--read-p', max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1).toFixed(4) : '0');
      };
      window.addEventListener('scroll', () => { if (!readTick) { readTick = true; requestAnimationFrame(readScroll); } }, { passive: true });
      window.addEventListener('resize', readScroll, { passive: true });
      readScroll();
    }

    // Cards rise in softly as they enter the viewport.
    if (effects.has('reveal') && motionOk() && 'IntersectionObserver' in window) {
      const targets = [...document.querySelectorAll('.moonlit-section-head, .moonlit-featured, .moonlit-row')];
      if (targets.length) {
        let batch = 0;
        let batchTimer;
        const observer = new IntersectionObserver(entries => {
          entries.filter(entry => entry.isIntersecting).forEach(entry => {
            entry.target.style.setProperty('--reveal-delay', `${Math.min(batch++, 6) * 60}ms`);
            entry.target.classList.add('is-revealed');
            observer.unobserve(entry.target);
          });
          clearTimeout(batchTimer);
          batchTimer = setTimeout(() => { batch = 0; }, 120);
        }, { rootMargin: '0px 0px -8% 0px', threshold: .08 });
        targets.forEach(target => { target.dataset.reveal = ''; observer.observe(target); });
        root.classList.add('moonlit-reveal-on');
        // Cards shown later by filters / "more" should never stay hidden.
        new MutationObserver(() => targets.forEach(t => { if (!t.hidden && !t.classList.contains('is-revealed') && t.getBoundingClientRect().top < innerHeight) t.classList.add('is-revealed'); }))
          .observe(document.querySelector('#notes') || document.body, { subtree: true, attributes: true, attributeFilter: ['hidden'] });
      }
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
