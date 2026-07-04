const NATIVE_HOST = "io.github.bluetab";
const CLIENT = "a";
let port;

function connect() {
  try {
    port = chrome.runtime.connectNative(NATIVE_HOST);
    port.onMessage.addListener(onNativeMessage);
    port.onDisconnect.addListener(() => {
      port = undefined;
      setTimeout(connect, 1000);
    });
  } catch (error) {
    console.error("bluetab native connect failed", error);
  }
}

connect();

async function onNativeMessage(message) {
  if (message.type !== "request") return;
  const request = message.request;
  const response = await handleRequest(request).catch(error => ({
    id: request.id,
    ok: false,
    stderr: `${error.message ?? String(error)}\n`,
    code: 1,
  }));
  port?.postMessage({ type: "response", response });
}

async function handleRequest(request) {
  switch (request.command) {
    case "windows": return ok(request, await windows());
    case "list": return ok(request, await listTabs({}));
    case "active": return ok(request, await listTabs({ active: true }));
    case "query": return ok(request, await query(request.args));
    case "activate": return await activate(request);
    case "close": return await closeTabs(request);
    case "open": return await openTabs(request);
    default: return { id: request.id, ok: false, stderr: `unsupported command: ${request.command}\n`, code: 2 };
  }
}

function ok(request, stdout) {
  return { id: request.id, ok: true, stdout, code: 0 };
}

async function windows() {
  const wins = await chrome.windows.getAll({ populate: false });
  return wins.map(w => `${CLIENT}.${w.id}\t${w.focused ? "active" : ""}\t${w.type ?? "normal"}`).join("\n") + (wins.length ? "\n" : "");
}

async function listTabs(queryInfo) {
  const tabs = await chrome.tabs.query(queryInfo);
  return formatTabs(tabs);
}

function formatTabs(tabs) {
  return tabs.map(tab => `${CLIENT}.${tab.windowId}.${tab.id}\t${tab.title ?? ""}\t${tab.url ?? ""}`).join("\n") + (tabs.length ? "\n" : "");
}

async function query(args) {
  const { queryInfo, filters } = parseQuery(args);
  let tabs = await chrome.tabs.query(queryInfo);
  for (const filter of filters) tabs = tabs.filter(filter);
  return formatTabs(tabs);
}

function parseQuery(args) {
  const queryInfo = {};
  const filters = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "+active") queryInfo.active = true;
    else if (arg === "-active") queryInfo.active = false;
    else if (arg === "+pinned") queryInfo.pinned = true;
    else if (arg === "-pinned") queryInfo.pinned = false;
    else if (arg === "+muted") filters.push(tab => Boolean(tab.mutedInfo?.muted));
    else if (arg === "-muted") filters.push(tab => !tab.mutedInfo?.muted);
    else if (arg === "-title") {
      const pattern = args[++i] ?? "";
      filters.push(tab => matchGlob(tab.title ?? "", pattern));
    } else if (arg === "-url") {
      const pattern = args[++i] ?? "";
      filters.push(tab => matchGlob(tab.url ?? "", pattern));
    } else {
      throw new Error(`unsupported query argument: ${arg}`);
    }
  }
  return { queryInfo, filters };
}

function matchGlob(value, pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`, "i").test(value);
}

async function activate(request) {
  const tabIdValue = request.args[0] ?? firstStdinField(request.stdin);
  const id = parseBluetabId(tabIdValue);
  if (!id.tabId) throw new Error("activate needs a tab id");
  const tab = await chrome.tabs.update(id.tabId, { active: true });
  if (tab.windowId) await chrome.windows.update(tab.windowId, { focused: true });
  return { id: request.id, ok: true, code: 0 };
}

function firstStdinField(stdin) {
  const firstLine = String(stdin ?? "").split(/\r?\n/).find(line => line.trim());
  return firstLine?.trim().split(/\s+/)[0];
}

async function closeTabs(request) {
  const tabIds = request.args.map(value => parseBluetabId(value).tabId).filter(Boolean);
  if (!tabIds.length) throw new Error("close needs at least one tab id");
  await chrome.tabs.remove(tabIds);
  return { id: request.id, ok: true, code: 0 };
}

async function openTabs(request) {
  const target = request.args[0] ?? CLIENT;
  const id = parseBluetabId(target);
  const urls = (request.stdin ?? "").split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  if (!urls.length) throw new Error("open needs URLs on stdin");
  if (id.windowId === 0) {
    await chrome.windows.create({ url: urls });
  } else {
    for (const url of urls) {
      const createProperties = id.windowId === undefined ? { url } : { url, windowId: id.windowId };
      await chrome.tabs.create(createProperties);
    }
  }
  return { id: request.id, ok: true, code: 0 };
}

function parseBluetabId(value) {
  const parts = String(value ?? "").split(".");
  return {
    client: parts[0],
    windowId: parts[1] === undefined ? undefined : Number(parts[1]),
    tabId: parts[2] === undefined ? undefined : Number(parts[2]),
  };
}
