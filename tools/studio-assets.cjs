'use strict';
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function editorBundle() {
  const entry=path.join(__dirname,'studio/editor-entry.mjs'),lock=path.join(root,'package-lock.json');
  const stamp=crypto.createHash('sha256').update(fs.readFileSync(entry)).update(fs.readFileSync(path.join(__dirname,'studio/visual-content.mjs'))).update(fs.readFileSync(lock)).update(fs.readFileSync(__filename)).digest('hex');
  const directory=path.join(root,'.studio'),output=path.join(directory,'editor-'+stamp+'.js'),marker=path.join(directory,'editor-build.txt');
  fs.mkdirSync(directory,{recursive:true});
  if(!fs.existsSync(output)){
    // Toast UI 3.2.2 leaves a throttled resize callback queued after destroy.
    // Guard that callback in our generated bundle, without changing installed
    // packages or sharing undo history between different articles.
    const vendor=path.join(path.dirname(require.resolve('@toast-ui/editor')),'esm/index.js');
    let source=fs.readFileSync(vendor,'utf8');
    const resize='// reset toolbar items to re-layout toolbar items with each clientWidth';
    const destroy='Toolbar.prototype.beforeDestroy = function () {';
    if(!source.includes(resize)||!source.includes(destroy))throw new Error('编辑器版本已改变，请检查工具栏生命周期补丁');
    source=source.replace(resize,'if (_this.studioDestroyed) return;\n'+resize).replace(destroy,destroy+'\n        this.studioDestroyed = true;');
    source+='\nexport { CodeBlockView as StudioCodeBlockView };\n';
    const guarded=path.join(directory,'editor-vendor-'+process.pid+'.mjs');fs.writeFileSync(guarded,source);
    const contents=fs.readFileSync(entry,'utf8').replace("'@toast-ui/editor/dist/i18n/zh-cn'",JSON.stringify(require.resolve('@toast-ui/editor/dist/i18n/zh-cn')));
    require('esbuild').buildSync({stdin:{contents,resolveDir:path.dirname(entry),sourcefile:entry,loader:'js'},alias:{'@toast-ui/editor':guarded},outfile:output+'.'+process.pid+'.tmp',bundle:true,minify:true,platform:'browser',target:['chrome110'],legalComments:'inline'});
    fs.renameSync(output+'.'+process.pid+'.tmp',output);
    fs.writeFileSync(marker,stamp);
  }
  return output;
}
module.exports={editorBundle};
