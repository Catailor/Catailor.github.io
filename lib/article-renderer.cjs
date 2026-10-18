'use strict';
const Markdown = require('markdown-it');
const {studyBlocks} = require('./study-blocks.cjs');
const {withHeadingAnchors} = require('./notebook');

// One Markdown dialect for the blog, publication checks and studio preview.
const md = new Markdown({html:true, breaks:true, linkify:true, typographer:true, quotes:'“”‘’'})
  .use(require('@renbaoshuo/markdown-it-katex'))
  .use(require('markdown-it-footnote'));
// Furigana: [漢字]{かんじ} -> <ruby>, written by the studio's 注音 tool.
md.inline.ruler.before('link','furigana',(state,silent)=>{
  const src=state.src,start=state.pos;
  if(src.charCodeAt(start)!==0x5B)return false;
  const match=/^\[([^\[\]\n]{1,40})\]\{([^{}\n]{1,60})\}/.exec(src.slice(start));
  if(!match||!match[1].trim()||!match[2].trim())return false;
  if(!silent){const token=state.push('furigana','',0);token.meta={base:match[1],reading:match[2].trim()};}
  state.pos+=match[0].length;return true;
});
md.renderer.rules.furigana=(tokens,index)=>{
  const {base,reading}=tokens[index].meta,escape=md.utils.escapeHtml;
  return `<ruby class="article-ruby">${escape(base)}<rp>(</rp><rt>${escape(reading)}</rt><rp>)</rp></ruby>`;
};
const image=md.renderer.rules.image;
md.renderer.rules.image=(tokens,index,options,env,self)=>{
  const caption=tokens[index].attrGet('title');
  return image(tokens,index,options,env,self)+(caption?`<span class="article-image-caption">${md.utils.escapeHtml(caption)}</span>`:'');
};
const renderArticle = body => withHeadingAnchors(studyBlocks(md.render(String(body))));
module.exports = {md, renderArticle};
