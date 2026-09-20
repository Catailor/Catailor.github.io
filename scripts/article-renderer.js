'use strict';
// Register after plugin initialization so two installed renderers cannot race.
hexo.extend.filter.register('after_init', () => {
  const {md} = require('../lib/article-renderer.cjs');
  for (const extension of ['md','markdown','mkd','mkdn','mdwn','mdtxt','mdtext']) {
    hexo.extend.renderer.register(extension, 'html', (data, options) =>
      options?.inline ? md.renderInline(data.text) : md.render(data.text), true);
  }
});
