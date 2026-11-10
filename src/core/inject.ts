/**
 * Assembles the full injected payload: wallpaper layer CSS + variable
 * overrides, plus helpers to apply a theme to a running ZCode instance.
 */

import { CdpConnection, injectIntoTarget, listTargets, pickRendererTargets, buildResetScript } from "./cdp.js";
import { loadWallpaper, type WallpaperAssets } from "./monet.js";
import { buildVariableOverrides, buildTransparencyOverrides } from "./tokens.js";

export type WallpaperFit = "cover" | "contain" | "smart";

export interface BeautifyConfig {
  port: number;
  wallpaperPath?: string;
  blur: number;
  dim: number;
  monet: boolean;
  wallpaperVisible: boolean;
  fit: WallpaperFit;
  /** Frost the left sidebar into a liquid-glass panel (off by default). */
  sidebarGlass: boolean;
  /** Backdrop blur radius for the glass sidebar, in px (0-60). */
  sidebarBlur: number;
  /** Glass tint strength 0-100: how much of the theme surface colour the
   *  panel keeps. Higher = more opaque, lower = more of the wallpaper shows. */
  sidebarTint: number;
  /** Corner radius in px (0 = flush with the window edge, no floating). */
  sidebarRadius: number;
  /** Frost the right-hand file preview into a glass sheet (off by default). */
  previewGlass: boolean;
  /** Backdrop blur radius for the preview glass, in px (0-60). */
  previewBlur: number;
  /** Preview glass tint strength 0-100 (higher = more opaque). */
  previewTint: number;
  /** Preview corner radius in px (0 = flush, no float). */
  previewRadius: number;
}

export const DEFAULT_CONFIG: BeautifyConfig = {
  port: 9222,
  blur: 0,
  dim: 25,
  monet: true,
  wallpaperVisible: true,
  fit: "cover",
  sidebarGlass: false,
  sidebarBlur: 38,
  sidebarTint: 30,
  sidebarRadius: 18,
  previewGlass: false,
  previewBlur: 40,
  previewTint: 30,
  previewRadius: 16,
};

export interface BuiltPayload {
  css: string;
  wallpaperDataUri?: string;
  /** How the wallpaper layer is framed; "contain" adds a blurred backdrop. */
  fit: "cover" | "contain";
  /** Normalized focus point for background-position. */
  focusX: number;
  focusY: number;
}

export function buildPayload(config: BeautifyConfig, assets?: WallpaperAssets): BuiltPayload {
  const parts: string[] = [];

  // "smart" resolves to the analyzed suggestion at build time, so the injected
  // CSS only ever deals with cover or contain.
  const resolved: "cover" | "contain" =
    config.fit === "smart" ? (assets?.focus.fit ?? "cover") : config.fit === "contain" ? "contain" : "cover";
  const focusX = config.fit === "smart" ? (assets?.focus.x ?? 0.5) : 0.5;
  const focusY = config.fit === "smart" ? (assets?.focus.y ?? 0.5) : 0.5;
  const position = `${Math.round(focusX * 100)}% ${Math.round(focusY * 100)}%`;

  parts.push(`
html, body { background: transparent !important; }
#zcode-beautify-wallpaper {
  position: fixed;
  inset: 0;
  z-index: -2147483646;
  background-size: ${resolved};
  background-position: ${resolved === "contain" ? "center" : position};
  background-repeat: no-repeat;
  pointer-events: none;
  filter: blur(${config.blur}px);
  transform: scale(${config.blur > 0 ? 1.04 : 1});
}
#zcode-beautify-backdrop {
  position: fixed;
  inset: 0;
  z-index: -2147483647;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  pointer-events: none;
  filter: blur(28px) saturate(1.15) brightness(0.85);
  transform: scale(1.12);
  display: none;
}
#zcode-beautify-backdrop[data-on="1"] { display: block; }`);
  if (config.dim > 0) {
    parts.push(`#zcode-beautify-wallpaper::after {
  content: '';
  position: absolute;
  inset: 0;
  background: rgb(0 0 0 / var(--zcode-beautify-dim, ${config.dim / 100}));
}`);
  }

  if (assets) {
    // Monet recolors the UI from the wallpaper; the wallpaper toggle only
    // decides whether the picture is visible at all. With Monet off we still
    // need transparency, otherwise the opaque UI hides the wallpaper.
    if (config.monet) {
      parts.push(buildVariableOverrides(assets.theme, {
        dim: config.dim,
        wallpaperVisible: config.wallpaperVisible,
      }));
    } else if (config.wallpaperVisible) {
      parts.push(buildTransparencyOverrides({ dim: config.dim }));
    }
  }
  const wallpaperDataUri = config.wallpaperVisible ? assets?.dataUri : undefined;

  if (config.sidebarGlass) {
    parts.push(buildSidebarGlassCss(config));
  }
  if (config.previewGlass) {
    parts.push(buildPreviewGlassCss(config));
  }

  return {
    css: parts.join("\n"),
    wallpaperDataUri,
    fit: config.wallpaperVisible ? resolved : "cover",
    focusX,
    focusY,
  };
}

