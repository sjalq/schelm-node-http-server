"use strict";

const assert = require("node:assert/strict");
const http = require("node:http");
const net = require("node:net");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const { createRequire } = require("node:module");

const offlineRoot = fsMkdtemp();
cp.execFileSync("tar", ["xzf", path.resolve(__dirname, "../../../vendor/ws-8.21.1.tgz"), "-C", offlineRoot]);
const offlineRequire = createRequire(path.join(offlineRoot, "package", "package.json"));
const wsPackage = offlineRequire("./package.json");
assert.equal(wsPackage.version, "8.21.1", "fixture must use reviewed ws pin");
const { WebSocket, WebSocketServer } = offlineRequire(".");
function fsMkdtemp() { return require("node:fs").mkdtempSync(path.join(os.tmpdir(), "schelm-ws-")); }

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      server.close((error) => (error ? reject(error) : resolve(port)));
    });
  });
}

async function probePreListenCancellation() {
  const port = await freePort();
  const server = http.createServer();
  let listeningEvents = 0;
  server.on("listening", () => listeningEvents++);

  // This is the production-shaped bind attempt: listeners are attached first,
  // listen is dispatched, and cancellation closes before ownership transfer.
  server.listen(port, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error && error.code !== "ERR_SERVER_NOT_RUNNING") reject(error);
      else resolve();
    });
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(server.listening, false);
  assert.equal(listeningEvents, 0, "cancelled attempt must not transfer ownership");

  await new Promise((resolve, reject) => {
    const replacement = http.createServer((_req, res) => res.end("ok"));
    replacement.once("error", reject);
    replacement.listen(port, "127.0.0.1", () =>
      replacement.close((error) => (error ? reject(error) : resolve()))
    );
  });
  return { portReleased: true, listeningEvents };
}

async function probeBackpressure() {
  const metrics = { falseWrites: 0, drains: 0, maxWritableLength: 0, bytes: 0 };
  const chunk = Buffer.alloc(64 * 1024, 120);
  const target = 4 * 1024 * 1024;
  const server = http.createServer((_req, res) => {
    function pump() {
      while (metrics.bytes < target) {
        const ok = res.write(chunk);
        metrics.bytes += chunk.length;
        metrics.maxWritableLength = Math.max(
          metrics.maxWritableLength,
          res.writableLength
        );
        if (!ok) {
          metrics.falseWrites++;
          res.once("drain", () => {
            metrics.drains++;
            pump();
          });
          return;
        }
      }
      res.end();
    }
    pump();
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const received = await new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: "/" }, (res) => {
        let bytes = 0;
        res.pause();
        setTimeout(() => {
          res.on("data", (data) => (bytes += data.length));
          res.on("end", () => resolve(bytes));
          res.resume();
        }, 150);
      })
      .once("error", reject);
  });
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  assert.equal(received, target);
  assert.ok(metrics.falseWrites > 0, "real write(false) must be observed");
  assert.equal(metrics.drains, metrics.falseWrites);
  assert.ok(
    metrics.maxWritableLength <= chunk.length + 16384,
    `writer retained too much: ${metrics.maxWritableLength}`
  );
  return metrics;
}

// Fixture for the proposed package-private bridge. The public Elm API sees an
// Upgrade id only. The registry owns these exact Node objects until claim().
function makePrivateUpgradeAdapter(wss) {
  let nextId = 1;
  const offers = new Map();
  return {
    offer(req, socket, head) {
      const id = nextId++;
      offers.set(id, { req, socket, head });
      return id;
    },
    claim(id, onConnection) {
      const owned = offers.get(id);
      if (!owned) return false;
      offers.delete(id); // claim before calling foreign code: exactly once
      const { req, socket, head } = owned;
      wss.handleUpgrade(req, socket, head, (webSocket) => {
        onConnection(webSocket, req);
      });
      return true;
    },
    reject(id) {
      const owned = offers.get(id);
      if (!owned) return false;
      offers.delete(id);
      owned.socket.destroy();
      return true;
    },
    size() {
      return offers.size;
    },
  };
}

async function probePinnedWsUpgrade() {
  const server = http.createServer((_req, res) => {
    res.statusCode = 426;
    res.end("upgrade required");
  });
  const wss = new WebSocketServer({ noServer: true });
  const adapter = makePrivateUpgradeAdapter(wss);
  let exactIdentity = false;
  let duplicateRejected = false;
  let headBytes = 0;
  server.on("upgrade", (req, socket, head) => {
    const id = adapter.offer(req, socket, head);
    const original = { req, socket, head };
    headBytes = head.length;
    const accepted = adapter.claim(id, (webSocket, acceptedReq) => {
      exactIdentity =
        acceptedReq === original.req &&
        socket === original.socket &&
        head === original.head;
      webSocket.once("message", (data) => webSocket.send(data));
    });
    assert.equal(accepted, true);
    duplicateRejected = adapter.claim(id, () => {}) === false;
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = server.address().port;
  const echoed = await new Promise((resolve, reject) => {
    const client = new WebSocket(`ws://127.0.0.1:${port}/ws`);
    client.once("error", reject);
    client.once("open", () => client.send("probe"));
    client.once("message", (data) => {
      const value = String(data);
      client.close();
      resolve(value);
    });
  });
  await new Promise((resolve) => wss.close(resolve));
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve()))
  );
  assert.equal(echoed, "probe");
  // ws client implementations normally wait for 101 before sending frames, so
  // this host probe proves exact object identity. M0c's raw-socket fixture is
  // responsible for the stronger deliberately non-empty head proof.
  assert.equal(exactIdentity, true);
  assert.equal(duplicateRejected, true);
  assert.equal(adapter.size(), 0);
  return {
    wsVersion: wsPackage.version,
    exactIdentity,
    headBytes,
    duplicateRejected,
    registryEmpty: true,
  };
}

(async () => {
  const cancellation = await probePreListenCancellation();
  const backpressure = await probeBackpressure();
  const upgrade = await probePinnedWsUpgrade();
  console.log(JSON.stringify({ cancellation, backpressure, upgrade }));
  cp.execFileSync("chmod", ["-R", "u+w", offlineRoot]);
  require("node:fs").rmSync(offlineRoot, { recursive: true, force: true });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
