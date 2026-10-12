// NGINX gzip_static serves these alongside the original files for clients
// advertising gzip. Keep original files for clients without compression.
import {readdir,readFile,writeFile,stat,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {gzipSync} from 'node:zlib';

async function compress(directory){
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory()){await compress(path);continue;}
    if(!/\.(?:js|css|html|svg|json)$/.test(entry.name))continue;
    const original=await readFile(path);
    if(original.length<256)continue;
    const compressed=gzipSync(original,{level:9});
    if(compressed.length>=original.length)continue;
    await writeFile(`${path}.gz`,compressed);
    const metadata=await stat(path);
    await utimes(`${path}.gz`,metadata.atime,metadata.mtime);
    console.log(`${path}: ${original.length} B → ${compressed.length} B gzip`);
  }
}
await compress('dist');
