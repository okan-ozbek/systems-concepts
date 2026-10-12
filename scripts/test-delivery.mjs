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
const files=(await readdir('dist/assets')).filter(name=>/\.(js|css)$/.test(name));
for(const name of files){
  const path=`/assets/${name}`;
  const [identity,gzip,disabled]=await Promise.all([get(path,'identity'),get(path,'gzip'),get(path,'gzip;q=0')]);
  const original=await readFile(`dist/assets/${name}`);
  assert.equal(identity.status,200,name);
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
const missing=await get('/assets/missing.js','gzip');
assert.equal(missing.status,404);
console.log('PASS compressed/identity parity, MIME types, q=0, Vary, asset caching, HTML revalidation, missing assets');
