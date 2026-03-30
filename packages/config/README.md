# 🎙️ Configuración de Detección de Voz y Wake Words

Este directorio contiene la configuración centralizada para detección de voz, wake words, sensibilidad y parámetros de audio.

## 📁 Archivos

- **`voice-detection-config.js`** - Archivo PRINCIPAL de configuración (edita este archivo)

## 🚀 Cómo Usar

### 1️⃣ Cambiar la Wake Word (Ejemplo: De "Alexa" a "HeyAIRA")

#### Opción A: Usar modelo existente (recomendado si tienes `heyaira.onnx`)

1. Abre `voice-detection-config.js`
2. Busca la sección **"1. CONFIGURACIÓN DE WAKE WORDS"**
3. Cambia:

```javascript
// ANTES:
model: process.env.WAKE_WORD_MODEL || 'alexa_v0.1.onnx',

// DESPUÉS:
model: process.env.WAKE_WORD_MODEL || 'heyaira.onnx',
```

4. Cambia también el array de palabras en cliente (si quieres):

```javascript
// En WAKE_WORDS_CONFIG.client:
default: ['heyaira'], // Cambio de ['aira'] a ['heyaira']
```

#### Opción B: Usar variable de entorno (sin editar código)

Si quieres cambiar sin editar el archivo, usa:

```bash
# Linux/Mac
export WAKE_WORD_MODEL='heyaira.onnx'
export WAKE_WORD_THRESHOLD='0.45'

# Windows (PowerShell)
$env:WAKE_WORD_MODEL='heyaira.onnx'
$env:WAKE_WORD_THRESHOLD='0.45'

# Windows (CMD)
set WAKE_WORD_MODEL=heyaira.onnx
set WAKE_WORD_THRESHOLD=0.45
```

### 2️⃣ Ajustar la Sensibilidad (Confident Threshold)

**¿Cuándo ajustar?**
- **Muchas falsas alarmas** (se activa sin que digas nada) → ⬆️ AUMENTA el threshold
- **No detecta tu voz** → ⬇️ DISMINUYE el threshold

1. Abre `voice-detection-config.js`
2. Busca `CONFIDENCE_THRESHOLDS`
3. Cambia:

```javascript
const CONFIDENCE_THRESHOLDS = {
  client: {
    minConfidence: 0.2,  // ← Ajusta aquí (cliente/navegador)
  },
  server: {
    wakeWordThreshold: Number(process.env.WAKE_WORD_THRESHOLD || 0.35), // ← O aquí (servidor)
    vadThreshold: 0.5,   // ← Detecta si hay voz en el audio
  },
};
```

**Valores recomendados:**
| Rango | Comportamiento |
|-------|---|
| 0.2 - 0.4 | Muy permisivo (muchas falsas alarmas) |
| **0.35 - 0.55** | **Equilibrado (recomendado)** |
| 0.6 - 0.8 | Muy restrictivo (puede perder tu voz) |

### 3️⃣ Cambiar Idioma de Reconocimiento de Voz

1. Abre `voice-detection-config.js`
2. Busca `WAKE_WORDS_CONFIG.client.language`
3. Cambia:

```javascript
const WAKE_WORDS_CONFIG = {
  client: {
    language: 'es-MX',  // ← CAMBIAR AQUÍ
  },
};
```

