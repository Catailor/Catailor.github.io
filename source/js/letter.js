(() => {
  'use strict';
  const init = () => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    const menu = document.querySelector('.letter-explore');
    if (menu) {
      document.addEventListener('click', event => { if (!menu.contains(event.target)) menu.open = false; });
      menu.addEventListener('keydown', event => { if (event.key === 'Escape') { menu.open = false; menu.querySelector('summary').focus(); } });
    }
    if (!reduced.matches && 'IntersectionObserver' in window) {
      const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) { entry.target.classList.add('letter-reveal'); observer.unobserve(entry.target); }
      }), { threshold: .08 });
      document.querySelectorAll('.letter-timeline-entry,.notebook-tile,.letter-taxonomy a,.notebook-moments article').forEach(node => observer.observe(node));
    }
    if (!document.body.classList.contains('letter-reader')) return;
    const tools = document.querySelector('[data-reader-tools]'), focusToggle = document.querySelector('[data-focus-toggle]');
    const copy = document.querySelector('[data-copy-link]'), status = document.querySelector('.letter-copy-status');
    copy.hidden = false;
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); status.textContent = '链接已复制'; }
      catch (_) { status.textContent = '请从地址栏复制链接'; }
    });
    if (!tools) return;
    tools.hidden = false;
    const resizeReading = change => {
      const anchor = [...document.querySelectorAll('#article-container > *')].find(node => {
        const rect = node.getBoundingClientRect(); return rect.bottom > 100 && rect.top < innerHeight;
      });
      const before = anchor?.getBoundingClientRect().top;
      change();
      requestAnimationFrame(() => {
        if (anchor) scrollTo({ top: scrollY + anchor.getBoundingClientRect().top - before, behavior: 'instant' });
        dispatchEvent(new Event('resize'));
      });
    };
    const toc = document.querySelector('#card-toc');
    const tocToggle = document.querySelector('[data-toc-toggle]');
    const closeToc = () => { document.body.classList.remove('letter-toc-open'); tocToggle?.setAttribute('aria-expanded', 'false'); };
    if (tocToggle && toc) {
      tocToggle.hidden = false;
      tocToggle.addEventListener('click', () => {
        const open = document.body.classList.toggle('letter-toc-open');
        tocToggle.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', event => { if (!event.target.closest('#aside-content,[data-toc-toggle]')) closeToc(); });
      document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('letter-toc-open')) { closeToc(); tocToggle.focus({preventScroll:true}); } });
      matchMedia('(min-width:1360px)').addEventListener('change', closeToc);
    }
    document.addEventListener('click', event => { if (!tools.contains(event.target)) tools.open = false; });
    toc?.addEventListener('click', event => {
      const link = event.target.closest('a.toc-link');
      if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const hash = link.getAttribute('href');
      let heading; try { heading = document.getElementById(decodeURIComponent(hash.slice(1))); } catch (_) { return; }
      if (!heading) return;
      event.preventDefault(); event.stopPropagation();
      closeToc();
      history.pushState(null, '', hash);
      scrollTo({ top: scrollY + heading.getBoundingClientRect().top - 79, behavior: reduced.matches ? 'instant' : 'smooth' });
    }, true);
    const fontButtons = [...document.querySelectorAll('[data-font-size]')];
    const setFont = value => {
      const size = [16, 18, 20].includes(Number(value)) ? Number(value) : 18;
      resizeReading(() => document.documentElement.style.setProperty('--letter-font-size', `${size}px`));
      fontButtons.forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.fontSize) === size)));
      try { localStorage.setItem('moonlit-font-size', String(size)); } catch (_) {}
    };
    let saved; try { saved = localStorage.getItem('moonlit-font-size'); } catch (_) {}
    setFont(saved);
    fontButtons.forEach(button => button.addEventListener('click', () => setFont(button.dataset.fontSize)));
    const exit = document.createElement('button'); exit.type = 'button'; exit.className = 'letter-exit-focus'; exit.textContent = '退出专注 · Esc'; exit.hidden = true; document.body.append(exit);
    const focus = enabled => {
      closeToc(); tools.open = false;
      resizeReading(() => document.body.classList.toggle('letter-focus', enabled)); exit.hidden = !enabled;
      focusToggle.setAttribute('aria-pressed', String(enabled));
      (enabled ? exit : focusToggle).focus({ preventScroll: true });
    };
    focusToggle.addEventListener('click', () => focus(true)); exit.addEventListener('click', () => focus(false));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('letter-focus')) focus(false); });

  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
