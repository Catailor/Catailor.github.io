(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.StudioTaxonomy=factory();})(typeof globalThis==='object'?globalThis:this,function(){
  'use strict';
  const split=value=>String(value||'').split(/[,，;；\n]+/).map(s=>s.trim()).filter(Boolean);
  const unique=items=>[...new Set(items)];
  function validate(items){
    if(!Array.isArray(items)||items.length>30||items.some(s=>typeof s!=='string'||s.length>100||/[\x00-\x1f\x7f]/.test(s)))throw new Error('分类和标签最多各 30 个，每个名称不超过 100 字');
    return unique(items.map(s=>s.trim()).filter(Boolean));
  }
  function categories(value){
    if(!value)return [];
    const rows=Array.isArray(value)?value:[value];
    if(rows.every(v=>typeof v==='string'||typeof v==='number'))return rows.length?[rows.map(String).join(' / ')]:[];
    return rows.map(v=>(Array.isArray(v)?v:[v]).filter(x=>typeof x==='string'||typeof x==='number').map(String).join(' / ')).filter(Boolean);
  }
  const tags=value=>unique([].concat(value||[]).filter(v=>typeof v==='string'||typeof v==='number').map(String));
  const categoryNames=value=>unique(value.flatMap(v=>v.split(/\s*\/\s*/)).filter(Boolean));
  function categoryData(paths){return paths.map(p=>p.split(/\s*\/\s*/).filter(Boolean));}
  function matches(rule,post){
    if(!rule)return false;
    const cats=new Set([...(post.categories||[]),...categoryNames(post.categories||[])]),tagSet=new Set(post.tags||[]);
    const checks=[...(rule.categories||[]).map(v=>cats.has(v)),...(rule.tags||[]).map(v=>tagSet.has(v))];
    return !!checks.length&&(rule.match==='any'?checks.some(Boolean):checks.every(Boolean));
  }
  const file=post=>(post.id||post.file).split('/').pop();
  function members(series,posts){
    const byName=new Map(posts.map(p=>[file(p),p])),manual=(series.posts||[]).map(n=>byName.get(n)).filter(Boolean);
    const used=new Set((series.posts||[]).concat(series.excluded||[]));
    const automatic=posts.filter(p=>!used.has(file(p))&&matches(series.rule,p)).sort((a,b)=>(series.rule?.order==='oldest'?1:-1)*a.date.localeCompare(b.date)||file(a).localeCompare(file(b)));
    return manual.concat(automatic);
  }
  return {split,validate,categories,tags,categoryNames,categoryData,matches,members};
});
