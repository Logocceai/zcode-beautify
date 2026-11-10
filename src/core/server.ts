/**
 * `serve` mode: a localhost-only control API plus persistent injection
 * sessions.
 *
 * The injected settings panel (src/panel) talks to this API to read and change
 * the live configuration. Injection connections are held open so that
 * Page.addScriptToEvaluateOnNewDocument keeps re-running across renderer
 * reloads for as long as this process lives — no polling reinjection needed
 * while a session is healthy.
 */

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import {
  CdpConnection,
  buildBootstrapScript,
  buildResetScript,
  listTargets,
  pickRendererTargets,
} from "./cdp.js";
import { buildPayload, DEFAULT_CONFIG, type BeautifyConfig } from "./inject.js";
import { loadWallpaper, type WallpaperAssets } from "./monet.js";
import { buildPanelScript } from "../panel/panelScript.js";
import { dataDir, isZcodeProcessRunning, loadConfig, relaunchZcode, saveConfig } from "./launch.js";
import { applyRecoveryMode, loadRecovery, normalizeMode } from "./recovery.js";
import { cliEntryPath, getAutostartStatus } from "./autostart.js";

const MAX_WALLPAPER_BYTES = 20 * 1024 * 1024;
const MAX_BODY_BYTES = MAX_WALLPAPER_BYTES + 1024 * 1024;
const POLL_MS = 1500;

export interface ServeOptions {
  cdpPort: number;
  apiPort: number;
}

interface HeldSession {
  conn: CdpConnection;
  themeScriptId?: string;
}

/**
 * What the last poll saw. The panel has to tell three situations apart — healthy,
 * "ZCode is running but its debug port is closed", and "ZCode is not running" —
 * because each one asks the user for something different.
 */
interface RuntimeState {
  cdpReachable: boolean;
  rendererCount: number;
  zcodeRunning: boolean;
  lastError?: string;
  updatedAt?: string;
}

let runtimeState: RuntimeState = { cdpReachable: false, rendererCount: 0, zcodeRunning: false };

/** Walking the process table on every failed poll would be wasteful. */
let nextProcessProbe = 0;

// One decoded image + extracted theme, reused across slider updates so the
// panel feels instant. Invalidated whenever the wallpaper file changes.
let cachedAssets: { file: string; mtimeMs: number; assets: WallpaperAssets } | undefined;

async function getAssets(wallpaperPath?: string): Promise<WallpaperAssets | undefined> {
  if (!wallpaperPath || !fs.existsSync(wallpaperPath)) return undefined;
  const mtimeMs = fs.statSync(wallpaperPath).mtimeMs;
  if (cachedAssets?.file === wallpaperPath && cachedAssets.mtimeMs === mtimeMs) {
    return cachedAssets.assets;
  }
  const assets = await loadWallpaper(wallpaperPath);
  cachedAssets = { file: wallpaperPath, mtimeMs, assets };
  return assets;
}

function currentConfig(): BeautifyConfig {
  return { ...DEFAULT_CONFIG, ...loadConfig() };
}

function backupFile(): string {
  return path.join(dataDir(), "config.backup.json");
}

function hasBackup(): boolean {
  return fs.existsSync(backupFile());
}

function publicConfig(config: BeautifyConfig) {
  return {
    blur: config.blur,
    dim: config.dim,
    monet: config.monet,
    wallpaperVisible: config.wallpaperVisible,
    fit: config.fit,
    sidebarGlass: config.sidebarGlass,
    sidebarBlur: config.sidebarBlur,
    sidebarTint: config.sidebarTint,
    sidebarRadius: config.sidebarRadius,
    previewGlass: config.previewGlass,
    previewBlur: config.previewBlur,
    previewTint: config.previewTint,
    previewRadius: config.previewRadius,
    wallpaperSet: Boolean(config.wallpaperPath && fs.existsSync(config.wallpaperPath)),
    hasBackup: hasBackup(),
    cdpPort: config.port,
  };
}

