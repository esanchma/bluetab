# bluetab

Minimal MV3 reimplementation of the brotab subset used by this project. The CLI binary is named `bt`.

## Supported surface

- `bt install <extension-id|chrome-extension://extension-id/>`
- `bt clients`
- `bt windows`
- `bt list`
- `bt active`
- `bt query +active|-active +pinned|-pinned +muted|-muted -title GLOB -url GLOB`
- `bt activate a.<windowId>.<tabId>`
- `bt activate` reading a tab id from stdin, compatible with pipelines such as `bt list | ... | bt activate`
- `bt close a.<windowId>.<tabId> [...]`
- `printf '%s\n' https://example.com | bt open a[.<windowId>|.0]`

Unsupported by design: `text`, `html`, `words`, `index`, `search`, and other brotab commands outside the MVP.

## Build

```bash
bun install
bun run check
bun run build
```

The compiled binary is `dist/bt`.

## Native messaging setup

1. Load `extension/` as an unpacked Brave/Chromium extension.
2. Install the compiled binary somewhere stable, for example `~/.local/bin/bt`.
3. Run:

```bash
bt install <extension-id>
```

`bt install` writes `io.github.bluetab.json` to the common per-user Chromium native messaging host directories, including Brave, Chrome, Chrome Beta, Chromium, Microsoft Edge, and Vivaldi.

The host name must stay `io.github.bluetab`, matching `extension/service_worker.js`.

## Runtime shape

The MV3 service worker opens a native messaging connection. The compiled binary then acts as a small daemon on `$XDG_RUNTIME_DIR/bluetab.sock` (usually `/run/user/<uid>/bluetab.sock`). CLI invocations connect to that socket and forward one command to the extension.
