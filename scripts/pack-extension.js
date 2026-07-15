#!/usr/bin/env node
import { existsSync, mkdtempSync, rmSync, statSync, unlinkSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const extensionDir = resolve(root, "extension");
const keyPath = resolve(root, "extension.pem");
const crxPath = resolve(root, "extension.crx");

const explicitBrowser = process.env.BLUETAB_BROWSER || process.env.CHROME || process.env.BROWSER;
const candidates = [
  explicitBrowser,
  "brave-browser",
  "brave",
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "microsoft-edge",
].filter(Boolean);

let lastError;
for (const browser of candidates) {
  const profileDir = mkdtempSync(resolve(tmpdir(), "bluetab-pack-profile-"));
  const previousMtime = existsSync(crxPath) ? statSync(crxPath).mtimeMs : 0;
  const hadKey = existsSync(keyPath);
  const args = [
    `--user-data-dir=${profileDir}`,
    `--pack-extension=${extensionDir}`,
  ];
  if (process.env.BLUETAB_NO_SANDBOX === "1") args.unshift("--no-sandbox");
  if (hadKey) args.push(`--pack-extension-key=${keyPath}`);

  try { unlinkSync(crxPath); } catch {}

  const result = spawnSync(browser, args, { stdio: "inherit" });
  rmSync(profileDir, { recursive: true, force: true });
  if (result.error) {
    lastError = result.error;
    continue;
  }
  if (existsSync(crxPath) && statSync(crxPath).mtimeMs >= previousMtime) {
    console.log(`Packed extension: ${crxPath}`);
    if (!hadKey && existsSync(keyPath)) console.log(`Created key: ${keyPath}`);
    process.exit(0);
  }
  if (result.status !== 0) process.exit(result.status ?? 1);
}

console.error("Could not find a Chromium-compatible browser to pack the extension.");
console.error("Set BLUETAB_BROWSER=/path/to/brave-browser or CHROME=/path/to/chrome and retry.");
if (lastError) console.error(lastError.message);
process.exit(1);
