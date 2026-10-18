'use strict';
const path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
// Bundle the studio editors once per source/dependency change into .studio/editor-<hash>/.
function editorBundle() {
  const entry=path.join(__dirname,'studio/editor-entry.mjs'),lock=path.join(root,'package-lock.json');
  const stamp=crypto.createHash('sha256').update(fs.readFileSync(entry)).update(fs.readFileSync(path.join(__dirname,'studio/visual-content.mjs'))).update(fs.readFileSync(lock)).update(fs.readFileSync(__filename)).digest('hex').slice(0,16);
  const directory=path.join(root,'.studio'),output=path.join(directory,'editor-'+stamp);
  fs.mkdirSync(directory,{recursive:true});
  if(!fs.existsSync(path.join(output,'editor-entry.js'))){
    const temporary=output+'.'+process.pid+'.tmp';fs.rmSync(temporary,{recursive:true,force:true});
    require('esbuild').buildSync({entryPoints:[entry],outdir:temporary,bundle:true,splitting:true,format:'esm',minify:true,platform:'browser',target:['chrome110','safari16'],chunkNames:'chunks/[name]-[hash]',assetNames:'assets/[name]-[hash]',loader:{'.woff2':'file','.woff':'file','.ttf':'file'},legalComments:'none',logLevel:'silent'});
    fs.rmSync(output,{recursive:true,force:true});fs.renameSync(temporary,output);
    for(const old of fs.readdirSync(directory))if(/^editor-[0-9a-f]{16}$/.test(old)&&old!=='editor-'+stamp)fs.rmSync(path.join(directory,old),{recursive:true,force:true});
  }
  return output;
}
module.exports={editorBundle};
