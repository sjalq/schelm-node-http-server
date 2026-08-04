"use strict";
const fs=require("node:fs"),path=require("node:path"),crypto=require("node:crypto"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const expected={
  "vendor/toolchain/elm-76bbe44424106c96f915cb24cd7f50d69f5cee0e-linux-x64":"69987adf7062562b6e6dfd60b6709be3a06feeb90b096b9c84f673f2b97d8654",
  "vendor/toolchain/node-v24.4.1-linux-x64.xz":"af4edd929c751cdccfd63173c35a435d8ea96148342677def30acad79cc93215",
  "vendor/toolchain/public-packages-0.19.2.tar.gz":"59c3cd6ba9126cb77d1e4b4f09e0c7b91a32bb3ee9b7e40be424f482657cb74e"
};
for(const [relative,want] of Object.entries(expected)){const got=crypto.createHash("sha256").update(fs.readFileSync(path.join(root,relative))).digest("hex");assert.equal(got,want,relative);}
const ws=JSON.parse(fs.readFileSync(path.join(root,"vendor/ws-8.21.1.provenance.json")));
assert.equal(ws.version,"8.21.1");assert.equal(ws.license,"MIT");assert.equal(ws.runtimePolicy,"optional native dependencies absent; pure JavaScript fallback required");assert.match(ws.upstreamIntegrity,/^sha512-/);
console.log(JSON.stringify({toolchain:Object.keys(expected).length,ws:ws.version}));
