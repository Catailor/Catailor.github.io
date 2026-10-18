// Writing studio editors: Milkdown Crepe for visual writing, CodeMirror for the Markdown source.
import {Crepe} from '@milkdown/crepe';
import '@milkdown/crepe/theme/common/style.css';
import {editorViewCtx, serializerCtx, parserCtx, remarkCtx, schemaCtx, editorViewOptionsCtx} from '@milkdown/kit/core';
import {uploadConfig} from '@milkdown/kit/plugin/upload';
import {$nodeSchema, $remark, $prose} from '@milkdown/kit/utils';
import {Plugin, TextSelection} from '@milkdown/kit/prose/state';
import {EditorView, keymap, drawSelection, placeholder as cmPlaceholder} from '@codemirror/view';
import {EditorState, EditorSelection} from '@codemirror/state';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import {languages} from '@codemirror/language-data';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {syntaxHighlighting, HighlightStyle} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import DOMPurify from 'dompurify';
import {diffLines} from 'diff';
import {prepareVisualContent, scanImages} from './visual-content.mjs';

window.prepareVisualContent = prepareVisualContent;
window.scanArticleImages = scanImages;
window.diffArticleLines = (before, after) => diffLines(before, after, {timeout: 100}) || [{removed: true, value: before, count: before.split('\n').length}, {added: true, value: after, count: after.split('\n').length}];
window.DOMPurify = DOMPurify;

