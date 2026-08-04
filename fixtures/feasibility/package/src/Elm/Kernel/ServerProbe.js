/*
import Elm.Kernel.Scheduler exposing (binding, succeed, rawSpawn)
import Platform exposing (sendToApp)
*/
var $serverProbeNext = 1;
var $serverProbeListeners = new Map();
var $serverProbeResponses = new Map();
var $serverProbeSubscriptions = new Map();

function $serverProbeResult(ok, value) {
  return ok ? $elm$core$Result$Ok(value) : $elm$core$Result$Err(String(value));
}

var _ServerProbe_listen = F5(function(router, port, makeListener, makeRequest, makeResponse) {
  return __Scheduler_binding(function(done) {
    var http = require('node:http');
    var id = $serverProbeNext++;
    var server = http.createServer();
    var settled = false;
    function finish(value) { if (!settled) { settled = true; done(__Scheduler_succeed(value)); } }
    server.once('error', function(error) { finish($serverProbeResult(false, error && error.code || 'listen-failed')); });
    server.on('request', function(req, res) {
      var responseId = $serverProbeNext++;
      $serverProbeResponses.set(responseId, res);
      var tagger = $serverProbeSubscriptions.get(id);
      if (tagger) {
        __Scheduler_rawSpawn(A2(__Platform_sendToApp, router,
          A2(tagger, A2(makeRequest, responseId, req.url || '/'), makeResponse(responseId))));
      } else { res.statusCode = 503; res.end('no subscriber'); }
    });
    server.listen(port, '127.0.0.1', function() {
      $serverProbeListeners.set(id, server);
      finish($serverProbeResult(true, makeListener(id)));
    });
    return function() {};// completed bind cancellation must not own listener
  });
});

var _ServerProbe_reconcile = F2(function(router, subs) {
  return __Scheduler_binding(function(done) {
    var next = new Map();
    for (var xs = subs; xs.b; xs = xs.b) {
      var sub = xs.a;
      next.set(sub.a, sub.b);
    }
    $serverProbeSubscriptions = next;
    done(__Scheduler_succeed(_Utils_Tuple0));
  });
});

var _ServerProbe_respond = F2(function(response, body) {
  return __Scheduler_binding(function(done) {
    var id = response;
    var res = $serverProbeResponses.get(id);
    if (!res) { done(__Scheduler_succeed($serverProbeResult(false, 'response-not-live'))); return; }
    $serverProbeResponses.delete(id);
    var completed = false;
    function finish() { if (!completed) { completed = true; done(__Scheduler_succeed($serverProbeResult(true, _Utils_Tuple0))); } }
    function fail() { if (!completed) { completed = true; done(__Scheduler_succeed($serverProbeResult(false, 'response-failed'))); } }
    res.once('error', fail);
    res.once('finish', finish);
    var chunk = body.repeat(65536);
    var index = 0;
    function pump() {
      while (index < 4) {
        index++;
        if (!res.write(chunk)) { res.once('drain', pump); return; }
      }
      res.end();
    }
    pump();
  });
});

var _ServerProbe_close = function(listener) {
  return __Scheduler_binding(function(done) {
    var id = listener;
    var server = $serverProbeListeners.get(id);
    if (!server) { done(__Scheduler_succeed($serverProbeResult(true, _Utils_Tuple0))); return; }
    $serverProbeListeners.delete(id);
    $serverProbeSubscriptions.delete(id);
    server.close(function(error) {
      done(__Scheduler_succeed(error ? $serverProbeResult(false, error.code || 'close-failed') : $serverProbeResult(true, _Utils_Tuple0)));
    });
  });
};
