#!/usr/bin/env bun
import { mkdir, realpath, unlink, writeFile } from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import { parseTabId, socketPath, type Request, type Response } from "./protocol";

const CLIENT = "a";
const nativePending = new Map<number, (response: Response) => void>();
let nativeBuffer = Buffer.alloc(0);
let nextId = 1;

function usage(): never {
  console.error("usage: bt <clients|windows|list|active|query|activate|close|open|install> [args...]");
  process.exit(2);
}

async function readStdinText(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function cliMain(args: string[]) {
  const command = args[0] ?? usage();
  const stdin = await readStdinText();
  const request: Request = { id: nextId++, command, args: args.slice(1), stdin };
  try {
    if (command === "install") {
      await installNativeHost(args.slice(1));
      return;
    }
    const response = await sendToDaemon(request);
    if (response.stdout) process.stdout.write(response.stdout);
    if (response.stderr) process.stderr.write(response.stderr);
    process.exit(response.code ?? (response.ok ? 0 : 1));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  }
}

async function installNativeHost(args: string[]) {
  const extensionId = normalizeExtensionId(args[0]);
  if (!extensionId) {
    console.error("usage: bt install <extension-id|chrome-extension://extension-id/>");
    process.exit(2);
  }

  const home = process.env.HOME;
  if (!home) throw new Error("HOME is not set");

  const binaryPath = await realpath(currentExecutablePath());
  const manifest = {
    name: "io.github.bluetab",
    description: "Bluetab native messaging host",
    path: binaryPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };

  const dirs = [
    `${home}/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts`,
    `${home}/.config/google-chrome/NativeMessagingHosts`,
    `${home}/.config/google-chrome-beta/NativeMessagingHosts`,
    `${home}/.config/chromium/NativeMessagingHosts`,
    `${home}/.config/microsoft-edge/NativeMessagingHosts`,
    `${home}/.config/vivaldi/NativeMessagingHosts`,
  ];

  for (const dir of dirs) {
    await mkdir(dir, { recursive: true });
    const path = `${dir}/io.github.bluetab.json`;
    await writeFile(path, JSON.stringify(manifest, null, 2) + "\n");
    console.log(path);
  }
}

function currentExecutablePath(): string {
  if (process.env.BLUETAB_HOST_PATH) return process.env.BLUETAB_HOST_PATH;
  const execName = process.execPath.split("/").pop();
  if (execName === "bun" || execName === "node") return process.argv[1] ?? process.execPath;
  return process.execPath;
}

function normalizeExtensionId(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const match = value.match(/^chrome-extension:\/\/([a-z]{32})\/?$/);
  if (match) return match[1];
  if (/^[a-z]{32}$/.test(value)) return value;
  throw new Error(`invalid extension id: ${value}`);
}

function sendToDaemon(request: Request): Promise<Response> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(socketPath());
    let data = "";
    let done = false;
    const finish = () => {
      if (done) return;
      const line = data.split("\n")[0];
      if (!line) return;
      done = true;
      try { resolve(JSON.parse(line) as Response); }
      catch (error) { reject(error); }
      socket.destroy();
    };
    socket.on("connect", () => socket.write(JSON.stringify(request) + "\n"));
    socket.on("data", chunk => {
      data += chunk.toString("utf8");
      finish();
    });
    socket.on("end", finish);
    socket.on("error", () => {
      reject(new Error("bluetab native host is not connected; is the MV3 extension loaded?"));
    });
  });
}

async function nativeMain() {
  await unlink(socketPath()).catch(() => {});
  const server = createServer(socket => {
    let data = "";
    let handled = false;
    const handle = async () => {
      if (handled || !data.includes("\n")) return;
      handled = true;
      try {
        const request = JSON.parse(data.split("\n")[0]) as Request;
        const response = await handleCliRequest(request);
        socket.end(JSON.stringify(response) + "\n");
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        socket.end(JSON.stringify({ id: 0, ok: false, stderr: message + "\n", code: 1 } satisfies Response) + "\n");
      }
    };
    socket.on("data", chunk => {
      data += chunk.toString("utf8");
      void handle();
    });
    socket.on("end", () => void handle());
  });
  server.listen(socketPath());

  process.stdin.on("data", chunk => readNativeFrames(Buffer.from(chunk)));
  sendNative({ type: "hello" });
}

async function handleCliRequest(request: Request): Promise<Response> {
  if (request.command === "clients") return { id: request.id, ok: true, stdout: `${CLIENT}\n`, code: 0 };
  return await sendNativeRequest(request);
}

function sendNativeRequest(request: Request): Promise<Response> {
  return new Promise(resolve => {
    nativePending.set(request.id, resolve);
    sendNative({ type: "request", request });
    setTimeout(() => {
      if (!nativePending.has(request.id)) return;
      nativePending.delete(request.id);
      resolve({ id: request.id, ok: false, stderr: "timeout waiting for extension\n", code: 1 });
    }, 10_000);
  });
}

function sendNative(message: unknown) {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  const header = Buffer.alloc(4);
  header.writeUInt32LE(payload.length, 0);
  process.stdout.write(Buffer.concat([header, payload]));
}

function readNativeFrames(chunk: Buffer) {
  nativeBuffer = Buffer.concat([nativeBuffer, chunk]);
  while (nativeBuffer.length >= 4) {
    const length = nativeBuffer.readUInt32LE(0);
    if (nativeBuffer.length < 4 + length) return;
    const payload = nativeBuffer.subarray(4, 4 + length).toString("utf8");
    nativeBuffer = nativeBuffer.subarray(4 + length);
    const message = JSON.parse(payload) as { type: string; response?: Response };
    if (message.type === "response" && message.response) {
      const resolve = nativePending.get(message.response.id);
      if (resolve) {
        nativePending.delete(message.response.id);
        resolve(message.response);
      }
    }
  }
}

// Keep this helper imported by compiled binaries/tests; it documents the ID format used by the extension too.
void parseTabId;

const args = process.argv.slice(2);
const launchedByBrowser = args[0]?.startsWith("chrome-extension://") || args[0]?.startsWith("chrome://");
if (args.length === 0 || launchedByBrowser) await nativeMain();
else await cliMain(args);
