# Changelog

## Unreleased

### Added

- **Liquid-glass sidebar.** `sidebarGlass` frosts ZCode's left sidebar into a
  floating glass panel: backdrop blur, a diagonal specular sheen, a lit rim and
  an outer float shadow. Off by default — existing users see no change. Three
  accompanying knobs: `sidebarBlur` (0-60 px), `sidebarTint` (0-100, how much
  theme surface the panel keeps) and `sidebarRadius` (0-40 px; 0 keeps the panel
  flush with the window edge instead of floating). Exposed in the settings panel,
  the `apply_options` MCP tool, and `apply --sidebar-glass --sidebar-blur …
  --sidebar-tint … --sidebar-radius …`.
  The tint is derived from `--color-sidebar` via `color-mix`, so the panel
  follows the Monet scheme (or ZCode's native colours when Monet is off) rather
  than hard-coding a palette, and the CSS sets no `position`/`z-index` on
  `#sidebar`, so ZCode's own modals keep their stacking order.

- **Liquid-glass file preview.** `previewGlass` applies the same recipe to the
  right-hand file preview (`#browser`), with its own `previewBlur` (0-60 px),
  `previewTint` (0-100) and `previewRadius` (0-40 px). Off by default. This
  panel needs a surface more than the sidebar does: its wrapper paints
  `bg-background`, and the token overrides set `--color-background` to
  `transparent` so the wallpaper shows through — which left preview text sitting
  straight on the picture. A collapse guard clears the glass while the panel is
  mounted at width 0 (`data-disabled`), so no float shadow smears past the window
  edge.

## v0.3.3

The plugin now keeps the debug port alive across ZCode updates by itself, and
covers one more class of launch entry.

### Added

- **Startup launcher check.** When ZCode starts without the debug port — the
  failure mode after every app update, because the updater rebuilds the Start
  Menu shortcut without the flag — the MCP host repairs the launch entries as
  soon as it has confirmed the port is unreachable, so the *next* start is
  clean. Same repair as `repair-launchers`, no resident cost, and nothing runs
  while the port is reachable. This matters most for third-party launchers
  (Flow Launcher, PowerToys Run, …): they index the Start Menu shortcut and
  start it through ShellExecute, so the flag on that shortcut is what makes
  them work.
- Pinned taskbar shortcuts (`…\Quick Launch\User Pinned\TaskBar`) are scanned
  and repaired like the other per-user shortcuts.

### Changed

- `status` explains the likely cause — and the fix — when the CDP port is
  unreachable, instead of only reporting the error.
- README and INSTALL-FOR-AI document which entries ZCode itself resets: the
  updater rebuilds the Start Menu shortcut without the flag, and the app
  re-registers its protocol and context-menu registry handlers on every start.
  Shortcuts are the durable entries.

## v0.3.2

Stops the resident service from flashing a black console window on Windows.

### Fixed

- The process probe in `isZcodeProcessRunning()` ran `tasklist` without hiding
  the child console. The probe runs inside the detached `serve` daemon, which has
  no console of its own, so Windows allocated a fresh one on every call — and
  Windows 11 hands a new console to Windows Terminal. The result was a window
  titled `C:\WINDOWS\system32\tasklist.exe` appearing and vanishing every ~15
  seconds whenever the probe fired, i.e. whenever ZCode was not running, for as
  long as the daemon stayed alive. `tasklist`, `taskkill` and the PowerShell
  launcher-repair call are now spawned with `windowsHide: true`, which is what
  the launcher spawn and the daemon's own `spawn` already did.

## v0.3.1

Fixes the autostart entry behind recovery mode `always` on Windows. The script
it wrote was not valid VBScript, so Windows Script Host never ran it: the entry
was present and enabled, yet the resident service never started and the theme
was gone after every reboot.

### Fixed

- `autostart install` (and selecting `always`) assembled the command line out of
  separately quoted fragments, leaving everything after the first path outside a
  string literal — a parse error, not a concatenation. The whole command is now
  one VBScript string literal, with the paths quoted for Windows inside it.
  Re-run `zcode-beautify autostart install` (or re-select `always` in the
  settings panel) to rewrite an existing entry; it only matters from the next
  sign-in, since a running service keeps working either way.

## v0.3.0

The theme now restores itself. This release fixes the "the plugin stopped
working" report that followed every ZCode restart, and closes a security gap in
the local control API.

### Added

- **Recovery modes** (`recovery_status`, `set_recovery_mode`). The injected
  theme dies with the renderer on every restart, so something has to put it
  back. Three modes, chosen by the user:
  - `on-start` (default) — the MCP host ZCode spawns at startup restores it
    once. No resident process, no settings panel.
  - `always` — registers an autostart entry for the resident `serve` daemon, so
    both the theme and the settings panel survive a reboot. Costs a background
    node process (~60 MB, ~0.3% of one core).
  - `off` — nothing automatic.
  The settings panel carries a picker with the same three options and a
  plain-language note about what each costs.
- **`repair-launchers`** — scans desktop and Start Menu shortcuts, the
  `zcode://` protocol handler and the Explorer context-menu verbs, and appends
  the missing `--remote-debugging-port`. ZCode cannot open the port on its own:
  the flag has to come from whatever launches it, and a machine typically has
  several launch entries with only some of them carrying it.
- The settings panel now reports when ZCode is running with its debug port
  closed — the one case no background process can fix — and offers a button
  that restarts the app properly.

### Fixed

- The CLI and the plugin host wrote **two different `config.json` files**: the
  CLI fell back to `plugins/data/zcode-beautify/` while the host points
  `ZCODE_BEAUTIFY_DATA_DIR` at the `…@zcode-beautify` form it derives from
  `${ZCODE_PLUGIN_DATA}`. Settings changed through one path were invisible to
  the other. They now resolve to the same directory.
- The control API answered any request that could reach localhost, including
  from any web page open in a local browser, and could replace the wallpaper or
  reset the appearance. It now requires a token that only the injected panel
  carries; `/api/health` stays open since it exposes nothing but the service
  identity.
- `holdSession` leaked its WebSocket when a step after the connect failed, and
  held sessions were never dropped while CDP was unreachable. Both accumulated
  connections over long runs.
- The MCP server reported a hard-coded version that had drifted from the
  manifest. It is now injected at bundle time from `package.json`.

## v0.2.1

- The settings panel is honest when `serve` is not running: an explicit offline
  banner, zeroed and non-interactive controls, and a retry button, instead of
  rendering plausible-looking defaults it never read.
- `serve --detach` backgrounds the service so the panel outlives the shell that
  started it; a second `serve` refuses to start and names the pid that already
  owns the port.
- `/api/health` identifies the service and its pid.

## v0.2.0

- Settings panel with live tuning (blur, dim, Monet colors, wallpaper
  visibility, framing), wallpaper import, and reset/restore.
- `/beautify` slash command and MCP tools.
- Platform-agnostic skill pack for beautifying any Electron app over CDP.
