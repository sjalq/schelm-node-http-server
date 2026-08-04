/*
import Elm.Kernel.Bytes exposing (width)
import Elm.Kernel.List exposing (fromArray, toArray)
import Elm.Kernel.Scheduler exposing (binding, succeed, rawSpawn)
import Platform exposing (sendToSelf)
*/
/* generated canonical-sha256 0c65583d87fb6df932b5cf5ab6309b54de8a5fe7964c9c1b9b6c5ec223c91e56 */
"use strict";

const http = require("node:http");
const crypto = require("node:crypto");

const HARD = Object.freeze({ listeners: 512, connections: 10000, exchanges: 10000, requestBytes: 67108864, responseBytes: 67108864, upgrades: 10000 });
const EMPTY_BYTES = () => new DataView(new ArrayBuffer(0));
const field = (value, name) => value[name] === undefined ? value["__$" + name] : value[name];
const listArray = value => typeof __List_toArray === "function" ? __List_toArray(value) : value;
const bytesBuffer = value => Buffer.from(value.buffer, value.byteOffset, value.byteLength);
const MAX_SAFE_ID = Number.MAX_SAFE_INTEGER;

class SafeIds {
  constructor(names = ["default"]) { this.next = new Map(names.map(name => [name, 1])); }
  canAllocate(names) { return names.every(name => Number.isSafeInteger(this.next.get(name)) && this.next.get(name) > 0); }
  allocate(names) {
    if (!this.canAllocate(names)) return null;
    const ids = names.map(name => this.next.get(name));
    names.forEach((name, index) => this.next.set(name, ids[index] === MAX_SAFE_ID ? null : ids[index] + 1));
    return ids;
  }
  setNext(name, value) {
    if (value !== null && (!Number.isSafeInteger(value) || value < 1)) throw new RangeError("identity must be a positive safe integer or null");
    this.next.set(name, value);
  }
  peek(name) { return this.next.get(name); }
}

class RouteRegistry {
  constructor() { this.routes = new Map(); }
  get(listenerId) { return this.routes.get(listenerId); }
  reconcile(router, routes, makeIncoming) {
    const seen = new Set();
    for (const raw of routes) {
      const listenerId = Array.isArray(raw) ? raw[0] : field(raw, "listenerId");
      const generation = Array.isArray(raw) ? raw[1] : field(raw, "generation");
      const present = Array.isArray(raw) ? raw[2] : field(raw, "present");
      seen.add(listenerId);
      this.routes.set(listenerId, { router, generation, present, makeIncoming });
    }
    for (const [listenerId, route] of this.routes) if (route.router === router && !seen.has(listenerId)) this.routes.delete(listenerId);
  }
  close(listenerId) { return this.routes.delete(listenerId); }
  snapshot() { return this.routes.size; }
}

class Budget {
  constructor(hard = HARD) {
    this.hard = hard; this.ids = new SafeIds(); this.reservations = new Map(); this.counts = new Map();
    Object.defineProperty(this, "next", { get: () => this.ids.peek("default"), set: value => this.ids.setNext("default", value) });
  }
  reserve(listenerId, klass, amount, listenerCap) {
    amount = amount === undefined ? 1 : amount;
    const hardCap = this.hard[klass];
    if (amount < 0 || hardCap === undefined) return 0;
    const localKey = listenerId + ":" + klass, globalKey = "*:" + klass;
    const keys = listenerId === 0 ? [globalKey] : [localKey, globalKey];
    const localLimit = Math.min(listenerCap, hardCap);
    if ((this.counts.get(globalKey) || 0) + amount > hardCap) return 0;
    if (listenerId !== 0 && (this.counts.get(localKey) || 0) + amount > localLimit) return 0;
    const allocated = this.ids.allocate(["default"]);
    if (!allocated) return 0;
    const id = allocated[0];
    this.reservations.set(id, { listenerId, klass, amount, keys });
    for (const key of keys) this.counts.set(key, (this.counts.get(key) || 0) + amount);
    return id;
  }
  release(id) {
    const found = this.reservations.get(id);
    if (!found) return false;
    this.reservations.delete(id);
    for (const key of found.keys) {
      const next = (this.counts.get(key) || 0) - found.amount;
      if (next) this.counts.set(key, next); else this.counts.delete(key);
    }
    return true;
  }
  usage(listenerId, klass) { return this.counts.get(listenerId + ":" + klass) || 0; }
  globalUsage(klass) { return this.counts.get("*:" + klass) || 0; }
  snapshot() { return { reservations: this.reservations.size, counts: Object.fromEntries(this.counts) }; }
}

