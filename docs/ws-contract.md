# Contrato WebSocket AIRA (Web y Rust)

Version del protocolo: 1.1.0
Transporte actual: Socket.IO sobre WebSocket
Servidor actual: packages/server/index.js

## Objetivo

Definir un contrato estable para:
- flujo actual (texto + wake word + PTT en navegador), y
- siguiente fase (STT backend streaming + TTS backend streaming),

sin romper compatibilidad entre cliente Web y futuro cliente Rust.

## Envelope de protocolo

Todos los eventos semanticos del servidor deben incluir:

```json
{
  "protocol": {
    "protocol": "aira-ws",
    "version": "1.1.0",
    "eventType": "AIRA_RESPONSE",
    "timestamp": 1711740000000
  }
}
```

Campos:
- protocol.protocol: nombre del protocolo.
- protocol.version: version de contrato.
- protocol.eventType: tipo semantico del evento.
- protocol.timestamp: epoch ms generado por servidor.

## Handshake de capacidad

### SERVER_READY (servidor -> cliente)

```json
{
  "protocol": {
    "protocol": "aira-ws",
    "version": "1.1.0",
    "eventType": "SERVER_READY",
    "timestamp": 1711740000000
  },
  "timestamp": 1711740000000,
  "version": "0.3.0",
  "wsVersion": "1.1.0",
  "wakeWord": {
    "mode": "server/openWakeWord",
    "active": true,
    "error": "",
    "wakeWordLabel": "HeyAIRA (Custom)",
    "modelName": "heyaira.onnx",
    "threshold": 0.18
  },
  "voiceRuntime": {
    "migrationPhase": "prep",
    "backendStreamingEnabled": false,
    "sttMode": "browser",
    "ttsMode": "browser",
    "browserFallbackEnabled": true
  }
}
```

Notas:
- voiceRuntime declara la intencion del runtime (browser/backend) sin forzar implementacion completa.
- cliente debe tratar voiceRuntime como metadata de capacidad, no como estado mutable.

## Eventos cliente -> servidor

### USER_INPUT

Uso: entrada principal (teclado, ptt, wakeword, stt-backend-final).

```json
{
  "content": "texto del usuario",
  "clientMessageId": "ptt-1711740000000-ab12cd",
  "fingerprint": "ptt:hola aira",
  "timestamp": 1711740000000,
  "protocol": {
    "name": "aira-ws",
    "version": "1.1.0"
  },
  "metadata": {
    "source": "ptt",
    "interrupt_active_tts": false,
    "input_mode": "browser-stt"
  }
}
```

Campos clave:
- content: texto normalizado del input.
- clientMessageId: id unico por mensaje para correlacion/deduplicacion.
- fingerprint: huella para evitar reenvios.
- metadata.source: keyboard | ptt | wakeword | stt-backend | unknown.
- metadata.interrupt_active_tts: true => servidor emite STOP_TTS.
- metadata.input_mode (nuevo): browser-stt | backend-stt | text.

Compatibilidad legacy:
- servidor acepta content, text o message.

### CLIENT_PING

Uso: prueba de conectividad del canal.

```json
{
  "at": 1711740000000,
  "from": "client-ui"
}
```

### VOICE_SESSION_START (futuro inmediato)

Uso: solicitar sesion de voz backend streaming (STT/TTS).

```json
{
  "clientSessionId": "voice-1711740000000-xy90",
  "protocol": {
    "name": "aira-ws",
    "version": "1.1.0"
  },
  "metadata": {
    "source": "wakeword",
    "prefer_backend_stt": true,
    "prefer_backend_tts": true,
    "allow_browser_fallback": true
  }
}
```

Estado de implementacion:
- definido en contrato para la migracion.
- no obligatorio en fase prep.

### VOICE_AUDIO_CHUNK (futuro inmediato)

Uso: enviar chunks PCM/WebM al backend durante sesion de voz.

Payload recomendado:
- clientSessionId
- seq
- mime
- sampleRate
- chunk (binario o base64)

Estado:
- reservado para fase streaming.

### VOICE_SESSION_END (futuro inmediato)

Uso: cerrar sesion de voz backend iniciada con VOICE_SESSION_START.

