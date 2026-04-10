const { normalizeUserInputPayload } = require('./userInput');
const { isToolCommand, parseToolCommand } = require('../mcp/command-parser');
const { ensurePermission } = require('../mcp/permission-prompt');
const { callTool, isAvailable } = require('../mcp/bridge');

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
  onInterruptActiveTts,
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

      if (typeof onInterruptActiveTts === 'function') {
        try {
          onInterruptActiveTts({
            socketId: socket.id,
            source,
          });
        } catch (interruptError) {
          console.error('[socket] STOP_TTS backend cancel error', interruptError);
        }
      }
    }

    if (!text) {
      return;
    }

    // ── MCP /tool command handling ──────────────────────────────────────────
    if (isToolCommand(text)) {
      await handleToolCommand({ socket, io, buildProtocolMeta, text, clientMessageId });
      return;
    }
    // ────────────────────────────────────────────────────────────────────────

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

/**
 * Handle a /tool command from the chat input.
 * Checks permissions, then executes via the MCP bridge.
 */
async function handleToolCommand({ socket, io, buildProtocolMeta, text, clientMessageId }) {
  const parsed = parseToolCommand(text);

  if (!parsed) {
    socket.emit('AIRA_RESPONSE', {
      protocol: buildProtocolMeta('AIRA_RESPONSE'),
      text: '❌ Comando /tool inválido. Uso: `/tool <nombre> [param=valor ...]`',
      timestamp: Date.now(),
      source: 'keyboard',
      clientMessageId,
      fallback: false,
    });
    return;
  }

  const { toolName, params } = parsed;

  // Check if MCP server is running.
  const mcpOnline = await isAvailable();
  if (!mcpOnline) {
    socket.emit('AIRA_RESPONSE', {
      protocol: buildProtocolMeta('AIRA_RESPONSE'),
      text:
        `❌ MCP Server no disponible en el puerto configurado. ` +
        `Inícialo con: \`npm run mcp:server\``,
      timestamp: Date.now(),
      source: 'keyboard',
      clientMessageId,
      fallback: false,
    });
    return;
  }

  // Permission check / prompt.
  try {
    await ensurePermission({ socket, toolName, params, clientMessageId });
  } catch (permErr) {
    socket.emit('AIRA_RESPONSE', {
      protocol: buildProtocolMeta('AIRA_RESPONSE'),
      text: `🚫 ${permErr.message}`,
      timestamp: Date.now(),
      source: 'keyboard',
      clientMessageId,
      fallback: false,
    });
    return;
  }

  // Execute via MCP bridge.
  try {
    socket.emit('SYSTEM_MESSAGE', {
      protocol: buildProtocolMeta('SYSTEM_MESSAGE'),
      type: 'status',
      code: 'MCP_TOOL_EXECUTING',
      message: `Ejecutando herramienta: ${toolName}`,
      request: { clientMessageId },
    });

    const result = await callTool(toolName, params);
    const resultText = formatToolResult(toolName, result);

    socket.emit('AIRA_RESPONSE', {
      protocol: buildProtocolMeta('AIRA_RESPONSE'),
      text: resultText,
      timestamp: Date.now(),
      source: 'keyboard',
      clientMessageId,
      fallback: false,
      toolResult: { toolName, params, result },
    });
  } catch (execErr) {
    socket.emit('AIRA_RESPONSE', {
      protocol: buildProtocolMeta('AIRA_RESPONSE'),
      text: `❌ Error ejecutando \`${toolName}\`: ${execErr.message}`,
      timestamp: Date.now(),
      source: 'keyboard',
      clientMessageId,
      fallback: false,
    });
  }
}

/**
 * Format a tool result for display in the chat.
 * @param {string} toolName
 * @param {unknown} result
 * @returns {string}
 */
function formatToolResult(toolName, result) {
  if (result === null || result === undefined) {
    return `✅ \`${toolName}\` ejecutado sin resultado.`;
  }

  if (toolName === 'fs.list') {
    const entries = result.entries || [];
    const lines = entries.map((e) => `  ${e.type === 'directory' ? '📁' : '📄'} ${e.name}${e.size != null ? ` (${e.size}b)` : ''}`);
    return `📂 **${result.path}**\n${lines.join('\n') || '  (vacío)'}`;
  }

  if (toolName === 'fs.read') {
    const preview = String(result.content || '').slice(0, 1500);
    return `📄 **${result.path}**\n\`\`\`\n${preview}\n\`\`\``;
  }

  if (toolName === 'fs.write') {
    return `✅ Archivo escrito: \`${result.path}\` (${result.bytesWritten} bytes)`;
  }

  if (toolName === 'fs.mkdir') {
    return `✅ Directorio ${result.created ? 'creado' : 'ya existía'}: \`${result.path}\``;
  }

  if (toolName === 'fs.delete') {
    return `🗑️ ${result.deleted ? 'Eliminado' : 'No encontrado'}: \`${result.path}\``;
  }

  if (toolName.startsWith('git.')) {
    return `\`\`\`\n${result.output || JSON.stringify(result, null, 2)}\n\`\`\``;
  }

  if (toolName === 'cmd.run') {
    const out = [result.stdout, result.stderr].filter(Boolean).join('\n');
    return `\`\`\`\n${out || '(sin salida)'}\n\`\`\`\nExit code: ${result.exitCode}`;
  }

  if (toolName === 'app.launch') {
    return `🚀 App \`${result.appId}\` lanzada: \`${result.executablePath}\``;
  }

  if (toolName === 'app.list') {
    const apps = (result.apps || []).map((a) => `  ${a.configured ? '✅' : '⚠️'} ${a.appId}${a.path ? ` → ${a.path}` : ' (sin ruta)'}`);
    return `**Apps en allowlist:**\n${apps.join('\n') || '  (ninguna configurada)'}`;
  }

  if (toolName.startsWith('browser.')) {
    return `🌐 Abierto: \`${result.url}\``;
  }

  if (toolName === 'util.time') {
    return `🕐 **Hora local:** ${result.locale} (${result.timezone})`;
  }

  if (toolName === 'util.weather') {
    if (result.stub) return `🌤️ ${result.message}`;
    return (
      `🌤️ **Clima en ${result.location}**\n` +
      `  🌡️ ${result.temperature_c}°C  💧 ${result.humidity_pct}%  💨 ${result.wind_speed_kmh} km/h`
    );
  }

  return `✅ \`${toolName}\` resultado:\n\`\`\`json\n${JSON.stringify(result, null, 2)}\n\`\`\``;
}

module.exports = {
  buildFallbackMessage,
  createUserInputHandler,
  handleToolCommand,
  formatToolResult,
};

