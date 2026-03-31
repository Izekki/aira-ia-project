# Resumen de Cambios - Logs y Cambio a aira.onnx

**Fecha**: 2026-03-30  
**Cambios principales**: 
1. ✅ Agregar logs de depuración en servidor, bridge y cliente
2. ✅ Cambiar modelo wake-word de `heyaira.onnx` a `aira.onnx`

---

## 📋 Logs Agregados

### 1. **Server-side (packages/server/index.js)**

#### `socket.on('TTS_REQUEST', ...)`
```javascript
console.log('[socket.TTS_REQUEST]', {
  socketId: socket.id,
  requestId,
  text: text.substring(0, 50) + (text.length > 50 ? '...' : ''),
  lang,
  preset,
  timestamp: new Date().toISOString(),
});
```

#### `socket.on('TTS_CANCEL', ...)`
```javascript
console.log('[socket.TTS_CANCEL]', {
  socketId: socket.id,
  requestId,
  reason,
  timestamp: new Date().toISOString(),
});
```

---

### 2. **Bridge TTS (packages/server/tts/realtimeBridge.js)**

#### Cuando WebSocket abre
```javascript
ws.on('open', () => {
  logTelemetry('VIBEV_WS_OPEN', { 
    requestId: normalizedRequestId,
    streamUrl: streamUrl.split('?')[0],
    timestamp: new Date().toISOString(),
  });
});
```

#### Cuando llega el primer chunk
```javascript
logTelemetry('TTS_FIRST_CHUNK_RECEIVED', {
  requestId: normalizedRequestId,
  textLength: requestState.textLength,
  lang: requestState.lang,
  preset: requestState.preset,
  latencyMs: requestState.firstChunkAt - requestState.startedAt,
  chunkSize: rawMessage.length,
  timestamp: new Date().toISOString(),
});
```

#### Cuando el backend completa streaming
```javascript
logTelemetry('TTS_BACKEND_STREAM_COMPLETE', {
  requestId: normalizedRequestId,
  totalChunks: requestState.pcmChunks.length,
  totalSize: requestState.pcmChunks.reduce((sum, chunk) => sum + chunk.length, 0),
  durationMs: Date.now() - requestState.startedAt,
  timestamp: new Date().toISOString(),
});
```

#### Cuando hay timeout
```javascript
console.error('[tts] TTS_TIMEOUT', {
  requestId: normalizedRequestId,
  text: normalizedText.substring(0, 50),
  elapsedMs: Date.now() - current.startedAt,
  timestamp: new Date().toISOString(),
});
```

#### Cuando cierra la conexión WebSocket
```javascript
logTelemetry('VIBEV_WS_CLOSE', {
  requestId: normalizedRequestId,
  hadChunks: requestState?.pcmChunks?.length > 0,
  chunkCount: requestState?.pcmChunks?.length || 0,
  timestamp: new Date().toISOString(),
});
```

#### Cuando hay error en WebSocket
```javascript
console.error('[tts] VibeVoice websocket error:', {
  requestId: normalizedRequestId,
  error: error?.message || String(error),
  timestamp: new Date().toISOString(),
});
```

---

### 3. **Cliente (packages/client/src/hooks/useBackendTTSStream.js)**

#### En `speak()` - emisión de TTS_REQUEST
```javascript
console.log('[useBackendTTSStream.speak]', {
  requestId,
  text: normalizedText.substring(0, 60) + (normalizedText.length > 60 ? '...' : ''),
  lang: String(options.lang || DEFAULT_LANG),
  preset: String(options.preset || DEFAULT_PRESET),
  timestamp: new Date().toISOString(),
});
```

#### En `onAudioChunk()` - primer chunk recibido
```javascript
if (!requestState.firstChunkAt) {
  requestState.firstChunkAt = Date.now();
  console.log('[useBackendTTSStream.onAudioChunk] FIRST_CHUNK', {
    requestId,
    latencyMs: requestState.firstChunkAt - requestState.startedAt,
    chunkSize: chunk.length,
    mime: payload?.mime,
    sampleRate: payload?.sampleRate,
    timestamp: new Date().toISOString(),
  });
}
```