**Opciones:**
- `'es-MX'` - Español (México)
- `'es-ES'` - Español (España)
- `'en-US'` - Inglés (USA)
- `'en-GB'` - Inglés (UK)
- `'fr-FR'` - Francés
- `'de-DE'` - Alemán
- Ver [Lista completa de códigos de idioma](https://www.w3.org/TR/2014/CR-speech-api-20141119/)

### 4️⃣ Ajustar Cooldown (Tiempo entre Detecciones)

Si la detección se dispara múltiples veces muy rápido, aumenta el cooldown:

```javascript
const TIMING_CONFIG = {
  detectionCooldownMs: {
    client: 1500,  // Navegador (milisegundos)
    server: 1400,  // Servidor (milisegundos)
  },
};
```

- **Valor bajo (1000)** = Más rápido, puede detectar múltiples veces
- **Valor alto (2000)** = Más lento, evita detecciones múltiples

### 5️⃣ Cambiar a Tu Modelo Personalizado

Si creaste tu propio modelo ONNX (ej: `mimodelo.onnx`):

1. Copia el archivo a `packages/server/recorder/models/mimodelo.onnx`
2. Abre `voice-detection-config.js`
3. Agrega tu modelo al mapeo:

```javascript
const MODEL_LABELS = {
  'alexa_v0.1.onnx': 'Alexa',
  'heyaira.onnx': 'HeyAIRA (Custom)',
  'mimodelo.onnx': 'Mi Modelo Personalizado',  // ← AGREGA ESTA LÍNEA
};
```

4. Cambia el modelo activo:

```javascript
const WAKE_WORDS_CONFIG = {
  server: {
    model: process.env.WAKE_WORD_MODEL || 'mimodelo.onnx',  // ← CAMBIAR AQUÍ
  },
};
```

## 📋 Referencia Rápida de Cambios Comunes

### "Quiero usar HEYAIRA en lugar de ALEXA"

```diff
// En voice-detection-config.js

- model: process.env.WAKE_WORD_MODEL || 'alexa_v0.1.onnx',
+ model: process.env.WAKE_WORD_MODEL || 'heyaira.onnx',

- default: ['aira'],
+ default: ['heyaira'],
```

### "Se activa demasiado fácil sin yo hablar"

```diff
// En voice-detection-config.js (aumenta threshold)

- wakeWordThreshold: Number(process.env.WAKE_WORD_THRESHOLD || 0.35),
+ wakeWordThreshold: Number(process.env.WAKE_WORD_THRESHOLD || 0.50),
```

### "No me detecta bien mi voz"

```diff
// En voice-detection-config.js (disminuye threshold)

- wakeWordThreshold: Number(process.env.WAKE_WORD_THRESHOLD || 0.35),
+ wakeWordThreshold: Number(process.env.WAKE_WORD_THRESHOLD || 0.25),
```

### "Quiero cambiar solo desde variable de entorno (sin editar código)"

```bash
# Antes de correr la app, ejecuta:
export WAKE_WORD_MODEL='heyaira.onnx'
export WAKE_WORD_THRESHOLD='0.45'

# Luego:
npm start
```

## 🔧 Archivos que Usan Esta Configuración

La configuración se importa automáticamente en:

1. **Cliente (Navegador)**
   - 📄 `packages/client/src/hooks/useWakeWordBrowser.js`

2. **Servidor (Electron/Desktop)**
   - 📄 `packages/server/recorder/wakeWordService.js`

Si editas `voice-detection-config.js`, los cambios se usarán automáticamente en ambos lugares.

## 🎯 Parámetros Avanzados (No Recomendado Cambiar)

Estos parámetros están vinculados a los modelos ONNX entrenados. **Solo cambialos si sabes lo que haces:**

```javascript
const AUDIO_PARAMETERS = {
  sampleRate: 16000,              // Muestras por segundo (Hz)
  frameSize: 512,                 // Tamaño de frame de audio
  melFrameBins: 32,               // Bins en mel-spectrogram
  melWindowSize: 76,              // Ventana de mel-spectrogram
  embeddingSize: 96,              // Tamaño de embedding
  embeddingWindowSize: 16,        // Ventana de embedding
};
```

Si cambias estos valores, los modelos ONNX pueden no funcionar correctamente.

## 🐛 Troubleshooting

### Error: "Modelo wake word no encontrado: heyaira.onnx"

✅ Solución: Verifica que `packages/server/recorder/models/heyaira.onnx` exista

### No se encuentran cambios después de editar

✅ Solución: Reinicia la aplicación (npm start)

### Variables de entorno no se aplican

✅ Solución: Verifica que estén configuradas ANTES de iniciar la app:

```bash
# Correcto:
export WAKE_WORD_THRESHOLD='0.45'
npm start

# Incorrecto (no funciona):
npm start
export WAKE_WORD_THRESHOLD='0.45'
```

## 📚 Más Información

- Ver documentación en [voice-detection-config.js](./voice-detection-config.js) para más detalles sobre cada parámetro
- Ver comentarios inline en el archivo para explicaciones detalladas

---

💡 **Tip**: Guarda una copia de `voice-detection-config.js` antes de hacer cambios importantes, así puedes restaurarla fácilmente.
