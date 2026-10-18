(() => {
  'use strict';
  const $ = id => document.getElementById(id), nameOf = id => id.split('/').pop();
  const taxonomy=window.StudioTaxonomy;
  const members=series=>taxonomy.members(series,all);
  const belongs=(series,id)=>members(series).some(p=>nameOf(p.id)===nameOf(id));
  const text = (tag,value,cls) => { const el = document.createElement(tag); el.textContent = value; if(cls) el.className = cls; return el; };
  const button = (label,action,cls) => { const el = text('button',label,cls); el.type='button'; el.addEventListener('click',()=>attempt(action)); return el; };
  const localGet = (key,fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  const localSet = (key,value) => { try { localStorage.setItem(key,JSON.stringify(value)); } catch (_) {} };
  let token='', current=null, all=[], collection={series:[],templates:[]}, view='recent', chosen=new Set(), editor=null, sourceEditor=null, editorEpoch=0;
  let dirty=false, saving=null, timer, editVersion=0, bodyChanged=false, loading=false, sourceMode=false, composing=false, busy=false, reviewed=null, privateUrl='', uploadCount=0;
  let positions=localGet('studio-positions',{}), openEpoch=0;
  let trashed=[], undoAction=null, managementBusy=false, viewChanging=false;
  function setLibrary(open){document.body.classList.toggle('library-collapsed',!open);document.body.classList.remove('nav-open');$('library-toggle').setAttribute('aria-expanded',String(open&&document.body.dataset.screen!=='desk'));}
  function syncScreen(){const screen=!$('editor').hidden?'paper':!$('private-panel').hidden?'private':'desk';if(document.body.dataset.screen!==screen){document.body.dataset.screen=screen;document.body.classList.remove('nav-open');}$('library-toggle').setAttribute('aria-expanded',String(screen!=='desk'&&!document.body.classList.contains('library-collapsed')));}
  for(const id of ['editor','private-panel'])new MutationObserver(syncScreen).observe($(id),{attributes:true,attributeFilter:['hidden']});
  let noticeTimer, noticeVersion=0;
  const pauseNotice=()=>clearTimeout(noticeTimer);
  function closeNotice(){pauseNotice();$('notice').hidden=true;undoAction=null;}
  function scheduleNotice(){pauseNotice();const panel=$('notice');if(!panel.hidden&&!document.hidden&&!panel.matches(':hover')&&!panel.contains(document.activeElement)&&!$('notice-undo').disabled)noticeTimer=setTimeout(closeNotice,undoAction?8000:5000);}
  function notice(message,undo=null){pauseNotice();noticeVersion++;$('notice-text').textContent=message;undoAction=undo;$('notice-undo').hidden=!undo;$('notice-undo').disabled=false;$('notice').hidden=false;scheduleNotice();}
  $('notice').addEventListener('pointerenter',pauseNotice);$('notice').addEventListener('pointerleave',scheduleNotice);
  $('notice').addEventListener('focusin',pauseNotice);$('notice').addEventListener('focusout',()=>queueMicrotask(scheduleNotice));
  document.addEventListener('visibilitychange',scheduleNotice);
  $('notice-close').onclick=closeNotice;
  $('notice-undo').onclick=()=>attempt(async()=>{if(!undoAction)return;const action=undoAction,version=noticeVersion;pauseNotice();$('notice-undo').disabled=true;try{await action();if(version===noticeVersion)closeNotice();}finally{if(version===noticeVersion){$('notice-undo').disabled=false;scheduleNotice();}}});
  const status = value => { $('save-status').textContent=value; $('save-status').title=value; };
  async function attempt(action) { try { return await action(); } catch(e) { status(e.message); } }
  async function api(route,data) {
    const response=await fetch('/api/'+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(data)});
    const result=await response.json(); if(!response.ok) throw new Error(result.error || '操作失败'); return result;
  }
  let visualContent=null;
  function body() { return sourceMode ? (sourceEditor ? sourceEditor.getMarkdown() : current?.body || '') : bodyChanged && editor ? visualContent.restore(editor.getMarkdown()) : current?.body || ''; }
  function fieldTaxonomy(kind){const previous=current?.[kind]||[];return $(kind).value===previous.join('，')?previous:taxonomy.split($(kind).value);}
  function values() { return {id:current.id,revision:current.revision,title:$('title').value,date:$('date').value,summary:$('summary').value,body:body(),categories:fieldTaxonomy('categories'),tags:fieldTaxonomy('tags'),kind:$('kind').value,topic:$('topic').value,link:validLink()?$('link').value.trim():undefined}; }
  // Link names become the address: catailor.github.io/YYYY/MM/DD/<link>/
  const LINK=/^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  function validLink(){const v=$('link').value.trim();return !v||(v.length<=80&&LINK.test(v));}
  function updateLinkPreview(){
    const v=$('link').value.trim(),day=($('date').value||'').replace(/-/g,'/');
    $('link').setAttribute('aria-invalid',String(!validLink()));
    $('link-preview').classList.toggle('is-error',!validLink());
    $('link-preview').textContent=!validLink()?'只用小写英文、数字和短横线，例如 japanese-day-1。':v?`文章地址：/${day}/${v}/`:current?.customPermalink?'这篇使用了自定义地址，留空即可保持不变。':'留空时使用文件名作为地址。起个好记的名字，分享时更清楚。';
    if(current?.link&&v!==current.link&&all.find(p=>nameOf(p.id)===nameOf(current.id))?.isPublished)$('link-preview').textContent+=' 旧地址会自动跳转到新地址。';
  }
  function suggestLink(){
    const words=($('title').value.normalize('NFKD').toLowerCase().match(/[a-z0-9]+/g)||[]).slice(0,6);
    const day=($('date').value||'').slice(5).replace('-','');
    const series=collection.series.find(s=>belongs(s,current.id));
    return words.length?words.join('-'):`${series?.id||$('kind').value||'note'}-${day}`.replace(/[^a-z0-9-]/g,'-').replace(/-+/g,'-');
  }
  function updateSummaryCount(){const n=$('summary').value.length;$('summary-count').textContent=n?`${n} / 500 字 · 首页和分享卡片会用到它`:'留空时自动摘取正文开头。';}
  function setNoteFields(source){$('kind').value=source.kind||'';$('topic').value=source.topic||'';$('link').value=source.link||'';updateLinkPreview();updateSummaryCount();}
  function remember() {
    if(!current || !$('private-panel').hidden) return;
    try { positions[nameOf(current.id)]={source:sourceMode,selection:sourceMode?sourceEditor?.getSelection():editor?.getSelection(),scroll:$('writing-scroll').scrollTop}; localSet('studio-positions',positions); } catch(_) {}
  }
  function changed(isBody=false) {
    if(loading || !current) return;
    if(isBody) bodyChanged=true;
    dirty=true;editVersion++;status('正在写…'); clearTimeout(timer);
    if(!composing) { localSet('studio-recovery-'+nameOf(current.id),values()); timer=setTimeout(()=>attempt(save),900); }
    if(!composing) { updateCount(); if(isBody) followCaret(); }
  }
  async function save() {
    clearTimeout(timer); if(composing) throw new Error('正在输入，文字确认后会自动保存');
    if(saving) { await saving; if(dirty) return save(); return; }
    if(!dirty || !current) return;
    const input=values(), version=editVersion; status('保存中…');
    saving=api('save',input).then(result=>{
      Object.assign(current,result); dirty=version!==editVersion;
      if(!dirty) { bodyChanged=false; try{localStorage.removeItem('studio-recovery-'+nameOf(current.id));}catch(_){} }
      status(dirty?'继续写作中…':'已保存到本机'); localSet('studio-last',current.id);
    }).finally(()=>{saving=null;});
    try { await saving; await refresh(); } catch(e) { dirty=true;status('保存失败：'+e.message);throw e; }
    if(dirty) return save();
  }
  async function refresh() { [all,collection,trashed]=await Promise.all([api('posts'),api('library'),api('trash')]);renderTaxonomyFilters();renderNav();renderList();renderMembership();updateState();renderEmpty(); }
  function vocabulary(kind){return [...new Set([...all.flatMap(p=>p[kind]||[]),...collection.series.flatMap(s=>[...(s.defaults?.[kind]||[]),...(s.rule?.[kind]||[])])])].sort((a,b)=>a.localeCompare(b,'zh-CN'));}
  function renderTaxonomyFilters(){
    for(const [id,kind] of [['category-filter','categories'],['tag-filter','tags']]){
      const select=$(id),value=select.value;select.replaceChildren();
      const options=[['',kind==='categories'?'全部分类':'全部标签'],['__empty',kind==='categories'?'未分类':'没有标签'],...vocabulary(kind).map(v=>[v,v])];
      if(kind==='categories')for(const name of taxonomy.categoryNames(vocabulary(kind)))if(!options.some(([v])=>v===name))options.push([name,name]);
      for(const [v,label] of options){const option=text('option',label);option.value=v;select.append(option);}
      if(value&&!options.some(([v])=>v===value)){const option=text('option',value);option.value=value;select.append(option);}select.value=value;
    }
  }
  function taxonomyInput(input,kind){
    input.setAttribute('aria-label',input.labels?.[0]?.firstChild?.textContent?.trim()||(kind==='categories'?'分类':'标签'));
    const suggestions=text('div','','taxonomy-suggestions');suggestions.hidden=true;input.after(suggestions);
    const show=()=>{const values=taxonomy.split(input.value),query=/[,，;；]\s*$/.test(input.value)?'':values.at(-1)||'',used=values.slice(0,query?-1:undefined);suggestions.replaceChildren();
      const choices=vocabulary(kind).filter(v=>!used.includes(v)&&v.toLowerCase().includes(query.toLowerCase())).slice(0,8);
      for(const value of choices){const choose=button(value,()=>{input.value=[...new Set([...used,value])].join('，')+'，';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();});choose.onpointerdown=e=>e.preventDefault();suggestions.append(choose);}
      suggestions.hidden=!choices.length;
    };
    input.addEventListener('focus',show);input.addEventListener('input',show);input.addEventListener('blur',()=>setTimeout(()=>suggestions.hidden=true,100));
    input.addEventListener('keydown',e=>{if(e.key==='Escape')suggestions.hidden=true;});
  }
  function activeSeries() { return collection.series.find(s=>view==='series:'+s.id); }
  function renderNav() {
    document.querySelectorAll('[data-view]').forEach(b=>b.toggleAttribute('aria-current',b.dataset.view===view));
    $('series-nav').replaceChildren();
    for(const s of [...collection.series].sort((a,b)=>Number(b.favorite)-Number(a.favorite))) {
      const el=button((s.favorite?'★ ':'')+s.title,()=>setView('series:'+s.id));el.toggleAttribute('aria-current',view==='series:'+s.id);$('series-nav').append(el);
    }
  }
  function filtered() {
    const s=activeSeries(), q=$('filter').value.trim().toLowerCase(); let items=[...all];
    if(view==='trash')return trashed.filter(p=>(p.title+' '+p.date).toLowerCase().includes(q));
    if(s) items=members(s);
    else if(view==='draft') items=items.filter(p=>!p.isPublished);
    else if(view==='published') items=items.filter(p=>p.isPublished);
    else if(view==='recent') items.sort((a,b)=>b.modified-a.modified||a.id.localeCompare(b.id));
    return items.filter(p=>{
      const cat=$('category-filter').value,tag=$('tag-filter').value,cats=p.categories||[],tags=p.tags||[];
      return (!cat||(cat==='__empty'?!cats.length:cats.includes(cat)||taxonomy.categoryNames(cats).includes(cat)))&&(!tag||(tag==='__empty'?!tags.length:tags.includes(tag)))&&(p.title+' '+p.date+' '+cats.join(' ')+' '+tags.join(' ')).toLowerCase().includes(q);
    });
  }
  const labels={draft:'草稿',changed:'有未发布修改',published:'已发布',pending:'发布中'};
  function renderList() {
    const s=activeSeries();$('view-title').textContent=s?s.title:({recent:'最近写过',all:'全部文章',draft:'草稿',published:'已发布',trash:'回收站'}[view]||'文章');
    $('view-description').textContent=s?(s.description||'把相连的想法，慢慢写成一个系列。'):'从上次停下的地方继续。';
    if(view==='recent')$('view-description').textContent='按最后修改时间排序，最近保存的文章排在最前。';
    if(view==='trash')$('view-description').textContent='删除的草稿保留在本机，可随时恢复。';
    else if(s?.rule)$('view-description').textContent=(s.description?s.description+' · ':'')+'自动收集已开启，手动添加的文章排在前面。';
    $('taxonomy-filters').hidden=view==='trash';
    $('series-settings').hidden=$('series-actions').hidden=!s;
    $('post-list').replaceChildren(); const items=filtered();$('list-empty').hidden=!!items.length;
    $('result-count').textContent=`${items.length} 篇`;$('select-filtered').disabled=!items.length;$('list-empty').textContent=($('filter').value||$('category-filter').value||$('tag-filter').value)?'没有匹配文章，试试清除筛选。':view==='trash'?'回收站是空的。':'这里还没有文章，写下第一篇吧。';
    for(const post of items) {
      const row=text('div','', 'post-row'+(current&&nameOf(post.id)===nameOf(current.id)?' active':''));row.dataset.status=view==='trash'?'trash':post.status||'';
      const selection=view==='trash'?post.key:post.id;
      const check=document.createElement('input');check.type='checkbox';check.checked=chosen.has(selection);check.setAttribute('aria-label','选择 '+(post.title||'无标题'));
      check.onchange=()=>{check.checked?chosen.add(selection):chosen.delete(selection);renderBatch();};
      const open=button('',()=>view==='trash'?postMenu(post):openId(post.id),'post-open');open.append(text('strong',post.title||'无标题'),text('small',(view==='trash'?'已删除 · '+post.deleted.slice(0,10):labels[post.status]+' · '+(view==='recent'?'修改于 '+new Date(post.modified).toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}):post.date))));row.append(check,open);
      if(view!=='trash'&&((post.categories||[]).length||(post.tags||[]).length)){const meta=text('small',[...(post.categories||[]),...(post.tags||[]).map(t=>'#'+t)].join(' · '),'post-taxonomy');meta.title=meta.textContent;open.append(meta);}
      const more=button('管理',()=>postMenu(post),'post-more');more.setAttribute('aria-label','管理文章 '+(post.title||'无标题'));row.append(more);
      if(s) {
        row.draggable=!$('filter').value&&!$('category-filter').value&&!$('tag-filter').value&&s.posts.includes(nameOf(post.id));
        if(row.draggable){const handle=text('span','⠿','post-drag-handle');handle.title='拖动调整顺序，也可在管理菜单中上移或下移';handle.setAttribute('aria-hidden','true');row.prepend(handle);}
        row.ondragstart=e=>{e.dataTransfer.setData('text/plain',nameOf(post.id));row.classList.add('dragging');};
        row.ondragend=()=>row.classList.remove('dragging');row.ondragover=e=>{e.preventDefault();row.classList.add('drop-target');};row.ondragleave=()=>row.classList.remove('drop-target');
        row.ondrop=e=>{e.preventDefault();row.classList.remove('drop-target');const from=e.dataTransfer.getData('text/plain'),to=nameOf(post.id);if(from===to||!s.posts.includes(from)||!s.posts.includes(to))return;attempt(async()=>{const next=structuredClone(collection),target=next.series.find(x=>x.id===s.id);target.posts.splice(target.posts.indexOf(from),1);target.posts.splice(target.posts.indexOf(to),0,from);await putLibrary(next);});};
      }
      $('post-list').append(row);
    }
    renderBatch();
  }
  function renderBatch(){ $('batch-bar').hidden=!chosen.size;$('batch-count').textContent=`已选 ${chosen.size} 篇`;$('batch-add').disabled=!chosen.size;$('batch-add').hidden=$('batch-trash').hidden=$('batch-taxonomy').hidden=view==='trash';$('batch-restore').hidden=view!=='trash'; }
  async function discardCurrentEmpty(){if(!current||dirty||busy||current.title.trim()||current.body.trim()||current.summary.trim())return;const result=await api('discard-empty',{id:current.id,revision:current.revision});if(result.discarded){clearCurrent();await refresh();}}
  function clearCurrent(){clearTimeout(timer);if(current){try{localStorage.removeItem('studio-recovery-'+nameOf(current.id));localStorage.removeItem('studio-last');}catch(_){}}current=null;dirty=false;bodyChanged=false;$('editor').hidden=$('article-actions').hidden=true;$('empty').hidden=false;$('document-state').textContent='留一页给今天';status('');}
  async function setView(next) {
    if(managementBusy)throw new Error('正在整理，请稍候');if(viewChanging)return;viewChanging=true;document.querySelector('.library').inert=true;$('category-filter').disabled=$('tag-filter').disabled=true;
    try{await save();remember();await discardCurrentEmpty();view=next;setLibrary(true);localSet('studio-view',view);chosen.clear();$('filter').value=$('category-filter').value=$('tag-filter').value='';renderNav();renderList();}
    finally{viewChanging=false;document.querySelector('.library').inert=false;$('category-filter').disabled=$('tag-filter').disabled=false;}
  }
  function updateState() {
    if(current)$('article-delete').querySelector('span').textContent=all.find(p=>nameOf(p.id)===nameOf(current.id))?.isPublished?'撤回为草稿':'移到回收站';
    if(!current || !$('private-panel').hidden)return;const post=all.find(p=>nameOf(p.id)===nameOf(current.id));
    $('document-state').textContent=post?labels[post.status]:'草稿';
    $('publish').querySelector('span').textContent=post?.status==='published'?'发布更新':'发布';
    const joined=collection.series.filter(s=>belongs(s,current.id));$('article-series').textContent=joined.length?joined.map(s=>s.title).join(' · '):'＋ 加入系列';
    $('article-taxonomy').replaceChildren();for(const label of [...taxonomy.split($('categories').value),...taxonomy.split($('tags').value).map(t=>'#'+t)])$('article-taxonomy').append(button(label,()=>toggleDrawer('settings')));
  }
  function updateCount(){if(!current)return;sizeSource();const content=body().replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/<[^>]*>/g,'').replace(/[#*`>|_~]/g,'');const count=(content.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)||[]).length+(content.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)||[]).length;$('word-count').textContent=count?`约 ${count} 字 · ${Math.ceil(count/300)} 分钟`:'0 字';const hasSections=sourceMode?sourceHeadings().length>1:(editor?.headings().length||0)>1;$('outline-toggle').hidden=!hasSections;if(!hasSections)$('outline').hidden=true;if(!$('outline').hidden)renderOutline();}
  function updateModeButton(){ const b=$('mode-toggle');b.setAttribute('aria-pressed',String(sourceMode));b.querySelector('span').textContent=sourceMode?'排版':'源码';b.querySelector('use').setAttribute('href',sourceMode?'#i-type':'#i-code');b.title=sourceMode?'回到排版编辑 · Ctrl /':'切换到 Markdown 源码 · Ctrl /';$('mode-label').textContent=sourceMode?'Markdown 源码':''; }
  // Visual writing uses Milkdown Crepe; source mode uses CodeMirror. Both are created fresh per article.
  async function loadEditor(value,forceSource=false) {
    const epoch=++editorEpoch;loading=true;sourceMode=forceSource;visualContent=window.prepareVisualContent(value);
    if(editor){const old=editor;editor=null;Promise.resolve().then(()=>old.destroy()).catch(()=>{});}
    if(sourceEditor){sourceEditor.destroy();sourceEditor=null;}
    $('rich-editor').replaceChildren();$('source-editor').replaceChildren();
    $('rich-editor').hidden=sourceMode;$('source-editor').hidden=!sourceMode;updateModeButton();
    $('compatibility').textContent='{% %} 标签、HTML、脚注等特殊内容以「特殊原文」代码块显示，可直接修改原文；其余内容所见即所得。';
    $('compatibility').hidden=sourceMode||!visualContent.hasSourceBlocks;
    try{
      if(sourceMode)sourceEditor=window.StudioEditors.createSource({parent:$('source-editor'),value,onChange:()=>{if(!loading){changed(true);$('compatibility').hidden=true;}}});
      else{
        const root=document.createElement('div');root.className='studio-visual';$('rich-editor').append(root);
        const instance=window.StudioEditors.createVisual({root,value:visualContent.markdown,onChange:()=>changed(true),upload:uploadFromEditor,editRuby});
        editor=instance;await instance.ready;
      }
    }finally{if(epoch===editorEpoch)loading=false;}
    return epoch===editorEpoch;
  }
  async function uploadFromEditor(file){
    const id=current?.id;uploadCount++;status('正在插入图片…');
    try{const url=await upload(file);if(current?.id!==id)throw new Error('图片已上传，请在原文章中重新插入');status('图片已插入');return url;}
    catch(error){status(error.message);throw error;}finally{uploadCount--;}
  }
  // Furigana dialog: [漢字]{かんじ}. Clearing the reading removes the ruby.
  function editRuby(attrs,done){
    const clean=value=>String(value||'').replace(/[\[\]{}\r\n]/g,'').trim();
    form(attrs.reading?'修改注音':'添加注音（振り仮名）',[{key:'base',label:'汉字',value:attrs.base,required:true,max:40},{key:'reading',label:'读音（假名）',value:attrs.reading,max:60,hint:attrs.reading?'清空读音会去掉注音，只保留汉字。':'例如：漢字 → かんじ。正文里写作 [漢字]{かんじ}。'}],async data=>done({base:clean(data.base),reading:clean(data.reading)}),'完成');
    if(attrs.base)requestAnimationFrame(()=>$('field-reading')?.focus());
  }
  async function openId(id) {
    if(managementBusy)throw new Error('正在整理，请稍候');
    if(uploadCount)throw new Error('图片正在插入，完成后即可切换文章');
    const epoch=++openEpoch;
    await save();remember();if(current&&nameOf(current.id)!==nameOf(id))await discardCurrentEmpty();const post=await api('post?id='+encodeURIComponent(id));
    await save();if(epoch!==openEpoch)return;
    current=post;dirty=false;bodyChanged=false;editVersion=0;
    setLibrary(false);$('settings').hidden=!localGet('studio-properties',false)||innerWidth<1180;$('outline').hidden=true;$('more-menu').hidden=true;
    $('empty').hidden=$('private-panel').hidden=true;$('editor').hidden=$('article-actions').hidden=false;$('private-actions').hidden=true;
    ['title','date','summary'].forEach(k=>$(k).value=post[k]);
    ['categories','tags'].forEach(k=>$(k).value=(post[k]||[]).join('，'));setNoteFields(post);
    const recovery=localGet('studio-recovery-'+nameOf(id),null);let recovered=false;
    if(recovery && recovery.revision===post.revision){['title','date','summary'].forEach(k=>$(k).value=recovery[k]);['categories','tags'].forEach(k=>{if(recovery[k])$(k).value=recovery[k].join('，');});setNoteFields({...post,...Object.fromEntries(['kind','topic','link'].filter(k=>recovery[k]!==undefined).map(k=>[k,recovery[k]]))});post.body=recovery.body;recovered=true;}
    else if(recovery){recoveryDialog(recovery);}
    const position=positions[nameOf(id)];const loaded=await loadEditor(post.body,position?.source);if(!loaded||epoch!==openEpoch)return;
    localSet('studio-last',post.id);
    renderList();renderMembership();updateState();updateCount();status(recovered?'已恢复上次未保存的文字':'已保存到本机');
    if(recovered)changed(true);
    requestAnimationFrame(()=>{sizeTitle();if(position){try{(sourceMode?sourceEditor:editor)?.setSelection(...position.selection);}catch(_){}$('writing-scroll').scrollTop=position.scroll||0;}});
  }
  function recoveryDialog(recovery){form('上次未保存的内容',[{key:'body',label:'原文章在别处改动过。可将这份内容保存为另一篇草稿。',value:recovery.body,type:'textarea',rows:12}],async data=>{const draft=await api('new',{});await api('save',{...draft,title:recovery.title,summary:recovery.summary,date:recovery.date,body:data.body,categories:recovery.categories||draft.categories,tags:recovery.tags||draft.tags});localStorage.removeItem('studio-recovery-'+nameOf(recovery.id));await refresh();await openId(draft.id);},'保存为另一篇草稿');}
  async function newPost(template) {if(managementBusy)throw new Error('正在整理，请稍候');await save();const doc=await api('new',{template,series:activeSeries()?.id});await refresh();await openId(doc.id);$('title').focus();}
  function postMenu(post){
    $('post-menu-title').textContent=post.title||'无标题';$('post-menu-actions').replaceChildren();
    const add=(label,action,cls)=>$('post-menu-actions').append(button(label,async()=>{$('post-menu').close();await action();},cls));
    if(view==='trash'&&post.key)add('恢复文章',()=>restorePosts([post.key]));
    else {
      add('加入系列',()=>addToSeries([post.id]));
      add('修改分类和标签',()=>batchTaxonomy([post.id]));
      const series=activeSeries();if(series){if(series.posts.includes(nameOf(post.id))){add('上移一篇',()=>move(series,nameOf(post.id),-1));add('下移一篇',()=>move(series,nameOf(post.id),1));}else add('加入手动排序',async()=>{const next=structuredClone(collection);next.series.find(s=>s.id===series.id).posts.push(nameOf(post.id));await putLibrary(next);});add('移出当前系列（保留文章）',()=>removeFrom(series,nameOf(post.id)));}
      if(post.isPublished)add('撤回为草稿',()=>review({id:post.id,withdraw:true}),'danger');
      else add('移到回收站',()=>requestTrash([post.id]),'danger');
    }
    $('post-menu').showModal();
  }
  function requestTrash(ids){
    if(busy)throw new Error('发布完成后可以删除文章');
    if(ids.some(id=>all.find(p=>p.id===id)?.isPublished))throw new Error('所选包含已发布文章，请先打开文章，在「···」菜单撤回为草稿，再删除');
    form('移到回收站',[],()=>trashPosts(ids),`删除 ${ids.length} 篇草稿`);
    $('dialog-fields').append(text('p','文章和系列位置会保存在本机回收站，可以恢复。'));
  }
  async function trashPosts(ids){
    if(managementBusy)throw new Error('正在整理，请稍候');managementBusy=true;$('editor').inert=true;
    try {
      await save();
      const items=ids.map(id=>{const post=all.find(p=>p.id===id);if(!post)throw new Error('文章已变更，请刷新后重试');return {id,revision:current&&nameOf(current.id)===nameOf(id)?current.revision:post.revision};});
      const entries=await api('trash',{items});
      if(current&&entries.some(e=>nameOf(e.id)===nameOf(current.id)))clearCurrent();
      chosen.clear();await refresh();setLibrary(true);
      notice(`已将 ${entries.length} 篇草稿移到回收站`,()=>restorePosts(entries.map(e=>e.key)));
    } finally {managementBusy=false;$('editor').inert=false;}
  }
  async function restorePosts(keys){
    let restored=0;
    try{for(const key of keys){await api('restore',{key});chosen.delete(key);restored++;}}
    finally{await refresh();if(restored)status(`已恢复 ${restored} 篇草稿，可在“草稿”中继续写`);}
  }
  function batchTaxonomy(ids){
    const fields=[];
    for(const [kind,label] of [['categories','分类'],['tags','标签']]){
      fields.push({key:kind+'Mode',label:label+'处理方式',type:'select',value:'keep',options:[{value:'keep',label:'保持原样'},{value:'add',label:'追加，不移除原来的名称'},{value:'replace',label:'替换为以下名称（留空则清空）'},{value:'remove',label:'移除以下名称'}]});
      fields.push({key:kind,label:label+'名称',taxonomy:kind,value:'',hint:'多个名称用逗号分隔。'});
    }
    form(`整理 ${ids.length} 篇文章`,fields,async data=>{
      const result=await manageTaxonomy(async()=>{
        const items=ids.map(id=>{const post=all.find(p=>nameOf(p.id)===nameOf(id));if(!post)throw new Error('文章已改变，请刷新列表');return {id:post.id,revision:post.revision};});
        return api('taxonomy',{items,categories:{mode:data.categoriesMode,values:taxonomy.split(data.categories)},tags:{mode:data.tagsMode,values:taxonomy.split(data.tags)}});
      });
      notice(result.changed.length?`已整理 ${result.changed.length} 篇文章，发布后才更新网页`:'分类和标签没有变化',result.undo?()=>manageTaxonomy(()=>api('taxonomy-undo',{key:result.undo})):null);
    },'保存到本机');
    $('dialog-fields').prepend(text('p','只修改分类和标签，正文保持原样。已发布文章需要再次发布才会更新网页。','muted'));
    for(const kind of ['categories','tags']){const update=()=>{$('field-'+kind).disabled=$('field-'+kind+'Mode').value==='keep';};$('field-'+kind+'Mode').addEventListener('change',update);update();}
  }
  async function manageTaxonomy(action){
    if(managementBusy)throw new Error('正在整理，请稍候');managementBusy=true;$('editor').inert=true;
    try{await save();const result=await action(),updated=current&&result.changed.find(p=>nameOf(p.id)===nameOf(current.id));
      if(updated){Object.assign(current,updated);['categories','tags'].forEach(k=>$(k).value=updated[k].join('，'));}
      chosen.clear();await refresh();return result;
    }finally{managementBusy=false;$('editor').inert=false;}
  }
  async function putLibrary(next) {const previous=structuredClone(collection);try{collection=await api('library',next);}catch(e){collection=await api('library');renderNav();renderList();throw e;}const savedRevision=collection.revision;notice('整理已保存到本机',async()=>{const latest=await api('library');if(latest.revision!==savedRevision)throw new Error('之后还有新的整理操作，不能覆盖；请手动调整');collection=await api('library',{...previous,revision:latest.revision});await refresh();});renderNav();renderList();renderMembership();updateState();}
  async function move(series,name,offset) {const next=structuredClone(collection),s=next.series.find(x=>x.id===series.id),i=s.posts.indexOf(name),j=i+offset;if(i<0||j<0||j>=s.posts.length)return;[s.posts[i],s.posts[j]]=[s.posts[j],s.posts[i]];await putLibrary(next);}
  async function removeFrom(series,name){const next=structuredClone(collection),s=next.series.find(s=>s.id===series.id);s.posts=series.posts.filter(n=>n!==name);if(s.rule)s.excluded=[...new Set([...(s.excluded||[]),name])];await putLibrary(next);status('已移出系列，文章仍在“全部文章”里');}
  function renderMembership(){
    $('membership').replaceChildren();if(!current)return;
    for(const s of collection.series){const label=text('label',''),check=document.createElement('input');check.type='checkbox';check.checked=belongs(s,current.id);check.onchange=()=>attempt(async()=>{const name=nameOf(current.id);if(!check.checked)return removeFrom(s,name);const next=structuredClone(collection),member=next.series.find(x=>x.id===s.id);member.posts=[...new Set([...member.posts,name])];member.excluded=(member.excluded||[]).filter(n=>n!==name);await putLibrary(next);});label.append(check,text('span',s.title+(check.checked&&!s.posts.includes(nameOf(current.id))?' · 自动':'')));$('membership').append(label);}
  }
  let formAction=null, extraAction=null;
  function form(title,fields,action,submit='保存',extra=null) {
    $('dialog-title').textContent=title;$('dialog-submit').textContent=submit;$('dialog-error').textContent='';$('dialog-fields').replaceChildren();
    const groups=new Map();
    for(const f of fields){const label=text('label',f.label),input=document.createElement(f.type==='textarea'?'textarea':f.type==='select'?'select':'input');input.name=f.key;input.id='field-'+f.key;if(f.type==='select'){for(const option of f.options){const el=text('option',option.label);el.value=option.value;input.append(el);}}else{if(f.type!=='textarea')input.type=f.type||'text';input.maxLength=f.max||200000;if(f.rows)input.rows=f.rows;}if(f.value!==undefined)input.value=f.value;input.required=!!f.required;label.append(input);
      let parent=$('dialog-fields');if(f.group){if(!groups.has(f.group)){const group=text('details','','form-section');group.open=!!f.open;group.append(text('summary',f.group));groups.set(f.group,group);parent.append(group);}parent=groups.get(f.group);}parent.append(label);if(f.taxonomy)taxonomyInput(input,f.taxonomy);if(f.hint)label.append(text('small',f.hint,'muted'));
    }
    formAction=action;extraAction=extra?.action;$('dialog-extra').hidden=!extra;$('dialog-extra').textContent=extra?.label||'';$('form-dialog').showModal();
  }
  $('dialog-form').onsubmit=async e=>{e.preventDefault();$('dialog-submit').disabled=true;try{await formAction(Object.fromEntries(new FormData(e.currentTarget)));$('form-dialog').close();}catch(error){$('dialog-error').textContent=error.message;}finally{$('dialog-submit').disabled=false;}};
  $('dialog-extra').onclick=()=>attempt(extraAction);
  function seriesForm(series=null,articles=[],initialTitle=''){
    const defaults=series?.defaults||{},rule=series?.rule,defaultGroup='新文章默认设置（选填）',ruleGroup='自动收集文章（选填）';
    form(series?'编辑系列':'新建系列',[
      {key:'title',label:'系列名称',value:series?.title||initialTitle,required:true,max:100},
      {key:'description',label:'简介（可不填）',value:series?.description,type:'textarea',rows:3,max:500},
      {key:'favorite',label:'侧栏位置',type:'select',value:series?.favorite?'yes':'no',options:[{value:'no',label:'普通系列'},{value:'yes',label:'收藏，放在前面'}]},
      {key:'homepage',label:'在网站首页展示',type:'select',value:(series?.homepage??series?.id==='japanese')?'yes':'no',options:[{value:'no',label:'不展示'},{value:'yes',label:'展示最近三篇'}],group:'首页展示（选填）'},
      {key:'homeOrder',label:'展示顺序（数字小的在前）',type:'number',value:series?.homeOrder||0,group:'首页展示（选填）'},
      {key:'defaultCategories',label:'默认分类',value:(defaults.categories||[]).join('，'),taxonomy:'categories',group:defaultGroup,open:!!(defaults.categories?.length||defaults.tags?.length),hint:'仅用于在这个系列里新建文章，不改动已有文章。'},
      {key:'defaultTags',label:'默认标签',value:(defaults.tags||[]).join('，'),taxonomy:'tags',group:defaultGroup},
      {key:'ruleMode',label:'收集方式',type:'select',value:rule?'auto':'manual',options:[{value:'manual',label:'只保留手动加入的文章'},{value:'auto',label:'持续收集符合条件的文章'}],group:ruleGroup,open:!!rule},
      {key:'ruleCategories',label:'收集这些分类',value:(rule?.categories||[]).join('，'),taxonomy:'categories',group:ruleGroup},
      {key:'ruleTags',label:'收集这些标签',value:(rule?.tags||[]).join('，'),taxonomy:'tags',group:ruleGroup},
      {key:'ruleMatch',label:'匹配方式',type:'select',value:rule?.match||'any',options:[{value:'any',label:'满足任意一个分类或标签'},{value:'all',label:'同时满足所有分类和标签'}],group:ruleGroup},
      {key:'ruleOrder',label:'自动收集的文章顺序',type:'select',value:rule?.order||'newest',options:[{value:'newest',label:'新的在前'},{value:'oldest',label:'旧的在前'}],group:ruleGroup}
    ],async data=>{
      const next=structuredClone(collection),id=series?.id||'series-'+crypto.randomUUID();
      const settings={homepage:data.homepage==='yes',homeOrder:Number(data.homeOrder)||0,title:data.title,description:data.description,favorite:data.favorite==='yes',defaults:{categories:taxonomy.split(data.defaultCategories),tags:taxonomy.split(data.defaultTags)},rule:data.ruleMode==='auto'?{categories:taxonomy.split(data.ruleCategories),tags:taxonomy.split(data.ruleTags),match:data.ruleMatch,order:data.ruleOrder}:null};
      if(series)Object.assign(next.series.find(s=>s.id===id),settings);
      else next.series.push({id,...settings,posts:[...new Set(articles.map(nameOf))],excluded:[]});
      await putLibrary(next);await setView('series:'+id);
    },series?'保存系列':'创建系列',series?{label:'解散系列',action:()=>{if(!confirm('解散这个系列？文章会保留在全部文章中。'))return;return attempt(async()=>{const next=structuredClone(collection);next.series=next.series.filter(s=>s.id!==series.id);await putLibrary(next);$('form-dialog').close();await setView('all');});}}:null);
    const hint=text('p','','rule-preview');$('field-ruleOrder').closest('details').append(hint);
    const previewRule=()=>{const auto=$('field-ruleMode').value==='auto';['ruleCategories','ruleTags','ruleMatch','ruleOrder'].forEach(k=>$('field-'+k).disabled=!auto);
      const proposed={...(series||{posts:[]}),rule:{categories:taxonomy.split($('field-ruleCategories').value),tags:taxonomy.split($('field-ruleTags').value),match:$('field-ruleMatch').value,order:$('field-ruleOrder').value}};
      const found=members(proposed).filter(p=>!(proposed.posts||[]).includes(nameOf(p.id)));hint.textContent=auto?`当前可自动收集 ${found.length} 篇，其中 ${found.filter(p=>!p.isPublished).length} 篇是草稿。网页只显示已发布文章；手动移出的文章不会重新加入。`:'只保留手动加入的文章。新文章默认设置与自动收集相互独立。';
    };
    ['ruleMode','ruleCategories','ruleTags','ruleMatch','ruleOrder'].forEach(k=>$('field-'+k).addEventListener('input',previewRule));previewRule();
  }
  function addToSeries(ids){form('加入系列',[{key:'search',label:'查找系列',placeholder:'输入系列名称'},{key:'series',label:`把 ${ids.length} 篇文章放入`,type:'select',options:[...collection.series.map(s=>({value:s.id,label:s.title})),{value:'__new',label:'＋ 新建一个系列'}]}],async data=>{
    if(data.series==='__new'){setTimeout(()=>seriesForm(null,ids,data.search),0);return;}
    const next=structuredClone(collection),s=next.series.find(s=>s.id===data.series);s.posts=[...new Set([...s.posts,...ids.map(nameOf)])];s.excluded=(s.excluded||[]).filter(n=>!ids.map(nameOf).includes(n));await putLibrary(next);chosen.clear();renderList();status('已加入系列');
  },'加入');$('field-search').oninput=()=>{const query=$('field-search').value.trim().toLowerCase();for(const option of $('field-series').options)option.hidden=option.value!=='__new'&&!option.textContent.toLowerCase().includes(query);const first=[...$('field-series').options].find(option=>!option.hidden);if(first)$('field-series').value=first.value;};}

  function templateForm(template=null,fromArticle=false){$('template-dialog').close();return form(template?'编辑模板':'新建模板',[{key:'title',label:'模板名称',required:true,value:template?.title,max:100},{key:'body',label:'模板内容（也可以写好文章后“存为模板”）',value:fromArticle?body():template?.body,type:'textarea',rows:12},{key:'favorite',label:'显示位置',type:'select',value:template?.favorite?'yes':'no',options:[{value:'no',label:'普通模板'},{value:'yes',label:'收藏，放在前面'}]}],async data=>{
    const next=structuredClone(collection),item={id:template?.id||'template-'+crypto.randomUUID(),title:data.title,body:data.body,favorite:data.favorite==='yes'};
    if(template)next.templates[next.templates.findIndex(t=>t.id===template.id)]=item;else next.templates.push(item);await putLibrary(next);status('模板已保存，下次可直接使用');
  },'保存模板',template?{label:'删除模板',action:()=>attempt(async()=>{if(!confirm('删除这个模板？用它写过的文章不会受影响。'))return;const next=structuredClone(collection);next.templates=next.templates.filter(t=>t.id!==template.id);await putLibrary(next);$('form-dialog').close();})}:null);}
  function templates(){
    $('template-list').replaceChildren();
    for(const t of [...collection.templates].sort((a,b)=>Number(b.favorite)-Number(a.favorite))){const card=text('div','','template-card');card.append(button((t.favorite?'★ ':'')+t.title,async()=>{$('template-dialog').close();await newPost(t.id);},'template-use'),text('small',t.body.replace(/[#>|*\n]/g,' ').slice(0,65)));const controls=text('div','','template-tools');controls.append(button(t.favorite?'取消收藏':'收藏',async()=>{const next=structuredClone(collection);next.templates.find(x=>x.id===t.id).favorite=!t.favorite;await putLibrary(next);templates();}),button('编辑',()=>templateForm(t)));card.append(controls);$('template-list').append(card);}
    if(!$('template-dialog').open)$('template-dialog').showModal();
  }
  function toggleDrawer(id,force){const open=force??$(id).hidden;if(open&&innerWidth<1180)$(id==='settings'?'outline':'settings').hidden=true;$(id).hidden=!open;if(id==='settings'){localSet('studio-properties',open);$('settings-toggle').setAttribute('aria-pressed',String(open));}if(id==='outline'){$('outline-toggle').setAttribute('aria-pressed',String(open));if(open)renderOutline();}}
  function sourceHeadings(){
    const headings=[];let offset=0,fence=null;
    for(const line of body().split('\n')){const marker=line.match(/^ {0,3}(\x60{3,}|~{3,})/);if(marker){if(!fence)fence=marker[1];else if(marker[1][0]===fence[0]&&marker[1].length>=fence.length&&/^\s*$/.test(line.slice(marker[0].length)))fence=null;}else if(!fence){const match=line.match(/^ {0,3}(#{1,6})\s+(.+)/);if(match)headings.push({label:match[2].replace(/\s+#+\s*$/,''),level:match[1].length,offset});}offset+=line.length+1;}return headings;
  }
  let caretFrame;
  function followCaret(){
    cancelAnimationFrame(caretFrame);
    caretFrame=requestAnimationFrame(()=>{
      if(composing || !current)return;
      const scroll=$('writing-scroll'),area=scroll.getBoundingClientRect();
      let rect;
      if(sourceMode){
        if(!sourceEditor?.view.hasFocus)return;rect=sourceEditor.caretRect();if(!rect)return;
      }else{
        const selection=getSelection();if(!selection?.rangeCount || !$('rich-editor').contains(selection.anchorNode))return;
        const range=selection.getRangeAt(0);if(!range.collapsed)return;
        rect=range.getBoundingClientRect();
        if(!rect.height)rect=(selection.anchorNode.nodeType===1?selection.anchorNode:selection.anchorNode.parentElement).getBoundingClientRect();
      }
      const bottom=area.bottom-Math.min(180,area.height*.25);
      if(rect.bottom>bottom)scroll.scrollTop+=rect.bottom-bottom;
    });
  }
  function sizeSource(){}
  function sizeTitle(){const t=$('title');t.style.height='auto';t.style.height=t.scrollHeight+'px';}
  function jumpSource(offset){if(!sourceEditor)return;sourceEditor.setSelection(offset);sourceEditor.focus();}
  function renderOutline(){
    $('outline-list').replaceChildren();if(!current)return;
    if(sourceMode){for(const heading of sourceHeadings()){const b=button(heading.label,()=>jumpSource(heading.offset));b.style.paddingLeft=(heading.level-1)*10+'px';$('outline-list').append(b);}}
    else (editor?.headings()||[]).forEach(h=>{const b=button(h.textContent,()=>h.scrollIntoView({behavior:'smooth',block:'center'}));b.style.paddingLeft=(Number(h.tagName[1])-1)*10+'px';$('outline-list').append(b);});
    if(!$('outline-list').children.length)$('outline-list').append(text('p','添加小标题后，会显示在这里。','muted'));
  }
  async function compressImage(file){
    if(file.size>20000000)throw new Error('原图请小于 20 MB');
    if(file.size<400000||!['image/jpeg','image/png'].includes(file.type))return file;
    const bitmap=await createImageBitmap(file);try{const scale=Math.min(1,1920/Math.max(bitmap.width,bitmap.height));const canvas=document.createElement('canvas');canvas.width=Math.round(bitmap.width*scale);canvas.height=Math.round(bitmap.height*scale);canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);const compressed=await new Promise(resolve=>canvas.toBlob(resolve,'image/webp',.85));return compressed&&compressed.size<file.size*.85?compressed:file;}finally{bitmap.close();}
  }
  async function showPublications(){
    const jobs=await api('publications');$('publications-list').replaceChildren();
    for(const job of jobs){const card=text('section','','publication-record');card.append(text('strong',({building:'正在构建',uploading:'正在上传',deploying:'等待上线',live:'已上线',error:'发布失败'})[job.state]||job.state),text('small',new Date(job.updated).toLocaleString('zh-CN')),text('p',job.state==='error'?'本次发布未完成，内容仍保存在本机。':job.message));
      if(job.state==='error'){const detail=document.createElement('details');detail.append(text('summary','查看失败原因'),text('pre',job.message,'publication-error'));card.append(detail);}
      if(['deploying','error'].includes(job.state)){const link=text('a','查看网站部署记录 ↗');link.href='https://github.com/Catailor/Catailor.github.io/actions';link.target='_blank';link.rel='noopener';card.append(link);}
      for(const item of job.items||[]){const post=all.find(p=>nameOf(p.id)===nameOf(item.id));card.append(text('p',post?.title||nameOf(item.id)));
        if(item.url&&job.state==='live'){const link=text('a','打开线上文章 ↗');link.href=item.url;link.target='_blank';link.rel='noopener';card.append(link);}
        if(job.state==='error'&&item.id==='source/private/vault.json')card.append(button('重新检查加密手记',async()=>{$('publications-dialog').close();await review({private:true});}));
        if(job.state==='error'&&post)card.append(button('重新检查并发布',async()=>{$('publications-dialog').close();await openId(post.id);await review({withdraw:item.action==='withdraw'});}));
      }
      if(job.state==='error'&&!job.items?.length)card.append(button('重新检查系列目录',async()=>{$('publications-dialog').close();await review({seriesOnly:true});}));
      $('publications-list').append(card);
    }
    if(!jobs.length)$('publications-list').append(text('p','之后的发布会记录在这里。'));
    if(!$('publications-dialog').open)$('publications-dialog').showModal();
  }
  async function showImages(){
    if(uploadCount)throw new Error('图片正在处理，完成后即可打开配图面板');
    await save();const raw=body(),id=current.id,images=window.scanArticleImages(raw),edits=[];$('images-list').replaceChildren();const saveButton=$('images-save');saveButton.disabled=!images.length;
    for(const image of images){const card=text('section','','image-record'),photo=document.createElement('img');if(/^(https?:|\/)/.test(image.url))photo.src=image.url;photo.alt=image.alt;card.append(photo);
      const alt=document.createElement('input'),caption=document.createElement('input');alt.value=image.alt;caption.value=image.caption;alt.setAttribute('aria-label','图片替代文字');caption.setAttribute('aria-label','图片说明');alt.maxLength=caption.maxLength=300;
      const a=text('label','替代文字'),c=text('label','图片下方说明');a.append(alt);c.append(caption);card.append(a,c);
      const edit={image,alt,caption,replacement:image.url};edits.push(edit);const picker=document.createElement('input');picker.type='file';picker.accept='image/png,image/jpeg,image/webp,image/gif';picker.hidden=true;
      const imageStatus=text('p','','image-status');imageStatus.setAttribute('role','status');
      picker.onchange=()=>attempt(async()=>{if(!picker.files[0]||uploadCount)return;uploadCount++;const controls=[...$('images-dialog').querySelectorAll('button,input')];controls.forEach(el=>el.disabled=true);imageStatus.textContent='正在处理图片，完成后即可保存…';try{edit.replacement=await upload(picker.files[0]);photo.src=edit.replacement;imageStatus.textContent='图片已准备好，保存后替换正文中的原图。';}catch(error){imageStatus.textContent='替换失败：'+error.message;}finally{uploadCount--;controls.forEach(el=>el.disabled=false);picker.value='';}});
      card.append(picker,button('替换图片',()=>picker.click()),imageStatus);$('images-list').append(card);
    }
    saveButton.onclick=()=>attempt(async()=>{
      if(uploadCount)return;if(current?.id!==id||body()!==raw)throw new Error('文章已改变，请重新打开配图面板');saveButton.disabled=true;
      try{let next=raw;const clean=value=>value.replace(/[\[\]"\\\r\n]/g,' ').trim();
        for(const {image,alt,caption,replacement} of [...edits].reverse()){
          if(alt.value===image.alt&&caption.value===image.caption&&replacement===image.url)continue;
          const markup='!['+clean(alt.value)+']('+replacement+(caption.value.trim()?' "'+clean(caption.value)+'"':'')+')';next=next.slice(0,image.start)+markup+next.slice(image.end);
        }
        if(next!==raw){await loadEditor(next,sourceMode);changed(true);await save();}
        $('images-dialog').close();notice('配图修改已保存到本机，发布后网站生效。');
      }finally{saveButton.disabled=false;}
    });
    if(!images.length)$('images-list').append(text('p','还没有可管理的 Markdown 配图。可以直接粘贴图片，或使用工具栏插入。'));
    if(!$('images-dialog').open)$('images-dialog').showModal();
  }
  async function upload(file){file=await compressImage(file);if(file.size>5000000)throw new Error('图片请小于 5 MB');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});return(await api('upload',{data})).url;}
  async function preview(){
    const result=await api('preview',{body:body()});
    const heading=text('h1',$('title').value).outerHTML;
    const content=DOMPurify.sanitize(result.html);
    $('preview').srcdoc=`<!doctype html><html lang="zh-CN" data-theme="light"><head><meta charset="utf-8"><link rel="stylesheet" href="/katex/katex.min.css"><link rel="stylesheet" href="/preview.css"></head><body class="letter-reader"><main><header>${heading}</header><article id="article-container">${content}</article></main></body></html>`;
    $('preview-dialog').showModal();
  }
  let historyArticle=null,historyVersion=null,historyEpoch=0,historyRequest=0;
  function comparisonText(doc){return [doc.title||'无标题',doc.summary||'',doc.body||''].filter(Boolean).join('\n\n');}
  function renderHistoryComparison(selected){
    const currentPane=$('history-current'),previousPane=$('history-selected');currentPane.replaceChildren();previousPane.replaceChildren();let added=0,removed=0;
    for(const part of window.diffArticleLines(comparisonText(selected),comparisonText(historyArticle))){
      if(part.added){added+=part.count;currentPane.append(text('span',part.value,'history-added'));}
      else if(part.removed){removed+=part.count;previousPane.append(text('span',part.value,'history-removed'));}
      else{currentPane.append(document.createTextNode(part.value));previousPane.append(document.createTextNode(part.value));}
    }
    currentPane.scrollTop=previousPane.scrollTop=0;
    return added||removed?'当前内容比所选版本增加 '+added+' 行，移除 '+removed+' 行。':'标题、摘要和正文相同。';
  }
  $('history-dialog').addEventListener('close',()=>{historyRequest++;historyVersion=null;});
  async function showHistory(){
    await save();historyArticle={...current,...values()};historyVersion=null;const epoch=++historyEpoch;
    $('history-current').textContent=comparisonText(historyArticle);$('history-selected').textContent='';$('history-summary').textContent='选择一个版本，左右对照查看。';$('history-error').textContent='';$('history-restore').disabled=true;
    const items=await api('history?id='+encodeURIComponent(current.id));$('history-list').replaceChildren();
    for(const item of items){const choice=button(new Date(item.time).toLocaleString('zh-CN')+' · '+item.reason,async()=>{
      const request=++historyRequest;historyVersion=null;$('history-restore').disabled=true;$('history-error').textContent='';$('history-summary').textContent='正在读取所选版本…';
      let selected;try{selected=await api('history-version?id='+encodeURIComponent(historyArticle.id)+'&key='+encodeURIComponent(item.key));}catch(error){if(request===historyRequest)$('history-error').textContent=error.message;return;}if(epoch!==historyEpoch||request!==historyRequest)return;
      historyVersion=selected;const changes=renderHistoryComparison(selected);
      $('history-summary').textContent=new Date(selected.time).toLocaleString('zh-CN')+' · '+changes;$('history-restore').disabled=comparisonText(selected)===comparisonText(historyArticle);
      for(const el of $('history-list').children)el.removeAttribute('aria-current');choice.setAttribute('aria-current','true');
    });$('history-list').append(choice);}
    if(!items.length)$('history-list').append(text('p','还没有历史版本。之后每次修改保存，都会保留修改前的内容。'));
    $('history-dialog').showModal();
  }
  $('history-restore').onclick=()=>attempt(async()=>{
    if(!historyVersion)return;$('history-list').inert=true;$('history-restore').disabled=true;$('history-error').textContent='';
    try{await api('history-restore',{id:historyArticle.id,revision:historyArticle.revision,key:historyVersion.key});dirty=false;bodyChanged=false;await openId(historyArticle.id);$('history-dialog').close();notice('已恢复到本机；恢复前的内容也在历史版本中。');}
    catch(error){$('history-error').textContent=error.message;}finally{$('history-list').inert=false;$('history-restore').disabled=false;}
  });
  async function review(options={}){
    if(uploadCount)throw new Error('图片正在插入，请完成后再发布');await save();
    reviewed=await api('review',{id:current?.id,...options});
    $('review-heading').textContent=reviewed.action==='withdraw'?'撤回这篇文章':'发布这次内容';
    $('review-confirm').textContent=reviewed.action==='withdraw'?'确认撤回':'确认发布';
    $('review-title').textContent=reviewed.title;$('review-summary').textContent=reviewed.summary;
    $('review-meta').textContent=reviewed.action==='withdraw'?'只从网站撤回，正文继续留在本机。':reviewed.seriesOnly?'只更新系列目录，草稿继续留在本机。':`${reviewed.assets.length} 张随文配图 · 分类：${reviewed.category||'未分类'}${reviewed.tags?.length?' · 标签：'+reviewed.tags.join('、'):''}`;
    $('review-tips').replaceChildren();
    if(reviewed.tips?.length&&reviewed.action!=='withdraw'){const box=text('div','','review-tips');box.append(text('strong','发布前看一眼（不影响发布）'));const list=document.createElement('ul');reviewed.tips.forEach(tip=>list.append(text('li',tip)));box.append(list,button('去文章设置补一补',()=>{$('review').close();$('settings').hidden=true;toggleDrawer('settings');}));$('review-tips').append(box);}
    $('review-changes').replaceChildren();
    if(reviewed.changes?.length){$('review-changes').append(text('strong','本次还会同步以下系列变更'));const list=document.createElement('ul');reviewed.changes.forEach(change=>list.append(text('li',change)));$('review-changes').append(list);}
    else if(reviewed.changes)$('review-changes').append(text('span','没有额外的系列变更。'));
    for(const warning of reviewed.warnings||[])$('review-changes').append(text('p',warning,'danger'));
    $('review-error').textContent='';$('review').showModal();
  }
  $('review-confirm').onclick=()=>attempt(async()=>{ $('review-confirm').disabled=true;try{await api('publish',{items:reviewed.seriesOnly?[]:[{id:reviewed.id,revision:reviewed.revision,action:reviewed.action}],seriesOnly:!!reviewed.seriesOnly,libraryRevision:reviewed.libraryRevision});$('review').close();await poll();}catch(e){$('review-error').textContent=e.message;}finally{$('review-confirm').disabled=false;} });
  let lastJob='';async function poll(){try{const job=await api('status');busy=['building','uploading','deploying'].includes(job.state);$('publication-status').textContent=job.state==='idle'?'':job.state==='error'?'发布未完成，内容已保留。可在资料库的“发布记录”查看原因并重试。':job.message;$('publish').disabled=$('series-publish').disabled=$('private-publish').disabled=busy;
    const key=job.state+':'+job.updated;if(key!==lastJob){lastJob=key;await refresh();if($('publications-dialog').open)await showPublications();if(current){const renamed=all.find(p=>nameOf(p.id)===nameOf(current.id));if(renamed){current.id=renamed.id;localSet('studio-last',current.id);}}}
  }catch(e){$('publication-status').textContent='暂时无法连接写作服务；未保存的文字仍保留在当前窗口。';}}
  ['title','date','summary','categories','tags','kind','topic','link'].forEach(id=>$(id).addEventListener('input',()=>changed()));
  $('kind').addEventListener('change',()=>changed());
  $('link').addEventListener('input',updateLinkPreview);$('date').addEventListener('input',updateLinkPreview);$('summary').addEventListener('input',updateSummaryCount);
  $('link').addEventListener('blur',()=>{const v=$('link').value,clean=v.trim().toLowerCase().replace(/[\s_]+/g,'-').replace(/-+/g,'-');if(clean!==v){$('link').value=clean;updateLinkPreview();changed();}});
  $('link-suggest').onclick=()=>{if(!current)return;$('link').value=suggestLink();updateLinkPreview();changed();$('link').focus();};
  function greet(){const h=new Date().getHours();return h<5?'夜深了，写完早点休息':h<11?'早上好':h<14?'中午好':h<18?'下午好':'晚上好';}
  function renderEmpty(){
    $('empty-greeting').textContent=greet();
    const last=localGet('studio-last',null),post=last&&all.find(p=>nameOf(p.id)===nameOf(last));
    $('quick-continue').hidden=!post;if(post)$('quick-continue-title').textContent=post.title||'无标题';
  }
  async function quickMoment(){
    await newPost();const d=new Date($('date').value+'T12:00:00');
    if(!$('title').value)$('title').value=`碎碎念 · ${d.getMonth()+1}/${d.getDate()}`;
    $('kind').value='moment';updateLinkPreview();changed();
    requestAnimationFrame(()=>(sourceMode?sourceEditor:editor)?.focus());
    notice('已新建碎碎念：写一两句话就好，发布后会出现在首页和「碎碎念」页。');
  }
  async function quickJapanese(){
    if(managementBusy)throw new Error('正在整理，请稍候');await save();
    const doc=await api('new',{mode:'quick',date:new Date().toLocaleDateString('sv-SE')});await refresh();await openId(doc.id);
  }
  $('editor').addEventListener('compositionstart',()=>{composing=true;clearTimeout(timer);},true);$('editor').addEventListener('compositionend',()=>{setTimeout(()=>{composing=false;changed(true);},0);},true);
  $('editor').addEventListener('keyup',remember);$('editor').addEventListener('pointerup',remember);$('writing-scroll').addEventListener('scroll',remember,{passive:true});
  async function toggleSource(){
    if(!current||$('editor').hidden)return;if(uploadCount)throw new Error('图片正在插入，完成后再切换');
    await save();remember();const raw=body(),wasSource=sourceMode,scroll=$('writing-scroll');
    let block=0;
    if(wasSource&&sourceEditor){const caret=sourceEditor.getSelection()[1];block=Math.max(0,window.StudioEditors.blockOffsets(raw).filter(offset=>offset<=caret).length-1);}
    else if(editor)block=editor.blockIndex();
    const ratio=scroll.scrollHeight>scroll.clientHeight?scroll.scrollTop/(scroll.scrollHeight-scroll.clientHeight):0;
    if(!await loadEditor(raw,!wasSource))return;updateCount();
    requestAnimationFrame(()=>{
      if(sourceMode){const offset=window.StudioEditors.blockOffsets(raw)[block]??0;sourceEditor.setSelection(offset);sourceEditor.focus();}
      else{editor.focusBlock(block);}
      if(!document.activeElement||document.activeElement===document.body)scroll.scrollTop=ratio*(scroll.scrollHeight-scroll.clientHeight);
    });
    status(sourceMode?'Markdown 源码：直接编辑原文，Ctrl / 回到排版':'已回到排版编辑');
  }
  $('mode-toggle').onclick=()=>attempt(toggleSource);
  // ---------- Desk ↔ paper ----------
  function toggleLibrary(){
    if(document.body.dataset.screen==='desk'){document.body.classList.toggle('nav-open');return;}
    setLibrary(document.body.classList.contains('library-collapsed'));
    if(!document.body.classList.contains('library-collapsed'))requestAnimationFrame(()=>$('filter').focus({preventScroll:true}));
  }
  async function goDesk(){
    if(uploadCount)throw new Error('图片正在插入，完成后再回到书桌');
    await save();remember();await discardCurrentEmpty();
    if(current){const id=current.id;clearCurrent();localSet('studio-last',id);}
    $('private-panel').hidden=$('private-actions').hidden=true;$('editor').hidden=$('article-actions').hidden=true;$('empty').hidden=false;
    $('document-state').textContent='留一页给今天';setLibrary(true);renderList();renderEmpty();
  }
  $('desk-backdrop').onclick=()=>{document.body.classList.remove('nav-open');if(document.body.dataset.screen!=='desk')setLibrary(false);};
  function toggleMore(force){const menu=$('more-menu'),open=force??menu.hidden;menu.hidden=!open;$('more-toggle').setAttribute('aria-expanded',String(open));if(open)menu.querySelector('button')?.focus();}
  $('more-menu').addEventListener('click',e=>{if(e.target.closest('button'))toggleMore(false);});
  document.addEventListener('pointerdown',e=>{if(!$('more-menu').hidden&&!e.target.closest('.menu-wrap'))toggleMore(false);});
  $('title').addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.isComposing&&e.keyCode!==229){e.preventDefault();(sourceMode?sourceEditor:editor)?.focus();}});
  $('title').addEventListener('input',()=>{if(/\n/.test($('title').value))$('title').value=$('title').value.replace(/\s*\n+\s*/g,' ');sizeTitle();});
  new ResizeObserver(()=>sizeTitle()).observe($('writing-scroll'));
  // ---------- Theme: follows the clock like the blog ----------
  function renderTheme(){const manual=window.StudioTheme?.manual,dark=document.documentElement.dataset.theme==='dark';$('theme-toggle').querySelector('span').textContent=manual?(dark?'深色（手动）':'浅色（手动）'):(dark?'深色 · 跟随时间':'浅色 · 跟随时间');$('theme-toggle').querySelector('use').setAttribute('href',dark?'#i-moon':'#i-sun');}
  function toggleTheme(){if(window.StudioTheme?.manual)window.StudioTheme.followTime();else window.StudioTheme?.toggle();renderTheme();notice(window.StudioTheme?.manual?'已手动切换，到下一个 6 点或 18 点会恢复跟随时间。':'已恢复跟随时间：06:00–18:00 浅色，其余时间深色。');}
  document.addEventListener('studio-theme',renderTheme);renderTheme();
  // ---------- Command palette (Ctrl K) ----------
  let paletteItems=[],paletteIndex=0;
  function paletteCommands(){
    const editing=current&&!$('editor').hidden,list=[];
    const add=(label,icon,run,hint='',when=true)=>{if(when)list.push({label,icon,run,hint,group:'命令'});};
    add('新建文章','pen',()=>newPost(),'Ctrl Alt N');
    add('今天的日语日记','japanese',quickJapanese);
    add('记一条碎碎念','quote',quickMoment);
    add('从模板开始','template',templates);
    add(sourceMode?'回到排版编辑':'切换到 Markdown 源码','code',toggleSource,'Ctrl /',editing);
    add('文章属性','panel',()=>toggleDrawer('settings',true),'Ctrl ,',editing);
    add('目录','outline',()=>toggleDrawer('outline',true),'',editing);
    add('阅读预览','eye',preview,'',editing);
    add('发布这篇','send',()=>review(),'',editing);
    add('文章配图','image',showImages,'',editing);
    add('历史版本','history',showHistory,'',editing);
    add('将这篇存为模板','copy',()=>templateForm(null,true),'',editing);
    add('回到书桌','back',goDesk,'',document.body.dataset.screen!=='desk');
    add('私人手记','lock',actions['private-open']);
    add('发布记录','history',showPublications);
    add(window.StudioTheme?.manual?'恢复跟随时间切换主题':document.documentElement.dataset.theme==='dark'?'切换为浅色（到下次整点切换）':'切换为深色（到下次整点切换）','sun',toggleTheme);
    add('快捷键','keyboard',()=>$('shortcuts-dialog').showModal());
    return list;
  }
  function renderPalette(){
    const query=$('palette-input').value.trim().toLowerCase(),list=$('palette-list');
    const commands=paletteCommands().filter(c=>!query||c.label.toLowerCase().includes(query));
    const posts=[...all].sort((a,b)=>b.modified-a.modified).filter(p=>!query||(p.title+' '+p.date+' '+(p.tags||[]).join(' ')+' '+(p.categories||[]).join(' ')).toLowerCase().includes(query)).slice(0,query?12:6)
      .map(p=>({label:p.title||'无标题',icon:'draft',hint:labels[p.status]+' · '+p.date,run:()=>openId(p.id),group:query?'文章':'最近的文章'}));
    paletteItems=query?[...posts,...commands]:[...commands.slice(0,4),...posts,...commands.slice(4).map(c=>({...c,group:'更多命令'}))];
    paletteIndex=Math.min(paletteIndex,Math.max(0,paletteItems.length-1));list.replaceChildren();let group='';
    paletteItems.forEach((item,index)=>{
      if(item.group!==group){group=item.group;list.append(text('div',group,'palette-group'));}
      const option=document.createElement('button');option.type='button';option.tabIndex=-1;option.setAttribute('role','option');option.setAttribute('aria-selected',String(index===paletteIndex));option.id='palette-option-'+index;
      option.innerHTML=`<svg class="i" aria-hidden="true"><use href="#i-${item.icon}"/></svg>`;option.append(text('span',item.label));if(item.hint)option.append(text('small',item.hint));
      option.onpointermove=()=>{if(paletteIndex!==index){paletteIndex=index;markPalette(false);}};option.onclick=()=>runPalette(index);list.append(option);
    });
    if(!paletteItems.length)list.append(text('p','没有找到。试试别的关键词。','palette-empty'));
    $('palette-input').setAttribute('aria-activedescendant',paletteItems.length?'palette-option-'+paletteIndex:'');
  }
  function markPalette(scroll=true){$('palette-list').querySelectorAll('[role=option]').forEach((el,index)=>el.setAttribute('aria-selected',String(index===paletteIndex)));const active=$('palette-option-'+paletteIndex);if(scroll)active?.scrollIntoView({block:'nearest'});$('palette-input').setAttribute('aria-activedescendant',active?active.id:'');}
  function runPalette(index){const item=paletteItems[index];if(!item)return;$('palette').close();attempt(item.run);}
  function openPalette(){if(document.querySelector('dialog[open]:not(#palette)'))return;$('palette-input').value='';paletteIndex=0;renderPalette();$('palette').showModal();$('palette-input').focus();}
  $('palette-input').addEventListener('input',()=>{paletteIndex=0;renderPalette();});
  $('palette-input').addEventListener('keydown',e=>{
    if(e.isComposing||e.keyCode===229)return;
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();if(!paletteItems.length)return;paletteIndex=(paletteIndex+(e.key==='ArrowDown'?1:-1)+paletteItems.length)%paletteItems.length;markPalette();}
    else if(e.key==='Enter'){e.preventDefault();runPalette(paletteIndex);}
  });
  $('palette').addEventListener('click',e=>{if(e.target===$('palette'))$('palette').close();});
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>attempt(()=>setView(b.dataset.view)));
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).hidden=true);
  document.querySelectorAll('[data-dialog-close]').forEach(b=>b.onclick=()=>$(b.dataset.dialogClose).close());
  const actions={'publications-refresh':showPublications,'publication-history':showPublications,'article-images':showImages,'article-history':showHistory,'article-preview':preview,'batch-taxonomy':()=>batchTaxonomy([...chosen]),'select-filtered':()=>{chosen=new Set(filtered().map(p=>view==='trash'?p.key:p.id));renderList();},'filter-clear':()=>{$('category-filter').value=$('tag-filter').value=$('filter').value='';chosen.clear();renderList();},'library-toggle':toggleLibrary,'desk-back':goDesk,'palette-open':openPalette,'theme-toggle':toggleTheme,'more-toggle':()=>toggleMore(),'article-delete':()=>all.find(p=>nameOf(p.id)===nameOf(current.id))?.isPublished?review({id:current.id,withdraw:true}):requestTrash([current.id]),'batch-trash':()=>requestTrash([...chosen]),'batch-restore':()=>restorePosts([...chosen]),'new-post':()=>newPost(),'empty-new':()=>newPost(),'quick-moment':quickMoment,'quick-moment-nav':quickMoment,'quick-japanese':quickJapanese,'quick-template':templates,'quick-continue':()=>openId(localGet('studio-last',null)),'template-manage':templates,'template-new':()=>templateForm(),'new-series':()=>seriesForm(),'series-settings':()=>seriesForm(activeSeries()),'article-new-series':()=>seriesForm(null,[current.id]),'article-series':()=>addToSeries([current.id]),'batch-add':()=>addToSeries([...chosen]),'batch-clear':()=>{chosen.clear();renderList();},'save-template':()=>templateForm(null,true),'settings-toggle':()=>toggleDrawer('settings'),'outline-toggle':()=>toggleDrawer('outline'),'publish':()=>review(),'series-publish':()=>review({seriesOnly:true}),'private-publish':()=>review({private:true}),'private-open':async()=>{await save();remember();setLibrary(false);$('empty').hidden=$('editor').hidden=$('article-actions').hidden=true;$('private-panel').hidden=$('private-actions').hidden=false;$('document-state').textContent='私人手记 · 密码解锁';status('');if(!$('private-frame').src)$('private-frame').src=privateUrl;}};
  for(const [id,action]of Object.entries(actions))$(id).onclick=()=>attempt(action);
  $('filter').oninput=()=>{chosen.clear();renderList();};
  ['category-filter','tag-filter'].forEach(id=>$(id).onchange=()=>{chosen.clear();renderList();});
  taxonomyInput($('categories'),'categories');taxonomyInput($('tags'),'tags');
  new ResizeObserver(()=>sizeSource()).observe($('writing-scroll'));
  // Global shortcuts run in the capture phase so editors (e.g. CodeMirror's Ctrl+/) don't swallow them.
  addEventListener('keydown',e=>{const mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase();
    if(e.isComposing||e.keyCode===229)return;
    if(mod&&!e.altKey&&!e.shiftKey&&key==='k'){e.preventDefault();e.stopPropagation();$('palette').open?$('palette').close():openPalette();return;}
    if(mod&&!e.altKey&&!e.shiftKey&&(key==='/'||e.code==='Slash')){e.preventDefault();e.stopPropagation();if(current&&!$('editor').hidden&&!document.querySelector('dialog[open]'))attempt(toggleSource);else if(!document.querySelector('dialog[open]'))$('shortcuts-dialog').showModal();return;}
    if(mod&&e.altKey&&(key==='n'||e.code==='KeyN')){e.preventDefault();attempt(()=>newPost());return;}
    if(mod&&key===','&&current&&!$('editor').hidden){e.preventDefault();toggleDrawer('settings');return;}
    if(mod&&e.shiftKey&&(key==='b'||e.code==='KeyB')){e.preventDefault();toggleLibrary();return;}
    if(mod&&key==='s'){e.preventDefault();attempt(save);return;}
    if(e.key==='Escape'&&!document.querySelector('dialog[open]')){
      if(!$('more-menu').hidden){toggleMore(false);$('more-toggle').focus();return;}
      if(document.body.classList.contains('nav-open')){document.body.classList.remove('nav-open');return;}
      if(document.body.dataset.screen!=='desk'&&!document.body.classList.contains('library-collapsed')){setLibrary(false);return;}
      if(innerWidth<1180&&!$('settings').hidden){toggleDrawer('settings',false);return;}
      if(innerWidth<1180&&!$('outline').hidden){toggleDrawer('outline',false);return;}
    }
  },true);
  addEventListener('beforeunload',e=>{remember();if(dirty||saving||uploadCount){e.preventDefault();e.returnValue='';}});
  attempt(async()=>{const session=await api('session');if(session.version!=='history-v2'){document.querySelector('.navigation').inert=document.querySelector('.library').inert=true;$('empty').replaceChildren(text('h2','写作台已经更新'),text('p','请重新双击“打开写作台”，使用新版服务。'));status('请重新打开新版写作台');return;}token=session.token;privateUrl=session.privateUrl;await refresh();const oldView=localGet('studio-view','recent');if(['recent','all','draft','published','trash'].includes(oldView)||collection.series.some(s=>'series:'+s.id===oldView))view=oldView;renderNav();renderList();const last=localGet('studio-last',null);if(last&&all.some(p=>nameOf(p.id)===nameOf(last)))await openId(last);await poll();setInterval(poll,6000);});
})();
