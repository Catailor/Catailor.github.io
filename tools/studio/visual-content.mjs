import MarkdownIt from 'markdown-it';

const parser = new MarkdownIt({html: true});

export function scanImages(body){
  const lines=body.split('\n'),offsets=[0];for(const line of lines)offsets.push(offsets.at(-1)+line.length+1);
  let masked=body;
  for(const token of parser.parse(body,{}).filter(token=>['fence','code_block'].includes(token.type)&&token.map).reverse()){
    const start=offsets[token.map[0]],end=Math.min(body.length,offsets[token.map[1]]);
    masked=masked.slice(0,start)+' '.repeat(end-start)+masked.slice(end);
  }
  masked=masked.replace(/(`+)([^\n]*?)\1/g,match=>' '.repeat(match.length));
  const images=[];
  const pattern=/!\[([^\]\n]*)\]\((<[^>\n]+>|[^\s)]+)(?:\s+"([^"\n]*)")?\)/g;
  for(const match of masked.matchAll(pattern))images.push({start:match.index,end:match.index+match[0].length,alt:match[1],url:match[2].replace(/^<|>$/g,''),caption:match[3]||''});
  return images;
}

// Unsupported blocks remain editable as source inside the visual document.
// Restore them verbatim instead of letting the rich editor reinterpret them.
export function prepareVisualContent(value) {
  const lines = value.split('\n'), ranges = [], keys = new Set();
  let sourceLabel = '特殊原文';
  while (value.includes(sourceLabel)) sourceLabel += '块';
  const tokens = parser.parse(value, {});
  const hasDefinitions = /^ {0,3}\[[^\]]+\]:/m.test(value);
  // Link definitions have no output tokens, but must survive visual editing.
  const verbatim = tokens.filter(token => ['fence', 'code_block'].includes(token.type) && token.map);
  for (let start = 0; start < lines.length; start++) {
    if (!/^ {0,3}\[[^\]]+\]:/.test(lines[start]) || verbatim.some(token => start >= token.map[0] && start < token.map[1])) continue;
    let end = start + 1;
    while (end < lines.length && /^\s+\S/.test(lines[end])) end++;
    tokens.push({level: 0, type: 'source_definition', map: [start, end]});
  }
  tokens.sort((a, b) => (a.map?.[0] ?? Infinity) - (b.map?.[0] ?? Infinity));
  for (const token of tokens) {
    if (token.level !== 0 || !token.map || ['fence', 'code_block'].includes(token.type)) continue;
    const [start, end] = token.map;
    if (ranges.some(range => start < range.end)) continue;
    const raw = lines.slice(start, end).join('\n');
    const check = raw.replace(/`+[^`]*`+/g, '').replace(/\\[\s\S]/g, '').replace(/<br\s*\/?\s*>/gi, '');
    const captionedImage=/!\[[^\]]*\]\([^\n]+\s+"[^"\n]+"\)/.test(check);
    if (!captionedImage && !(hasDefinitions && check.includes('[')) && !/<\/?[a-zA-Z!]|{%|\[\^[^\]]+\]|^\s*\[[^\]]+\]:|^\s*\[toc\]|\$\$|\$[^\s$](?:[^$\n]*[^\s$])?\$/im.test(check)) continue;
    const key = sourceLabel;
    keys.add(key);
    const fence = '`'.repeat(Math.max(3, ...[...raw.matchAll(/`+/g)].map(match => match[0].length + 1)));
    ranges.push({start, end, text: `${fence}${key}\n${raw}\n${fence}`});
  }
  let markdown = value;
  for (const range of ranges.reverse()) lines.splice(range.start, range.end - range.start, range.text);
  if (ranges.length) markdown = lines.join('\n');
  return {
    markdown,
    hasSourceBlocks: keys.size > 0,
    isSourceLanguage: language => keys.has(language),
    restore(edited) {
      const result = edited.split('\n');
      const blocks = parser.parse(edited, {}).filter(token => token.type === 'fence' && keys.has(token.info.trim()));
      for (const block of blocks.reverse()) {
        result.splice(block.map[0], block.map[1] - block.map[0], block.content.replace(/\n$/, ''));
      }
      return result.join('\n');
    }
  };
}
