# PLAN_SPRINT1 — Implementación TTS Backend (VibeVoice‑Realtime‑0.5B) + Streaming (Socket.IO) + Preparación Tauri/Rust
Fecha: 2026-03-30  
Repo: `Izekki/aira-ia-project`  
Base: `main` @ commit `dbbc9e7840b598ea8928a0ada29acaff6684f6d3` (2026-03-30)

Objetivo del sprint:
- Empezar a **reemplazar WebSpeechAPI TTS** por **TTS backend local** con **streaming**.
- Mantener **fallback** a navegador mientras el motor se estabiliza.
- Dejar listo el “puente” para conectar el **demo WebSocket** de `VibeVoice‑Realtime‑0.5B` (que tú levantarás aparte).
- No bloquear la futura migración a **Tauri/Rust**.

Referencia técnica (VibeVoice realtime):
- Doc oficial VibeVoice‑Realtime‑0.5B: https://github.com/microsoft/VibeVoice/blob/main/docs/vibevoice-realtime-0.5b.md
- Modelo en HF: https://huggingface.co/microsoft/VibeVoice-Realtime-0.5B

---

## 0) Suposiciones / dependencias
- Tú vas a clonar y levantar VibeVoice en tu PC (proceso aparte).
- El demo de VibeVoice expone un WebSocket local (ej: `ws://127.0.0.1:<PORT>/...`) y emite audio por chunks.
- Nuestro repo no debe acoplarse fuerte al protocolo interno de VibeVoice; se crea un **bridge**.

---

## 1) Trabajo inmediato para el agente (VS Code) — sin esperar a VibeVoice

### 1.1 Agregar configuración/env para Voice Backend
**Archivos a tocar**
- `packages/config/voice-detection-config.js` (ya tiene `VOICE_BACKEND_URL`, `AIRA_TTS_MODE`, etc.)

**Acciones**
- Añadir env vars nuevas (solo lectura en config):
  - `VOICE_TTS_PROVIDER=vibevoice-realtime`
  - `VIBEV_WS_URL=ws://127.0.0.1:PORT` (solo placeholder)
  - `VOICE_TTS_STREAMING=1` (para activar `enableBackendStreamingProtocol`)

**Resultado**
- Que el cliente muestre claramente en UI que:
  - `ttsMode=backend`
  - `backendStreamingEnabled=true`

> Nota: hoy `enableBackendStreamingProtocol` está hardcodeado a `false`. El agente debe permitir controlarlo por env (ej. `VOICE_TTS_STREAMING=1`).

---

## 2) Server Node: implementar “TTS Bridge” (Socket.IO ↔ WebSocket VibeVoice)

### 2.1 Crear módulo bridge (sin dependencia de VibeVoice repo)
**Nuevos archivos**
- `packages/server/tts/realtimeBridge.js`
- `packages/server/tts/index.js` (wrapper provider)

**Responsabilidad**
- Conectar Node → WebSocket del demo VibeVoice.
- Traducir eventos:
  - Cliente (Socket.IO) `TTS_REQUEST` → VibeVoice WS “input text”
  - VibeVoice WS “audio chunk” → Cliente `TTS_AUDIO_CHUNK`
- Manejar reconexión y timeouts.

**Interfaz sugerida**
- `createVibeVoiceRealtimeBridge({ wsUrl, io, buildProtocolMeta })`
  - `connect()`
  - `speak({ socketId, requestId, text, lang, preset })`
  - `stop({ socketId, requestId })`
  - `close()`

**Eventos nuevos (Socket.IO Aira)**
- Cliente → Server:
  - `TTS_REQUEST` payload:
    ```json
    {
      "requestId": "tts-<timestamp>-<rand>",
      "text": "hola ...",
      "lang": "es-MX",
      "preset": "balanced",
      "metadata": { "source": "aira-response", "clientMessageId": "..." }
    }
    ```
  - `TTS_CANCEL` payload:
    ```json
    { "requestId": "...", "reason": "interrupt|user|new_input" }
    ```

- Server → Cliente:
  - `TTS_AUDIO_CHUNK` payload (contrato 1.1.0 reservado, ahora se activa):
    ```json
    {
      "protocol": { "...": "..." },
      "requestId": "...",
      "seq": 12,
      "mime": "audio/wav|audio/pcm|audio/opus",
      "sampleRate": 24000,
      "chunkBase64": "<...>"
    }
    ```
  - `TTS_DONE` payload:
    ```json
    { "protocol": { ... }, "requestId": "...", "reason": "eos|cancel|error" }
    ```
  - `SYSTEM_MESSAGE` en error de motor:
    - `code: TTS_BACKEND_UNAVAILABLE | TTS_BACKEND_ERROR`

### 2.2 Cablear el bridge en `packages/server/index.js`
**Acciones**
- En el arranque del server:
  - leer `VIBEV_WS_URL` (o `VOICE_BACKEND_URL` si decides unificar) desde env/config
  - inicializar `bridge.connect()` si `ttsMode=backend`
