"use strict";

const assert = require("node:assert/strict");
const cp = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");

const root = path.resolve(__dirname, "..");
const schelmHomeDefault = path.resolve(os.homedir(), ".schelm");
const schelm = process.env.SCHELM || path.join(os.homedir(), ".local", "bin", "schelm");
const nodeBin = fs.existsSync("/opt/elm-harness/current/runtime/node")
  ? "/opt/elm-harness/current/runtime/node"
  : process.execPath;

function fail(message) {
  throw new Error(message);
}

function run(cmd, args, opts = {}) {
  return cp.execFileSync(cmd, args, { encoding: "utf8", ...opts });
}

function spawnYes(cmd, args, opts = {}) {
  const result = cp.spawnSync(cmd, args, { encoding: "utf8", input: "y\ny\ny\n", ...opts });
  if (result.status !== 0) {
    fail(`${cmd} ${args.join(" ")}\nstdout:\n${result.stdout || ""}\nstderr:\n${result.stderr || ""}`);
  }
  return result;
}

function canonicalize(headers) {
  const skip = new Set(["date", "connection", "keep-alive", "transfer-encoding"]);
  const out = {};
  for (const [name, value] of Object.entries(headers)) {
    if (skip.has(name.toLowerCase())) continue;
    out[name.toLowerCase()] = Array.isArray(value) ? value.join(", ") : String(value);
  }
  return out;
}

function request(port) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/parity", method: "GET", headers: { connection: "close" } }, res => {
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({
        status: res.statusCode,
        headers: canonicalize(res.headers),
        undefinedHeader: Object.prototype.hasOwnProperty.call(res.headers, "undefined"),
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    req.on("error", reject);
    req.end();
  });
}

async function runBundle(bundlePath) {
  const source = fs.readFileSync(bundlePath, "utf8");
  const context = { console, process, require, setTimeout, clearTimeout, setImmediate, clearImmediate, Buffer, URL, URLSearchParams };
  context.global = context;
  vm.runInNewContext(source, context, { filename: bundlePath });
  const app = context.Elm.Main.init({ flags: null });
  const events = [];
  let client;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout ${JSON.stringify(events)}`)), 20000);
    app.ports.report.subscribe(event => {
      events.push(event);
      if (event && event.kind === "listening" && !client) {
        client = request(event.port).then(response => { event.response = response; }).catch(reject);
      }
      if (event && event.kind === "closed") {
        clearTimeout(timer);
        resolve();
      }
    });
  });
  if (client) await client;
  const listening = events.find(event => event && event.kind === "listening");
  const sent = events.find(event => event && event.kind === "sent");
  if (!listening || !listening.response) fail(`missing client response: ${JSON.stringify(events)}`);
  if (!sent || sent.outcome !== "accepted") fail(`send did not finish: ${JSON.stringify(events)}`);
  return { events, observed: listening.response };
}

function snapshotPackage(dest, version) {
  fs.mkdirSync(dest, { recursive: true });
  run("git", ["init", "-b", "main"], { cwd: dest, stdio: "pipe" });
  run("git", ["config", "user.email", "header-parity-gate@schelm"], { cwd: dest, stdio: "pipe" });
  run("git", ["config", "user.name", "header-parity-gate"], { cwd: dest, stdio: "pipe" });
  for (const rel of ["elm.json", "LICENSE", "README.md", "src"]) {
    fs.cpSync(path.join(root, rel), path.join(dest, rel), { recursive: true });
  }
  run("git", ["add", "."], { cwd: dest, stdio: "pipe" });
  run("git", ["-c", "commit.gpgsign=false", "commit", "-m", version], { cwd: dest, stdio: "pipe" });
  run("git", ["tag", version], { cwd: dest, stdio: "pipe" });
}

function writeFixture(app, version) {
  fs.mkdirSync(path.join(app, "src"), { recursive: true });
  fs.writeFileSync(path.join(app, "elm.json"), `${JSON.stringify({
    type: "application",
    "source-directories": ["src"],
    "elm-version": "0.19.1",
    dependencies: {
      direct: {
        "elm/core": "1.0.5",
        "elm/json": "1.1.3",
        "sjalq/schelm-node-http-server": version
      },
      indirect: { "elm/bytes": "1.0.8" }
    },
    "test-dependencies": { direct: {}, indirect: {} }
  }, null, 4)}\n`);
  fs.copyFileSync(path.join(root, "fixtures/header-parity/src/Main.elm"), path.join(app, "src/Main.elm"));
}

(async () => {
  if (!fs.existsSync(schelm)) fail(`missing schelm binary at ${schelm}`);
  const kernelSrc = fs.readFileSync(path.join(root, "kernel-src/http-server.js"), "utf8");
  assert.doesNotMatch(kernelSrc, /\bconst field\s*=/);
  assert.doesNotMatch(kernelSrc, /\["__\$"\s*\+/);
  assert.match(kernelSrc, /h\.__\$name/);
  assert.match(kernelSrc, /h\.__\$value/);

  run(process.execPath, [path.join(root, "scripts/assemble-kernels.cjs")], { stdio: "inherit" });
  const assembled = fs.readFileSync(path.join(root, "src/Elm/Kernel/HttpServer.js"), "utf8");
  assert.doesNotMatch(assembled, /\bconst field\s*=/);
  assert.doesNotMatch(assembled, /\["__\$"\s*\+/);
  assert.match(assembled, /h\.__\$name/);
  assert.match(assembled, /h\.__\$value/);
  assert.match(assembled, /name:h\.__\$name/);
  assert.match(assembled, /value:h\.__\$value/);

  const version = JSON.parse(fs.readFileSync(path.join(root, "elm.json"), "utf8")).version;
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "schelm-http-header-parity-"));
  const pkgGit = fs.mkdtempSync(path.join(os.tmpdir(), "schelm-http-pkg-git-"));
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "schelm-http-header-app-"));
  if (path.resolve(home) === schelmHomeDefault) fail("SCHELM_HOME must not be ~/.schelm");

  const env = { ...process.env, SCHELM_HOME: home, ELM_HOME: home };
  delete env.HOME_SCHELM;
  try {
    snapshotPackage(pkgGit, version);
    writeFixture(app, version);
    spawnYes(schelm, ["install", "sjalq/schelm-node-http-server", `--from=${pkgGit}`], { cwd: app, env });
    const observed = {};
    for (const mode of ["debug", "optimize"]) {
      const out = path.join(app, `out-${mode}.js`);
      const args = ["make", "--no-wire", "src/Main.elm", `--output=${out}`];
      if (mode === "optimize") args.push("--optimize");
      run(schelm, args, { cwd: app, env, stdio: "inherit" });
      observed[mode] = await runBundle(out);
    }
    const debug = observed.debug.observed;
    const optimize = observed.optimize.observed;
    assert.deepEqual(debug, optimize);
    assert.equal(debug.status, 200);
    assert.equal(debug.body, "hello");
    assert.equal(debug.headers["content-type"], "text/plain; charset=utf-8");
    assert.equal(debug.headers["x-schelm-gate"], "optimize-parity");
    assert.equal(debug.undefinedHeader, false);
    assert.ok(!("undefined" in debug.headers));
    const report = {
      ok: true,
      version,
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      nodeBin,
      schelm,
      schelmHome: home,
      debug,
      optimize
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    for (const dir of [home, pkgGit, app]) {
      try { run("chmod", ["-R", "u+w", dir], { stdio: "pipe" }); } catch (_) {}
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
