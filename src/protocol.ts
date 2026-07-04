export type Request = {
  id: number;
  command: string;
  args: string[];
  stdin?: string;
};

export type Response = {
  id: number;
  ok: boolean;
  stdout?: string;
  stderr?: string;
  code?: number;
};

export function socketPath(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : "user";
  const runtimeDir = process.env.XDG_RUNTIME_DIR || `/run/user/${uid}`;
  return `${runtimeDir}/bluetab.sock`;
}

export function parseTabId(value: string): { client: string; windowId?: number; tabId?: number } {
  const parts = value.split(".");
  if (parts.length === 1) return { client: parts[0] };
  if (parts.length === 2) return { client: parts[0], windowId: Number(parts[1]) };
  if (parts.length === 3) return { client: parts[0], windowId: Number(parts[1]), tabId: Number(parts[2]) };
  throw new Error(`invalid bluetab id: ${value}`);
}
