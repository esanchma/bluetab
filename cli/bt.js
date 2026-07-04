#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const bun = join(root, "node_modules", "bun", "bin", process.platform === "win32" ? "bun.exe" : "bun.exe");
const main = join(root, "src", "main.ts");

const child = spawn(bun, [main, ...process.argv.slice(2)], {
  stdio: "inherit",
  env: {
    ...process.env,
    BLUETAB_HOST_PATH: process.env.BLUETAB_HOST_PATH ?? process.argv[1],
  },
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});

child.on("error", error => {
  console.error(error.message);
  process.exit(1);
});