function sanitize(body: any): Partial<BeautifyConfig> {
  const out: Partial<BeautifyConfig> = {};
  if (typeof body?.blur === "number" && body.blur >= 0 && body.blur <= 100) out.blur = body.blur;
  if (typeof body?.dim === "number" && body.dim >= 0 && body.dim <= 100) out.dim = body.dim;
  if (typeof body?.monet === "boolean") out.monet = body.monet;
  if (typeof body?.wallpaperVisible === "boolean") out.wallpaperVisible = body.wallpaperVisible;
  if (body?.fit === "cover" || body?.fit === "contain" || body?.fit === "smart") out.fit = body.fit;
  if (typeof body?.sidebarGlass === "boolean") out.sidebarGlass = body.sidebarGlass;
  if (typeof body?.sidebarBlur === "number" && body.sidebarBlur >= 0 && body.sidebarBlur <= 60) out.sidebarBlur = body.sidebarBlur;
  if (typeof body?.sidebarTint === "number" && body.sidebarTint >= 0 && body.sidebarTint <= 100) out.sidebarTint = body.sidebarTint;
  if (typeof body?.sidebarRadius === "number" && body.sidebarRadius >= 0 && body.sidebarRadius <= 40) out.sidebarRadius = body.sidebarRadius;
  if (typeof body?.previewGlass === "boolean") out.previewGlass = body.previewGlass;
  if (typeof body?.previewBlur === "number" && body.previewBlur >= 0 && body.previewBlur <= 60) out.previewBlur = body.previewBlur;
  if (typeof body?.previewTint === "number" && body.previewTint >= 0 && body.previewTint <= 100) out.previewTint = body.previewTint;
  if (typeof body?.previewRadius === "number" && body.previewRadius >= 0 && body.previewRadius <= 40) out.previewRadius = body.previewRadius;
  return out;
}

// --- injection session management -------------------------------------------

const held = new Map<string, HeldSession>();

async function registerScript(
  session: HeldSession,
  source: string
): Promise<string> {
  const { identifier } = await session.conn.send("Page.addScriptToEvaluateOnNewDocument", { source });
  return identifier;
}

async function holdSession(
  target: { id: string; webSocketDebuggerUrl?: string },
  config: BeautifyConfig,
  apiPort: number,
  token: string
): Promise<void> {
  if (!target.webSocketDebuggerUrl) return;
  const conn = await CdpConnection.connect(target.webSocketDebuggerUrl);
  // Anything that fails once the socket is up has to close it: the caller
  // retries every tick, so a connection dropped on the floor here would leave
  // one orphaned WebSocket per tick for as long as the failure lasts.
  try {
    await conn.send("Page.enable");
    const session: HeldSession = { conn };

    const assets = await getAssets(config.wallpaperPath);
    const payload = buildPayload(config, assets);
    const bootstrap = buildBootstrapScript({
      css: payload.css,
      wallpaperDataUri: payload.wallpaperDataUri,
      fit: payload.fit,
    });
    const { identifier } = await conn.send("Page.addScriptToEvaluateOnNewDocument", {
      source: bootstrap,
    });
    session.themeScriptId = identifier;
    await conn.send("Runtime.evaluate", { expression: bootstrap, returnByValue: true });

    const panelScript = buildPanelScript(apiPort, token);
    await conn.send("Page.addScriptToEvaluateOnNewDocument", { source: panelScript });
    await conn.send("Runtime.evaluate", { expression: panelScript, returnByValue: true });

    held.set(target.id, session);
  } catch (err) {
    conn.close();
    throw err;
  }
}

/** Re-evaluates the theme bootstrap in every live session after a config change. */
async function pushConfigToSessions(config: BeautifyConfig): Promise<number> {
  const assets = await getAssets(config.wallpaperPath);
  const payload = buildPayload(config, assets);
  const bootstrap = buildBootstrapScript({
    css: payload.css,
    wallpaperDataUri: payload.wallpaperDataUri,
    fit: payload.fit,
  });
  let ok = 0;
  for (const [id, session] of held) {
    try {
      if (session.themeScriptId) {
        await session.conn
          .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: session.themeScriptId })
          .catch(() => {});
      }
      session.themeScriptId = await registerScript(session, bootstrap);
      await session.conn.send("Runtime.evaluate", { expression: bootstrap, returnByValue: true });
      ok++;
    } catch {
      session.conn.close();
      held.delete(id);
    }
  }
  return ok;
}

