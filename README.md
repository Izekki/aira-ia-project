# Aira IA Project

Aira es un asistente de escritorio con interfaz multimodal (voz + texto), memoria en Supabase y respuesta en tiempo real via Socket.IO.

## Estado actual del proyecto

El repositorio ya implementa una base funcional para interaccion continua:

- Cliente React con avatar reactivo y chat en tiempo real.
- Hook de reconocimiento de voz con control de estabilidad, deduplicacion y filtro por wake word.
- Sintesis de voz con seleccion automatica de voz en espanol.
- Servidor Node.js con eventos Socket.IO, heartbeat y manejo de fallback.
- Persistencia de historial conversacional en Supabase (tabla memories).
- Orquestacion de ventana de escritorio por Electron.

## Objetivo operativo

Construir un asistente llamado Aira que:

- Escuche y procese comandos por voz o texto.
- Responda por chat y voz con estilo consistente.
- Mantenga contexto reciente de conversacion.
- Soporte una evolucion progresiva hacia memoria y automatizacion avanzada.

## Arquitectura real (implementada)

### 1) Capa de interfaz

- Ruta principal: packages/client/src
- Motor: React 18 + CSS personalizado + Framer Motion.
- Funciones visibles:
	- Panel de estado y heartbeat de servidor.
	- Avatar animado con estados IDLE, LISTENING, SPEAKING.
	- Chat con historial local y auto scroll.
	- Entrada de texto y boton Push-to-Talk.
	- Overlay inicial para activar interaccion de voz.

### 2) Capa de voz

- STT: Web Speech API via hook useSpeech.
- TTS: SpeechSynthesis via hook useVoiceSynthesis.
- Controles implementados:
	- Reintentos con backoff ante errores de red.
	- Pausa temporal de STT cuando Aira habla (prevencion de eco).
	- Filtro por wake word (aira).
	- Deduplicacion de frases finales para evitar envios repetidos.

### 3) Capa de orquestacion

- Ruta principal: packages/server
- Motor: Node.js + Socket.IO.
- Responsabilidades:
	- Gestion de conexion de clientes.
	- Recepcion de USER_INPUT (voz/texto).
	- Emision de SERVER_READY, HEARTBEAT, SYSTEM_MESSAGE, AIRA_RESPONSE, AIRA_NUDGE.
	- Deduplicacion de mensajes por fingerprint y timestamp.
	- Fallback conversacional cuando hay error de LLM/cuota.

### 4) Capa de inteligencia y memoria

- LLM:
	- Activo por defecto: endpoint local tipo OpenAI (LM Studio).
	- Opcion alterna preparada: Google Gemini (bloque comentado).
- Memoria:
	- Supabase para guardar mensajes de usuario y Aira.
	- Recuperacion de memorias recientes para enriquecer prompt.

### 5) Capa desktop

- Ruta principal: electron/main.js
- Electron abre una ventana y carga la UI del cliente en 127.0.0.1:3000.

## Flujo funcional resumido

1. El cliente inicia, conecta por socket y muestra estado.
2. El usuario envia texto o voz.
3. El servidor guarda la entrada en Supabase.
4. El servidor compone prompt con contexto reciente.
5. El LLM genera respuesta.
6. La respuesta se guarda en Supabase.
7. El servidor emite AIRA_RESPONSE.
8. El cliente renderiza el mensaje y lo reproduce por TTS.

## Estructura del monorepo

- electron/: contenedor de escritorio.
- packages/client/: interfaz React.
- packages/server/: backend de orquestacion y memoria.
- PLAN_*.md: bitacoras de planificacion por sprint.

## Variables de entorno relevantes

En el servidor se usan variables para conectores y memoria:

- PORT
- SUPABASE_URL
- SUPABASE_KEY
- GEMINI_API_KEY
- GEMINI_MODEL
- GEMINI_API_VERSION
- LM_STUDIO_BASE_URL
- LM_STUDIO_MODEL
- LM_STUDIO_API_KEY

## Scripts de trabajo del repositorio

- npm run client: inicia cliente React.
- npm run server: inicia servidor de orquestacion.
- npm run dev: ejecuta cliente y servidor en paralelo.
- npm run electron: abre contenedor de escritorio.

## Riesgos y brechas actuales

- En electron/main.js se usa nodeIntegration habilitado y contextIsolation deshabilitado; para hardening futuro se recomienda preload y aislamiento.
- La memoria actual es historica simple (sin embeddings activos), aunque el diseño apunta a evolucion vectorial.
- La seleccion de proveedor LLM se hace por bloque activo/comentado en codigo; conviene llevarla a bandera de entorno.

## Direccion de evolucion inmediata

- Consolidar modo seleccionable de proveedor LLM por configuracion.
- Extender memoria hacia recuperacion semantica.
- Añadir pruebas de regresion para flujo de voz (PTT, wake word, deduplicacion).