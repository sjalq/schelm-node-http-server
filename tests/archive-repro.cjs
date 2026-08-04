"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os"),cp=require("node:child_process"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,".."),archive=path.join(root,"vendor/ws-8.21.1.tgz");
const provenance=JSON.parse(fs.readFileSync(path.join(root,"vendor/ws-8.21.1.provenance.json")));
const sha=file=>crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
assert.equal(sha(archive),provenance.sha256);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),"schelm-ws-repro-"));
try{
  cp.execFileSync("tar",["-xzf",archive,"-C",dir]);
  const rebuilt=path.join(dir,"rebuilt.tgz");
  cp.execFileSync("tar",["--sort=name","--mtime=@0","--owner=0","--group=0","--numeric-owner","-czf",rebuilt,"-C",dir,"package"]);
  assert.equal(sha(rebuilt),provenance.sha256);
  assert.equal(crypto.createHash("sha256").update(fs.readFileSync(path.join(dir,"package/LICENSE"))).digest("hex"),provenance.licenseSha256);
  const names=cp.execFileSync("tar",["-tzf",archive],{encoding:"utf8"}).trim().split("\n");
  assert.ok(names.every(x=>x==="package/"||x.startsWith("package/")));
  console.log(JSON.stringify({archive:provenance.sha256,entries:names.length}));
}finally{cp.execFileSync("chmod",["-R","u+w",dir]);fs.rmSync(dir,{recursive:true,force:true});}