function classifyTarget(method, target) {
  if (target === "*") return "asterisk";
  if (method === "CONNECT") return "authority";
  if (/^https?:\/\//i.test(target)) return "absolute";
  if (target.startsWith("/")) return "origin";
  return "invalid";
}
function rawPairs(values, max) {
  const out = [];
  for (let i = 0; i + 1 < values.length && out.length < max; i += 2) out.push({ name: String(values[i]).toLowerCase(), value: String(values[i + 1]) });
  return out;
}
function fixedReject(response, code) {
  if (!response || response.destroyed || response.writableEnded) return;
  try { response.shouldKeepAlive = false; response.writeHead(code, { connection: "close", "content-length": "0" }); response.end(); } catch (_) { try { response.destroy(); } catch (_) {} }
}
function socketReject(socket, code) {
  if (!socket || socket.destroyed) return;
  const phrase = code === 504 ? "Gateway Timeout" : code === 429 ? "Too Many Requests" : code === 400 ? "Bad Request" : "Service Unavailable";
  try { socket.end(`HTTP/1.1 ${code} ${phrase}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch (_) { socket.destroy(); }
}

class ServerRegistry {
  constructor(hooks = {}) {
    this.hooks = hooks;
    this.ids = new SafeIds(["listener", "request", "body", "response", "writer", "upgrade"]);
    for (const name of ["listener", "request", "body", "response", "writer", "upgrade"]) {
      const property = "next" + name[0].toUpperCase() + name.slice(1);
      Object.defineProperty(this, property, { get: () => this.ids.peek(name), set: value => this.ids.setNext(name, value) });
    }
    this.listeners = new Map(); this.binds = new Map(); this.bodies = new Map(); this.responses = new Map(); this.writers = new Map(); this.upgrades = new Map();
    this.hard = hooks.hardLimits || HARD; this.budget = new Budget(this.hard);
  }
  emit(router, value) { if (this.hooks.emit) this.hooks.emit(router, value); }
  option(raw, name) { return Number(field(raw, name)); }
  limit(raw, name) { return Number(field(field(raw, "limits"), name)); }
  listen(router, operationId, bindKind, addressValue, port, rawOptions, makeFact) {
    // Keep the package-private test/kernel call shape source-compatible while
    // the Elm bridge supplies the explicit bind kind added in 1.1.0.
    if (makeFact === undefined) {
      makeFact = rawOptions; rawOptions = port; port = addressValue;
      addressValue = bindKind; bindKind = "tcp";
    }
    if (!this.ids.canAllocate(["listener"])) { this.emit(router, makeFact(operationId, "unsupported", 0, "", 0)); return; }
    const listenerReserve = this.budget.reserve(0, "listeners", 1, this.hard.listeners);
    if (!listenerReserve) { this.emit(router, makeFact(operationId, "unsupported", 0, "", 0)); return; }
    const listenerId = this.ids.allocate(["listener"])[0];
    const server = http.createServer({ insecureHTTPParser: false, requireHostHeader: true }, (req, res) => this.offerRequest(listenerId, req, res));
    // Listener ownership is established at bind completion, not after an Elm
    // subscription turn. The package retains the exchange/upgrade unless this
    // synchronous boundary adopts it; otherwise the normal typed route applies.
    const transfer = globalThis.__schelmHttpLegacyTransfer;
    const bind = { operationId, listenerId, server, reserve: listenerReserve, claimed: false, router, makeFact, timer: null };
    this.binds.set(operationId, bind);
    const fail = error => {
      if (!this.binds.delete(operationId)) return;
      clearTimeout(bind.timer); this.budget.release(listenerReserve);
      const kind = error && error.code === "EADDRINUSE" ? "address-in-use" : error && error.code === "EACCES" ? "permission" : "failed";
      this.emit(router, makeFact(operationId, kind, 0, "", 0));
    };
    server.once("error", fail);
    const bindTimeout = Math.min(this.option(rawOptions, "headersTimeout"), 600000);
    bind.timer = setTimeout(() => { if (!this.binds.delete(operationId)) return; server.close(); this.budget.release(listenerReserve); this.emit(router, makeFact(operationId, "timeout", 0, "", 0)); }, bindTimeout);
    server.on("connection", socket => this.trackSocket(listenerId, socket));
    server.on("upgrade", (req, socket, head) => {
      if (typeof transfer === "function") {
        let adopted = false;
        try { adopted = transfer("upgrade", { req, socket, head }) === true; } catch (_) { adopted = false; }
        if (adopted) return;
        socket.destroy();
        return;
      }
      this.offerUpgrade(listenerId, req, socket, head);
    });
    server.on("clientError", (_error, socket) => socketReject(socket, 400));
    try {
      server.maxHeadersCount = this.limit(rawOptions, "headerPairs");
      server.headersTimeout = this.option(rawOptions, "headersTimeout");
      server.requestTimeout = this.option(rawOptions, "requestTimeout");
      server.keepAliveTimeout = this.option(rawOptions, "keepAliveTimeout");
      if ("keepAliveTimeoutBuffer" in server) server.keepAliveTimeoutBuffer = Math.min(1000, server.keepAliveTimeout);
      server.maxRequestsPerSocket = this.limit(rawOptions, "requestsPerSocket");
      const listenOptions = bindKind === "unix" ? { path: addressValue, exclusive: true } : { host: addressValue, port, exclusive: true };
      server.listen(listenOptions, () => {
        if (!this.binds.delete(operationId)) { server.close(); return; }
        clearTimeout(bind.timer); server.removeListener("error", fail); bind.claimed = true;
        const address = server.address();
        const listener = { id: listenerId, server, router, options: rawOptions, reserve: listenerReserve, sockets: new Set(), activeBySocket: new Map(), exchanges: new Set(), upgrades: new Set(), closing: null, accepted: 0, completed: 0, rejected: 0, forced: 0 };
        this.listeners.set(listenerId, listener);
        if (typeof address === "string") this.emit(router, makeFact(operationId, "ok", listenerId, address, 0));
        else this.emit(router, makeFact(operationId, "ok", listenerId, address.address, address.port));
      });
    } catch (error) { fail(error); }
  }
  cancelListen(operationId) {
    const bind = this.binds.get(operationId); if (!bind) return;
    this.binds.delete(operationId); clearTimeout(bind.timer); this.budget.release(bind.reserve);
    try { bind.server.close(); } catch (_) {}
    this.emit(bind.router, bind.makeFact(operationId, "cancelled", 0, "", 0));
  }
  trackSocket(listenerId, socket) {
    const listener = this.listeners.get(listenerId); if (!listener || listener.closing) { socket.destroy(); return; }
    const reserve = this.budget.reserve(listenerId, "connections", 1, this.limit(listener.options, "connections"));
    if (!reserve) { socket.destroy(); return; }
    socket.__schelmReserve = reserve; listener.sockets.add(socket);
    socket.__schelmHeaderTimer = setTimeout(() => socket.destroy(), this.option(listener.options, "headersTimeout"));
    socket.once("close", () => { clearTimeout(socket.__schelmHeaderTimer); listener.sockets.delete(socket); listener.activeBySocket.delete(socket); this.budget.release(reserve); this.maybeClosed(listener); });
  }
  offerRequest(listenerId, req, res) {
    const transfer = globalThis.__schelmHttpLegacyTransfer;
    if (typeof transfer === "function") {
      let adopted = false;
      try { adopted = transfer("request", { req, res }) === true; } catch (_) { adopted = false; }
      if (adopted) return;
      fixedReject(res, 503);
      return;
    }
    const listener = this.listeners.get(listenerId);
    if (!listener || listener.closing) { fixedReject(res, 503); return; }
    clearTimeout(req.socket.__schelmHeaderTimer); req.socket.__schelmHeaderTimer = null;
    if (listener.activeBySocket.has(req.socket)) { listener.rejected++; req.socket.__schelmPipelined = true; fixedReject(res, 429); return; }
    const identityNames = ["request", "body", "response"];
    if (!this.ids.canAllocate(identityNames)) { listener.rejected++; fixedReject(res, 503); return; }
    const reserve = this.budget.reserve(listenerId, "exchanges", 1, this.limit(listener.options, "exchanges"));
    if (!reserve) { listener.rejected++; fixedReject(res, 503); return; }
    if (req.method === "CONNECT" || req.headers.expect || req.rawHeaders.length / 2 > this.limit(listener.options, "headerPairs")) { this.budget.release(reserve); listener.rejected++; fixedReject(res, req.headers.expect ? 417 : 405); return; }
    req.pause();
    const [requestId, bodyId, responseId] = this.ids.allocate(identityNames);
    const exchange = { requestId, bodyId, responseId, req, res, listener, reserve, bodyDone: false, responseDone: false, terminal: false, timer: null };
    listener.activeBySocket.set(req.socket, exchange); listener.exchanges.add(exchange); listener.accepted++;
    const body = { id: bodyId, exchange, pending: false, ended: false, bytes: 0, limit: null, copyReserve: 0, timer: null };
    this.bodies.set(bodyId, body); this.responses.set(responseId, exchange);
    const rawRequest = { id: requestId, method_: String(req.method || ""), target_: String(req.url || ""), targetForm_: classifyTarget(req.method, req.url || ""), version: String(req.httpVersion), headers_: rawPairs(req.rawHeaders, this.limit(listener.options, "headerPairs")), remote: String(req.socket.remoteAddress || ""), encrypted_: !!req.socket.encrypted };
    const incoming = { kind: "request", request: rawRequest, bodyId, responseId, upgradeId: 0, reason: "" };
    exchange.timer = setTimeout(() => { if (exchange.terminal || res.headersSent) return; fixedReject(res, 504); this.cleanupExchange(exchange, true, "rejected"); }, this.option(listener.options, "decisionTimeout"));
    body.timer = setTimeout(() => {
      if (body.pending || body.ended || exchange.terminal) return;
      this.cleanupExchange(exchange, true, "forced");
    }, this.option(listener.options, "bodyTimeout"));
    req.once("aborted", () => this.abortExchange(exchange, "client-closed"));
    req.once("error", () => this.abortExchange(exchange, "client-error"));
    this.hooks.incoming && this.hooks.incoming(listener.router, listenerId, incoming, exchange);
  }
  readBody(router, operationId, bodyId, limit, makeFact) {
    const body = this.bodies.get(bodyId);
    if (!body || body.ended) { this.emit(router, makeFact(operationId, "unavailable", bodyId, EMPTY_BYTES(), [])); return; }
    if (body.pending) { this.emit(router, makeFact(operationId, "claimed", bodyId, EMPTY_BYTES(), [])); return; }
    if (body.copyReserve) { this.budget.release(body.copyReserve); body.copyReserve = 0; }
    clearTimeout(body.timer); body.timer = null;
    body.pending = true; body.limit = body.limit === null ? limit : Math.min(body.limit, limit); const { req, listener } = body.exchange; let claimed = false;
    const done = (kind, bytes, trailers) => { if (claimed) return; claimed = true; body.pending = false; clearTimeout(body.timer); cleanup(); this.emit(router, makeFact(operationId, kind, bodyId, bytes || EMPTY_BYTES(), trailers || [])); };
    const cleanup = () => { req.removeListener("data", onData); req.removeListener("end", onEnd); req.removeListener("error", onError); req.removeListener("aborted", onAbort); };
    const onData = chunk => {
      req.pause(); const size = chunk.byteLength;
      if (body.bytes + size > body.limit || body.bytes + size > this.limit(listener.options, "requestBytes")) { done("too-large"); this.cleanupExchange(body.exchange, true); return; }
      const reserve = this.budget.reserve(listener.id, "requestBytes", size, this.limit(listener.options, "requestBytes"));
      if (!reserve) { done("too-large"); this.cleanupExchange(body.exchange, true); return; }
      const copy = Buffer.from(chunk); body.copyReserve = reserve; body.bytes += size;
      done("chunk", new DataView(copy.buffer, copy.byteOffset, copy.byteLength));
      if (!body.ended && body.copyReserve) body.timer = setTimeout(() => {
        if (!body.copyReserve || body.pending || body.exchange.terminal) return;
        this.cleanupExchange(body.exchange, true, "forced");
      }, this.option(listener.options, "bodyTimeout"));
    };
    const onEnd = () => { body.ended = true; this.bodies.delete(bodyId); body.exchange.bodyDone = true; done("complete", EMPTY_BYTES(), rawPairs(req.rawTrailers || [], this.limit(listener.options, "headerPairs"))); this.maybeExchangeDone(body.exchange); };
    const onError = () => done("aborted"); const onAbort = () => done("aborted");
    req.once("data", onData); req.once("end", onEnd); req.once("error", onError); req.once("aborted", onAbort);
    body.timer = setTimeout(() => { done("timeout"); this.cleanupExchange(body.exchange, true); }, this.option(listener.options, "bodyTimeout")); req.resume();
  }
  discardBody(router, operationId, bodyId, makeFact) {
    const body = this.bodies.get(bodyId); if (!body) { this.emit(router, makeFact(operationId, "unavailable")); return; }
    if (body.pending) { this.emit(router, makeFact(operationId, "claimed")); return; }
    if (body.copyReserve) { this.budget.release(body.copyReserve); body.copyReserve = 0; }
    clearTimeout(body.timer); body.timer = null;
    body.pending = true;
    const limit = this.limit(body.exchange.listener.options, "requestBytes"); let bytes = 0, settled = false;
    const finish = kind => { if (settled) return; settled = true; body.pending = false; clearTimeout(timer); cleanup(); this.emit(router, makeFact(operationId, kind)); };
    const cleanup = () => { body.exchange.req.removeListener("data", data); body.exchange.req.removeListener("end", end); body.exchange.req.removeListener("aborted", abort); };
    const data = chunk => { bytes += chunk.byteLength; if (bytes > limit) { finish("too-large"); this.cleanupExchange(body.exchange, true); } };
    const end = () => { body.ended = true; this.bodies.delete(bodyId); body.exchange.bodyDone = true; finish("ok"); this.maybeExchangeDone(body.exchange); };
    const abort = () => finish("aborted"); const timer = setTimeout(() => { finish("timeout"); this.cleanupExchange(body.exchange, true); }, this.option(body.exchange.listener.options, "bodyTimeout"));
    body.exchange.req.on("data", data); body.exchange.req.once("end", end); body.exchange.req.once("aborted", abort); body.exchange.req.resume();
  }
  applyHead(exchange, code, headers) {
    if (exchange.terminal || exchange.res.headersSent || code < 200 || code > 999) return false;
    if ((code === 204 || code === 304 || exchange.req.method === "HEAD") && exchange.__hasBody) return false;
    const object = Object.create(null); for (const h of listArray(headers)) { const name = String(field(h, "name")); const value = String(field(h, "value")); if (["connection", "transfer-encoding", "content-length", "upgrade"].includes(name)) return false; if (object[name] === undefined) object[name] = value; else object[name] = [].concat(object[name], value); }
    exchange.res.writeHead(code, object); return true;
  }
  terminal(exchange, router, operationId, makeFact, timeout) {
    let settled = false; const finish = kind => { if (settled) return; settled = true; clearTimeout(timer); cleanup(); exchange.responseDone = true; this.emit(router, makeFact(operationId, kind)); this.maybeExchangeDone(exchange); };
    const cleanup = () => { exchange.res.removeListener("finish", onFinish); exchange.res.removeListener("close", onClose); exchange.res.removeListener("error", onError); };
    const onFinish = () => finish("finish"); const onClose = () => { if (!exchange.res.writableFinished) finish("peer-closed"); }; const onError = () => finish("peer-closed");
    exchange.res.once("finish", onFinish); exchange.res.once("close", onClose); exchange.res.once("error", onError);
    const timer = setTimeout(() => { finish("timeout"); try { exchange.res.destroy(); } catch (_) {} }, timeout);
  }
  send(router, operationId, responseId, code, headers, bytes, makeFact) {
    const exchange = this.responses.get(responseId); if (!exchange) { this.emit(router, makeFact(operationId, "ended")); return; }
    const body = bytesBuffer(bytes); exchange.__hasBody = body.length > 0;
    if (body.length > this.limit(exchange.listener.options, "responseBytes")) { this.emit(router, makeFact(operationId, "too-large")); return; }
    const reserve = this.budget.reserve(exchange.listener.id, "responseBytes", body.length, this.limit(exchange.listener.options, "responseBytes")); if (!reserve) { this.emit(router, makeFact(operationId, "too-large")); return; }
    if (!this.applyHead(exchange, code, headers)) { this.budget.release(reserve); this.emit(router, makeFact(operationId, "invalid")); return; }
    clearTimeout(exchange.timer); this.terminal(exchange, router, operationId, makeFact, this.option(exchange.listener.options, "finishTimeout"));
    try { exchange.res.end(body, () => this.budget.release(reserve)); } catch (_) { this.budget.release(reserve); exchange.res.destroy(); }
  }
  stream(router, operationId, responseId, code, headers, makeFact) {
    const exchange = this.responses.get(responseId);
    if (!exchange || !this.ids.canAllocate(["writer"]) || !this.applyHead(exchange, code, headers)) { this.emit(router, makeFact(operationId, "invalid", 0)); return; }
    const writerId = this.ids.allocate(["writer"])[0];
    clearTimeout(exchange.timer); this.writers.set(writerId, { id: writerId, exchange, pending: false, ended: false, bytes: 0, bodyAllowed: code !== 204 && code !== 304 && exchange.req.method !== "HEAD" }); this.emit(router, makeFact(operationId, "ok", writerId));
  }
  write(router, operationId, writerId, bytes, makeFact) {
    const writer = this.writers.get(writerId); if (!writer || writer.ended) { this.emit(router, makeFact(operationId, "ended")); return; }
    if (writer.pending) { this.emit(router, makeFact(operationId, "pending")); return; }
    const body = bytesBuffer(bytes), limit = this.limit(writer.exchange.listener.options, "responseBytes");
    if (!writer.bodyAllowed && body.length > 0) { this.emit(router, makeFact(operationId, "invalid")); return; }
    if (writer.bytes + body.length > limit) { this.emit(router, makeFact(operationId, "too-large")); return; }
    const reserve = this.budget.reserve(writer.exchange.listener.id, "responseBytes", body.length, limit); if (!reserve) { this.emit(router, makeFact(operationId, "too-large")); return; }
    writer.bytes += body.length;
    writer.pending = true; let settled = false;
    const settle = kind => { if (settled) return; settled = true; writer.pending = false; clearTimeout(timer); cleanup(); this.budget.release(reserve); if (kind !== "accepted" && kind !== "drained") writer.exchange.res.destroy(); this.emit(router, makeFact(operationId, kind)); };
    const cleanup = () => { writer.exchange.res.removeListener("drain", drain); writer.exchange.res.removeListener("close", close); writer.exchange.res.removeListener("error", close); };
    const drain = () => settle("drained"), close = () => settle("peer-closed");
    writer.exchange.res.once("close", close); writer.exchange.res.once("error", close);
    const timer = setTimeout(() => settle("timeout"), this.option(writer.exchange.listener.options, "writeTimeout"));
    try { const accepted = writer.exchange.res.write(body); if (accepted) settle("accepted"); else writer.exchange.res.once("drain", drain); } catch (_) { settle("peer-closed"); }
  }
  end(router, operationId, writerId, makeFact) {
    const writer = this.writers.get(writerId); if (!writer || writer.ended || writer.pending) { this.emit(router, makeFact(operationId, writer && writer.pending ? "pending" : "ended")); return; }
    writer.ended = true; this.writers.delete(writerId); this.terminal(writer.exchange, router, operationId, makeFact, this.option(writer.exchange.listener.options, "finishTimeout")); writer.exchange.res.end();
  }
  transferRequest(router, operationId, responseId, makeFact) {
    const exchange = this.responses.get(responseId);
    if (!exchange || exchange.terminal) { this.emit(router, makeFact(operationId, "unavailable")); return; }
    const adapter = globalThis.__schelmHttpLegacyTransfer;
    let adopted = false;
    try { adopted = typeof adapter === "function" && adapter("request", { req: exchange.req, res: exchange.res }); } catch (_) { adopted = false; }
    if (!adopted) { this.emit(router, makeFact(operationId, "rejected")); return; }
    this.releaseExchangeForTransfer(exchange);
    this.emit(router, makeFact(operationId, "ok"));
  }
  releaseExchangeForTransfer(exchange) {
    if (exchange.terminal) return false;
    exchange.terminal = true; clearTimeout(exchange.timer);
    const body = this.bodies.get(exchange.bodyId); if (body) clearTimeout(body.timer); if (body && body.copyReserve) this.budget.release(body.copyReserve);
    this.bodies.delete(exchange.bodyId); this.responses.delete(exchange.responseId); exchange.listener.exchanges.delete(exchange); exchange.listener.activeBySocket.delete(exchange.req.socket); this.budget.release(exchange.reserve);
    exchange.listener.completed++; this.maybeClosed(exchange.listener); return true;
  }
  transferUpgradeToLegacy(router, operationId, id, makeFact) {
    const offer = this.transferUpgrade(id);
    if (!offer) { this.emit(router, makeFact(operationId, "unavailable")); return; }
    const adapter = globalThis.__schelmHttpLegacyTransfer;
    let adopted = false;
    try { adopted = typeof adapter === "function" && adapter("upgrade", { req: offer.req, socket: offer.socket, head: offer.head }); } catch (_) { adopted = false; }
    if (adopted && this.adoptTransferredUpgrade(offer)) this.emit(router, makeFact(operationId, "ok"));
    else { this.failTransferredUpgrade(offer); this.emit(router, makeFact(operationId, "rejected")); }
  }
  abort(responseId) { const exchange = this.responses.get(responseId); if (exchange) this.cleanupExchange(exchange, true); }
  abortExchange(exchange, reason) { if (exchange.terminal) return; if (this.hooks.aborted) this.hooks.aborted(exchange.listener.router, exchange, reason); this.cleanupExchange(exchange, true, "rejected"); }
  maybeExchangeDone(exchange) { if (exchange.bodyDone && exchange.responseDone) this.cleanupExchange(exchange, !!exchange.req.socket.__schelmPipelined); }
  cleanupExchange(exchange, destroy, outcome = "completed") {
    if (exchange.terminal) return; exchange.terminal = true; clearTimeout(exchange.timer);
    const body = this.bodies.get(exchange.bodyId); if (body) clearTimeout(body.timer); if (body && body.copyReserve) this.budget.release(body.copyReserve);
    this.bodies.delete(exchange.bodyId); this.responses.delete(exchange.responseId); exchange.listener.exchanges.delete(exchange); exchange.listener.activeBySocket.delete(exchange.req.socket); this.budget.release(exchange.reserve);
    for (const [id, writer] of this.writers) if (writer.exchange === exchange) this.writers.delete(id);
    if (destroy) try { exchange.req.socket.destroy(); } catch (_) {}
    else if (!exchange.req.socket.destroyed) exchange.req.socket.__schelmHeaderTimer = setTimeout(() => exchange.req.socket.destroy(), this.option(exchange.listener.options, "headersTimeout"));
    exchange.listener[outcome]++; this.maybeClosed(exchange.listener);
  }
  offerUpgrade(listenerId, req, socket, head) {
    const listener = this.listeners.get(listenerId); if (!listener || listener.closing) { socketReject(socket, 503); return; }
    const identityNames = ["upgrade", "request"];
    if (!this.ids.canAllocate(identityNames)) { socketReject(socket, 503); return; }
    const reserve = this.budget.reserve(listenerId, "upgrades", 1, this.limit(listener.options, "upgrades")); if (!reserve) { socketReject(socket, 503); return; }
    const [id, requestId] = this.ids.allocate(identityNames); const offer = { id, listener, req, socket, head: Buffer.from(head), reserve, timer: null, claimed: false };
    this.upgrades.set(id, offer); listener.upgrades.add(id);
    offer.timer = setTimeout(() => this.rejectUpgrade(null, 0, id, 504, null), this.option(listener.options, "upgradeTimeout"));
    const rawRequest = { id: requestId, method_: String(req.method || ""), target_: String(req.url || ""), targetForm_: classifyTarget(req.method, req.url || ""), version: String(req.httpVersion), headers_: rawPairs(req.rawHeaders, this.limit(listener.options, "headerPairs")), remote: String(socket.remoteAddress || ""), encrypted_: !!socket.encrypted };
    this.hooks.incoming && this.hooks.incoming(listener.router, listenerId, { kind: "upgrade", request: rawRequest, bodyId: 0, responseId: 0, upgradeId: id, reason: "" }, offer);
  }
  takeUpgrade(id, release) { const offer = this.upgrades.get(id); if (!offer || offer.claimed) return null; offer.claimed = true; this.upgrades.delete(id); offer.listener.upgrades.delete(id); clearTimeout(offer.timer); if (release) { this.budget.release(offer.reserve); offer.reserve = 0; } return offer; }
  claimUpgrade(id) { return this.takeUpgrade(id, true); }
  transferUpgrade(id) {
    const offer = this.takeUpgrade(id, false);
    if (!offer) return null;
    offer.transferState = "pending";
    offer.transferTimer = setTimeout(() => this.failTransferredUpgrade(offer), this.option(offer.listener.options, "upgradeTimeout"));
    offer.socket.once("close", () => this.releaseTransferredUpgrade(offer));
    return offer;
  }
  adoptTransferredUpgrade(offer) {
    if (!offer || offer.transferState !== "pending") return false;
    offer.transferState = "adopted";
    clearTimeout(offer.transferTimer); offer.transferTimer = null;
    return true;
  }
  failTransferredUpgrade(offer) {
    if (!offer || offer.transferState !== "pending") return false;
    offer.transferState = "failed";
    clearTimeout(offer.transferTimer); offer.transferTimer = null;
    this.releaseTransferredUpgrade(offer);
    if (!offer.socket.destroyed) offer.socket.destroy();
    return true;
  }
  releaseTransferredUpgrade(offer) {
    if (!offer || !offer.reserve) return false;
    clearTimeout(offer.transferTimer); offer.transferTimer = null;
    const reserve = offer.reserve; offer.reserve = 0; offer.transferState = "released";
    return this.budget.release(reserve);
  }
  rejectUpgrade(router, operationId, id, code, makeFact) { const offer = this.claimUpgrade(id); if (offer) socketReject(offer.socket, code); if (makeFact) this.emit(router, makeFact(operationId, code === 504 ? "timeout" : "ok")); }
  rejectStale(responseId, upgradeId) { if (responseId) { const exchange = this.responses.get(responseId); if (exchange) { fixedReject(exchange.res, 503); this.cleanupExchange(exchange, true, "rejected"); } } if (upgradeId) this.rejectUpgrade(null, 0, upgradeId, 503, null); }
  close(router, operationId, listenerId, timeout, makeFact) {
    const listener = this.listeners.get(listenerId); if (!listener) { this.emit(router, makeFact(operationId, "unknown", 0, 0, 0)); return; }
    if (listener.closing) { if (listener.closing.waiters.length >= this.limit(listener.options, "closeWaiters")) this.emit(router, makeFact(operationId, "waiters", 0, 0, 0)); else listener.closing.waiters.push({ router, operationId, makeFact }); return; }
    listener.closing = { waiters: [{ router, operationId, makeFact }], timer: null, serverDone: false };
    for (const id of Array.from(listener.upgrades)) this.rejectUpgrade(null, 0, id, 503, null);
    listener.server.close(() => { listener.closing.serverDone = true; this.maybeClosed(listener); });
    if (typeof listener.server.closeIdleConnections === "function") listener.server.closeIdleConnections();
    listener.closing.timer = setTimeout(() => { for (const exchange of Array.from(listener.exchanges)) this.cleanupExchange(exchange, true, "forced"); for (const socket of listener.sockets) socket.destroy(); listener.closing.serverDone = true; this.maybeClosed(listener); }, timeout);
    this.maybeClosed(listener);
  }
  maybeClosed(listener) {
    if (!listener.closing || !listener.closing.serverDone || listener.exchanges.size || listener.upgrades.size || listener.sockets.size) return;
    clearTimeout(listener.closing.timer); this.listeners.delete(listener.id); this.budget.release(listener.reserve);
    const report = { completed: listener.completed, rejected: listener.rejected, forced: listener.forced };
    for (const waiter of listener.closing.waiters) this.emit(waiter.router, waiter.makeFact(waiter.operationId, "ok", report.completed, report.rejected, report.forced));
  }
  snapshot() { return { listeners: this.listeners.size, binds: this.binds.size, bodies: this.bodies.size, responses: this.responses.size, writers: this.writers.size, upgrades: this.upgrades.size, budget: this.budget.snapshot() }; }
}



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
var _HttpServer_listen = F7(function(router,op,kind,address,port,options,makeFact){ return $task(function(){ $schelmRegistry.listen(router,op,kind,address,port,$rawOptions(options),function(a,b,c,d,e){return A5(makeFact,a,b,c,d,e);}); }); });
var _HttpServer_cancelListen = function(op){ return $task(function(){ $schelmRegistry.cancelListen(op); }); };
var _HttpServer_readBody = F5(function(router,op,id,limit,makeFact){ return $task(function(){ $schelmRegistry.readBody(router,op,id,limit,function(a,b,c,d,e){return A5(makeFact,a,b,c,d,e);}); }); });
var _HttpServer_discardBody = F4(function(router,op,id,makeFact){ return $task(function(){ $schelmRegistry.discardBody(router,op,id,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_send = F7(function(router,op,id,code,headers,bytes,makeFact){ return $task(function(){ $schelmRegistry.send(router,op,id,code,headers,bytes,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_stream = F6(function(router,op,id,code,headers,makeFact){ return $task(function(){ $schelmRegistry.stream(router,op,id,code,headers,function(a,b,c){return A3(makeFact,a,b,c);}); }); });
var _HttpServer_write = F5(function(router,op,id,bytes,makeFact){ return $task(function(){ $schelmRegistry.write(router,op,id,bytes,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_end = F4(function(router,op,id,makeFact){ return $task(function(){ $schelmRegistry.end(router,op,id,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_abort = F2(function(id,reason){ return $task(function(){ $schelmRegistry.abort(id,reason); }); });
var _HttpServer_transferRequest = F4(function(router,op,id,makeFact){ return $task(function(){ $schelmRegistry.transferRequest(router,op,id,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_transferUpgrade = F4(function(router,op,id,makeFact){ return $task(function(){ $schelmRegistry.transferUpgradeToLegacy(router,op,id,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_rejectUpgrade = F5(function(router,op,id,code,makeFact){ return $task(function(){ $schelmRegistry.rejectUpgrade(router,op,id,code,function(a,b){return A2(makeFact,a,b);}); }); });
var _HttpServer_rejectStale = F2(function(responseId,upgradeId){ return $task(function(){ $schelmRegistry.rejectStale(responseId,upgradeId); }); });
var _HttpServer_close = F5(function(router,op,id,timeout,makeFact){ return $task(function(){ $schelmRegistry.close(router,op,id,timeout,function(a,b,c,d,e){ if(b === "ok") $schelmRoutes.close(id); return A5(makeFact,a,b,c,d,e); }); }); });