/**
 * Shared glass recipe. Both the sidebar and the file preview are panes of the
 * same material, so the frost / sheen / rim numbers live in one place and each
 * caller only supplies its selector, geometry and tint token.
 */
interface GlassRecipe {
  selector: string;
  /** CSS custom property holding the surface colour to tint from. */
  tintVar: string;
  tintFallback: string;
  tint: number;
  blur: number;
  radius: number;
  /** Side of the panel that keeps a margin when floating (the others are 0). */
  marginAxis: "all" | "left";
  /** Extra rules appended verbatim, e.g. concentric-inner-radius or collapse guards. */
  extra?: string;
}

function glassRules(r: GlassRecipe): string {
  // Specular sheen: light gathers at the top-left edge and thins out toward the
  // bottom-right, the way a real pane catches a window.
  const sheen = `linear-gradient(
    135deg,
    rgba(255, 255, 255, 0.16) 0%,
    rgba(255, 255, 255, 0.06) 26%,
    rgba(255, 255, 255, 0.00) 48%,
    rgba(255, 255, 255, 0.03) 74%,
    rgba(255, 255, 255, 0.10) 100%
  )`;

  const rim = [
    "inset 0 1.5px 0 rgba(255, 255, 255, 0.34)",
    "inset 0 0 0 1px rgba(255, 255, 255, 0.14)",
    "inset 0 -1.5px 0 rgba(255, 255, 255, 0.08)",
    "inset 0 0 24px rgba(255, 255, 255, 0.035)",
  ];
  const floating = r.radius > 0;
  // Only a floating panel casts an outer shadow; flush panels have nowhere to cast it.
  if (floating) rim.push("0 10px 32px rgba(0, 0, 0, 0.34)", "0 2px 10px rgba(0, 0, 0, 0.20)");

  const inset = !floating
    ? `  margin: 0 !important;`
    : r.marginAxis === "all"
      ? `  margin: 8px !important;
  height: calc(100% - 16px) !important;`
      : `  margin: 6px 6px 6px 0 !important;
  height: calc(100% - 12px) !important;`;

  const tintPct = Math.round(Math.max(0, Math.min(100, r.tint)));
  const blur = Math.max(0, Math.min(60, r.blur));
  const radius = Math.max(0, Math.min(40, r.radius));

  return `${r.selector} {
${inset}
  border-radius: ${radius}px !important;
  background-color: color-mix(in srgb, var(${r.tintVar}, ${r.tintFallback}) ${tintPct}%, transparent) !important;
  background-image: ${sheen} !important;
  backdrop-filter: blur(${blur}px) saturate(2.1) brightness(1.1) contrast(1.04) !important;
  -webkit-backdrop-filter: blur(${blur}px) saturate(2.1) brightness(1.1) contrast(1.04) !important;
  box-shadow: ${rim.join(", ")} !important;
  border: none !important;
}${r.extra ? "\n" + r.extra : ""}`;
}

