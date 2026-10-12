// Verify actual wire bytes and negotiation against the production NGINX image.
import assert from 'node:assert/strict';
import {request} from 'node:http';
import {readdir,readFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';

const base=process.env.DELIVERY_URL??'http://localhost:8080';
function get(path,encoding){
  return new Promise((resolve,reject)=>{
    const req=request(new URL(path,base),{headers:{'Accept-Encoding':encoding}},res=>{
      const chunks=[];
      res.on('data',chunk=>chunks.push(chunk));
      res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));
      res.on('error',reject);
    });
    req.on('error',reject);req.end();
  });
}
function securityHeaders(response){
  assert.match(response.headers['content-security-policy'],/script-src 'self' 'wasm-unsafe-eval'/);
  assert.match(response.headers['content-security-policy'],/worker-src 'self'/);
  assert.match(response.headers['content-security-policy'],/frame-ancestors 'none'/);
  assert.equal(response.headers['x-content-type-options'],'nosniff');
  assert.equal(response.headers['x-frame-options'],'DENY');
  assert.equal(response.headers['referrer-policy'],'strict-origin-when-cross-origin');
  assert.match(response.headers['permissions-policy'],/camera=\(\)/);
}
const files=(await readdir('dist/assets')).filter(name=>/\.(js|css)$/.test(name));
for(const name of files){
  const path=`/assets/${name}`;
  const [identity,gzip,disabled]=await Promise.all([get(path,'identity'),get(path,'gzip'),get(path,'gzip;q=0')]);
  const original=await readFile(`dist/assets/${name}`);
  assert.equal(identity.status,200,name);
  securityHeaders(identity);securityHeaders(gzip);
  assert.equal(identity.headers['content-encoding'],undefined,name);
  assert.deepEqual(identity.body,original,name);
  assert.equal(gzip.headers['content-encoding'],'gzip',name);
  assert.deepEqual(gunzipSync(gzip.body),original,name);
  assert.ok(gzip.body.length<original.length,name);
  assert.match(gzip.headers.vary,/Accept-Encoding/i,name);
  assert.match(gzip.headers['content-type'],name.endsWith('.css')?/text\/css/:/(?:application|text)\/javascript/,name);
  assert.match(gzip.headers['cache-control'],/immutable/,name);
  assert.equal(disabled.headers['content-encoding'],undefined,name);
  assert.deepEqual(disabled.body,original,name);
  console.log(`${name}: ${identity.body.length} B → ${gzip.body.length} B over HTTP`);
}
const index=await get('/','identity');
assert.match(index.headers['cache-control'],/no-cache/);
securityHeaders(index);
const missing=await get('/assets/missing.js','gzip');
assert.equal(missing.status,404);
securityHeaders(missing);
const apiGet=await get('/api/cpp/compile','identity');
assert.equal(apiGet.status,405);securityHeaders(apiGet);
assert.equal((await get('/api/cpp/health','identity')).status,404);
const wrongType=await fetch(new URL('/api/cpp/compile',base),{method:'POST',body:'{}'});
assert.equal(wrongType.status,415);
// Changing a forged forwarded IP must not bypass a direct client's rate budget.
const statuses=[];
for(let i=0;i<9;i++){
  const response=await fetch(new URL('/api/cpp/compile',base),{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':`198.51.100.${i+1}`},body:JSON.stringify({source:'int main(){ broken; }'})});
  statuses.push(response.status);await response.arrayBuffer();
}
assert.ok(statuses.includes(429),`Rate limit not enforced: ${statuses}`);
console.log('PASS delivery, security headers (HTML/assets/worker/errors), API restrictions, forged-IP rate limit');
