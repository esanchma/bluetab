#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = resolve(root, "package.json");
const versionTsPath = resolve(root, "src", "version.ts");
const manifestPath = resolve(root, "extension", "manifest.json");

const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const version = String(pkg.version ?? "0.0.0-dev");

writeFileSync(versionTsPath, `export const BLUETAB_VERSION = ${JSON.stringify(version)};\n`);
console.log(`Synced src/version.ts -> ${version}`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = version;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
console.log(`Synced extension/manifest.json -> ${version}`);
