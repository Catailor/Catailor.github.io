const test = require('node:test'), assert = require('node:assert/strict');
const cheerio = require('cheerio'), MarkdownIt = require('markdown-it');
const { studyBlocks } = require('../lib/study-blocks.cjs');
const md = new MarkdownIt();
test('study notes render all four kinds while retaining rich content and heading structure', () => {
  for (const [marker, kind] of [['TIP','tip'],['例句','example'],['WARNING','warning'],['参考资料','reference']]) {
    const html = studyBlocks(md.render(`> [!${marker}]\n> **重点** 与 [资料](https://example.com/)\n>\n> - 第一条\n> - 第二条`));
    const $ = cheerio.load(html);assert.equal($('.study-note--'+kind).length,1);assert.equal($('strong').text(),'重点');assert.equal($('li').length,2);assert.equal($('a').attr('href'),'https://example.com/');assert.equal($('h1,h2,h3').length,0);
    assert.equal(studyBlocks(html),html);
  }
});
test('ordinary quotations, code samples and unsupported markers are not promoted to study notes', () => {
  const html=studyBlocks(md.render('> 普通引用\n\n> [!UNKNOWN]\n> 保留原样\n\n```md\n> [!TIP]\n> 仅为示例\n```'));
  const $=cheerio.load(html);assert.equal($('.study-note').length,0);assert($('blockquote').text().includes('[!UNKNOWN]'));assert($('code').text().includes('[!TIP]'));
});
