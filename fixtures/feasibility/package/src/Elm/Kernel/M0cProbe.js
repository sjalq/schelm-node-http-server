/*
import Elm.Kernel.Scheduler exposing (binding, succeed, rawSpawn)
import Platform exposing (sendToSelf)
*/
var $m0cBinds = new Map();
var $m0cTerminals = new Set();
function $m0cTask(fn) {
  return __Scheduler_binding(function(done) {
    try { fn(); } finally { done(__Scheduler_succeed(_Utils_Tuple0)); }
  });
}
function $m0cSelf(router, value) {
  __Scheduler_rawSpawn(A2(__Platform_sendToSelf, router, value));
}
var _M0cProbe_beginBind = F3(function(router, id, makeDone) {
  return $m0cTask(function() {
    // Withheld by design. cancelBind owns the first terminal transition.
    $m0cBinds.set(id, { router: router, done: makeDone });
  });
});
var _M0cProbe_cancelBind = function(id) {
  return $m0cTask(function() {
    var active = $m0cBinds.get(id);
    if (!active || $m0cTerminals.has(id)) return;
    $m0cBinds.delete(id);
    $m0cTerminals.add(id);
    $m0cSelf(active.router, A4(active.done, id, false, 'cancelled', 0));
    // Duplicate terminal fact: manager must ignore after removing Reply.
    $m0cSelf(active.router, A4(active.done, id, true, 'late-listening', 99));
  });
};
var _M0cProbe_runWrite = F4(function(router, id, script, makeDone) {
  return $m0cTask(function() {
    var writes = 0, falseWrites = 0, drains = 0, retained = 0, blocked = false;
    function write(result) {
      if (blocked) throw new Error('write while blocked');
      writes++;
      if (!result) { blocked = true; falseWrites++; retained = 1; }
    }
    write(false);
    if (script === 'false-drain') { blocked = false; drains++; retained = 0; write(true); $m0cSelf(router, A3(makeDone,id,'write-ok',JSON.stringify({writes,falseWrites,drains,retained}))); }
    else if (script === 'error') { retained = 0; $m0cSelf(router, A3(makeDone,id,'write-error',JSON.stringify({writes,falseWrites,drains,retained}))); }
    else { retained = 0; $m0cSelf(router, A3(makeDone,id,'write-close',JSON.stringify({writes,falseWrites,drains,retained}))); }
    $m0cSelf(router, A3(makeDone,id,'duplicate','must-ignore'));
  });
});
var _M0cProbe_runUpgrade = F4(function(router, id, scenario, makeDone) {
  return $m0cTask(function() {
    var req = { url: '/ws', marker: id };
    var socket = { marker: id, destroyed: false, destroy: function(){ this.destroyed=true; } };
    var head = Buffer.from([0x81,0x02,0x68,0x69]);
    var offer = { req: req, socket: socket, head: head };
    var registry = new Map([[id, offer]]);
    function claim() { var x=registry.get(id); if(!x)return null; registry.delete(id); return x; }
    var kind, detail;
    try {
      if (scenario === 'transfer') {
        var owned=claim();
        var exact=owned.req===req && owned.socket===socket && owned.head===head && owned.head.length===4;
        kind='upgrade-transfer'; detail=JSON.stringify({exact:exact,head:owned.head.toString('hex'),duplicate:claim()===null,remaining:registry.size});
      } else if (scenario === 'reject') {
        claim().socket.destroy(); kind='upgrade-reject'; detail=JSON.stringify({destroyed:socket.destroyed,remaining:registry.size});
      } else if (scenario === 'timeout') {
        claim().socket.destroy(); kind='upgrade-timeout'; detail=JSON.stringify({destroyed:socket.destroyed,remaining:registry.size});
      } else {
        var thrown=claim(); try { throw new Error('adapter-throw'); } catch (_) { thrown.socket.destroy(); }
        kind='upgrade-throw'; detail=JSON.stringify({destroyed:socket.destroyed,remaining:registry.size});
      }
    } catch (_) { kind='fixture-failure'; detail='unexpected'; }
    $m0cSelf(router, A3(makeDone,id,kind,detail));
    $m0cSelf(router, A3(makeDone,id,'duplicate','must-ignore'));
  });
});
var _M0cProbe_emit = F5(function(router, listenerId, generation, value, makeIncoming) {
  return $m0cTask(function() { $m0cSelf(router, A3(makeIncoming,listenerId,generation,value)); });
});
