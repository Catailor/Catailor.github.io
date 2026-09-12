'use strict';
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
function editorBundle() {
  const entry=path.join(__dirname,'studio/editor-entry.mjs'),lock=path.join(root,'package-lock.json');
  const stamp=crypto.createHash('sha256').update(fs.readFileSync(entry)).update(fs.readFileSync(lock)).digest('hex');
  const directory=path.join(root,'.studio'),output=path.join(directory,'editor.js'),marker=path.join(directory,'editor-build.txt');
  fs.mkdirSync(directory,{recursive:true});
  if(!fs.existsSync(output)||!fs.existsSync(marker)||fs.readFileSync(marker,'utf8')!==stamp){
    require('esbuild').buildSync({entryPoints:[entry],outfile:output,bundle:true,minify:true,platform:'browser',target:['chrome110'],legalComments:'inline'});
    fs.writeFileSync(marker,stamp);
  }
  return output;
}
module.exports={editorBundle};