async function poll(config: BeautifyConfig, apiPort: number, token: string): Promise<void> {
  try {
    const targets = pickRendererTargets(await listTargets(config.port));
    const current = new Set(targets.map((t) => t.id));
    for (const t of targets) {
      if (!held.has(t.id)) {
        try {
          await holdSession(t, config, apiPort, token);
          console.log(`serve: panel + theme injected into "${t.title}" (${t.id})`);
        } catch {
          /* retry next tick */
        }
      }
    }
    for (const id of [...held.keys()]) {
      if (!current.has(id)) {
        held.get(id)!.conn.close();
        held.delete(id);
      }
    }
    runtimeState = {
      cdpReachable: true,
      rendererCount: targets.length,
      zcodeRunning: true,
      updatedAt: new Date().toISOString(),
    };
  } catch (err) {
    // No CDP endpoint: either ZCode is closed, or it is running without the
    // debug port. Either way the held sockets are dead weight — drop them so a
    // later restart injects afresh instead of matching a stale target id.
    for (const [id, session] of held) {
      session.conn.close();
      held.delete(id);
    }
    if (Date.now() > nextProcessProbe) {
      nextProcessProbe = Date.now() + 15_000;
      runtimeState = {
        cdpReachable: false,
        rendererCount: 0,
        zcodeRunning: await isZcodeProcessRunning(),
        lastError: (err as Error).message,
        updatedAt: new Date().toISOString(),
      };
    }
  }
}

// --- HTTP API ----------------------------------------------------------------

function sendJson(res: http.ServerResponse, code: number, body: unknown): void {
  // The client can vanish mid-request (panel closed, renderer reloaded); a
  // write to a dead socket must not escape as a rejection.
  try {
    res.writeHead(code, {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    res.end(JSON.stringify(body));
  } catch {
    /* response already finished or socket gone */
  }
}

/** Only the injected panel carries the token; nothing else on the machine has it. */
function authorized(req: http.IncomingMessage, token: string): boolean {
  const header = req.headers["x-zb-token"];
  return typeof header === "string" && header.length > 0 && header === token;
}

/** True when another `serve` of this plugin already owns the port. */
export async function existingServePid(apiPort: number): Promise<number | undefined> {
  try {
    const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
      signal: AbortSignal.timeout(1000),
    });
    const body = (await res.json()) as { service?: string; pid?: number };
    return body?.service === "zcode-beautify" ? body.pid : undefined;
  } catch {
    return undefined;
  }
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const IMAGE_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
};

