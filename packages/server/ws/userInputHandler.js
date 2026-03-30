const { normalizeUserInputPayload } = require('./userInput');

function buildFallbackMessage(error) {
  const message = String(error?.message || '').toLowerCase();
  const isQuotaLike =
    message.includes('quota') ||
    message.includes('rate limit') ||
    message.includes('429') ||
    message.includes('resource exhausted');

  if (isQuotaLike) {
    return 'Izekki, estoy en recaida por cuota ahora mismo. Dame un minuto, reintentamos y te saco adelante el siguiente paso.';
  }

  return 'Izekki, tuve una recaida de conexion en mi cerebro. Sigo contigo: vuelve a intentarlo y retomamos desde donde quedamos.';
}

function createUserInputHandler({
  socket,
  io,
  memoryStore,
  generateAiraResponse,
  deduper,
  buildProtocolMeta,
}) {
  return async function onUserInput(payload = {}) {
    const normalizedInput = normalizeUserInputPayload(payload);
    const {
      source,
      interruptActiveTts,
      text,
      timestamp: clientTimestamp,
      fingerprint: clientFingerprint,
      clientMessageId,
    } = normalizedInput;

    // Prioridad maxima: si el usuario interrumpe, cortamos TTS inmediatamente.
    if (interruptActiveTts) {
      io.emit('STOP_TTS');
      console.log(`[socket] STOP_TTS triggered by ${source}`);
    }

    if (!text) {
      return;
    }

    const fingerprint = clientFingerprint || `${source}:${text.toLowerCase()}`;
    const now = Date.now();

    if (
      deduper.isDuplicate({
        fingerprint,
        clientTimestamp,
        clientMessageId,
        now,
      })
    ) {
      console.log('[socket] USER_INPUT skipped duplicate', {
        text,
        source,
        clientMessageId,
      });
      return;
    }

    deduper.register({
      fingerprint,
      clientTimestamp,
      clientMessageId,
      now,
    });

    socket.emit('SYSTEM_MESSAGE', {
      protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
      type: 'status',
      code: 'USER_INPUT_ACCEPTED',
      message: `Entrada ${source} aceptada para procesamiento.`,
      request: {
        clientMessageId,
        fingerprint,
        source,
      },
    });

    try {
      console.log('[socket] USER_INPUT', { text, source, clientMessageId });

      await memoryStore.saveMemory({
        role: 'user',
        content: text,
        inputType: source,
        fingerprint,
      });

      const recentMemories = await memoryStore.getRecentMemories(14);

      const airaText = await generateAiraResponse({
        userText: text,
        recentMemories,
        inputSource: source,
      });

      await memoryStore.saveMemory({
        role: 'aira',
        content: airaText,
      });

      socket.emit('AIRA_RESPONSE', {
        protocol: buildProtocolMeta('AIRA_RESPONSE'),
        text: airaText,
        timestamp: Date.now(),
        source,
        clientMessageId,
        fallback: false,
      });
    } catch (error) {
      const fallbackText = buildFallbackMessage(error);
      console.error('[socket] USER_INPUT failure', error);

      try {
        await memoryStore.saveMemory({
          role: 'aira',
          content: fallbackText,
        });
      } catch (saveError) {
        console.error('[socket] fallback save failure', saveError);
      }

      socket.emit('AIRA_RESPONSE', {
        protocol: buildProtocolMeta('AIRA_RESPONSE'),
        text: fallbackText,
        timestamp: Date.now(),
        source,
        clientMessageId,
        fallback: true,
      });

      socket.emit('SYSTEM_MESSAGE', {
        protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
        type: 'error',
        code: 'USER_INPUT_FAILURE',
        msg: 'Error en el flujo de memoria.',
        message: 'Aira entro en recaida temporal; se envio respuesta de contingencia.',
        request: {
          clientMessageId,
          fingerprint,
          source,
        },
      });
    }
  };
}

module.exports = {
  buildFallbackMessage,
  createUserInputHandler,
};
