import Editor, {StudioCodeBlockView} from '@toast-ui/editor';
import '@toast-ui/editor/dist/i18n/zh-cn';
import DOMPurify from 'dompurify';
import {prepareVisualContent,scanImages} from './visual-content.mjs';
window.prepareVisualContent = prepareVisualContent;
window.scanArticleImages = scanImages;
window.studioSourceBlocks = options => context => ({wysiwygNodeViews:{codeBlock(node,view,getPos,eventEmitter){
  if(!options.isSourceLanguage(node.attrs.language))return new StudioCodeBlockView(node,view,getPos,eventEmitter);
  const dom=document.createElement('div'),toolbar=document.createElement('div'),toggle=document.createElement('button'),preview=document.createElement('div'),pre=document.createElement('pre'),code=document.createElement('code');
  dom.className='studio-special-block';toolbar.contentEditable=preview.contentEditable='false';toolbar.className='studio-special-tools';preview.className='studio-special-preview';toggle.type='button';toggle.textContent='编辑这一块';toolbar.append(toggle);pre.append(code);pre.hidden=true;dom.append(toolbar,preview,pre);
  let current=node,editing=false,epoch=0,destroyed=false;
  const render=async()=>{const request=++epoch;try{const result=await options.render(current.textContent);if(!destroyed&&request===epoch)preview.innerHTML=DOMPurify.sanitize(result.html);}catch(_){if(!destroyed)preview.textContent=current.textContent;}};
  toggle.onclick=()=>{editing=!editing;pre.hidden=!editing;preview.hidden=editing;toggle.textContent=editing?'完成编辑':'编辑这一块';if(editing){view.dispatch(view.state.tr.setSelection(context.pmState.TextSelection.create(view.state.doc,getPos()+1)));view.focus();}else render();};
  render();
  return {dom,contentDOM:code,update(next){if(next.type!==current.type||!options.isSourceLanguage(next.attrs.language))return false;const changed=next.textContent!==current.textContent;current=next;if(changed&&!editing)render();return true;},stopEvent:event=>toolbar.contains(event.target)||preview.contains(event.target),ignoreMutation:mutation=>mutation.type!=='selection'&&!code.contains(mutation.target),destroy(){destroyed=true;epoch++;}};
}}});
window.toastui = {Editor};
window.DOMPurify = DOMPurify;
