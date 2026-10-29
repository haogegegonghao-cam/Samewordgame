import { readFileSync } from 'node:fs';
const defaults=JSON.parse(readFileSync(new URL('../src/public-config.json',import.meta.url),'utf8'));
const url=process.env.VITE_SUPABASE_URL||defaults.url||'';
const key=process.env.VITE_SUPABASE_PUBLISHABLE_KEY||defaults.publishableKey||'';
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||!key||url.includes('YOUR_')||key.includes('YOUR_')){
  console.error('请在 GitHub Settings → Secrets and variables → Actions → Variables 添加 VITE_SUPABASE_URL 与 VITE_SUPABASE_PUBLISHABLE_KEY。请使用 publishable/anon 公钥。');process.exit(1);
}
if(key.startsWith('sb_secret_')){console.error('禁止把 Supabase secret key 放进前端。');process.exit(1);}
if(key.split('.').length===3){
  try{if(JSON.parse(Buffer.from(key.split('.')[1],'base64url').toString()).role!=='anon')throw Error();}
  catch{console.error('JWT 必须是 anon public key，禁止 service_role/admin 密钥。');process.exit(1);}
}else if(!key.startsWith('sb_publishable_')){console.error('请使用 Supabase publishable key 或 legacy anon public key。');process.exit(1);}
console.log('Public Supabase configuration validated.');
