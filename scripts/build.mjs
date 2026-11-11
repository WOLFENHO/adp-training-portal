import { existsSync, lstatSync, openSync, closeSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')
const output=path.resolve(root,'.next'),lock=path.resolve(root,'.adp-build.lock')
// Only the reserved generated production directory is eligible for cleanup.
if(path.dirname(output)!==root||path.basename(output)!=='.next')throw Error('Unsafe build output')
let descriptor
try{descriptor=openSync(lock,'wx')}catch{throw Error('Another ADP build is running, or a stale .adp-build.lock requires operator review')}
try{
 if(existsSync(output)){
  if(lstatSync(output).isSymbolicLink()||!lstatSync(output).isDirectory())throw Error('Refusing to remove a redirected or non-directory build output')
  rmSync(output,{recursive:true,force:true,maxRetries:3,retryDelay:200})
 }
 const result=spawnSync(process.execPath,[path.resolve(root,'node_modules/next/dist/bin/next'),'build'],{cwd:root,stdio:'inherit'})
 if(result.error)throw result.error
 process.exitCode=result.status??1
}finally{closeSync(descriptor);rmSync(lock)}
