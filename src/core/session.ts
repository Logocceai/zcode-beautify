/**
 * Shared high-level operations used by both the CLI and the MCP server.
 */

import fs from "node:fs";
import path from "node:path";
import { applyToZCode, buildPayload, DEFAULT_CONFIG, loadWallpaper, resetZCode, type BeautifyConfig, type BuiltPayload } from "./inject.js";
import { dataDir, loadConfig, saveConfig } from "./launch.js";

export interface ApplyOptions {
  port?: number;
  blur?: number;
  dim?: number;
  monet?: boolean;
  wallpaperVisible?: boolean;
  fit?: "cover" | "contain" | "smart";
  sidebarGlass?: boolean;
  sidebarBlur?: number;
  sidebarTint?: number;
  sidebarRadius?: number;
  previewGlass?: boolean;
  previewBlur?: number;
  previewTint?: number;
  previewRadius?: number;
}

/** Applies (or refreshes) the theme using the stored config. */
export async function reapplyStored(): Promise<number> {
  const config = mergedConfig();
  return applyToZCode(config, await buildPayloadFromConfig(config));
}

export async function applyWallpaper(imagePath: string, opts: ApplyOptions): Promise<{ windows: number; config: BeautifyConfig }> {
  const abs = path.resolve(imagePath);
  if (!fs.existsSync(abs)) throw new Error(`Image not found: ${abs}`);

  const stored = loadConfig();
  const config: BeautifyConfig = {
    ...DEFAULT_CONFIG,
    ...stored,
    port: opts.port ?? stored.port ?? DEFAULT_CONFIG.port,
    blur: opts.blur ?? stored.blur ?? DEFAULT_CONFIG.blur,
    dim: opts.dim ?? stored.dim ?? DEFAULT_CONFIG.dim,
    monet: opts.monet ?? stored.monet ?? DEFAULT_CONFIG.monet,
    wallpaperVisible: opts.wallpaperVisible ?? stored.wallpaperVisible ?? DEFAULT_CONFIG.wallpaperVisible,
    fit: opts.fit ?? stored.fit ?? DEFAULT_CONFIG.fit,
    sidebarGlass: opts.sidebarGlass ?? stored.sidebarGlass ?? DEFAULT_CONFIG.sidebarGlass,
    sidebarBlur: opts.sidebarBlur ?? stored.sidebarBlur ?? DEFAULT_CONFIG.sidebarBlur,
    sidebarTint: opts.sidebarTint ?? stored.sidebarTint ?? DEFAULT_CONFIG.sidebarTint,
    sidebarRadius: opts.sidebarRadius ?? stored.sidebarRadius ?? DEFAULT_CONFIG.sidebarRadius,
    previewGlass: opts.previewGlass ?? stored.previewGlass ?? DEFAULT_CONFIG.previewGlass,
    previewBlur: opts.previewBlur ?? stored.previewBlur ?? DEFAULT_CONFIG.previewBlur,
    previewTint: opts.previewTint ?? stored.previewTint ?? DEFAULT_CONFIG.previewTint,
    previewRadius: opts.previewRadius ?? stored.previewRadius ?? DEFAULT_CONFIG.previewRadius,
  };

  // Keep a copy of the wallpaper inside the data dir so the theme survives
  // the original file being moved/deleted.
  fs.mkdirSync(dataDir(), { recursive: true });
  const dest = path.join(dataDir(), "wallpaper" + path.extname(abs).toLowerCase());
  if (dest !== abs) fs.copyFileSync(abs, dest);

  const assets = await loadWallpaper(dest);
  const payload = buildPayload(config, assets);
  // Persist first: even if the app is not running yet, `launch` + `refresh_theme`
  // can pick the stored theme up later.
  saveConfig({ ...config, wallpaperPath: dest });

  const windows = await applyToZCode(config, payload);
  return { windows, config };
}

export async function applyColorsOnly(opts: ApplyOptions): Promise<number> {
  const stored = loadConfig();
  const config: BeautifyConfig = {
    ...DEFAULT_CONFIG,
    ...stored,
    port: opts.port ?? stored.port ?? DEFAULT_CONFIG.port,
    blur: opts.blur ?? stored.blur ?? DEFAULT_CONFIG.blur,
    dim: opts.dim ?? stored.dim ?? DEFAULT_CONFIG.dim,
    monet: opts.monet ?? stored.monet ?? DEFAULT_CONFIG.monet,
    wallpaperVisible: opts.wallpaperVisible ?? stored.wallpaperVisible ?? DEFAULT_CONFIG.wallpaperVisible,
    fit: opts.fit ?? stored.fit ?? DEFAULT_CONFIG.fit,
    sidebarGlass: opts.sidebarGlass ?? stored.sidebarGlass ?? DEFAULT_CONFIG.sidebarGlass,
    sidebarBlur: opts.sidebarBlur ?? stored.sidebarBlur ?? DEFAULT_CONFIG.sidebarBlur,
    sidebarTint: opts.sidebarTint ?? stored.sidebarTint ?? DEFAULT_CONFIG.sidebarTint,
    sidebarRadius: opts.sidebarRadius ?? stored.sidebarRadius ?? DEFAULT_CONFIG.sidebarRadius,
    previewGlass: opts.previewGlass ?? stored.previewGlass ?? DEFAULT_CONFIG.previewGlass,
    previewBlur: opts.previewBlur ?? stored.previewBlur ?? DEFAULT_CONFIG.previewBlur,
    previewTint: opts.previewTint ?? stored.previewTint ?? DEFAULT_CONFIG.previewTint,
    previewRadius: opts.previewRadius ?? stored.previewRadius ?? DEFAULT_CONFIG.previewRadius,
  };
  saveConfig(config);
  return applyToZCode(config, await buildPayloadFromConfig(config));
}

export async function resetAppearance(port?: number): Promise<number> {
  const stored = loadConfig();
  await resetZCode(port ?? stored.port ?? DEFAULT_CONFIG.port);
  saveConfig({ ...stored, wallpaperPath: undefined });
  return 0;
}

export async function buildPayloadFromConfig(config: BeautifyConfig): Promise<BuiltPayload> {
  let assets;
  if (config.wallpaperPath && fs.existsSync(config.wallpaperPath)) {
    assets = await loadWallpaper(config.wallpaperPath);
  }
  return buildPayload(config, assets);
}

function mergedConfig(): BeautifyConfig {
  return { ...DEFAULT_CONFIG, ...loadConfig(), port: loadConfig().port ?? DEFAULT_CONFIG.port };
}
