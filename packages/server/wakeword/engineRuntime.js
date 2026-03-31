function createWakeWordRuntime({ WakeWordService, io, buildProtocolMeta, voiceServerConfig = {} }) {
  let wakeWordService = null;
  let wakeWordRuntime = {
    mode: 'server/openWakeWord',
    active: false,
    error: '',
    wakeWordLabel: String(voiceServerConfig.label || 'AIRA (Custom)'),
    modelName: String(voiceServerConfig.modelName || 'aira.onnx'),
    threshold: Number(voiceServerConfig.wakeWordThreshold || 0.1),
  };

  async function startListening() {
    if (!WakeWordService) {
      wakeWordRuntime = {
        ...wakeWordRuntime,
        active: false,
        error: 'WakeWordService no disponible en este entorno',
      };

      io.emit('SYSTEM_MESSAGE', {
        protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
        type: 'error',
        code: 'WAKE_WORD_ENGINE_ERROR',
        message: `Wake word backend no disponible: ${wakeWordRuntime.error}`,
      });
      return;
    }

    try {
      wakeWordService = new WakeWordService({
        onWakeWordDetected: (payload = {}) => {
          io.emit('WAKE_WORD_DETECTED', {
            protocol: buildProtocolMeta('WAKE_WORD_DETECTED'),
            ...payload,
          });
        },
      });

      await wakeWordService.startListening();
      const runtimeInfo = wakeWordService.getRuntimeInfo();
      wakeWordRuntime = {
        mode: 'server/openWakeWord',
        active: true,
        error: '',
        wakeWordLabel: runtimeInfo.wakeWordLabel,
        modelName: runtimeInfo.modelName,
        threshold: runtimeInfo.wakeWordThreshold,
      };

      io.emit('SYSTEM_MESSAGE', {
        protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
        type: 'info',
        code: 'WAKE_WORD_ENGINE_READY',
        message: `Wake word backend activo: ${runtimeInfo.wakeWordLabel} (${runtimeInfo.modelName}) umbral ${runtimeInfo.wakeWordThreshold.toFixed(2)}`,
      });
    } catch (error) {
      wakeWordRuntime = {
        ...wakeWordRuntime,
        active: false,
        error: String(error?.message || 'No se pudo iniciar wake word engine'),
      };

      console.error('[wake-word] engine start failure', error);
      io.emit('SYSTEM_MESSAGE', {
        protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
        type: 'error',
        code: 'WAKE_WORD_ENGINE_ERROR',
        message: `Wake word backend no disponible: ${wakeWordRuntime.error}`,
      });
    }
  }

  function stopListening() {
    if (!wakeWordService) {
      return;
    }

    try {
      wakeWordService.cleanup();
    } catch (error) {
      console.error('[wake-word] engine cleanup failure', error);
    } finally {
      wakeWordService = null;
      wakeWordRuntime = {
        ...wakeWordRuntime,
        active: false,
      };
    }
  }

  function getRuntime() {
    return {
      ...wakeWordRuntime,
    };
  }

  return {
    startListening,
    stopListening,
    getRuntime,
  };
}

module.exports = {
  createWakeWordRuntime,
};
