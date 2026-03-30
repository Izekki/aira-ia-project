# 📝 Cambios de Refactorización - Configuración de Voz

## 🎯 Resumen

Se ha refactorizado la configuración de detección de voz y wake words en un **archivo centralizado** (`packages/config/voice-detection-config.js`) para facilitar cambios sin modificar múltiples archivos.

## ✅ Qué Cambió

### Antes (Configuración Dispersa)

Antes, la configuración estaba esparcida en:
- `packages/client/src/hooks/useWakeWordBrowser.js` (constantes hardcodeadas)
- `packages/server/recorder/wakeWordService.js` (constantes hardcodeadas + env vars)

Cambiar la wake word o sensibilidad requería editar 2 archivos diferentes.

### Después (Configuración Centralizada)

Ahora toda la configuración está en:
- **`packages/config/voice-detection-config.js`** ← Edita AQUÍ
- `packages/client/src/hooks/useWakeWordBrowser.js` (solo importa)
- `packages/server/recorder/wakeWordService.js` (solo importa)

**Ventajas:**
✅ Un solo archivo para cambiar todos los parámetros  
✅ Menos duplicación de código  
✅ Comentarios detallados sobre cada parámetro  
✅ Fácil mantener sincronización entre cliente y servidor  
✅ Mejor documentación  

## 🔧 Guía de Migración para Desarrolladores

Si tienes customizaciones previas, aquí te mostramos cómo migrar:

### Cambios en Archivos Existentes

#### `packages/client/src/hooks/useWakeWordBrowser.js`

**ANTES:**
```javascript
const DEFAULT_WAKE_WORDS = ['aira'];
const PRIMARY_SPEECH_LANG = 'es-MX';
const DETECTION_COOLDOWN_MS = 1500;
const DEFAULT_MIN_CONFIDENCE = 0.2;
```

**DESPUÉS:**
```javascript
// Carga desde configuración centralizada
let VOICE_CONFIG = window.VOICE_DETECTION_CONFIG || { /* fallback */ };
const DEFAULT_WAKE_WORDS = VOICE_CONFIG.WAKE_WORDS_CONFIG?.client?.default || ['aira'];
const PRIMARY_SPEECH_LANG = VOICE_CONFIG.WAKE_WORDS_CONFIG?.client?.language || 'es-MX';
// ... etc
```

**Acción requerida:** Ninguna - el archivo se actualizó automáticamente

---

#### `packages/server/recorder/wakeWordService.js`

**ANTES:**
```javascript
this.SAMPLE_RATE = 16000;
this.FRAME_SIZE = 512;
this.CONFIDENCE_THRESHOLD = Number(process.env.WAKE_WORD_THRESHOLD || 0.35);
// ... más constantes hardcodeadas
```

**DESPUÉS:**
```javascript
// Importa configuración centralizada
const serverConfig = VOICE_CONFIG.getServerConfig();
this.SAMPLE_RATE = serverConfig.sampleRate;
this.FRAME_SIZE = serverConfig.frameSize;
this.CONFIDENCE_THRESHOLD = serverConfig.wakeWordThreshold;
// ... etc
```

**Acción requerida:** Ninguna - el archivo se actualizó automáticamente

---

## 📍 Nuevos Archivos

```
packages/config/
├── voice-detection-config.js      # ← ARCHIVO PRINCIPAL (edita aquí)
├── voice-detection-config-inject.js  # JavaScript para inyectar en navegador
├── .env.example                    # Ejemplo de variables de entorno
├── README.md                        # Documentación completa
└── MIGRATION.md                    # Este archivo
```

## 🚀 Cómo Usar la Nueva Configuración

### Opción 1: Editar el archivo directamente (Recomendado)

```bash
# 1. Abre el archivo
nano packages/config/voice-detection-config.js

# 2. Busca la sección que quieres cambiar (ej: CONFIDENCE_THRESHOLDS)

# 3. Edita el valor

# 4. Guarda el archivo

# 5. Reinicia la app
npm start
```

### Opción 2: Usar variables de entorno (Sin editar código)

```bash
# 1. Copia el archivo de ejemplo
cp packages/config/.env.example .env

# 2. Edita .env con tus valores
nano .env

# 3. Reinicia la app
npm start
```

