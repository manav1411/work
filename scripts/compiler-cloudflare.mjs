import { execFileSync } from 'node:child_process';
import { readFileSync,writeFileSync,mkdirSync } from 'node:fs';
const account='235b7f098227aa97860dfd1d4ea9ee71';
let token;
try{
  token=readFileSync('.private/cloudflare-api-token','utf8').trim();
  token=token.replace(/^\s*cloudflare-api-token\s*=\s*/, '').trim().replace(/^['"]|['"]$/g, '');
}catch{token=JSON.parse(execFileSync(process.execPath,['node_modules/wrangler/bin/wrangler.js','auth','token','--json'],{encoding:'utf8',stdio:['ignore','pipe','pipe']})).token;}
const api=async(path,method='GET',body)=>{const response=await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`,{method,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});const value=await response.json();if(!value.success)throw new Error(`Cloudflare ${response.status}: ${(value.errors||[]).map(e=>e.message).join('; ')}`);return value.result;};
const action=process.argv[2]||'check';
if(action==='check'){const apps=await api('/access/apps');console.log(JSON.stringify({accessAvailable:true,applications:apps.map(a=>({id:a.id,name:a.name,domain:a.domain}))}));}
if(action==='configure'){
  const hostname='work-compiler.manavdodia.com';
  const apps=await api('/access/apps');let app=apps.find(a=>a.domain===hostname);
  if(!app)app=await api('/access/apps','POST',{name:'Work private compiler',domain:hostname,type:'self_hosted',session_duration:'24h'});
  const credential=await api('/access/service_tokens','POST',{name:`Work compiler ${new Date().toISOString().slice(0,10)}`,duration:'8760h'});
  await api(`/access/apps/${app.id}/policies`,'POST',{name:'Work Worker only',decision:'non_identity',include:[{service_token:{token_id:credential.id}}]});
  const client=JSON.parse(readFileSync('.private/pi-compiler.json','utf8'));
  Object.assign(client,{accessClientId:credential.client_id,accessClientSecret:credential.client_secret});
  mkdirSync('.private',{recursive:true});writeFileSync('.private/pi-compiler.json',JSON.stringify(client),{mode:0o600});
  console.log('Compiler Access service policy configured; credentials stored privately.');
}
