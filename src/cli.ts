#!/usr/bin/env node
/**
 * zcode-beautify CLI
 *
 *   launch   Start ZCode with the CDP debug port enabled (required once).
 *   apply    Set a wallpaper + Monet-derived colors, injecting into the running app.
 *   colors   Re-apply Monet colors only (no wallpaper change).
 *   reset    Restore ZCode's default appearance.
 *   watch    Keep re-injecting: survives ZCode restarts while this process lives.
 *   serve    Watch mode + settings panel + local control API.
 */

import fs from "node:fs";
import path from "node:path";
import { applyToZCode, DEFAULT_CONFIG, type BeautifyConfig } from "./core/inject.js";
import type { ApplyOptions } from "./core/session.js";
import { launchZcode, dataDir } from "./core/launch.js";
import { applyWallpaper, resetAppearance } from "./core/session.js";
import { cliEntryPath, getAutostartStatus, installAutostart, uninstallAutostart, type AutostartSpec } from "./core/autostart.js";
import { RECOVERY_MODES, applyRecoveryMode, normalizeMode, recoveryStatus } from "./core/recovery.js";
import { repairLaunchers } from "./core/launchers.js";

const USAGE = `zcode-beautify <command> [options]

Commands:
  launch [--port N]              Start ZCode with --remote-debugging-port=N
  apply <image> [options]        Set wallpaper and adapt colors
    --blur <px>                  Blur the wallpaper (default 0)
    --dim <0-100>                Darken the wallpaper (default 25)
    --fit <mode>                 cover | contain | smart (default cover)
    --no-monet                   Keep ZCode's original colors
    --sidebar-glass              Frost the left sidebar into a liquid-glass panel
    --sidebar-blur <px>          Sidebar backdrop blur (default 38)
    --sidebar-tint <0-100>       Sidebar glass tint strength (default 30)
    --sidebar-radius <px>        Sidebar corner radius; 0 = flush (default 18)
    --preview-glass              Frost the right-hand file preview into a glass sheet
    --preview-blur <px>          Preview backdrop blur (default 40)
    --preview-tint <0-100>       Preview glass tint strength (default 30)
    --preview-radius <px>        Preview corner radius; 0 = flush (default 16)
    --port <N>                   CDP port (default 9222)
  colors [--port N]              Re-apply stored theme without wallpaper change
  reset [--port N]               Remove wallpaper and color overrides
  status [--port N]              Show CDP reachability and renderer targets
  watch [--port N]               Watch mode: re-inject whenever ZCode (re)starts
  serve [--port N] [--api-port M] [--detach]
                                 Watch mode + settings panel + local API (default API port 9223)
                                 --detach runs it in the background, outliving this shell
  recovery [mode]                Restore the theme after ZCode restarts:
                                 off | on-start (default) | always
  autostart [install|uninstall]  Start the resident service at sign-in (used by mode "always")
  repair-launchers [--dry-run]   Add --remote-debugging-port to ZCode launch entries missing it
`;

