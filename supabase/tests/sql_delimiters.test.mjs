import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
function validateSql(text,file){
 let i=0
 while(i<text.length){
  if(text.startsWith('--',i)){const end=text.indexOf('\n',i);i=end<0?text.length:end+1;continue}
  if(text.startsWith('/*',i)){const end=text.indexOf('*/',i+2);assert.notEqual(end,-1,file+' unterminated comment');i=end+2;continue}
  if(text[i]==="'"||text[i]==='"'){
   const quote=text[i++];let closed=false
   while(i<text.length){if(text[i++]===quote){if(text[i]===quote){i++;continue}closed=true;break}}
   assert.ok(closed,file+' unterminated quoted string');continue
  }
  if(text[i]==='$'){
   const tag=text.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0]
   assert.ok(tag,file+' malformed dollar quote near character '+i)
   const end=text.indexOf(tag,i+tag.length)
   assert.notEqual(end,-1,file+' unterminated '+tag)
   i=end+tag.length;continue
  }
  i++
 }
}
test('SQL migration and deployment scripts have balanced string and dollar quoting',()=>{
 for(const folder of ['supabase/migrations','supabase/deployment','supabase/tests'])for(const file of fs.readdirSync(folder).filter(f=>f.endsWith('.sql'))){
  const path=folder+'/'+file;validateSql(fs.readFileSync(path,'utf8'),path)
 }
 assert.throws(()=>validateSql('do $begin end$;','malformed fixture'))
})
