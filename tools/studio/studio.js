(() => {
  'use strict';
  const $ = id => document.getElementById(id), nameOf = id => id.split('/').pop();
  const text = (tag,value,cls) => { const el = document.createElement(tag); el.textContent = value; if(cls) el.className = cls; return el; };
  const button = (label,action,cls) => { const el = text('button',label,cls); el.type='button'; el.addEventListener('click',()=>attempt(action)); return el; };
  const localGet = (key,fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; } };
  const localSet = (key,value) => { try { localStorage.setItem(key,JSON.stringify(value)); } catch (_) {} };
  let token='', current=null, all=[], collection={series:[],templates:[]}, view='recent', chosen=new Set(), editor=null;
  let dirty=false, saving=null, timer, editVersion=0, bodyChanged=false, loading=false, sourceMode=false, composing=false, busy=false, reviewed=null, privateUrl='', uploadCount=0;
  let recent=localGet('studio-recent',[]), positions=localGet('studio-positions',{}), openEpoch=0;
  const status = value => { $('save-status').textContent=value; $('save-status').title=value; };
  async function attempt(action) { try { return await action(); } catch(e) { status(e.message); } }
  async function api(route,data) {
    const response=await fetch('/api/'+route,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Studio-Token':token},body:JSON.stringify(data)});
    const result=await response.json(); if(!response.ok) throw new Error(result.error || '操作失败'); return result;
  }
  function body() { return sourceMode ? $('source-editor').value : bodyChanged ? editor.getMarkdown() : current?.body || ''; }
  function values() { return {id:current.id,revision:current.revision,title:$('title').value,date:$('date').value,summary:$('summary').value,body:body()}; }
  function remember() {
    if(!current || !$('private-panel').hidden) return;
    try { positions[nameOf(current.id)]={source:sourceMode,selection:sourceMode?[$('source-editor').selectionStart,$('source-editor').selectionEnd]:editor.getSelection(),scroll:$('editor').scrollTop}; localSet('studio-positions',positions); } catch(_) {}
  }
  function changed(isBody=false) {
    if(loading || !current) return;
    if(isBody) bodyChanged=true;
    dirty=true;editVersion++;status('正在写…'); clearTimeout(timer);
    if(!composing) { localSet('studio-recovery-'+nameOf(current.id),values()); timer=setTimeout(()=>attempt(save),900); }
    updateCount();
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
  async function refresh() { [all,collection]=await Promise.all([api('posts'),api('library')]);renderNav();renderList();renderMembership();updateState(); }
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
    if(s) items=s.posts.map(name=>all.find(p=>nameOf(p.id)===name)).filter(Boolean);
    else if(view==='draft') items=items.filter(p=>!p.isPublished);
    else if(view==='published') items=items.filter(p=>p.isPublished);
    else if(view==='recent') items.sort((a,b)=>{const ai=recent.indexOf(nameOf(a.id)),bi=recent.indexOf(nameOf(b.id));return (ai<0?9999:ai)-(bi<0?9999:bi)||b.modified-a.modified;});
    return items.filter(p=>(p.title+' '+p.date).toLowerCase().includes(q));
  }
  const labels={draft:'草稿',changed:'有未发布修改',published:'已发布',pending:'发布中'};
  function renderList() {
    const s=activeSeries();$('view-title').textContent=s?s.title:({recent:'最近写过',all:'全部文章',draft:'草稿',published:'已发布'}[view]||'文章');
    $('view-description').textContent=s?(s.description||'把相连的想法，慢慢写成一个系列。'):'从上次停下的地方继续。';
    $('series-settings').hidden=$('series-actions').hidden=!s;
    $('post-list').replaceChildren(); const items=filtered();$('list-empty').hidden=!!items.length;
    for(const post of items) {
      const row=text('div','', 'post-row'+(current&&nameOf(post.id)===nameOf(current.id)?' active':''));
      const check=document.createElement('input');check.type='checkbox';check.checked=chosen.has(post.id);check.setAttribute('aria-label','选择 '+(post.title||'无标题'));
      check.onchange=()=>{check.checked?chosen.add(post.id):chosen.delete(post.id);renderBatch();};
      const open=button('',()=>openId(post.id),'post-open');open.append(text('strong',post.title||'无标题'),text('small',labels[post.status]+' · '+post.date));row.append(check,open);
      if(s) {
        const controls=text('div','','order-tools');
        const up=button('↑',()=>move(s,nameOf(post.id),-1)),down=button('↓',()=>move(s,nameOf(post.id),1)),remove=button('移出',()=>removeFrom(s,nameOf(post.id)));
        up.setAttribute('aria-label','上移 '+(post.title||'无标题'));down.setAttribute('aria-label','下移 '+(post.title||'无标题'));remove.setAttribute('aria-label','移出系列 '+(post.title||'无标题'));controls.append(up,down,remove);row.append(controls);
        row.draggable=!$('filter').value;
        row.ondragstart=e=>{e.dataTransfer.setData('text/plain',nameOf(post.id));row.classList.add('dragging');};
        row.ondragend=()=>row.classList.remove('dragging');row.ondragover=e=>{e.preventDefault();row.classList.add('drop-target');};row.ondragleave=()=>row.classList.remove('drop-target');
        row.ondrop=e=>{e.preventDefault();row.classList.remove('drop-target');const from=e.dataTransfer.getData('text/plain'),to=nameOf(post.id);if(from===to||!s.posts.includes(from))return;attempt(async()=>{const next=structuredClone(collection),target=next.series.find(x=>x.id===s.id);target.posts.splice(target.posts.indexOf(from),1);target.posts.splice(target.posts.indexOf(to),0,from);await putLibrary(next);});};
      }
      $('post-list').append(row);
    }
    renderBatch();
  }
  function renderBatch(){ $('batch-bar').hidden=!chosen.size;$('batch-count').textContent=`已选 ${chosen.size} 篇`;$('batch-add').disabled=!chosen.size; }
  async function setView(next) { await save();remember();view=next;localSet('studio-view',view);chosen.clear();$('filter').value='';renderNav();renderList(); }
  function updateState() {
    if(!current || !$('private-panel').hidden)return;const post=all.find(p=>nameOf(p.id)===nameOf(current.id));
    $('document-state').textContent=post?labels[post.status]:'草稿';
    $('publish').textContent=post?.status==='published'?'发布更新':'发布';
    const members=collection.series.filter(s=>s.posts.includes(nameOf(current.id)));$('article-series').textContent=members.length?members.map(s=>s.title).join(' · '):'＋ 加入系列';
  }
  function updateCount(){if(!current)return;const content=sourceMode?body().replace(/!?\[([^\]]*)\]\([^)]*\)/g,'$1').replace(/[#*`>|_~]/g,''):($('rich-editor').querySelector('.toastui-editor-ww-container .toastui-editor-contents')?.textContent||'');const count=(content.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu)||[]).length+(content.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)||[]).length;$('word-count').textContent=`约 ${count} 字 · ${Math.max(1,Math.ceil(count/300))} 分钟`;if(!$('outline').hidden)renderOutline();}
  // Keep unsupported syntax literal; visual editing must never silently rewrite it.
  const special = value => /\$|<\/?[a-zA-Z!]|{%|\[\^[^\]]+\]|^\s*\[[^\]]+\]:|^\s*\[toc\]/im.test(value);
  function loadEditor(value,forceSource=false) {
    loading=true;sourceMode=forceSource||special(value);$('source-editor').value=value;
    if(editor)editor.destroy();
    editor=new toastui.Editor({el:$('rich-editor'),height:'auto',minHeight:'400px',initialEditType:'wysiwyg',initialValue:sourceMode?'':value,language:'zh-CN',hideModeSwitch:true,usageStatistics:false,autofocus:false,placeholder:'从这里开始写…',toolbarItems:[['heading','bold','italic','strike'],['quote','ul','ol','task'],['table','image','link'],['code','codeblock']],customHTMLSanitizer:html=>DOMPurify.sanitize(html),events:{change:()=>changed(true)},hooks:{addImageBlobHook:(blob,callback)=>{const id=current?.id;uploadCount++;attempt(async()=>{const url=await upload(blob);if(current?.id!==id)throw new Error('图片已上传，请在原文章中重新插入');callback(url,blob.name||'图片');}).finally(()=>uploadCount--);}}});
    $('rich-editor').hidden=sourceMode;$('source-editor').hidden=!sourceMode;$('mode-toggle').textContent=sourceMode?'排版编辑':'Markdown';$('mode-toggle').disabled=sourceMode&&special(value);$('compatibility').hidden=!(sourceMode&&special(value));loading=false;
  }
  async function openId(id) {
    if(uploadCount)throw new Error('图片正在插入，完成后即可切换文章');
    const epoch=++openEpoch;
    await save();remember();const post=await api('post?id='+encodeURIComponent(id));
    await save();if(epoch!==openEpoch)return;
    current=post;dirty=false;bodyChanged=false;editVersion=0;
    $('empty').hidden=$('private-panel').hidden=true;$('editor').hidden=$('article-actions').hidden=false;$('private-actions').hidden=true;
    ['title','date','summary'].forEach(k=>$(k).value=post[k]);
    const recovery=localGet('studio-recovery-'+nameOf(id),null);let recovered=false;
    if(recovery && recovery.revision===post.revision){['title','date','summary'].forEach(k=>$(k).value=recovery[k]);post.body=recovery.body;recovered=true;}
    else if(recovery){recoveryDialog(recovery);}
    const position=positions[nameOf(id)];loadEditor(post.body,position?.source);
    recent=[nameOf(id),...recent.filter(n=>n!==nameOf(id))].slice(0,100);localSet('studio-recent',recent);localSet('studio-last',post.id);
    renderList();renderMembership();updateState();updateCount();status(recovered?'已恢复上次未保存的文字':'已保存到本机');
    if(recovered)changed(true);
    requestAnimationFrame(()=>{if(position){try{if(sourceMode){$('source-editor').focus();$('source-editor').setSelectionRange(...position.selection);}else{editor.focus();editor.setSelection(...position.selection);}}catch(_){}$('editor').scrollTop=position.scroll||0;}});
  }
  function recoveryDialog(recovery){form('上次未保存的内容',[{key:'body',label:'原文章在别处改动过。可将这份内容保存为另一篇草稿。',value:recovery.body,type:'textarea',rows:12}],async data=>{const draft=await api('new',{});await api('save',{...draft,title:recovery.title,summary:recovery.summary,date:recovery.date,body:data.body});localStorage.removeItem('studio-recovery-'+nameOf(recovery.id));await refresh();await openId(draft.id);},'保存为另一篇草稿');}
  async function newPost(template) {await save();const doc=await api('new',{template,series:activeSeries()?.id});await refresh();await openId(doc.id);$('title').focus();}
  async function putLibrary(next) {try{collection=await api('library',next);}catch(e){collection=await api('library');renderNav();renderList();throw e;}renderNav();renderList();renderMembership();updateState();}
  async function move(series,name,offset) {const next=structuredClone(collection),s=next.series.find(x=>x.id===series.id),i=s.posts.indexOf(name),j=i+offset;if(j<0||j>=s.posts.length)return;[s.posts[i],s.posts[j]]=[s.posts[j],s.posts[i]];await putLibrary(next);}
  async function removeFrom(series,name){const next=structuredClone(collection);next.series.find(s=>s.id===series.id).posts=series.posts.filter(n=>n!==name);await putLibrary(next);status('已移出系列，文章仍在“全部文章”里');}
  function renderMembership(){
    $('membership').replaceChildren();if(!current)return;
    for(const s of collection.series){const label=text('label',''),check=document.createElement('input');check.type='checkbox';check.checked=s.posts.includes(nameOf(current.id));check.onchange=()=>attempt(async()=>{const next=structuredClone(collection),member=next.series.find(x=>x.id===s.id),name=nameOf(current.id);member.posts=check.checked?[...member.posts,name]:member.posts.filter(n=>n!==name);await putLibrary(next);});label.append(check,text('span',s.title));$('membership').append(label);}
  }
  let formAction=null, extraAction=null;
  function form(title,fields,action,submit='保存',extra=null) {
    $('dialog-title').textContent=title;$('dialog-submit').textContent=submit;$('dialog-error').textContent='';$('dialog-fields').replaceChildren();
    for(const f of fields){const label=text('label',f.label),input=document.createElement(f.type==='textarea'?'textarea':f.type==='select'?'select':'input');input.name=f.key;input.id='field-'+f.key;if(f.type==='select'){for(const option of f.options){const el=text('option',option.label);el.value=option.value;input.append(el);}}else{if(f.type!=='textarea')input.type=f.type||'text';input.maxLength=f.max||200000;if(f.rows)input.rows=f.rows;}if(f.value!==undefined)input.value=f.value;input.required=!!f.required;label.append(input);$('dialog-fields').append(label);}
    formAction=action;extraAction=extra?.action;$('dialog-extra').hidden=!extra;$('dialog-extra').textContent=extra?.label||'';$('form-dialog').showModal();
  }
  $('dialog-form').onsubmit=async e=>{e.preventDefault();$('dialog-submit').disabled=true;try{await formAction(Object.fromEntries(new FormData(e.currentTarget)));$('form-dialog').close();}catch(error){$('dialog-error').textContent=error.message;}finally{$('dialog-submit').disabled=false;}};
  $('dialog-extra').onclick=()=>attempt(extraAction);
  function seriesForm(series=null,articles=[]){
    return form(series?'编辑系列':'新建系列',[{key:'title',label:'系列名称',value:series?.title,required:true,max:100},{key:'description',label:'简介（可不填）',value:series?.description,type:'textarea',rows:3,max:500},{key:'favorite',label:'侧栏位置',type:'select',value:series?.favorite?'yes':'no',options:[{value:'no',label:'普通系列'},{value:'yes',label:'收藏，放在前面'}]}],async data=>{
      const next=structuredClone(collection),id=series?.id||'series-'+crypto.randomUUID();
      if(series)Object.assign(next.series.find(s=>s.id===id),{title:data.title,description:data.description,favorite:data.favorite==='yes'});
      else next.series.push({id,title:data.title,description:data.description,favorite:data.favorite==='yes',posts:[...new Set(articles.map(nameOf))]});
      await putLibrary(next);await setView('series:'+id);
    },series?'保存系列':'创建系列',series?{label:'解散系列',action:()=>{if(!confirm('解散这个系列？文章会保留在全部文章中。'))return;return attempt(async()=>{const next=structuredClone(collection);next.series=next.series.filter(s=>s.id!==series.id);await putLibrary(next);$('form-dialog').close();await setView('all');});}}:null);
  }
  function addToSeries(ids){return form('加入系列',[{key:'series',label:`把 ${ids.length} 篇文章放入`,type:'select',options:[...collection.series.map(s=>({value:s.id,label:s.title})),{value:'__new',label:'＋ 新建一个系列'}]}],async data=>{
    if(data.series==='__new'){setTimeout(()=>seriesForm(null,ids),0);return;}
    const next=structuredClone(collection),s=next.series.find(s=>s.id===data.series);s.posts=[...new Set([...s.posts,...ids.map(nameOf)])];await putLibrary(next);chosen.clear();renderList();status('已加入系列');
  },'加入');}
  function templateForm(template=null,fromArticle=false){$('template-dialog').close();return form(template?'编辑模板':'新建模板',[{key:'title',label:'模板名称',required:true,value:template?.title,max:100},{key:'body',label:'模板内容（也可以写好文章后“存为模板”）',value:fromArticle?body():template?.body,type:'textarea',rows:12},{key:'favorite',label:'显示位置',type:'select',value:template?.favorite?'yes':'no',options:[{value:'no',label:'普通模板'},{value:'yes',label:'收藏，放在前面'}]}],async data=>{
    const next=structuredClone(collection),item={id:template?.id||'template-'+crypto.randomUUID(),title:data.title,body:data.body,favorite:data.favorite==='yes'};
    if(template)next.templates[next.templates.findIndex(t=>t.id===template.id)]=item;else next.templates.push(item);await putLibrary(next);status('模板已保存，下次可直接使用');
  },'保存模板',template?{label:'删除模板',action:()=>attempt(async()=>{if(!confirm('删除这个模板？用它写过的文章不会受影响。'))return;const next=structuredClone(collection);next.templates=next.templates.filter(t=>t.id!==template.id);await putLibrary(next);$('form-dialog').close();})}:null);}
  function templates(){
    $('template-list').replaceChildren();
    for(const t of [...collection.templates].sort((a,b)=>Number(b.favorite)-Number(a.favorite))){const card=text('div','','template-card');card.append(button((t.favorite?'★ ':'')+t.title,async()=>{$('template-dialog').close();await newPost(t.id);},'template-use'),text('small',t.body.replace(/[#>|*\n]/g,' ').slice(0,65)));const controls=text('div','','template-tools');controls.append(button(t.favorite?'取消收藏':'收藏',async()=>{const next=structuredClone(collection);next.templates.find(x=>x.id===t.id).favorite=!t.favorite;await putLibrary(next);templates();}),button('编辑',()=>templateForm(t)));card.append(controls);$('template-list').append(card);}
    if(!$('template-dialog').open)$('template-dialog').showModal();
  }
  function toggleDrawer(id){const open=$(id).hidden;$('settings').hidden=$('outline').hidden=true;$(id).hidden=!open;if(id==='outline')renderOutline();}
  function renderOutline(){
    $('outline-list').replaceChildren();if(!current)return;
    if(sourceMode){let offset=0;for(const line of body().split('\n')){const match=line.match(/^(#{1,6})\s+(.+)/);if(match){const pos=offset;const b=button(match[2],()=>{$('source-editor').focus();$('source-editor').setSelectionRange(pos,pos);$('source-editor').scrollTop=(body().slice(0,pos).split('\n').length-1)*30;});b.style.paddingLeft=(match[1].length-1)*10+'px';$('outline-list').append(b);}offset+=line.length+1;}}
    else $('rich-editor').querySelectorAll('.toastui-editor-ww-container h1,.toastui-editor-ww-container h2,.toastui-editor-ww-container h3,.toastui-editor-ww-container h4').forEach(h=>{const b=button(h.textContent,()=>h.scrollIntoView({behavior:'smooth',block:'center'}));b.style.paddingLeft=(Number(h.tagName[1])-1)*10+'px';$('outline-list').append(b);});
    if(!$('outline-list').children.length)$('outline-list').append(text('p','添加小标题后，会显示在这里。','muted'));
  }
  async function upload(file){if(file.size>5000000)throw new Error('图片请小于 5 MB');const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=reject;reader.readAsDataURL(file);});return(await api('upload',{data})).url;}
  async function preview(){const result=await api('preview',{body:body()});const heading=text('h1',$('title').value).outerHTML;$('preview').srcdoc=`<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><link rel="stylesheet" href="/katex/katex.min.css"><style>body{max-width:680px;margin:35px auto;padding:0 24px 50px;font:16px/1.95 'Microsoft YaHei',sans-serif;color:#393541;overflow-wrap:anywhere}h1,h2,h3{font-family:Georgia,SimSun,serif;line-height:1.6}h1{font-size:30px}h2{margin-top:36px}a{color:#847196}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #ddd5e6;padding:9px}th{background:#f0ebf5}pre,.katex-display{overflow:auto;padding:14px;background:#f6f3f8}img{max-width:100%;border-radius:8px}blockquote{border-left:3px solid #c4afcf;margin-left:0;padding-left:20px;color:#837889}</style></head><body>${heading}${result.html}</body></html>`;$('preview-dialog').showModal();}
  async function review(options={}){if(uploadCount)throw new Error('图片正在插入，请完成后再发布');await save();reviewed=await api('review',{id:current?.id,...options});$('review-title').textContent=reviewed.title;$('review-summary').textContent=reviewed.summary;$('review-meta').textContent=reviewed.seriesOnly?'只更新系列目录，草稿继续留在本机。':`${reviewed.assets.length} 张随文配图 · ${reviewed.category||'文章'}${options.private?'':' · 同步系列目录'}`;$('review').showModal();}
  $('review-confirm').onclick=()=>attempt(async()=>{ $('review-confirm').disabled=true;try{await api('publish',{items:reviewed.seriesOnly?[]:[{id:reviewed.id,revision:reviewed.revision}],seriesOnly:!!reviewed.seriesOnly,libraryRevision:reviewed.libraryRevision});$('review').close();await poll();}finally{$('review-confirm').disabled=false;} });
  let lastJob='';async function poll(){try{const job=await api('status');busy=['building','uploading','deploying'].includes(job.state);$('publication-status').textContent=job.state==='idle'?'':job.message;$('publish').disabled=$('series-publish').disabled=$('private-publish').disabled=busy;
    const key=job.state+':'+job.updated;if(key!==lastJob){lastJob=key;await refresh();if(current){const renamed=all.find(p=>nameOf(p.id)===nameOf(current.id));if(renamed){current.id=renamed.id;localSet('studio-last',current.id);}}}
  }catch(e){$('publication-status').textContent='暂时无法连接写作服务；未保存的文字仍保留在当前窗口。';}}
  ['title','date','summary'].forEach(id=>$(id).addEventListener('input',()=>changed()));
  $('source-editor').oninput=()=>{changed(true);$('mode-toggle').disabled=special($('source-editor').value);$('compatibility').hidden=!special($('source-editor').value);};
  $('editor').addEventListener('compositionstart',()=>{composing=true;clearTimeout(timer);});$('editor').addEventListener('compositionend',()=>{composing=false;changed(true);});
  $('editor').addEventListener('keyup',remember);$('editor').addEventListener('pointerup',remember);$('editor').addEventListener('scroll',remember,{passive:true});
  $('mode-toggle').onclick=()=>attempt(async()=>{await save();remember();const raw=body();if(sourceMode&&special(raw))return;const wasSource=sourceMode;loadEditor(raw,!wasSource);status('已切换编辑方式');});
  document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>attempt(()=>setView(b.dataset.view)));
  document.querySelectorAll('[data-close]').forEach(b=>b.onclick=()=>$(b.dataset.close).hidden=true);
  document.querySelectorAll('[data-dialog-close]').forEach(b=>b.onclick=()=>$(b.dataset.dialogClose).close());
  const actions={'new-post':()=>newPost(),'empty-new':()=>newPost(),'series-write':()=>newPost(),'templates':templates,'empty-template':templates,'template-manage':templates,'template-new':()=>templateForm(),'new-series':()=>seriesForm(),'series-settings':()=>seriesForm(activeSeries()),'article-new-series':()=>seriesForm(null,[current.id]),'article-series':()=>addToSeries([current.id]),'batch-add':()=>addToSeries([...chosen]),'batch-clear':()=>{chosen.clear();renderList();},'save-template':()=>templateForm(null,true),'settings-toggle':()=>toggleDrawer('settings'),'outline-toggle':()=>toggleDrawer('outline'),'save':save,'preview-open':preview,'publish':()=>review(),'series-publish':()=>review({seriesOnly:true}),'private-publish':()=>review({private:true}),'private-open':async()=>{await save();remember();$('empty').hidden=$('editor').hidden=$('article-actions').hidden=true;$('private-panel').hidden=$('private-actions').hidden=false;$('document-state').textContent='私人手记 · 密码解锁';status('');if(!$('private-frame').src)$('private-frame').src=privateUrl;}};
  for(const [id,action]of Object.entries(actions))$(id).onclick=()=>attempt(action);
  $('filter').oninput=renderList;
  addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();attempt(save);}});
  addEventListener('beforeunload',e=>{remember();if(dirty||saving||uploadCount){e.preventDefault();e.returnValue='';}});
  attempt(async()=>{const session=await api('session');token=session.token;privateUrl=session.privateUrl;await refresh();const oldView=localGet('studio-view','recent');if(['recent','all','draft','published'].includes(oldView)||collection.series.some(s=>'series:'+s.id===oldView))view=oldView;renderNav();renderList();const last=localGet('studio-last',null);if(last&&all.some(p=>nameOf(p.id)===nameOf(last)))await openId(last);await poll();setInterval(poll,6000);});
})();
