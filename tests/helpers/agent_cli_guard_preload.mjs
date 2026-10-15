import fs from "node:fs";
import path from "node:path";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import childProcess from "node:child_process";
import { fileURLToPath } from "node:url";
import { syncBuiltinESMExports } from "node:module";

const canonical = input => path.resolve(input).replaceAll("\\", "/").toLowerCase();
const root = canonical(process.env.SCHOOLOGY_ROUTER_SOURCE);
const dependencies = canonical(fs.realpathSync(path.join(process.env.SCHOOLOGY_ROUTER_SOURCE, "node_modules")));
const fixtureRoot = canonical(fileURLToPath(new URL("./", import.meta.url)));
const sandbox = canonical(process.env.SCHOOLOGY_ROUTER_SANDBOX);
const selectedEnv = canonical(process.env.DOTENV_CONFIG_PATH);
const inside = (target, parent) => target === parent || target.startsWith(parent + "/");
const attempts = {};
function deny(kind) {
  attempts[kind] = (attempts[kind] || 0) + 1;
  throw new Error(`ROUTER-GUARD-BLOCKED:${kind}`);
}
function check(input, write = false) {
  if (typeof input === "number") return;
  const value = input instanceof URL ? fileURLToPath(input) : String(input);
  const target = canonical(value);
  const name = path.basename(value).toLowerCase();
  if ((name.startsWith(".env") || name.endsWith(".env")) && target !== selectedEnv) deny("dotenv-file");
  if (inside(target, sandbox + "/forbidden")) deny("protected-file");
  if (write) {
    if (!inside(target, sandbox)) deny("outside-write");
    return;
  }
  if (inside(target, root + "/data")) deny("original-store");
  if (inside(target, sandbox) || inside(target, dependencies) || inside(target, fixtureRoot)) return;
  if (inside(target, root) && (/\.(?:[cm]?js|json)$/.test(target) || target === root)) return;
  deny("private-file");
}
for (const name of ["readFileSync", "readFile", "createReadStream", "existsSync", "accessSync", "statSync", "lstatSync", "realpathSync", "readdirSync"]) {
  const original = fs[name];
  fs[name] = function(input, ...args) { check(input); return original.call(this, input, ...args); };
}
function openWrites(flags) {
  if (typeof flags === "number") return Boolean(flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND));
  return /[wa+]/.test(String(flags || "r"));
}
for (const name of ["openSync", "open"]) {
  const original = fs[name];
  fs[name] = function(input, flags, ...args) { check(input, openWrites(flags)); return original.call(this, input, flags, ...args); };
}
for (const name of ["writeFileSync", "writeFile", "appendFileSync", "appendFile", "createWriteStream", "mkdirSync", "mkdir", "unlinkSync", "unlink", "rmSync", "rm"]) {
  const original = fs[name];
  fs[name] = function(input, ...args) { check(input, true); return original.call(this, input, ...args); };
}
for (const name of ["renameSync", "rename", "copyFileSync", "copyFile"]) {
  const original = fs[name];
  fs[name] = function(from, to, ...args) { check(from); check(to, true); return original.call(this, from, to, ...args); };
}
for (const name of ["readFile", "access", "stat", "lstat", "realpath", "readdir"]) {
  const original = fs.promises[name];
  fs.promises[name] = async function(input, ...args) { check(input); return original.call(this, input, ...args); };
}
const promiseOpen = fs.promises.open;
fs.promises.open = async function(input, flags, ...args) { check(input, openWrites(flags)); return promiseOpen.call(this, input, flags, ...args); };
for (const name of ["writeFile", "appendFile", "mkdir", "unlink", "rm"]) {
  const original = fs.promises[name];
  fs.promises[name] = async function(input, ...args) { check(input, true); return original.call(this, input, ...args); };
}
http.request = http.get = https.request = https.get = () => deny("network");
net.connect = net.createConnection = net.Socket.prototype.connect = tls.connect = () => deny("network");
net.Server.prototype.listen = () => deny("service-start");
dgram.createSocket = () => deny("network");
for (const name of ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]) childProcess[name] = () => deny("process-start");
let transport;
const fakeFetch = async (url, options) => {
  if (!transport || new URL(String(url)).origin !== "https://router-fixture.invalid") deny("network");
  return await transport(String(url), options);
};
globalThis.fetch = fakeFetch;
Object.defineProperty(globalThis, "__schoologyRouterGuard", {
  value: Object.freeze({ deny, snapshot: () => ({ ...attempts }), installTransport: value => {
    if (transport || typeof value !== "function") throw new Error("ROUTER-TRANSPORT-INSTALL-REFUSED");
    transport = value;
  } }), writable: false, configurable: false,
});
syncBuiltinESMExports();
process.on("exit", () => {
  process.stderr.write(`ROUTER-GUARD-COUNTS ${JSON.stringify(attempts)}\n`);
  if (Object.keys(attempts).length) process.exitCode = 95;
});