const icon = path => `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;
const icons = {
  ruby: icon('<path d="M5 19h6M8 19V9M4.5 9h7M15 19l3-8 3 8M16 16.5h4"/><path d="M6 5.5h4M15.5 5.5h5" opacity=".6"/>'),
  vocab: icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M3.5 9.5h17M9 9.5v10M14.5 9.5v10"/>'),
  image: icon('<rect x="3.5" y="4.5" width="17" height="15" rx="2.5"/><circle cx="9" cy="10" r="1.6"/><path d="m4.5 18 5-5 3.5 3.5 2.5-2.5 4 4"/>')
};

// ---------- Furigana: [漢字]{かんじ} ----------
export const RUBY = /\[([^\[\]\n]{1,40})\]\{([^{}\n]{1,60})\}/g;
const rubyRemark = $remark('studioRuby', () => () => tree => {
  const walk = node => {
    if (!node.children) return;
    const next = [];
    for (const child of node.children) {
      if (child.type !== 'text' || !child.value.includes(']{')) { walk(child); next.push(child); continue; }
      let last = 0;
      for (const match of child.value.matchAll(RUBY)) {
        if (match.index > last) next.push({type: 'text', value: child.value.slice(last, match.index)});
        next.push({type: 'studioRuby', base: match[1], reading: match[2]});
        last = match.index + match[0].length;
      }
      if (last < child.value.length) next.push({type: 'text', value: child.value.slice(last)});
    }
    node.children = next;
  };
  walk(tree);
});
const rubySchema = $nodeSchema('studio_ruby', () => ({
  group: 'inline', inline: true, atom: true, selectable: true,
  attrs: {base: {default: ''}, reading: {default: ''}},
  parseDOM: [{tag: 'ruby[data-studio-ruby]', getAttrs: dom => ({base: dom.dataset.base || '', reading: dom.dataset.reading || ''})}],
  toDOM: node => ['ruby', {'data-studio-ruby': '', 'data-base': node.attrs.base, 'data-reading': node.attrs.reading, title: '点击修改注音'}, node.attrs.base, ['rt', node.attrs.reading]],
  parseMarkdown: {match: node => node.type === 'studioRuby', runner: (state, node, type) => { state.addNode(type, {base: node.base, reading: node.reading}); }},
  toMarkdown: {match: node => node.type.name === 'studio_ruby', runner: (state, node) => { state.addNode('html', undefined, `[${node.attrs.base}]{${node.attrs.reading}}`); }}
}));

// Japanese IMEs often turn "/" into "・" or "／"; treat either alone on a line as the slash menu key.
const imeSlash = $prose(() => new Plugin({
  view: () => ({update(view) {
    if (view.composing) return;
    const {selection} = view.state, {$from} = selection;
    if (!selection.empty || !$from.parent.isTextblock || $from.parent.type.name !== 'paragraph') return;
    const textContent = $from.parent.textContent;
    if ((textContent === '・' || textContent === '／') && $from.parentOffset === 1) {
      view.dispatch(view.state.tr.insertText('/', $from.pos - 1, $from.pos));
    }
  }})
}));

function serializeWith(ctx, node) {
  const schema = ctx.get(schemaCtx), serializer = ctx.get(serializerCtx);
  return serializer(schema.topNodeType.create(null, node)).replace(/\n+$/, '');
}
// Plain brackets such as IPA [ˈʒɑːn.rə] need no escaping unless they could start a link, footnote or ruby.
const unescapeBrackets = text => text.split(/(`+[^`]*`+)/).map((part, i) => i % 2 ? part : part.replace(/\\\[([^\[\]\n]*)\](?![(\[{:]|\\\[)/g, (all, inner, offset, whole) => whole[offset - 1] === '\\' || /^[\^!]/.test(inner) ? all : `[${inner}]`)).join('');
// Blog Markdown quirks that a generic serializer would escape.
const tidy = (text, type) => (/code/.test(type || '') ? text : unescapeBrackets(text))
  .replace(/^((?:[ \t]*>[ \t]?)+)\\\[!(\w+)\]/gm, '$1[!$2]')
  .replace(/(\|[ \t]*)<br \/>(?=[ \t]*\|)/g, '$1')
  // Table separators and empty rows: keep them short instead of padded to column width.
  .replace(/^\|(?:[ \t]*:?-+:?[ \t]*\|)+[ \t]*$/gm, row => '|' + row.slice(1).replace(/[ \t]*(:?)-+(:?)[ \t]*\|/g, (_, left, right) => ` ${left}---${right} |`))
  .replace(/^\|(?:[ \t]*\|)+[ \t]*$/gm, row => '|' + row.slice(1).replace(/[ \t]*\|/g, '  |'));

// Milkdown fills in heading ids and a trailing paragraph after loading; neither is a user edit.
function sameNode(a, b) {
  if (a.eq(b)) return true;
  if (a.type !== b.type || !a.content.eq(b.content) || a.marks.length !== b.marks.length || !a.marks.every((mark, i) => mark.eq(b.marks[i]))) return false;
  const attrs = node => JSON.stringify({...node.attrs, id: null});
  return attrs(a) === attrs(b);
}
function sameDoc(a, b) {
  const blocks = doc => { const list = []; doc.forEach(node => list.push(node)); while (list.length && list.at(-1).type.name === 'paragraph' && !list.at(-1).content.size) list.pop(); return list; };
  const x = blocks(a), y = blocks(b);
  return x.length === y.length && x.every((node, i) => sameNode(node, y[i]));
}
export function createVisual({root, value, onChange, upload, editRuby, onReady}) {
  const crepe = new Crepe({
    root, defaultValue: value,
    features: {[Crepe.Feature.ImageBlock]: false, [Crepe.Feature.TopBar]: false, [Crepe.Feature.AI]: false},
    featureConfigs: {
      [Crepe.Feature.Placeholder]: {text: '从这里开始写，输入 / 插入标题、表格、公式…', mode: 'block'},
      [Crepe.Feature.LinkTooltip]: {inputPlaceholder: '粘贴或输入链接…'},
      [Crepe.Feature.Latex]: {inlineEditConfirm: '完成'},
      [Crepe.Feature.CodeMirror]: {searchPlaceholder: '查找语言', noResultText: '没有找到', previewToggleText: preview => preview ? '编辑' : '隐藏'},
      [Crepe.Feature.Toolbar]: {
        boldLabel: '加粗', italicLabel: '斜体', strikethroughLabel: '删除线', codeLabel: '行内代码', linkLabel: '链接', latexLabel: '行内公式',
        buildToolbar: builder => builder.getGroup('function').addItem('ruby', {icon: icons.ruby, label: '注音（振り仮名）', active: () => false, onRun: ctx => rubyAtSelection(ctx)})
      },
      [Crepe.Feature.BlockEdit]: {
        textGroup: {label: '文字', text: {label: '正文'}, h1: {label: '标题 1'}, h2: {label: '标题 2'}, h3: {label: '标题 3'}, h4: {label: '标题 4'}, h5: {label: '标题 5'}, h6: {label: '标题 6'}, quote: {label: '引用'}, divider: {label: '分割线'}},
        listGroup: {label: '列表', bulletList: {label: '无序列表'}, orderedList: {label: '有序列表'}, taskList: {label: '待办清单'}},
        advancedGroup: {label: '插入', codeBlock: {label: '代码块'}, table: {label: '表格'}, math: {label: '公式块'}},
        buildMenu: builder => builder.addGroup('japanese', '日语笔记')
          .addItem('vocab', {label: '生词表', icon: icons.vocab, onRun: ctx => insertMarkdown(ctx, '| 单词 | 读音（假名） | 词性 | 中文意思 | 例句与用法 |\n| --- | --- | --- | --- | --- |\n|  |  |  |  |  |')})
          .addItem('ruby', {label: '注音（振り仮名）', icon: icons.ruby, onRun: ctx => rubyAtSelection(ctx)})
          .addItem('image', {label: '图片', icon: icons.image, onRun: ctx => pickImage(ctx)})
      }
    }
  });
  let ready = false, view = null, baseline = null;
  const withCtx = fn => crepe.editor.action(fn);
  function clearSlash(ctx) {
    const v = ctx.get(editorViewCtx), {$from} = v.state.selection;
    if ($from.parent.isTextblock && /^[\/・／]/.test($from.parent.textContent)) v.dispatch(v.state.tr.delete($from.start(), $from.end()));
  }
  function insertMarkdown(ctx, text) {
    clearSlash(ctx);
    const v = ctx.get(editorViewCtx), doc = ctx.get(parserCtx)(text);
    const {$from} = v.state.selection;
    const at = $from.depth ? $from.before(1) : $from.pos, empty = $from.depth && !$from.node(1).textContent;
    const tr = empty ? v.state.tr.replaceWith(at, $from.after(1), doc.content) : v.state.tr.insert($from.depth ? $from.after(1) : at, doc.content);
    v.dispatch(tr.scrollIntoView()); v.focus();
  }
  function rubyAtSelection(ctx) {
    clearSlash(ctx);
    const v = ctx.get(editorViewCtx), {from, to} = v.state.selection;
    const base = v.state.doc.textBetween(from, to, '');
    editRuby({base, reading: ''}, result => {
      if (!result?.base || !result?.reading) return;
      const node = v.state.schema.nodes.studio_ruby.create(result);
      v.dispatch(v.state.tr.replaceRangeWith(from, to, node).scrollIntoView()); v.focus();
    });
  }
  function pickImage(ctx) {
    clearSlash(ctx);
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/png,image/jpeg,image/webp,image/gif';
    input.onchange = async () => {
      const file = input.files[0]; if (!file) return;
      const url = await upload(file), v = ctx.get(editorViewCtx);
      const image = v.state.schema.nodes.image.create({src: url, alt: file.name.replace(/\.[^.]+$/, '') || '图片'});
      v.dispatch(v.state.tr.replaceSelectionWith(v.state.schema.nodes.paragraph.create(null, image)).scrollIntoView()); v.focus();
    };
    input.click();
  }
  crepe.editor
    .config(ctx => {
      ctx.update(uploadConfig.key, prev => ({...prev, uploader: async (files, schema) => {
        const nodes = [];
        for (const file of [...files].filter(f => f.type.startsWith('image/'))) nodes.push(schema.nodes.image.createAndFill({src: await upload(file), alt: file.name.replace(/\.[^.]+$/, '') || '图片'}));
        return nodes;
      }}));
      ctx.update(editorViewOptionsCtx, prev => ({...prev, scrollMargin: {top: 96, bottom: 200}, scrollThreshold: {top: 96, bottom: 200},
        handleClickOn: (pmView, pos, node) => {
          if (node.type.name !== 'studio_ruby') return false;
          editRuby({...node.attrs}, result => {
            if (!result) return;
            const tr = result.base && result.reading ? pmView.state.tr.setNodeMarkup(pos, null, result) : pmView.state.tr.replaceWith(pos, pos + node.nodeSize, pmView.state.schema.text(node.attrs.base || ' '));
            pmView.dispatch(tr); pmView.focus();
          });
          return true;
        }}));
    })
    .use(rubyRemark).use(rubySchema).use(imeSlash);
  crepe.on(api => api.updated((ctx, doc, previous) => { if (ready && previous && !sameDoc(doc, previous)) onChange(); }));

  // Unchanged top-level blocks keep their original Markdown text, so editing one paragraph
  // never reformats the rest of an older article.
  function snapshot(ctx) {
    const doc = ctx.get(editorViewCtx).state.doc, remark = ctx.get(remarkCtx);
    let tree; try { tree = remark.runSync(remark.parse(value), value); } catch (_) { return null; }
    const blocks = tree.children;
    if (blocks.length !== doc.childCount && !(blocks.length + 1 === doc.childCount && !doc.lastChild.content.size)) return null;
    return blocks.map((block, index) => {
      const start = block.position?.start?.offset, end = block.position?.end?.offset;
      return {node: doc.child(index), start, end, source: Number.isInteger(start) && Number.isInteger(end) ? value.slice(start, end) : null};
    });
  }
  function getMarkdown() {
    return withCtx(ctx => {
      const doc = ctx.get(editorViewCtx).state.doc;
      if (!baseline) return tidy(ctx.get(serializerCtx)(doc));
      let output = '', previous = -2, pointer = 0, first = true;
      doc.forEach(node => {
        let match = -1;
        for (let k = pointer; k < Math.min(baseline.length, pointer + 80); k++) if (baseline[k].source !== null && sameNode(baseline[k].node, node)) { match = k; break; }
        if (match < 0 && node.type.name === 'paragraph' && !node.content.size) return;
        let piece, gap = first ? '' : '\n\n';
        if (match >= 0) {
          piece = baseline[match].source;
          if (match === previous + 1 && previous >= 0) gap = value.slice(baseline[previous].end, baseline[match].start);
          else if (first && match === 0) gap = value.slice(0, baseline[0].start);
          else if (!first) { const indent = value.slice(value.lastIndexOf('\n', baseline[match].start - 1) + 1, baseline[match].start); if (/^[ \t]*$/.test(indent)) gap += indent; }
          previous = match; pointer = match + 1;
        } else { piece = tidy(serializeWith(ctx, node), node.type.name); previous = -2; }
        output += gap + piece; first = false;
      });
      if (!output) return '';
      // Keep the original ending (trailing newline or not) when the last block is untouched.
      return previous >= 0 && previous === baseline.length - 1 ? output + value.slice(baseline[previous].end) : output + (value && !value.endsWith('\n') ? '' : '\n');
    });
  }
  const ready$ = crepe.create().then(() => {
    withCtx(ctx => { view = ctx.get(editorViewCtx); baseline = snapshot(ctx); });
    ready = true; onReady?.();
  });
  return {
    ready: ready$,
    getMarkdown,
    get view() { return view; },
    headings: () => [...root.querySelectorAll('.ProseMirror :is(h1,h2,h3,h4,h5,h6)')],
    getSelection: () => view ? [view.state.selection.from, view.state.selection.to] : [0, 0],
    setSelection(from, to = from) { if (!view) return; const max = view.state.doc.content.size; view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, Math.min(from, max), Math.min(to, max))).scrollIntoView()); },
    // Top-level block index of the caret, used to keep the place when switching to source.
    blockIndex: () => view ? view.state.selection.$from.index(0) : 0,
    focusBlock(index) { if (!view) return; const doc = view.state.doc; let pos = 0; for (let i = 0; i < Math.min(index, doc.childCount - 1); i++) pos += doc.child(i).nodeSize; const sel = TextSelection.near(doc.resolve(Math.min(pos + 1, doc.content.size))); view.dispatch(view.state.tr.setSelection(sel).scrollIntoView()); view.focus(); },
    focus: () => view?.focus(),
    destroy: () => { ready = false; return crepe.destroy(); }
  };
}

// Offsets of top-level Markdown blocks, for mapping the caret between visual and source modes.
export function blockOffsets(text) {
  const offsets = []; let inFence = null, blank = true, offset = 0;
  for (const line of text.split('\n')) {
    const fence = line.match(/^ {0,3}(`{3,}|~{3,}|\$\$)/);
    if (inFence) { if (fence && fence[1][0] === inFence[0]) inFence = null; }
    else { if (blank && line.trim()) offsets.push(offset); if (fence) inFence = fence[1]; }
    blank = !line.trim() && !inFence; offset += line.length + 1;
  }
  return offsets;
}

const highlight = HighlightStyle.define([
  {tag: tags.heading, fontWeight: '650', color: 'var(--studio-text)'},
  {tag: [tags.heading1, tags.heading2], fontSize: '1.08em'},
  {tag: tags.strong, fontWeight: '700'}, {tag: tags.emphasis, fontStyle: 'italic'},
  {tag: tags.strikethrough, textDecoration: 'line-through'},
  {tag: [tags.link, tags.url], color: 'var(--studio-accent)'},
  {tag: [tags.processingInstruction, tags.contentSeparator, tags.meta, tags.punctuation], color: 'var(--studio-muted)'},
  {tag: tags.monospace, color: 'var(--studio-code)', fontFamily: 'var(--studio-mono)'},
  {tag: [tags.keyword, tags.operator], color: 'var(--studio-accent)'},
  {tag: [tags.string, tags.special(tags.string)], color: 'var(--studio-green)'},
  {tag: [tags.number, tags.bool, tags.atom], color: 'var(--studio-orange)'},
  {tag: [tags.comment, tags.quote], color: 'var(--studio-muted)', fontStyle: 'italic'},
  {tag: [tags.typeName, tags.className, tags.function(tags.variableName)], color: 'var(--studio-blue)'}
]);
export function createSource({parent, value, onChange, label = 'Markdown 原文'}) {
  const view = new EditorView({parent, state: EditorState.create({doc: value, extensions: [
    history(), drawSelection(), EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
    markdown({base: markdownLanguage, codeLanguages: languages}), syntaxHighlighting(highlight),
    cmPlaceholder('从这里开始写 Markdown…'),
    EditorView.contentAttributes.of({'aria-label': label, spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off'}),
    EditorView.scrollMargins.of(() => ({top: 96, bottom: 200})),
    EditorView.updateListener.of(update => { if (update.docChanged) onChange(); })
  ]})});
  return {
    view,
    getMarkdown: () => view.state.doc.toString(),
    setMarkdown(text) { view.dispatch({changes: {from: 0, to: view.state.doc.length, insert: text}}); },
    getSelection: () => [view.state.selection.main.anchor, view.state.selection.main.head],
    setSelection(from, to = from) { const max = view.state.doc.length; view.dispatch({selection: EditorSelection.single(Math.min(from, max), Math.min(to, max)), scrollIntoView: true}); },
    caretRect: () => view.coordsAtPos(view.state.selection.main.head),
    headings() {
      const list = []; let fence = null, offset = 0;
      for (const line of view.state.doc.toString().split('\n')) {
        const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
        if (marker) { if (!fence) fence = marker[1]; else if (marker[1][0] === fence[0]) fence = null; }
        else if (!fence) { const m = line.match(/^ {0,3}(#{1,6})\s+(.+)/); if (m) list.push({label: m[2].replace(/\s+#+\s*$/, ''), level: m[1].length, offset}); }
        offset += line.length + 1;
      }
      return list;
    },
    focus: () => view.focus(),
    destroy: () => view.destroy()
  };
}
window.StudioEditors = {createVisual, createSource, blockOffsets};
