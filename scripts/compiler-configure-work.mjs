import { readFileSync,writeFileSync,copyFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const client=JSON.parse(readFileSync('.private/pi-compiler.json','utf8'));
const fields={LATEX_COMPILER_URL:client.url,LATEX_COMPILER_TOKEN:client.token,...(client.accessClientId?{LATEX_ACCESS_CLIENT_ID:client.accessClientId,LATEX_ACCESS_CLIENT_SECRET:client.accessClientSecret}:{})};
const mode=process.argv[2]||'local';
if(mode==='local'){
  let content='';try{content=readFileSync('.dev.vars','utf8');copyFileSync('.dev.vars','.private/dev-vars-before-pi');}catch{/* initial local setup */}
  content=content.split('\n').filter(line=>!/^LATEX_(COMPILER|ACCESS)_/.test(line)).join('\n');
  writeFileSync('.dev.vars',`${content.trim()}\n${Object.entries(fields).map(([key,value])=>`${key}=${value}`).join('\n')}\n`,{mode:0o600});
  console.log('Local Worker compiler settings updated; previous settings backed up privately.');
}else if(['staging','production'].includes(mode)){
  if(!client.accessClientId)throw new Error('Configure compiler Access before publishing its credentials.');
  writeFileSync('.private/work-compiler-secrets.json',JSON.stringify(fields),{mode:0o600});
  const args=['node_modules/wrangler/bin/wrangler.js','secret','bulk','.private/work-compiler-secrets.json','--config','wrangler.jsonc',...(mode==='staging'?['--env','staging']:[])];
  const result=execFileSync(process.execPath,args,{encoding:'utf8',stdio:['ignore','pipe','pipe']});console.log(result);
}else throw new Error('Expected local, staging, or production.');
