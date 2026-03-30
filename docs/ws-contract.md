# Contrato WebSocket AIRA (Web y Rust)

Version del protocolo: 1.0.0
Transporte actual: Socket.IO sobre WebSocket
Servidor actual: packages/server/index.js

## Objetivo

Definir un contrato agnostico del cliente para que la app Web (React) y el futuro cliente Rust puedan usar el mismo flujo de eventos.

## Envelope de protocolo

Todos los eventos de servidor relevantes incluyen:

```json
{
  "protocol": {
    "protocol": "aira-ws",
    "version": "1.0.0",
    "eventType": "AIRA_RESPONSE",
    "timestamp": 1711740000000
  }
}
```

Notas:
- `protocol.protocol`: nombre del protocolo.
- `protocol.version`: version del contrato.
- `protocol.eventType`: tipo de evento semantico.
- `protocol.timestamp`: epoch ms generado por servidor.

## Eventos cliente -> servidor

### USER_INPUT

Uso: entrada principal de usuario (teclado, ptt, wakeword).

```json
{
  "content": "texto del usuario",
  "clientMessageId": "keyboard-1711740000000-ab12cd",
  "fingerprint": "keyboard:texto del usuario",
  "timestamp": 1711740000000,
  "protocol": {
    "name": "aira-ws",
    "version": "1.0.0"
  },
  "metadata": {
    "source": "keyboard",
    "interrupt_active_tts": false
  }
}
```

Campos clave:
- `content`: texto normalizado por cliente.
- `clientMessageId`: id unico por mensaje, usado para deduplicacion y trazabilidad.
- `fingerprint`: huella para evitar duplicados.
- `metadata.source`: `keyboard` | `ptt` | `wakeword` | `unknown`.
- `metadata.interrupt_active_tts`: si es `true`, el servidor emite `STOP_TTS`.

Compatibilidad legacy:
- El servidor tambien acepta `text` o `message` en lugar de `content`.

### CLIENT_PING

Uso: prueba de conectividad del canal.

```json
{
  "at": 1711740000000,
  "from": "client-ui"
}
```

## Eventos servidor -> cliente

### SERVER_READY

Uso: handshake inicial.

```json
{
  "protocol": {
    "protocol": "aira-ws",
    "version": "1.0.0",
    "eventType": "SERVER_READY",
    "timestamp": 1711740000000
  },
  "timestamp": 1711740000000,
  "version": "0.2.0",
  "wsVersion": "1.0.0"
}
```

### AIRA_RESPONSE

Uso: respuesta final de IA.

```json
{
  "protocol": {
    "protocol": "aira-ws",
    "version": "1.0.0",
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

Campos clave:
- `text`: respuesta para render/TTS.
- `clientMessageId`: correlacion con `USER_INPUT`.
- `fallback`: `true` cuando se envia mensaje de contingencia por error.

### SYSTEM_MESSAGE

Uso: mensajes de estado, informacion o error.

```json
{
  "protocol": {
    "protocol": "aira-ws",
    "version": "1.0.0",
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
- `type`: `info` | `status` | `error`.
- `code`: identificador estable para telemetria/logs.

### HEARTBEAT

Uso: latido periodico del servidor.

```json
{
  "protocol": {
    "protocol": "aira-ws",
    "version": "1.0.0",
    "eventType": "HEARTBEAT",
    "timestamp": 1711740002000
  },
  "timestamp": 1711740002000
}
```

### STOP_TTS

Uso: interrumpir sintesis de voz activa cuando llega una nueva entrada con `interrupt_active_tts=true`.

Payload actual: vacio.

## Reglas de deduplicacion del servidor

Para `USER_INPUT`, el servidor descarta duplicados por:
- `fingerprint` repetido en ventana corta.
- `timestamp` de cliente repetido en ventana larga.
- `clientMessageId` repetido en ventana larga.

## Metadata de origen (source)

El cliente debe enviar `metadata.source` para trazabilidad:
- `keyboard`: texto manual.
- `ptt`: push-to-talk.
- `wakeword`: deteccion wake word.

## Compatibilidad futura con Rust

Para cliente Rust:
- Mantener `event names` actuales (`USER_INPUT`, `AIRA_RESPONSE`, etc.).
- Respetar envelope `protocol.version` y `metadata.source`.
- Generar `clientMessageId` unico por input.
- Procesar `fallback` y `SYSTEM_MESSAGE.type=error` para recovery UX.