function autostartSpec(cdpPort: number, apiPort = 9223): AutostartSpec {
  return { nodePath: process.execPath, cliPath: cliEntryPath(), cdpPort, apiPort };
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const i = rest.indexOf(name);
    return i >= 0 && i + 1 < rest.length ? rest[i + 1] : undefined;
  };
  const has = (name: string): boolean => rest.includes(name);
  const port = Number(flag("--port") ?? 9222);

  try {
    switch (cmd) {
      case "launch": {
        const r = await launchZcode(port);
        if (r.started) {
          console.log(`ZCode started with CDP on port ${port}.`);
        } else if (r.reason === "running-without-cdp") {
          console.error(
            `A ZCode instance is already running without the debug port, so the single-instance lock ` +
              `would immediately close the new process's CDP port.\n` +
              `Quit ZCode completely (including any tray icon), then run \`zcode-beautify launch\` again.`
          );
          process.exitCode = 1;
        } else {
          console.log(`ZCode already reachable on port ${port}.`);
        }
        break;
      }
      case "apply": {
        const image = rest.find((a) => !a.startsWith("--"));
        if (!image) {
          console.error(USAGE);
          process.exitCode = 1;
          return;
        }
        const { windows } = await applyWallpaper(image, {
          port,
          blur: Number(flag("--blur") ?? 0),
          dim: Number(flag("--dim") ?? 25),
          monet: !has("--no-monet"),
          fit: flag("--fit") as ApplyOptions["fit"],
          // Only set the glass when asked: passing `false` unconditionally would
          // silently switch off a panel the user enabled earlier.
          ...(has("--sidebar-glass") ? { sidebarGlass: true } : {}),
          ...(flag("--sidebar-blur") !== undefined ? { sidebarBlur: Number(flag("--sidebar-blur")) } : {}),
          ...(flag("--sidebar-tint") !== undefined ? { sidebarTint: Number(flag("--sidebar-tint")) } : {}),
          ...(flag("--sidebar-radius") !== undefined ? { sidebarRadius: Number(flag("--sidebar-radius")) } : {}),
          ...(has("--preview-glass") ? { previewGlass: true } : {}),
          ...(flag("--preview-blur") !== undefined ? { previewBlur: Number(flag("--preview-blur")) } : {}),
          ...(flag("--preview-tint") !== undefined ? { previewTint: Number(flag("--preview-tint")) } : {}),
          ...(flag("--preview-radius") !== undefined ? { previewRadius: Number(flag("--preview-radius")) } : {}),
        });
        console.log(`Applied wallpaper + theme to ${windows} window(s).`);
        break;
      }
      case "colors": {
        const { applyColorsOnly } = await import("./core/session.js");
        const windows = await applyColorsOnly({ port });
        console.log(`Re-applied theme to ${windows} window(s).`);
        break;
      }
      case "reset": {
        await resetAppearance(port);
        console.log("Appearance reset.");
        break;
      }
      case "status": {
        try {
          const { listTargets, pickRendererTargets } = await import("./core/cdp.js");
          const targets = pickRendererTargets(await listTargets(port));
          console.log(`CDP reachable on port ${port}; ${targets.length} renderer target(s):`);
          for (const t of targets) console.log(`  - [${t.id}] ${t.title} ${t.url}`);
        } catch (err) {
          console.log(`CDP not reachable on port ${port}: ${(err as Error).message}`);
          console.log(
            `If ZCode is running, it was probably started from an entry that lacks the debug flag.\n` +
              `Run \`zcode-beautify repair-launchers\` (add --dry-run to preview) to fix every entry,\n` +
              `then quit ZCode completely and start it from one of the fixed shortcuts.`
          );
          process.exitCode = 1;
        }
        break;
      }
      case "watch": {
        await watch(port);
        break;
      }
      case "serve": {
        const apiPort = Number(flag("--api-port") ?? 9223);
        if (has("--detach")) {
          await startServeDetached(port, apiPort);
          break;
        }
        const { startServe } = await import("./core/server.js");
        await startServe({ cdpPort: port, apiPort });
        break;
      }
      case "recovery": {
        const wanted = normalizeMode(rest[0]);
        if (rest[0] !== undefined && wanted === undefined) {
          console.error(`Unknown recovery mode "${rest[0]}". Use one of: ${RECOVERY_MODES.join(", ")}.`);
          process.exitCode = 1;
          break;
        }
        if (wanted) {
          const status = applyRecoveryMode(wanted, autostartSpec(port));
          console.log(`Recovery mode set to "${wanted}".`);
          if (wanted === "always") {
            console.log(
              status.autostart.installed
                ? `Autostart entry written to ${status.autostart.entryPath} (active from the next sign-in).`
                : `Could not register autostart${status.autostart.note ? `: ${status.autostart.note}` : ""}.`
            );
          } else if (status.autostart.installed === false) {
            console.log("Autostart entry removed.");
          }
          console.log(JSON.stringify(status, null, 2));
          break;
        }
        console.log(JSON.stringify(recoveryStatus(), null, 2));
        break;
      }
      case "autostart": {
        const apiPort = Number(flag("--api-port") ?? 9223);
        const action = rest[0] ?? "status";
        if (action === "install") {
          const status = installAutostart(autostartSpec(port, apiPort));
          if (!status.supported) {
            console.error(`Autostart is not supported on ${status.platform}.`);
            process.exitCode = 1;
            break;
          }
          console.log(`Autostart entry written to ${status.entryPath} (active from the next sign-in).`);
        } else if (action === "uninstall") {
          const before = getAutostartStatus();
          uninstallAutostart();
          console.log(before.installed ? "Autostart entry removed." : "No autostart entry was installed.");
        } else {
          console.log(JSON.stringify(getAutostartStatus(), null, 2));
        }
        break;
      }
      case "repair-launchers": {
        const report = await repairLaunchers({ port, dryRun: has("--dry-run") });
        if (report.error) {
          console.error(report.error);
          process.exitCode = 1;
          break;
        }
        for (const f of report.fixes) {
          console.log(`[${f.status}] ${f.path}${f.reason ? ` — ${f.reason}` : ""}`);
        }
        const updated = report.fixes.filter((f) => f.status === "updated").length;
        console.log(
          report.dryRun
            ? `${updated} of ${report.fixes.length} entry(ies) would be updated.`
            : `${updated} of ${report.fixes.length} entry(ies) updated.`
        );
        break;
      }
      case "help":
      case "--help":
      case "-h":
        console.log(USAGE);
        break;
      default:
        console.log(USAGE);
        if (cmd !== undefined) process.exitCode = 1;
    }
  } catch (err) {
    console.error(`error: ${(err as Error).message}`);
    process.exitCode = 1;
  }
}

