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
    toc?.addEventListener('click', event => {
      const link = event.target.closest('a.toc-link');
      if (!link || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const hash = link.getAttribute('href');
      let heading; try { heading = document.getElementById(decodeURIComponent(hash.slice(1))); } catch (_) { return; }
      if (!heading) return;
      event.preventDefault(); event.stopPropagation();
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
      resizeReading(() => document.body.classList.toggle('letter-focus', enabled)); exit.hidden = !enabled;
      focusToggle.setAttribute('aria-pressed', String(enabled));
      (enabled ? exit : focusToggle).focus({ preventScroll: true });
    };
    focusToggle.addEventListener('click', () => focus(true)); exit.addEventListener('click', () => focus(false));
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && document.body.classList.contains('letter-focus')) focus(false); });
    const dock = document.createElement('div'); dock.className = 'letter-reading-dock'; dock.setAttribute('aria-label', '当前阅读进度');
    const percent = document.createElement('b'), remaining = document.createElement('span'); percent.textContent = '0%';
    dock.append(percent, remaining); document.body.append(dock);
    const total = Number(document.querySelector('[data-reading-article]')?.dataset.readingMinutes) || 1;
    remaining.textContent = `约 ${total} 分钟`;
    document.addEventListener('notebook:progress', event => {
      const ratio = event.detail;
      percent.textContent = `${Math.round(ratio * 100)}%`;
      remaining.textContent = ratio >= .99 ? '这一页，读完了' : `还需约 ${Math.max(1, Math.ceil(total * (1 - ratio)))} 分钟`;
    });
    const copy = document.querySelector('[data-copy-link]'), status = document.querySelector('.letter-copy-status'); copy.hidden = false;
    copy.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); status.textContent = '链接已复制'; }
      catch (_) { status.textContent = '请从地址栏复制链接'; }
    });
  };
  document.readyState === 'loading' ? document.addEventListener('DOMContentLoaded', init) : init();
})();