```json
{
  "clientSessionId": "voice-1711740000000-xy90",
  "reason": "silence|manual|error|timeout"
}
```

## Eventos servidor -> cliente

### AIRA_RESPONSE

Uso: respuesta final de IA (texto consolidado).

```json
{
  "protocol": {
    "protocol": "aira-ws",
    "version": "1.1.0",
    "eventType": "AIRA_RESPONSE",
    "timestamp": 1711740001234
  },
  "text": "respuesta de Aira",
  "timestamp": 1711740001234,
  "source": "ptt",
  "clientMessageId": "ptt-1711740000000-ab12cd",
  "fallback": false
}
```

### SYSTEM_MESSAGE

Uso: mensajes de estado, info, warning o error.

```json
{
  "protocol": {
    "protocol": "aira-ws",
    "version": "1.1.0",
    "eventType": "SYSTEM_MESSAGE",
    "timestamp": 1711740001000
  },
  "type": "status",
  "code": "USER_INPUT_ACCEPTED",
  "message": "Entrada ptt aceptada para procesamiento.",
  "request": {
    "clientMessageId": "ptt-1711740000000-ab12cd",
    "fingerprint": "ptt:hola aira",
    "source": "ptt"
  }
}
```

Valores recomendados:
- type: info | status | warning | error.
- code: identificador estable de telemetria.

### HEARTBEAT

Uso: latido periodico del servidor.

```json
{
  "protocol": {
    "protocol": "aira-ws",
    "version": "1.1.0",
    "eventType": "HEARTBEAT",
    "timestamp": 1711740002000
  },
  "timestamp": 1711740002000
}
```

### STOP_TTS

Uso: interrumpir sintesis activa cuando llega input con interrupt_active_tts=true.

Payload actual: vacio.

### WAKE_WORD_DETECTED

Uso: notificar deteccion backend de wake word.

```json
{
  "protocol": {
    "protocol": "aira-ws",
    "version": "1.1.0",
    "eventType": "WAKE_WORD_DETECTED",
    "timestamp": 1711740000500
  },
  "detected": true,
  "wakeWord": "HeyAIRA (Custom)",
  "confidence": 0.82,
  "threshold": 0.18,
  "modelName": "heyaira.onnx",
  "timestamp": 1711740000500
}
```

### Eventos reservados para streaming (fase siguiente)

- VOICE_SESSION_READY: backend confirma sesion de voz.
- STT_PARTIAL: transcripcion parcial de streaming.
- STT_FINAL: transcripcion final del turno.
- LLM_TOKEN: token incremental del modelo.
- TTS_AUDIO_CHUNK: chunk de audio sintetizado desde backend.
- VOICE_FALLBACK_NOTICE: backend/cliente informa downgrade a browser fallback.
- VOICE_SESSION_CLOSED: sesion finalizada.

Estado actual:
- reservados en contrato para preparar migracion.
- no obligatorios en runtime de fase prep.

## Reglas de deduplicacion (servidor)

Para USER_INPUT:
- fingerprint repetido en ventana corta (~2500 ms).
- timestamp de cliente repetido en ventana larga (~10000 ms).
- clientMessageId repetido en ventana larga (~10000 ms).

## Compatibilidad y versionado

Reglas:
- cambios aditivos => incremento menor (1.x).
- cambios rompientes => incremento mayor (2.0.0).
- cliente debe ignorar campos desconocidos.

Matriz resumida:
- Cliente 1.0.x con servidor 1.1.x: compatible en flujo base.
- Cliente 1.1.x con servidor 1.0.x: compatible parcial sin voiceRuntime.
- Cliente Rust futuro: debe implementar USER_INPUT, SYSTEM_MESSAGE, AIRA_RESPONSE, HEARTBEAT y fallback handling.

## Roadmap del contrato

Fase prep (actual):
- protocolo 1.1.0
- voiceRuntime anunciado en SERVER_READY
- contrato de sesion de voz definido (reservado)

Fase migracion STT backend:
- activar VOICE_SESSION_START / VOICE_AUDIO_CHUNK / STT_PARTIAL / STT_FINAL

Fase migracion TTS backend:
- activar LLM_TOKEN / TTS_AUDIO_CHUNK / VOICE_SESSION_CLOSED
- mantener fallback a browser mientras backend se estabiliza
