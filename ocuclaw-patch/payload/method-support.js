// openclaw-g2: decide whether a gateway method is supported before calling it,
// so unsupported methods (e.g. sessions.compaction.list on OpenClaw 2026.10.x)
// are never sent. Sources, in order:
//   1. the method list the gateway advertises in hello-ok (features.methods);
//   2. a small per-host-version file of methods the gateway rejected as
//      unknown (<state>/unsupported-gateway-methods.json, state defaults to
//      ~/.openclaw/ocuclaw-g2), so they are not retried until the version changes;
//   3. an in-process set (when the host version is unknown).
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const KEY = Symbol.for("openclaw-g2.gatewayMethodSupport");
const FILE_NAME = "unsupported-gateway-methods.json";

function freshState() {
  return { advertised: null, version: null, unsupported: new Set() };
}

const holder = (globalThis[KEY] ||= { state: freshState() });

function stateFile() {
  const dir = process.env.OCUCLAW_G2_STATE_DIR || path.join(os.homedir(), ".openclaw", "ocuclaw-g2");
  return path.join(dir, FILE_NAME);
}

function readPersisted() {
  try {
    const data = JSON.parse(fs.readFileSync(stateFile(), "utf8"));
    if (data && typeof data === "object" && data.versions && typeof data.versions === "object") return data;
  } catch {
    // missing or unreadable file: nothing persisted
  }
  return { versions: {} };
}

function persist(version, methods) {
  try {
    const data = readPersisted();
    data.versions = { [version]: [...methods].sort() }; // keep only the current host version
    const file = stateFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(tmp, file);
  } catch {
    // persistence is best effort
  }
}

// Hook for the gateway client's hello-ok handler.
export function noteGatewayHello(helloOk) {
  const st = holder.state;
  if (!helloOk || typeof helloOk !== "object") return;
  const version = typeof helloOk.server?.version === "string" ? helloOk.server.version.trim() : "";
  const methods = helloOk.features?.methods;
  st.advertised = Array.isArray(methods) ? new Set(methods.filter((m) => typeof m === "string")) : null;
  if (version && version !== st.version) {
    st.version = version;
    st.unsupported = new Set(readPersisted().versions[version] || []);
  }
}

export function isMethodUnsupported(method) {
  const st = holder.state;
  if (st.advertised) return !st.advertised.has(method);
  return st.unsupported.has(method);
}

export function markMethodUnsupported(method) {
  if (typeof method !== "string" || !method) return;
  const st = holder.state;
  st.unsupported.add(method);
  if (st.version) persist(st.version, st.unsupported);
}

export function resetMethodSupportForTests() {
  holder.state = freshState();
}
