"use strict";
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const machine = fs.readFileSync(path.join(root, "kernel-src/http-server.js"), "utf8");
const hash = crypto.createHash("sha256").update(machine).digest("hex");
const prelude = `/*\nimport Elm.Kernel.Bytes exposing (width)\nimport Elm.Kernel.List exposing (fromArray, toArray)\nimport Elm.Kernel.Scheduler exposing (binding, succeed, rawSpawn)\nimport Platform exposing (sendToSelf)\n*/\n`;
const bridge = `
var $schelmRegistry = new ServerRegistry({
  emit: function(router, value) { __Scheduler_rawSpawn(A2(__Platform_sendToSelf, router, value)); },
  incoming: function(router, listenerId, raw, owner) {
    var route = $schelmRoutes.get(listenerId);
    if (route && route.present) __Scheduler_rawSpawn(A2(__Platform_sendToSelf, router, A3(route.makeIncoming, listenerId, route.generation, $rawIncoming(raw))));
    else $schelmRegistry.rejectStale(raw.responseId, raw.upgradeId);
  },
  aborted: function(router, exchange, reason) {
    var listener = exchange.listener;
    var route = $schelmRoutes.get(listener.id);
    if (!route || !route.present) return;
    var raw = { kind: "aborted", request: { id: exchange.requestId, method_: "", target_: "", targetForm_: "invalid", version: "", headers_: [], remote: "", encrypted_: false }, bodyId: 0, responseId: 0, upgradeId: 0, reason: reason };
    __Scheduler_rawSpawn(A2(__Platform_sendToSelf, router, A3(route.makeIncoming, listener.id, route.generation, $rawIncoming(raw))));
  }
});
var $schelmRoutes = new RouteRegistry();
function $task(fn) { return __Scheduler_binding(function(done) { try { fn(); } finally { done(__Scheduler_succeed(_Utils_Tuple0)); } }); }
function $rawOptions(o) { return { limits: { connections:o.__$limits.__$connections, exchanges:o.__$limits.__$exchanges, requestBytes:o.__$limits.__$requestBytes, responseBytes:o.__$limits.__$responseBytes, upgrades:o.__$limits.__$upgrades, closeWaiters:o.__$limits.__$closeWaiters, requestsPerSocket:o.__$limits.__$requestsPerSocket, headerPairs:o.__$limits.__$headerPairs }, headersTimeout:o.__$headersTimeout, requestTimeout:o.__$requestTimeout, decisionTimeout:o.__$decisionTimeout, bodyTimeout:o.__$bodyTimeout, writeTimeout:o.__$writeTimeout, finishTimeout:o.__$finishTimeout, keepAliveTimeout:o.__$keepAliveTimeout, upgradeTimeout:o.__$upgradeTimeout, gracefulTimeout:o.__$gracefulTimeout }; }
function $rawRequest(r) { return { __$id:r.id, __$method_:r.method_, __$target_:r.target_, __$targetForm_:r.targetForm_, __$version:r.version, __$headers_:__List_fromArray(r.headers_.map(function(h){return {__$name:h.name,__$value:h.value};})), __$remote:r.remote, __$encrypted_:r.encrypted_ }; }
function $rawIncoming(r) { return { __$kind:r.kind, __$request:$rawRequest(r.request), __$bodyId:r.bodyId, __$responseId:r.responseId, __$upgradeId:r.upgradeId, __$reason:r.reason }; }
var _HttpServer_configureRoutes = F3(function(router,routes,makeIncoming){ return $task(function(){ $schelmRoutes.reconcile(router,__List_toArray(routes).map(function(r){ return [r.__$listenerId,r.__$generation,r.__$present]; }),makeIncoming); }); });
var _HttpServer_listen = F6(function(router,op,host,port,options,makeFact){ return $task(function(){ $schelmRegistry.listen(router,op,host,port,$rawOptions(options),function(a,b,c,d,e){return A5(makeFact,a,b,c,d,e);}); }); });
var _HttpServer_cancelListen = function(op){ return $task(function(){ $schelmRegistry.cancelListen(op); }); };
var _HttpServer_readBody = F5(function(router,op,id,limit,makeFact){ return $task(function(){ $schelmRegistry.readBody(router,op,id,limit,function(a,b,c,d,e){return A5(makeFact,a,b,c,d,e);}); }); });
var _HttpServer_discardBody = F4(function(router,op,id,makeFact){ return $task(function(){ $schelmRegistry.discardBody(router,op,id,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_send = F7(function(router,op,id,code,headers,bytes,makeFact){ return $task(function(){ $schelmRegistry.send(router,op,id,code,headers,bytes,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_stream = F6(function(router,op,id,code,headers,makeFact){ return $task(function(){ $schelmRegistry.stream(router,op,id,code,headers,function(a,b,c){return A3(makeFact,a,b,c);}); }); });
var _HttpServer_write = F5(function(router,op,id,bytes,makeFact){ return $task(function(){ $schelmRegistry.write(router,op,id,bytes,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_end = F4(function(router,op,id,makeFact){ return $task(function(){ $schelmRegistry.end(router,op,id,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_abort = F2(function(id,reason){ return $task(function(){ $schelmRegistry.abort(id,reason); }); });
var _HttpServer_rejectUpgrade = F5(function(router,op,id,code,makeFact){ return $task(function(){ $schelmRegistry.rejectUpgrade(router,op,id,code,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_rejectStale = F2(function(responseId,upgradeId){ return $task(function(){ $schelmRegistry.rejectStale(responseId,upgradeId); }); });
var _HttpServer_close = F5(function(router,op,id,timeout,makeFact){ return $task(function(){ $schelmRegistry.close(router,op,id,timeout,function(a,b,c,d,e){ if(b === "ok") $schelmRoutes.close(id); return A5(makeFact,a,b,c,d,e); }); }); });
`;
const source = prelude + `/* generated canonical-sha256 ${hash} */\n` + machine.replace(/module\.exports[^;]+;/, "") + bridge;
const target = path.join(root, "src/Elm/Kernel/HttpServer.js");
if (process.argv.includes("--check")) { if (!fs.existsSync(target) || fs.readFileSync(target,"utf8") !== source) { console.error("stale generated kernel"); process.exit(1); } console.log(`checked ${hash}`); }
else { fs.mkdirSync(path.dirname(target),{recursive:true}); fs.writeFileSync(target,source); console.log(`assembled ${hash}`); }
