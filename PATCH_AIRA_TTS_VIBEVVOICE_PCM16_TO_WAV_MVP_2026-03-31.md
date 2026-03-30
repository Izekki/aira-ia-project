# Patch MVP: Integrar VibeVoice (/stream) enviando WAV final (compatible con <audio>) vía TTS_AUDIO_CHUNK base64
Fecha: 2026-03-31  
Repo: `Izekki/aira-ia-project`

## Contexto actual (ya implementado)
- `TTS_AUDIO_CHUNK` se envía como JSON con `chunkBase64` (string).
- Cliente `useBackendTTSStream.js`:
  - decodifica base64 → Uint8Array
  - acumula chunks
  - crea `Blob` y reproduce con `<audio>` (Object URL)
- Mock WS generaba chunks WAV; con VibeVoice real el WS envía PCM16 raw binario.

## Objetivo
Hacer que el bridge `realtimeBridge.js` soporte VibeVoice real:
- Conectar a `VIBEV_WS_URL` **sin mandar mensajes**, solo construyendo la URL con query params:
  - `text`, `voice`, `cfg`, `steps`
- Recibir:
  - logs como `string` JSON
  - audio como `Buffer` binario **PCM16 mono 24kHz** (chunk típico 6400 bytes)
- Acumular PCM16 en server y al finalizar:
  - empaquetar todo como **WAV** (PCM 16-bit, 24kHz, mono)
  - emitir 1 payload reproducible al cliente usando el evento existente `TTS_AUDIO_CHUNK`
  - emitir `TTS_DONE`

Esto preserva el MVP del cliente con `<audio>` y evita implementar streaming real en WebAudio por ahora.

---

## 1) Variables / constantes
- sampleRate fijo: `24000`
- channels: `1`
- bitsPerSample: `16`
- formato en WS VibeVoice: PCM16 little-endian raw bytes
- evento fin: log `backend_stream_complete` (string JSON)

---

## 2) Cambios en server: `packages/server/tts/realtimeBridge.js`

### 2.1 Detectar y parsear mensajes del WS
En el handler del WS `.on("message", (data) => ...)`:

- Si `typeof data === "string"`:
  - `JSON.parse(data)`
  - Si `{ type:"log", event:"backend_stream_complete" }`:
    - cerrar WS
    - finalizar request: construir WAV y emitirlo
  - Si `{ type:"log", event:"backend_busy" | "backend_error" | "generation_error" }`:
    - emitir `SYSTEM_MESSAGE`/`TTS_DONE` con error
- Si `Buffer.isBuffer(data)`:
  - **es PCM16 chunk** → acumularlo (push a array)

### 2.2 Construcción del WS URL por request (VibeVoice)
Para cada `TTS_REQUEST`:
- construir una URL a partir de `process.env.VIBEV_WS_URL` (que será `ws://127.0.0.1:3000/stream`)
- agregar query params:
  - `text` = request.text
  - `voice` = seleccionado según lang (o default)
  - `cfg` = 1.5 (default o request)
  - `steps` = opcional

Ejemplo resultante:
`ws://127.0.0.1:3000/stream?text=Hello&voice=en-Carter_man&cfg=1.5`

No enviar `ws.send()`.

### 2.3 Empaquetar WAV en server al final
Implementar helper (en el mismo archivo o util):
- `pcm16ToWavBuffer(pcm16Buffer, sampleRate=24000, channels=1) -> Buffer`

WAV header estándar PCM:
- "RIFF" chunk
- "WAVE"
- "fmt " subchunk (PCM)
- "data" subchunk
- byteRate = sampleRate * channels * bitsPerSample/8
- blockAlign = channels * bitsPerSample/8

Luego:
- `wavBase64 = wavBuffer.toString("base64")`
- emitir al socket:
  - `TTS_AUDIO_CHUNK` con:
    - `mime: "audio/wav"`
    - `chunkBase64: wavBase64`
    - `isFinal: true` (si ya existe campo, si no, omitir)
- emitir:
  - `TTS_DONE`

### 2.4 Cancelación / stop
En `TTS_CANCEL`:
- cerrar WS actual si existe
- limpiar buffers
- emitir `TTS_DONE` con reason cancel

---

## 3) Cambios en cliente: `useBackendTTSStream.js` (mínimos o cero)
### 3.1 Opción A (cero cambios)
Si el server ahora manda un WAV completo en un solo `TTS_AUDIO_CHUNK`, el cliente ya lo reproduce igual:
- base64→Uint8Array→Blob({type:"audio/wav"})→Audio(objectUrl).play()

Solo confirmar que el Blob type sea `audio/wav` (si hoy se deja vacío, agregarlo).

### 3.2 Opción B (pequeña mejora recomendada)
En la creación del Blob, usar:
- `new Blob([bytes], { type: payload.mime ?? "audio/wav" })`

---

## 4) Pruebas manuales (end-to-end)
1) Levantar VibeVoice:
- `python demo/vibevoice_realtime_demo.py --model_path microsoft/VibeVoice-Realtime-0.5B`
- Confirmar: `Uvicorn running on http://0.0.0.0:3000`
2) `.env` en Aira:
- `VIBEV_WS_URL=ws://127.0.0.1:3000/stream`
- `AIRA_TTS_MODE=backend`
3) Ejecutar Aira (server + client).
4) Disparar una respuesta de Aira y verificar:
- en server logs: recibe chunks binarios del WS
- al final emite WAV (TTS_AUDIO_CHUNK final)
- en client suena audio en `<audio>`

---

## 5) Entregables del agente
- PR local o commit con:
  - `realtimeBridge.js` actualizado
  - (opcional) `useBackendTTSStream.js` para Blob mime
- Nota de prueba: confirmación de que suena con VibeVoice real.
