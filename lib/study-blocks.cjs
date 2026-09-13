'use strict';
const cheerio = require('cheerio');
const types = {
  TIP: ['tip', '提示'], '提示': ['tip', '提示'],
  EXAMPLE: ['example', '例句'], '例句': ['example', '例句'],
  WARNING: ['warning', '易错点'], '易错点': ['warning', '易错点'],
  REFERENCE: ['reference', '参考资料'], '参考资料': ['reference', '参考资料']
};
function studyBlocks(html) {
  const $ = cheerio.load(html, null, false);
  $('blockquote').each((_, block) => {
    const quote = $(block), first = quote.children().first();
    if (first[0]?.tagName !== 'p' || quote.hasClass('study-note')) return;
    const match = first.html().match(/^\s*\[!([^\]]+)\](?:[ \t]*(?:\r?\n|<br\s*\/?\s*>))?/i);
    const type = match && types[match[1].toUpperCase()];
    if (!type) return;
    first.html(first.html().slice(match[0].length));
    if (!first.text().trim() && !first.children().length) first.remove();
    quote.addClass('study-note study-note--' + type[0]);
    quote.prepend($('<p class="study-note-label"></p>').text(type[1]));
  });
  return $.html();
}
module.exports = { studyBlocks };
