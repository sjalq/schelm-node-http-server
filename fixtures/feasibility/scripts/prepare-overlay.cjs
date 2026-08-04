"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const root=path.resolve(__dirname,"..");
const client="/home/s.dormehl/git/schelm/.worktrees/program-foundation/packages/node-http-client/.worktrees/schelm-node-http-client-v1";
const caches=fs.readdirSync(path.join(client,"build/cache")).filter(x=>!x.endsWith(".lock"));
if(!caches.length)throw new Error("http-client public package cache missing");
const home=fs.mkdtempSync(path.join(os.tmpdir(),"schelm-server-feasibility-"));
fs.mkdirSync(path.join(home,"0.19.2"),{recursive:true});
fs.cpSync(path.join(client,"build/cache",caches[0]),path.join(home,"0.19.2"),{recursive:true});
const packages=path.join(home,"0.19.2/packages");
const dest=path.join(packages,"sjalq/schelm-node-http-server-feasibility/1.0.0");
fs.mkdirSync(dest,{recursive:true});
fs.cpSync(path.join(root,"package/src"),path.join(dest,"src"),{recursive:true});
for(const f of ["elm.json"])fs.copyFileSync(path.join(root,"package",f),path.join(dest,f));
fs.writeFileSync(path.join(dest,"README.md"),"# feasibility fixture only\n");fs.writeFileSync(path.join(dest,"LICENSE"),"BSD-3-Clause\n");
let registry=fs.readFileSync(path.join(packages,"registry.dat"));
function entries(buf){let pos=16,n=Number(buf.readBigUInt64BE(8)),xs=[];for(let i=0;i<n;i++){const start=pos,la=buf[pos++],author=buf.subarray(pos,pos+la).toString();pos+=la;const lp=buf[pos++],project=buf.subarray(pos,pos+lp).toString();pos+=lp;const major=buf[pos++];if(major===255)throw Error("large version unsupported");pos+=2;const previous=Number(buf.readBigUInt64BE(pos));pos+=8+3*previous;xs.push({author,project,start});}return{n,xs};}
function add(buf,author,project){const {n,xs}=entries(buf),key=`${author}/${project}`;const index=xs.findIndex(x=>`${x.author}/${x.project}`>key),at=index<0?buf.length:xs[index].start;const entry=Buffer.concat([Buffer.from([Buffer.byteLength(author)]),Buffer.from(author),Buffer.from([Buffer.byteLength(project)]),Buffer.from(project),Buffer.from([1,0,0]),Buffer.alloc(8)]),out=Buffer.concat([buf.subarray(0,at),entry,buf.subarray(at)]);out.writeBigUInt64BE(buf.readBigUInt64BE(0)+1n,0);out.writeBigUInt64BE(BigInt(n+1),8);return out;}
registry=add(registry,"sjalq","schelm-node-http-server-feasibility");fs.writeFileSync(path.join(packages,"registry.dat"),registry);process.stdout.write(home);