- En `io.on('connection')`:
  - registrar handlers:
    - `socket.on('TTS_REQUEST', ...)`
    - `socket.on('TTS_CANCEL', ...)`
- En el handler actual `STOP_TTS` (que se emite cuando llega `USER_INPUT` con `interrupt_active_tts=true`):
  - además de emitir `STOP_TTS` al cliente, ejecutar `bridge.stop(...)` (si hay request activa)

**Resultado**
- Server ya listo para consumir VibeVoice cuando exista el WS URL.

---

## 3) Client React: playback streaming + modo backend

### 3.1 Implementar `useBackendTTSStream` (nuevo hook)
**Nuevo archivo**
- `packages/client/src/hooks/useBackendTTSStream.js`

**Responsabilidad**
- Enviar `TTS_REQUEST` por socket.
- Recibir `TTS_AUDIO_CHUNK` y reproducirlo en streaming.
- Recibir `STOP_TTS` y cortar audio.
- Recibir `TTS_DONE` y cerrar sesión.

**Playback recomendado (web)**
- MVP (rápido): acumular chunks y reproducir al final (solo para validar).
- Recomendado: WebAudio (AudioContext) con cola:
  - decodificar PCM si viene PCM
  - si viene WAV-chunks, probablemente tendrás que convertir a PCM (depende de formato real)
  - si viene OPUS, es más complejo en web (posible vía MSE/MediaSource o decodificación).

**Entrega MVP sugerida para este sprint**
- Implementar primero “acumular y reproducir al final” para verificar el bridge.
- Luego iterar a streaming real cuando sepamos el formato exacto emitido por el demo de VibeVoice.

### 3.2 Unificar con TTS actual
**Acciones**
- Crear `packages/client/src/hooks/useTTS.js`:
  - si `ttsMode === 'browser'` → usa `useVoiceSynthesis`
  - si `ttsMode === 'backend'` → usa `useBackendTTSStream`

**Integración**
- En `App.js`, cuando llega `AIRA_RESPONSE`:
  - llamar `tts.speak(text, { lang, preset })`
- En `STOP_TTS`:
  - `tts.cancel()`

**Resultado**
- Con `AIRA_TTS_MODE=backend` no se usa `speechSynthesis`.

---

## 4) Contrato y documentación (para no perder el rumbo)
### 4.1 Actualizar `docs/ws-contract.md`
**Acciones**
- Marcar `TTS_AUDIO_CHUNK` como “activo” cuando `backendStreamingEnabled=true`.
- Documentar eventos nuevos:
  - `TTS_REQUEST`
  - `TTS_CANCEL`
  - `TTS_DONE`
- Mantener compatibilidad con 1.1.0:
  - cambios aditivos → ok.

---

## 5) Telemetría mínima (para medir “naturalidad”)
Agregar logs + opcional SYSTEM_MESSAGE:
- `TTS_REQUEST_RECEIVED`
- `TTS_FIRST_CHUNK_SENT` (medir delta)
- `TTS_DONE_SENT`
Campos:
- requestId
- text length
- lang
- preset
- latencyMs

---

## 6) Pruebas / checklist para el agente (sin VibeVoice aún)
### 6.1 Prueba “mock WS”
Como tú estarás bajando VibeVoice aparte, el agente debe crear un mock temporal:
- script Node simple que abra WS local y:
  - reciba texto
  - devuelva “fake audio chunks” (aunque sea bytes dummy) + DONE
Esto valida:
- bridge
- wiring
- que el cliente no se rompa

### 6.2 Cuando tú tengas VibeVoice levantado
Solo cambias:
- `VIBEV_WS_URL=ws://127.0.0.1:XXXX/...`
y se prueba end-to-end.

---

## 7) Variables de entorno sugeridas (para `.env`)
- `AIRA_TTS_MODE=backend`
- `VOICE_TTS_PROVIDER=vibevoice-realtime`
- `VOICE_TTS_STREAMING=1`
- `VIBEV_WS_URL=ws://127.0.0.1:PORT`   # tu lo defines al correr el demo
- `VOICE_BACKEND_URL=` (opcional si quieres unificar; por ahora separamos)

---

## 8) Notas específicas de hardware (AMD)
- El plan no asume CUDA.
- Realtime “perfecto” puede depender del motor/runtime, pero la arquitectura (streaming + cancel + bridge) aplica igual.

---

## 9) Criterio de finalización del sprint (mínimo viable)
- Con `AIRA_TTS_MODE=backend`:
  - Aira recibe `AIRA_RESPONSE` → dispara `TTS_REQUEST`
  - Client reproduce audio (aunque sea en modo “no-streaming real” inicialmente)
  - `STOP_TTS` corta audio inmediatamente
- Contrato documentado y flags funcionando.

---

## 10) Próximo sprint (no implementar ahora)
- Migración STT backend (Whisper/faster-whisper) y VAD real.
- Empaquetado en Tauri como sidecars (Node + Python + VibeVoice).