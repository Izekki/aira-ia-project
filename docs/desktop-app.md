# Aira Desktop App

A Tauri-based desktop wrapper for the Aira IA project.  
It embeds the existing React client UI inside a native window so you can use
Aira **without opening a browser tab** and without any dependency on the Web
Speech API for TTS (backend TTS via Socket.IO / VibeVoice still works
normally).

> **Phase scope** — chat by keyboard + backend TTS playback.  
> STT / microphone support is **not** included in this phase.

---

## Prerequisites

| Requirement | Notes |
|---|---|
| **Node.js ≥ 18** | Needed to run the backend and build the React client |
| **Rust ≥ 1.77** | Install via [rustup](https://rustup.rs) |
| **Tauri v2 system deps** | See [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for your OS (WebKit / GTK on Linux, WebView2 on Windows, Xcode on macOS) |
| **Aira Node backend running** | `npm run server` from the repo root |
| **VibeVoice** *(optional)* | Only required when using backend TTS. Run externally before starting Aira. |

Install the Tauri CLI once (inside the desktop package):

```bash
cd packages/desktop
npm install
```

Or install globally:

```bash
npm install -g @tauri-apps/cli@^2
```

---

## Running the desktop app

### Development mode (recommended)

In development mode Tauri loads the UI from the **CRA dev server** running at
`http://localhost:3000`, giving you hot-reload.

**Terminal 1 — backend**
```bash
npm run server
```

**Terminal 2 — React dev server**
```bash
npm run client
```

**Terminal 3 — Tauri dev window**
```bash
npm run desktop:dev
```

Or, from inside the desktop package directly:
```bash
cd packages/desktop
npm run dev
```

### Production build

Builds the React client first, then packages the Tauri app:

```bash
npm run desktop
```

The distributable installer/binary is written to
`packages/desktop/src-tauri/target/release/bundle/`.

---

## Overriding the backend URL

By default the desktop app connects to:

```
http://127.0.0.1:4000
```

To use a different address (e.g. a remote dev machine), set the
`AIRA_BACKEND_URL` environment variable **before** launching the desktop app:

```bash
# Linux / macOS
AIRA_BACKEND_URL=http://192.168.1.10:4000 npm run desktop:dev

# Windows (PowerShell)
$env:AIRA_BACKEND_URL="http://192.168.1.10:4000"; npm run desktop:dev

# Windows (cmd)
set AIRA_BACKEND_URL=http://192.168.1.10:4000 && npm run desktop:dev
```

The Rust side reads this variable at startup and injects it into the webview as
`window.__AIRA_BACKEND_URL__` before any page script runs.  The React client
config (`voiceClientConfig.js`) checks this property first, so it takes
precedence over any value in `voice-detection-config-inject.js`.

---

## How it works

```
┌─────────────────────────────────────────────┐
│  Tauri desktop window (native WebView)       │
│                                              │
│   React client UI (packages/client)          │
│   └── connects via Socket.IO to backend      │
│       (http://127.0.0.1:4000 by default)     │
└─────────────────┬───────────────────────────┘
                  │ Socket.IO (port 4000)
┌─────────────────▼───────────────────────────┐
│  Node backend  (packages/server)             │
│  └── bridges TTS_AUDIO_CHUNK / TTS_DONE      │
│      events from VibeVoice → client          │
└─────────────────┬───────────────────────────┘
                  │ WebSocket (port 10001 default)
┌─────────────────▼───────────────────────────┐
│  VibeVoice TTS service (external)            │
└─────────────────────────────────────────────┘
```

1. The Tauri process starts and reads `AIRA_BACKEND_URL` (defaults to
   `http://127.0.0.1:4000`).
2. It injects `window.__AIRA_BACKEND_URL__` into the WebView before the page
   loads.
3. The React app connects to the backend over Socket.IO.
4. TTS audio chunks (`TTS_AUDIO_CHUNK` / `TTS_DONE`) are streamed from the
   backend and played back in the WebView's WebAudio context.

---

## Adding app icons (for distribution builds)

Tauri requires icons to produce an installable bundle.  Generate them with:

```bash
cd packages/desktop
npx @tauri-apps/cli icon path/to/your-icon.png
```

This writes a complete icon set into `packages/desktop/src-tauri/icons/` and
updates `tauri.conf.json` automatically.  A 1024×1024 PNG source image works
best.
