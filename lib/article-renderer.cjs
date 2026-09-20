'use strict';
const Markdown = require('markdown-it');
const {studyBlocks} = require('./study-blocks.cjs');
const {withHeadingAnchors} = require('./notebook');

// One Markdown dialect for the blog, publication checks and studio preview.
const md = new Markdown({html:true, breaks:true, linkify:true, typographer:true, quotes:'“”‘’'})
  .use(require('@renbaoshuo/markdown-it-katex'))
  .use(require('markdown-it-footnote'));
const image=md.renderer.rules.image;
md.renderer.rules.image=(tokens,index,options,env,self)=>{
  const caption=tokens[index].attrGet('title');
  return image(tokens,index,options,env,self)+(caption?`<span class="article-image-caption">${md.utils.escapeHtml(caption)}</span>`:'');
};
const renderArticle = body => withHeadingAnchors(studyBlocks(md.render(String(body))));
module.exports = {md, renderArticle};