/**
 * Liquid-glass treatment for the left sidebar (`#sidebar`).
 *
 * ZCode paints the sidebar from `--color-sidebar`, which our token overrides
 * already make translucent — but a flat translucent fill over a busy wallpaper
 * reads as "a hole", not as glass. This adds the three ingredients that make it
 * read as material: a frosted backdrop, a specular sheen, and a lit rim.
 *
 * Two deliberate constraints:
 *  - No `position`/`z-index` is set on `#sidebar`. Changing them would make the
 *    panel a stacking context and trap ZCode's own modals behind it; the glass
 *    is painted purely with background/backdrop-filter/box-shadow.
 *  - The tint is derived from `--color-sidebar` at build time via color-mix, so
 *    the panel keeps following the Monet scheme (or ZCode's native colours when
 *    Monet is off) instead of hard-coding one palette.
 */
export function buildSidebarGlassCss(config: BeautifyConfig): string {
  return glassRules({
    selector: "#sidebar",
    tintVar: "--color-sidebar",
    tintFallback: "rgba(32, 26, 25, 0.62)",
    tint: config.sidebarTint,
    blur: config.sidebarBlur,
    radius: config.sidebarRadius,
    marginAxis: "all",
  });
}

/**
 * Liquid-glass treatment for the right-hand file preview (`#browser`).
 *
 * This panel needs a surface more urgently than the sidebar does: its wrapper
 * paints `bg-background`, and the token overrides set `--color-background` to
 * `transparent` so the wallpaper can show through. With nothing behind it the
 * preview text sits straight on the wallpaper. The glass restores a readable
 * frosted surface while still letting the picture read through.
 *
 * The right edge sits against the window chrome, so the margin is zeroed there
 * and the float shadow only shows on the three inner sides.
 */
export function buildPreviewGlassCss(config: BeautifyConfig): string {
  return glassRules({
    selector: "#browser",
    tintVar: "--color-card",
    tintFallback: "rgba(37, 30, 29, 0.72)",
    tint: config.previewTint,
    blur: config.previewBlur,
    radius: config.previewRadius,
    marginAxis: "left",
    // The panel's own wrapper carries a 6px radius; match it inward so the two
    // rounded corners stay concentric instead of cutting a notch.
    // The collapse guard matters: the host keeps this panel mounted at width 0
    // (it never sets display:none) and marks it data-disabled, so the glass,
    // its margin and its outer shadow would still be laid out — the float
    // shadow alone smears a dark smudge past the window edge.
    extra: `#browser > div > div > div[class*="rounded-md"] {
  border-radius: 12px !important;
}
#browser[data-disabled="true"] {
  margin: 0 !important;
  border-radius: 0 !important;
  box-shadow: none !important;
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
  background-color: transparent !important;
  background-image: none !important;
}`,
  });
}

/** Apply config to a running ZCode instance. Returns how many windows got it. */
export async function applyToZCode(config: BeautifyConfig, payload: BuiltPayload): Promise<number> {
  const targets = pickRendererTargets(await listTargets(config.port));
  if (targets.length === 0) {
    throw new Error("No ZCode renderer target found on the CDP endpoint.");
  }
  let count = 0;
  for (const target of targets) {
    try {
      await injectIntoTarget(target, payload);
      count++;
    } catch (err) {
      console.warn(`Injection into "${target.title}" failed: ${(err as Error).message}`);
    }
  }
  return count;
}

export async function resetZCode(port: number): Promise<number> {
  const targets = pickRendererTargets(await listTargets(port));
  let count = 0;
  for (const target of targets) {
    try {
      const conn = await CdpConnection.connect(target.webSocketDebuggerUrl!);
      await conn.send("Runtime.evaluate", { expression: buildResetScript() });
      conn.close();
      count++;
    } catch (err) {
      console.warn(`Reset of "${target.title}" failed: ${(err as Error).message}`);
    }
  }
  return count;
}

/** Re-export so CLI/MCP can load wallpapers without touching monet internals. */
export { loadWallpaper };
