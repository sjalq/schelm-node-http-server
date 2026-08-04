"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { ServerRegistry } = require("../../kernel-src/http-server.js");

const options = {
  limits: { connections: 8, exchanges: 8, requestBytes: 65536, responseBytes: 65536, upgrades: 8, closeWaiters: 4, requestsPerSocket: 20, headerPairs: 40 },
  headersTimeout: 1000, requestTimeout: 1000, decisionTimeout: 500,
  bodyTimeout: 500, writeTimeout: 500, finishTimeout: 500,
  keepAliveTimeout: 500, upgradeTimeout: 500, gracefulTimeout: 1000,
};
const fact = (...values) => values;

function close(registry, id) {
  return new Promise((resolve, reject) => {
    registry.hooks.emit = (_router, value) => value[0] === 99 && (value[1] === "ok" ? resolve(value) : reject(new Error(value[1])));
    registry.close({}, 99, id, 1000, fact);
  });
}

test("typed unix bind reports its path and leaves socket cleanup to the owner", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schelm-http-unix-"));
  const socketPath = path.join(dir, "listener.sock");
  let resolveListen;
  const registry = new ServerRegistry({ emit: (_router, value) => resolveListen(value) });
  const listened = new Promise((resolve) => { resolveListen = resolve; });
  registry.listen({}, 1, "unix", socketPath, 0, options, fact);
  const result = await listened;
  assert.deepEqual(result.slice(0, 5), [1, "ok", 1, socketPath, 0]);
  assert.equal(fs.existsSync(socketPath), true);
  await close(registry, result[2]);
  assert.equal(fs.existsSync(socketPath), false);
  fs.rmdirSync(dir);
});

test("listener boundary synchronously adopts legacy requests before typed routing", async () => {
  let listened;
  let typedOffers = 0;
  const registry = new ServerRegistry({
    emit: (_router, value) => { if (value[0] === 1) listened(value); },
    incoming: () => { typedOffers += 1; },
  });
  globalThis.__schelmHttpLegacyTransfer = (kind, owned) => {
    assert.equal(kind, "request");
    owned.res.writeHead(200, { "content-type": "text/plain" });
    owned.res.end("direct");
    return true;
  };
  try {
    const listenFact = await new Promise((resolve) => {
      listened = resolve;
      registry.listen({}, 1, "tcp", "127.0.0.1", 0, options, fact);
    });
    const reply = await new Promise((resolve, reject) => {
      http.get({ host: "127.0.0.1", port: listenFact[4], path: "/direct" }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      }).on("error", reject);
    });
    assert.deepEqual(reply, { status: 200, body: "direct" });
    assert.equal(typedOffers, 0);
    assert.equal(registry.responses.size, 0);
    await close(registry, listenFact[2]);
  } finally {
    delete globalThis.__schelmHttpLegacyTransfer;
  }
});

test("listener boundary destroys upgrades rejected or failed by the legacy adapter", async () => {
  for (const behavior of ["reject", "throw"]) {
    let listened;
    const registry = new ServerRegistry({ emit: (_router, value) => { if (value[0] === 1) listened(value); } });
    globalThis.__schelmHttpLegacyTransfer = () => {
      if (behavior === "throw") throw new Error("adapter failed");
      return false;
    };
    try {
      const listenFact = await new Promise((resolve) => {
        listened = resolve;
        registry.listen({}, 1, "tcp", "127.0.0.1", 0, options, fact);
      });
      await new Promise((resolve, reject) => {
        const socket = require("node:net").connect(listenFact[4], "127.0.0.1", () => socket.write("GET /ws HTTP/1.1\r\nHost: x\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: bad\r\nSec-WebSocket-Version: 13\r\n\r\n"));
        const timer = setTimeout(() => reject(new Error(`${behavior} socket remained open`)), 500);
        socket.on("error", (error) => { if (error.code !== "ECONNRESET") reject(error); });
        socket.on("close", () => { clearTimeout(timer); resolve(); });
      });
      assert.equal(registry.upgrades.size, 0);
      await close(registry, listenFact[2]);
    } finally {
      delete globalThis.__schelmHttpLegacyTransfer;
    }
  }
});

test("explicit request transfer is synchronous, exact once, and releases package ownership", async () => {
  let listened;
  let incoming;
  const registry = new ServerRegistry({
    emit: (_router, value) => { if (value[0] === 1) listened(value); },
    incoming: (_router, _listener, raw) => { incoming(raw); },
  });
  const listenFact = await new Promise((resolve) => {
    listened = resolve;
    registry.listen({}, 1, "tcp", "127.0.0.1", 0, options, fact);
  });
  const listenerId = listenFact[2];
  const port = listenFact[4];
  try {
    const reply = new Promise((resolve, reject) => {
      const req = http.get({ host: "127.0.0.1", port, path: "/legacy" }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
      });
      req.on("error", reject);
    });
    const offered = await new Promise((resolve) => { incoming = resolve; });
    globalThis.__schelmHttpLegacyTransfer = (kind, owned) => {
      assert.equal(kind, "request");
      owned.res.writeHead(200, { "content-type": "text/plain" });
      owned.res.end("legacy");
      return true;
    };
    const transfer = await new Promise((resolve) => {
      registry.hooks.emit = (_router, value) => value[0] === 2 && resolve(value);
      registry.transferRequest({}, 2, offered.responseId, fact);
    });
    assert.equal(transfer[1], "ok");
    assert.deepEqual(await reply, { status: 200, body: "legacy" });
    assert.equal(registry.responses.size, 0);
    const duplicate = await new Promise((resolve) => {
      registry.hooks.emit = (_router, value) => value[0] === 3 && resolve(value);
      registry.transferRequest({}, 3, offered.responseId, fact);
    });
    assert.equal(duplicate[1], "unavailable");
  } finally {
    delete globalThis.__schelmHttpLegacyTransfer;
    await close(registry, listenerId);
  }
});

test("legacy upgrade transfer fails closed when the adapter does not adopt", () => {
  const registry = new ServerRegistry({ emit() {} });
  const listener = { id: 7, closing: null, options, upgrades: new Set() };
  registry.listeners.set(7, listener);
  let incoming;
  registry.hooks.incoming = (_router, _listener, raw) => { incoming = raw; };
  const socket = { destroyed: false, end() {}, destroy() { this.destroyed = true; }, once() {} };
  registry.offerUpgrade(7, { method: "GET", url: "/ws", httpVersion: "1.1", rawHeaders: [] }, socket, Buffer.from("head"));
  globalThis.__schelmHttpLegacyTransfer = () => false;
  let result;
  registry.hooks.emit = (_router, value) => { result = value; };
  registry.transferUpgradeToLegacy({}, 4, incoming.upgradeId, fact);
  delete globalThis.__schelmHttpLegacyTransfer;
  assert.equal(result[1], "rejected");
  assert.equal(socket.destroyed, true);
  assert.equal(registry.upgrades.size, 0);
  assert.equal(registry.budget.globalUsage("upgrades"), 0);
});