export async function startServe(opts: ServeOptions): Promise<void> {
  const { cdpPort, apiPort } = opts;

  // This API can replace the user's wallpaper and even relaunch ZCode, and it
  // answers anything that can reach localhost. The token only ever travels
  // inside the injected panel script, so a random web page cannot drive it.
  const token = randomBytes(16).toString("hex");

  // `serve --port N` must win over the port stored in the config file: reading
  // the merged config alone silently dialed the stored port while still
  // printing the flag's value.
  const runtimeConfig = (): BeautifyConfig => ({ ...currentConfig(), port: cdpPort });
  /** What actually goes to disk — the CLI's --port is not a persisted setting. */
  const persisted = (config: BeautifyConfig): BeautifyConfig => ({
    ...config,
    port: currentConfig().port,
  });

  const already = await existingServePid(apiPort);
  if (already !== undefined) {
    throw new Error(
      `a beautify service is already running on http://127.0.0.1:${apiPort} (pid ${already}) — ` +
        `open its panel, or stop that process first`
    );
  }

  // A request handler that rejects would otherwise take the whole process down
  // (unhandled rejection), killing every held injection session with it.
  const server = http.createServer((req, res) => {
    handleRequest(req, res).catch(() => {
      try {
        res.destroy();
      } catch {
        /* socket gone */
      }
    });
  });

  async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", "http://127.0.0.1");
    try {
      if (req.method === "OPTIONS") {
        sendJson(res, 204, {});
        return;
      }

      // /api/health stays open: it identifies the service but exposes nothing,
      // and the CLI relies on it to detect an already-running instance.
      if (url.pathname !== "/api/health" && !authorized(req, token)) {
        sendJson(res, 403, { error: "missing or invalid token" });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/config") {
        sendJson(res, 200, publicConfig(runtimeConfig()));
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/config") {
        const patch = sanitize(JSON.parse(await readBody(req)));
        const config = { ...runtimeConfig(), ...patch };
        saveConfig(persisted(config));
        const windows = await pushConfigToSessions(config).catch(() => 0);
        sendJson(res, 200, { ok: true, windows, ...publicConfig(config) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/wallpaper") {
        const body = JSON.parse(await readBody(req));
        const dataUri = typeof body?.dataUri === "string" ? body.dataUri : "";
        const m = /^data:(image\/(?:jpeg|png|webp|gif|bmp));base64,(.+)$/.exec(dataUri);
        if (!m) throw new Error("dataUri must be a base64 image data URI");
        const bytes = Buffer.from(m[2], "base64");
        if (bytes.length > MAX_WALLPAPER_BYTES) {
          throw new Error(`image too large (max ${MAX_WALLPAPER_BYTES / 1024 / 1024} MB)`);
        }
        const config = runtimeConfig();
        fs.mkdirSync(dataDir(), { recursive: true });
        const dest = path.join(dataDir(), "wallpaper" + IMAGE_EXT[m[1]]);
        fs.writeFileSync(dest, bytes);
        cachedAssets = { file: dest, mtimeMs: fs.statSync(dest).mtimeMs, assets: await loadWallpaper(dest) };
        saveConfig(persisted({ ...config, wallpaperPath: dest }));
        const windows = await pushConfigToSessions({ ...config, wallpaperPath: dest }).catch(() => 0);
        sendJson(res, 200, { ok: true, windows, ...publicConfig({ ...config, wallpaperPath: dest }) });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/reset") {
        const stored = loadConfig();
        // Back up the wallpaper config so /api/restore can bring it back
        // without re-importing the image.
        if (stored.wallpaperPath && fs.existsSync(stored.wallpaperPath)) {
          fs.mkdirSync(dataDir(), { recursive: true });
          fs.writeFileSync(backupFile(), JSON.stringify(stored));
        }
        for (const [id, session] of held) {
          try {
            if (session.themeScriptId) {
              await session.conn
                .send("Page.removeScriptToEvaluateOnNewDocument", { identifier: session.themeScriptId })
                .catch(() => {});
              session.themeScriptId = undefined;
            }
            await session.conn.send("Runtime.evaluate", { expression: buildResetScript() });
          } catch {
            session.conn.close();
            held.delete(id);
          }
        }
        saveConfig({ ...stored, wallpaperPath: undefined });
        cachedAssets = undefined;
        sendJson(res, 200, { ok: true, hasBackup: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/restore") {
        let saved: Partial<BeautifyConfig>;
        try {
          saved = JSON.parse(fs.readFileSync(backupFile(), "utf8"));
        } catch {
          throw new Error("no wallpaper backup available");
        }
        const config: BeautifyConfig = { ...DEFAULT_CONFIG, ...saved };
        saveConfig(config);
        const windows = await pushConfigToSessions(config).catch(() => 0);
        sendJson(res, 200, { ok: true, windows, ...publicConfig(config) });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        sendJson(res, 200, {
          ...runtimeState,
          recovery: loadRecovery(),
          autostart: getAutostartStatus(),
        });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/relaunch") {
        const result = await relaunchZcode(cdpPort);
        sendJson(res, 200, { ok: true, ...result });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/recovery") {
        const body = JSON.parse(await readBody(req));
        const mode = normalizeMode(body?.mode);
        if (!mode) throw new Error("mode must be one of: off, on-start, always");
        const status = applyRecoveryMode(mode, {
          nodePath: process.execPath,
          cliPath: cliEntryPath(),
          cdpPort,
          apiPort,
        });
        sendJson(res, 200, {
          ok: true,
          recovery: { mode: status.mode, updatedAt: status.updatedAt },
          autostart: status.autostart,
        });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/health") {
        sendJson(res, 200, { ok: true, service: "zcode-beautify", pid: process.pid });
        return;
      }

      sendJson(res, 404, { error: "not found" });
    } catch (err) {
      sendJson(res, 400, { error: (err as Error).message });
    }
  }

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(apiPort, "127.0.0.1", resolve);
  });

  // The listen-time listener above is one-shot; without a permanent one, any
  // later server error would be an unhandled 'error' event and crash serve.
  server.on("error", (err) => {
    console.error(`serve: http server error — ${(err as Error).message}`);
  });

  console.log(`serve: control API on http://127.0.0.1:${apiPort} — Ctrl+C to stop`);
  console.log(`serve: injecting into ZCode renderers on CDP port ${cdpPort}`);

  // Initial pass, then keep polling so restarts of the app get re-injected.
  await poll(runtimeConfig(), apiPort, token);
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_MS));
    await poll(runtimeConfig(), apiPort, token);
  }
}