### Opción 3: Inyectar en tiempo de ejecución (Avanzado)

Si necesitas cambiar valores dinámicamente desde el navegador:

```javascript
// En la consola del navegador:
localStorage.setItem('AIRA_WAKEWORD_DEBUG', '1'); // Habilita debug logs
```

## ⚠️ Consideraciones de Compatibilidad

### Retrocompatibilidad

✅ **Completamente retrocompatible**: Variables de entorno antiguas aún funcionan:

```bash
# Esto aún funciona:
export WAKE_WORD_MODEL='heyaira.onnx'
export WAKE_WORD_THRESHOLD='0.45'
npm start
```

### Prioridad de Configuración

La configuración se carga en este orden (la primera que existe, gana):

1. **Variables de entorno** (más alta prioridad)
   ```bash
   WAKE_WORD_MODEL=heyaira.onnx
   WAKE_WORD_THRESHOLD=0.45
   ```

2. **Archivo `voice-detection-config.js`** (prioridad media)
   ```javascript
   model: process.env.WAKE_WORD_MODEL || 'alexa_v0.1.onnx',
   wakeWordThreshold: Number(process.env.WAKE_WORD_THRESHOLD || 0.35),
   ```

3. **Valores hardcodeados por defecto** (lowest priority)
   ```javascript
   if (!value) { value = defaultValue; }
   ```

## 🔍 Validación de la Migración

Para verificar que todo funciona correctamente:

### 1. Verificar configuración cargada (Servidor)
```bash
npm start
# Busca en la consola:
# [WakeWordService] ✓ voice-detection-config.js cargado (fallback omitido si todo está bien)
```

### 2. Verificar configuración cargada (Navegador)
```javascript
// En consola del navegador:
console.log(window.VOICE_DETECTION_CONFIG);
// Debe mostrar el objeto de configuración
```

### 3. Verificar que los cambios aplican
```javascript
// Cambia un valor en voice-detection-config.js
// Reinicia la app
// Verifica que el cambio se haya aplicado en ambos cliente y servidor
```

## 📚 Documentación Actual

- **`packages/config/README.md`** - Guía de usuario completa
- **`packages/config/voice-detection-config.js`** - Comentarios inline detallados
- **`packages/config/.env.example`** - Ejemplo de variables de entorno
- **Este archivo** - Notas técnicas de migración

## ❓ Preguntas Frecuentes

### P: ¿Puedo usar las variables de entorno antiguas?

**R:** Sí, completamente. Las variables `WAKE_WORD_MODEL` y `WAKE_WORD_THRESHOLD` siguen funcionando.

### P: ¿Qué pasa si edito `voice-detection-config.js` Y tengo `.env`?

**R:** Las variables de entorno ganaran. Orden: env vars > archivo config > defaults.

### P: ¿Debo actualizar mis scripts de deploy?

**R:** No es necesario, pero es recomendado. Ahora puedes usar un único archivo `.env` en lugar de pasar múltiples variables.

### P: ¿Como revert los cambios si algo falla?

**R:** 
```bash
# La configuración antigua aún funciona via env vars:
export WAKE_WORD_MODEL='alexa_v0.1.onnx'
export WAKE_WORD_THRESHOLD='0.35'
npm start
```

## 🤝 Contribuciones

Si creas un nuevo modelo ONNX personalizado:

1. Copia el archivo a `packages/server/recorder/models/`
2. Edita `voice-detection-config.js` y agrega el modelo al `MODEL_LABELS`
3. Cambia el modelo activo en `WAKE_WORDS_CONFIG.server.model`

Ejemplo:
```javascript
// En voice-detection-config.js
const MODEL_LABELS = {
  'alexa_v0.1.onnx': 'Alexa',
  'mimodelo_custom.onnx': 'Mi Modelo Personalizado', // ← NUEVO
};

const WAKE_WORDS_CONFIG = {
  server: {
    model: 'mimodelo_custom.onnx', // ← USAR EL NUEVO
  },
};
```

---

**Última actualización:** Marzo 2026  
**Versión:** 1.0 - Refactorización Centralizada
