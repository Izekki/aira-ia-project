# 🚀 INICIO RÁPIDO - Configuración de Voz

## El Archivo Principal

📌 **Edita AQUÍ todos los parámetros de voz:**
```
packages/config/voice-detection-config.js
```

## Cambios Más Comunes (Copy & Paste)

### 1️⃣ Cambiar Wake Word a "HEYAIRA"

```javascript
// En voice-detection-config.js, busca:
const WAKE_WORDS_CONFIG = {
  server: {
    model: process.env.WAKE_WORD_MODEL || 'alexa_v0.1.onnx',
    //                                      ↑ CAMBIAR ESTO
  },
};

// Cambia a:
const WAKE_WORDS_CONFIG = {
  server: {
    model: process.env.WAKE_WORD_MODEL || 'heyaira.onnx',
    //                                      ↑ AHORA "HEYAIRA"
  },
};

// Y también:
enabled: ['heyaira'],  // En client.default
```

### 2️⃣ Se Activa Demasiado Fácil (Falsas Alarmas)

```javascript
// En CONFIDENCE_THRESHOLDS, aumenta el threshold:
wakeWordThreshold: Number(process.env.WAKE_WORD_THRESHOLD || 0.35),
//                                                             ↑ AUMENTAR A 0.5
```

### 3️⃣ NO Me Detecta la Voz

```javascript
// En CONFIDENCE_THRESHOLDS, disminuye el threshold:
wakeWordThreshold: Number(process.env.WAKE_WORD_THRESHOLD || 0.35),
//                                                             ↑ DISMINUIR A 0.2
```

### 4️⃣ Cambiar Idioma (España, USA, etc.)

```javascript
// En WAKE_WORDS_CONFIG.client:
language: 'es-MX',  // Cambiar a 'es-ES', 'en-US', 'fr-FR', etc.
//         ↑ AQUÍ
```

### 5️⃣ Activación Múltiple Rápida (Aumentar Cooldown)

```javascript
// En TIMING_CONFIG:
detectionCooldownMs: {
  client: 1500,   // Aumentar a 2000+
  server: 1400,   // Aumentar a 2000+
},
```

## 📝 Usando Variables de Entorno (Sin Editar Código)

```bash
# Opción 1: Terminal bash/zsh
export WAKE_WORD_MODEL='heyaira.onnx'
export WAKE_WORD_THRESHOLD='0.45'
npm start

# Opción 2: PowerShell (Windows)
$env:WAKE_WORD_MODEL='heyaira.onnx'
$env:WAKE_WORD_THRESHOLD='0.45'
npm start

# Opción 3: Archivo .env
# 1. cp packages/config/.env.example .env
# 2. Edita .env con tus valores
# 3. npm start
```

## 🎯 Parámetros Principales

| Parámetro | Localización | Rango | Default |
|-----------|-------------|-------|---------|
| Wake Word | `WAKE_WORDS_CONFIG.server.model` | `heyaira.onnx`, `alexa_v0.1.onnx`, etc. | `alexa_v0.1.onnx` |
| Sensibilidad | `CONFIDENCE_THRESHOLDS.server.wakeWordThreshold` | 0.0-1.0 | 0.35 |
| Idioma | `WAKE_WORDS_CONFIG.client.language` | `es-MX`, `en-US`, etc. | `es-MX` |
| Cooldown | `TIMING_CONFIG.detectionCooldownMs` | ms | 1400-1500 |

## ✅ Verificación

Abre la consola del navegador y ejecuta:
```javascript
console.log(window.VOICE_DETECTION_CONFIG)
// Debe mostrar el objeto con tu configuración
```

En el terminal, busca:
```
[WakeWordService] ✓ {modelo}.onnx cargado
```

## 📚 Más Información

- 📖 Guía completa: [`packages/config/README.md`](README.md)
- 🔧 Detalles técnicos: [`voice-detection-config.js`](voice-detection-config.js)
- 📋 Ejemplo .env: [`packages/config/.env.example`](.env.example)
- 📝 Cambios: [`MIGRATION.md`](MIGRATION.md)

---

💡 **Tip**: Después de cambiar cualquier parámetro, reinicia la app con `npm start`
