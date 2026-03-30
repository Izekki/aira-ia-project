# Aira IA Project

Aira es un asistente multimodal (voz + texto) orientado a uso web local, con memoria en Supabase y orquestacion en tiempo real via Socket.IO.

## Estado actual

- Modo **Web-Only** activo.
- **Electron ya no es parte del flujo operativo actual**.
- Cliente React con chat, estado visual y control por voz.
- Backend Node.js con Socket.IO y eventos de protocolo.
- Deteccion de wake word en backend usando ONNX + PvRecorder.
- Auto-disparo de PTT en cliente cuando backend emite `WAKE_WORD_DETECTED`.

## Novedades recientes

- Conexion Socket.IO estabilizada con path explicito `/socket.io` en cliente y servidor.
- Carga de `.env` en backend antes de inicializar configuracion de voz.
- Configuracion de voz centralizada en `packages/config/voice-detection-config.js`.
- Sincronizacion automatica de configuracion hacia cliente (`public/voice-detection-config-inject.js`).
- Ajustes de sensibilidad wake word por variables de entorno:
  - `WAKE_WORD_THRESHOLD`
  - `WAKE_WORD_VAD_THRESHOLD`

## Arquitectura implementada

### Cliente

- Ruta: `packages/client/src`
- Stack: React 18 + `socket.io-client` + SpeechSynthesis/Web Speech API.
- Funcionalidades:
  - Chat realtime.
  - Push-to-Talk manual (boton, Space/Alt).
  - Auto-PTT por evento `WAKE_WORD_DETECTED` del backend.
  - Estado de runtime visible: modo wake, modelo, umbral, heartbeat.

### Backend

- Ruta: `packages/server`
- Stack: Node.js + `socket.io` + ONNX Runtime + PvRecorder.
- Responsabilidades:
  - Canal Socket.IO (`/socket.io`).
  - Eventos `SERVER_READY`, `HEARTBEAT`, `SYSTEM_MESSAGE`, `AIRA_RESPONSE`, `WAKE_WORD_DETECTED`.
  - Deteccion wake word server-side (`heyaira.onnx` por defecto).
  - Persistencia de memoria conversacional en Supabase.

### Configuracion de voz

- Archivo fuente: `packages/config/voice-detection-config.js`
- Inyeccion en cliente: `packages/client/public/voice-detection-config-inject.js`
- Script de sync:
  - `scripts/sync-voice-config.js`
  - `scripts/sync-voice-config-watch.js`

## Flujo operativo (actual)

1. Cliente conecta al backend por Socket.IO.
2. Backend reporta `SERVER_READY` con runtime wake word (`mode`, `modelName`, `threshold`).
3. Backend detecta wake word con ONNX (`wakeWordService.js`).
4. Backend emite `WAKE_WORD_DETECTED`.
5. Cliente dispara auto-PTT y activa captura STT.
6. Cliente emite `USER_INPUT`.
7. Backend procesa con LLM + memoria y responde por `AIRA_RESPONSE`.
8. Cliente renderiza respuesta y reproduce TTS.

## Scripts principales

- `npm run server`: inicia backend.
- `npm run client`: inicia cliente React.
- `npm run dev`: arranca `config:watch`, backend y cliente en paralelo.
- `npm run config:watch`: sincroniza cambios de config de voz al cliente.
- `npm run build:client`: build de produccion del cliente.

## Variables de entorno relevantes

Servidor/LLM/memoria:

- `PORT`
- `SUPABASE_URL`
- `SUPABASE_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL`
- `LM_STUDIO_BASE_URL`
- `LM_STUDIO_MODEL`

Wake word:

- `WAKE_WORD_MODEL` (ej. `heyaira.onnx`)
- `WAKE_WORD_THRESHOLD` (sensibilidad clasificador)
- `WAKE_WORD_VAD_THRESHOLD` (filtro de actividad de voz)

## Estructura del monorepo

- `packages/client/`: app web React.
- `packages/server/`: servidor Socket.IO, LLM y memoria.
- `packages/config/`: configuracion central de voz.
- `scripts/`: utilidades de sincronizacion.
- `docs/`: notas de contrato y documentacion operativa.

## Notas operativas

- Si aparece `EADDRINUSE` en puerto 4000, ya hay una instancia de servidor activa.
- Si wake word detecta pero no inicia PTT, revisar permisos de microfono en navegador.
- En desarrollo pueden coexistir puertos `3000`/`3001` para cliente segun disponibilidad.

## Roadmap corto

- Endurecer telemetria de wake word (contadores por fase VAD -> clasificador -> auto-PTT).
- Añadir pruebas de regresion para flujo voz/socket.
- Pulir fallback de proveedor LLM por variables de entorno.