#### En `onTtsDone()` - cuando finaliza TTS
```javascript
console.log('[useBackendTTSStream.onTtsDone]', {
  requestId,
  reason,
  totalChunks: requestState?.chunks?.length || 0,
  totalSize: requestState?.chunks?.reduce((sum, chunk) => sum + chunk.length, 0) || 0,
  durationMs: requestState ? Date.now() - requestState.startedAt : -1,
  timestamp: new Date().toISOString(),
});
```

---

## 🎯 Cambio de Modelo Wake-Word: heyaira → aira

### Archivos Modificados

| Archivo | Cambios |
|---------|---------|
| `.env` | `WAKE_WORD_MODEL=aira.onnx` |
| `packages/config/voice-detection-config.js` | Modelo y etiquetas actualizadas a `aira.onnx` / `AIRA (Custom)` |
| `packages/client/public/voice-detection-config-inject.js` | Ídem |
| `packages/server/recorder/wakeWordService.js` | Modelos inicializados con `aira.onnx` |
| `packages/server/wakeword/engineRuntime.js` | Labels y modelos a `AIRA (Custom)` / `aira.onnx` |
| `packages/client/src/App.js` | Estado inicial y manejo de eventos a `aira.onnx` |
| `packages/client/src/lib/voiceClientConfig.js` | Wake words por defecto: `['hey aira', 'aira']` |
| `docs/ws-contract.md` | Documentación del protocolo actualizada |
| `README.md` | Referencia actualizada |

### Estado de los Modelos ONNX

```
packages/server/recorder/models/
├── aira.onnx ✅ (activo)
├── heyaira.onnx ✓ (presente para compatibilidad)
├── alexa_v0.1.onnx
├── hey_jarvis_v0.1.onnx
├── hey_mycroft_v0.1.onnx
├── hey_rhasspy_v0.1.onnx
├── timer_v0.1.onnx
├── weather_v0.1.onnx
├── silero_vad.onnx
├── embedding_model.onnx
└── melspectrogram.onnx
```

---

## ✅ Verificación

### Startup del Servidor
```
[WakeWordService] Wake word activo: AIRA (Custom)
[WakeWordService] Ô£ô aira.onnx cargado (wake word: AIRA (Custom))
[WakeWordService] Todas las sesiones ONNX cargadas exitosamente
```

### Test E2E Confirma:
- ✅ Socket conecta correctamente
- ✅ TTS_REQUEST se emite y recibe
- ✅ Chunks de audio se transmiten
- ✅ TTS_DONE se dispara correctamente
- ✅ Logging de cada etapa activo

---

## 🔍 Cómo Verificar los Logs

### Console del Navegador
- Abre DevTools (F12)
- Ve a la pestaña **Console**
- Busca logs con prefijo `[useBackendTTSStream...`

### Terminal del Servidor
- Busca logs con prefijo `[socket...`, `[tts]`, `[WakeWordService]`
- Ejemplo:
  ```
  [socket.TTS_REQUEST] { socketId: 'abc123', requestId: 'tts-123456', ... }
  [socket.TTS_CANCEL] { socketId: 'abc123', reason: 'user', ... }
  ```

---

## 📝 Notas

- Los logs incluyen **timestamps ISO 8601** para facilitar correlación
- Se capturan **solo los primeros 50-60 caracteres** del texto para evitar logs gigantes
- Los logs son **retrocompatibles** (no rompen funcionalidad existente)
- El cambio a `aira.onnx` es **global y consistente** en toda la aplicación

---

## 🚀 Próximos Pasos

Propuestos para futuro:
- [ ] Dashboard de logs en tiempo real (WebSockets hacia frontend)
- [ ] Exportación de logs a archivo (server-side)
- [ ] Filtrado de logs por nivel (DEBUG, INFO, ERROR)
- [ ] Métricas de latencia agregadas
