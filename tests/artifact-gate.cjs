"use strict";
const fs=require("node:fs"),path=require("node:path"),assert=require("node:assert/strict");
const root=path.resolve(__dirname,"..");
const files=["src/Elm/Kernel/HttpServer.js","build/server-debug.js","build/server-optimize.js"];
for(const relative of files){
  const source=fs.readFileSync(path.join(root,relative),"utf8");
  assert.doesNotMatch(source,/\/home\/|\/opt\/elm-harness|sourceMappingURL|fixtures\/feasibility|observationHook/);
  assert.doesNotMatch(source,/require\(["']ws["']\)/,"production must not use ambient ws");
  assert.match(source,/canonical-sha256 [a-f0-9]{64}/);
}
const publicElm=fs.readFileSync(path.join(root,"src/Schelm/Node/HttpServer.elm"),"utf8");
assert.doesNotMatch(publicElm,/WebSocketServer|WebSocketMessage|RawSocket/);
console.log(JSON.stringify({artifacts:files.length,publicApi:"http-only"}));