/**
 * Runs `serve` as a detached process so the settings panel keeps working after
 * the terminal, agent session, or command invocation that started it is gone.
 */
async function startServeDetached(cdpPort: number, apiPort: number): Promise<void> {
  const { spawn } = await import("node:child_process");
  const { existingServePid } = await import("./core/server.js");

  // The child's own duplicate check runs in the background where nobody can see
  // it: probing the port afterwards would find the *existing* service healthy
  // and report a success that never happened. Check before spawning instead.
  const already = await existingServePid(apiPort);
  if (already !== undefined) {
    throw new Error(
      `a beautify service is already running on http://127.0.0.1:${apiPort} (pid ${already}) — ` +
        `open its panel, or stop that process first`
    );
  }

  fs.mkdirSync(dataDir(), { recursive: true });
  const logFile = path.join(dataDir(), "serve.log");
  const out = fs.openSync(logFile, "a");
  const child = spawn(
    process.execPath,
    [process.argv[1], "serve", "--port", String(cdpPort), "--api-port", String(apiPort)],
    { detached: true, stdio: ["ignore", out, out], windowsHide: true }
  );
  child.unref();
  fs.closeSync(out);

  // A detached spawn reports nothing, so confirm the service really came up.
  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const res = await fetch(`http://127.0.0.1:${apiPort}/api/health`, {
        signal: AbortSignal.timeout(1000),
      });
      const body = (await res.json()) as { service?: string; pid?: number };
      if (body?.service === "zcode-beautify") {
        console.log(`Beautify service running on http://127.0.0.1:${apiPort} (pid ${body.pid}).`);
        console.log(`Log: ${logFile}`);
        return;
      }
    } catch {
      /* not up yet */
    }
  }
  console.error(`serve did not come up within 10s — see ${logFile}`);
  process.exitCode = 1;
}

async function watch(port: number): Promise<void> {
  const { buildPayloadFromConfig } = await import("./core/session.js");
  const { loadConfig } = await import("./core/launch.js");
  const config = {
    ...DEFAULT_CONFIG,
    ...loadConfig(),
    port,
    fit: loadConfig().fit ?? "cover",
  } as BeautifyConfig;
  const payload = await buildPayloadFromConfig(config);

  let injected = new Set<string>();
  console.log(`watching CDP port ${port} — Ctrl+C to stop`);
  for (;;) {
    try {
      const { listTargets, pickRendererTargets } = await import("./core/cdp.js");
      const targets = pickRendererTargets(await listTargets(port));
      for (const t of targets) {
        if (!injected.has(t.id)) {
          try {
            await applyToZCode(config, payload);
            injected.add(t.id);
            console.log(`injected into "${t.title}" (${t.id})`);
          } catch {
            /* retry next tick */
          }
        }
      }
      const current = new Set(targets.map((t) => t.id));
      injected = new Set([...injected].filter((id) => current.has(id)));
    } catch {
      /* ZCode not up yet; keep polling */
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
}

main();
