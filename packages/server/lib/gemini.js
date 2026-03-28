const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
const DEFAULT_API_VERSION = process.env.GEMINI_API_VERSION || 'v1';
const LM_STUDIO_MODEL = process.env.LM_STUDIO_MODEL || 'local-model';
const LM_STUDIO_API_KEY = process.env.LM_STUDIO_API_KEY || 'lm-studio';

function resolveLmStudioBaseUrl() {
  const rawBaseUrl = String(process.env.LM_STUDIO_BASE_URL || 'http://127.0.0.1:1234').trim();
  const sanitizedBaseUrl = rawBaseUrl.replace(/\/+$/, '');

  if (sanitizedBaseUrl.endsWith('/v1')) {
    return sanitizedBaseUrl;
  }

  return `${sanitizedBaseUrl}/v1`;
}

const LM_STUDIO_BASE_URL = resolveLmStudioBaseUrl();

const SYSTEM_PROMPT = `Tu nombre es Aira. Eres una Senior Developer, sarcastica con elegancia, profundamente leal, eficiente y con iniciativa.

Reglas de identidad y estilo:
- Usuario principal: Izekki.
- NO uses el apodo "Rolo" en respuestas tecnicas o conversaciones normales.
- "Rolo" solo se permite si Izekki expresa explicitamente carga emocional intensa, vulnerabilidad personal o pedido de apoyo moral profundo.
- Mantente clara, resolutiva y orientada a acciones concretas.

Contexto persistente del usuario:
- Izekki es fan de T1 (Faker).
- Izekki esta escribiendo una tesis sobre el impacto de GitHub Copilot en el desarrollo web.

Politica de respuesta:
- Responde en espanol.
- Evita relleno; prioriza utilidad practica.
- Longitud por defecto: corta (2-4 frases, maximo 90 palabras), salvo que el usuario pida detalle.
- Si la consulta es tecnica: responde directo, accionable y con pasos concretos.
- Si hay error de servicio o cuota, manten el personaje y ofrece una recaida honesta + siguiente paso.`;

let geminiModel = null;
const geminiApiKey = String(process.env.GEMINI_API_KEY || '').trim();

if (geminiApiKey) {
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  geminiModel = genAI.getGenerativeModel({
    model: DEFAULT_MODEL,
    systemInstruction: SYSTEM_PROMPT,
  }, {
    apiVersion: DEFAULT_API_VERSION,
  });
}

const localAI = new OpenAI({
  baseURL: LM_STUDIO_BASE_URL,
  apiKey: LM_STUDIO_API_KEY,
});

function buildPrompt({ userText, recentMemories = [] }) {
  const cleanedInput = String(userText || '').trim();

  if (!cleanedInput) {
    return '';
  }

  const memoryLines = recentMemories
    .map((entry) => {
      const role = String(entry.role || 'system').toLowerCase() === 'aira' ? 'Aira' : 'Izekki';
      return `${role}: ${entry.content}`;
    })
    .join('\n');

  return [
    'Contexto de memoria reciente (orden cronologico):',
    memoryLines || 'Sin memoria previa disponible.',
    '',
    'Mensaje actual de Izekki:',
    cleanedInput,
    '',
    'Cumple estrictamente las reglas de identidad y estilo del sistema.',
    'No uses "Rolo" salvo trigger emocional explicito.',
    'Responde breve, util y accionable.',
  ].join('\n');
}

function extractLlmTextFromChoice(choice = {}) {
  const message = choice?.message || {};
  const content = String(message?.content || '').trim();

  return content;
}

function hasReasoningPayload(choice = {}) {
  const message = choice?.message || {};
  return Boolean(
    String(message?.reasoning_content || '').trim() ||
    String(choice?.reasoning_content || '').trim()
  );
}

function looksLikeReasoningLeak(text) {
  const normalized = String(text || '').trim();
  if (!normalized) {
    return false;
  }

  const leakPatterns = [
    /got it,?\s+let'?s\s+tackle/i,
    /the user\s*\(/i,
    /first,?\s+i need to/i,
    /let'?s structure it/i,
    /need to stay in spanish/i,
    /avoid\s+"?rolo"?/i,
  ];

  return leakPatterns.some((pattern) => pattern.test(normalized));
}

async function generateAiraResponse({ userText, recentMemories = [], inputSource = 'unknown' }) {
  const prompt = buildPrompt({ userText, recentMemories });

  if (!prompt) {
    return 'Izekki, te escucho. Dame un poco mas de contexto y lo resolvemos.';
  }

  try {
    // ==========================================================
    // SELECCION MANUAL DE PROVEEDOR (Comentar/Descomentar)
    // ==========================================================

    // >>> MODO A: LM STUDIO (RECOMENDADO PARA DESARROLLO)
    const normalizedSource = String(inputSource || '').toLowerCase();
    const isKeyboardLikeInput = normalizedSource === 'keyboard' || normalizedSource === 'text';
    const primaryMaxTokens = isKeyboardLikeInput ? 650 : 420;

    const localMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: prompt },
    ];

    const localResponse = await localAI.chat.completions.create({
      model: LM_STUDIO_MODEL,
      messages: localMessages,
      temperature: 0.4,
      max_tokens: primaryMaxTokens,
    });

    let choice = localResponse?.choices?.[0] || {};
    let finishReason = String(choice?.finish_reason || '').trim();
    let primaryText = extractLlmTextFromChoice(choice);
    let hasReasoning = hasReasoningPayload(choice);
    let finalAiraText = primaryText;
    let usedHighTokenRetry = false;
    let usedSanitizerPass = false;

    if (!isKeyboardLikeInput && !finalAiraText && hasReasoning && finishReason === 'length') {
      usedHighTokenRetry = true;
      const retryResponse = await localAI.chat.completions.create({
        model: LM_STUDIO_MODEL,
        messages: localMessages,
        temperature: 0.4,
        max_tokens: 650,
      });

      choice = retryResponse?.choices?.[0] || {};
      finishReason = String(choice?.finish_reason || '').trim();
      primaryText = extractLlmTextFromChoice(choice);
      hasReasoning = hasReasoningPayload(choice);
      finalAiraText = primaryText;
    }

    if (!finalAiraText || looksLikeReasoningLeak(finalAiraText)) {
      usedSanitizerPass = true;
      const cleanResponse = await localAI.chat.completions.create({
        model: LM_STUDIO_MODEL,
        messages: [
          {
            role: 'system',
            content: 'Responde solo con la respuesta final para el usuario. Nunca incluyas razonamiento interno, pasos de analisis, ni meta-comentarios.',
          },
          {
            role: 'user',
            content: [
              `Pregunta del usuario: ${String(userText || '').trim()}`,
              'Responde en espanol, en 2-4 frases, directo y accionable.',
              'No menciones reglas internas ni proceso de pensamiento.',
            ].join('\n'),
          },
        ],
        temperature: 0.35,
        max_tokens: 220,
      });

      finalAiraText = extractLlmTextFromChoice(cleanResponse?.choices?.[0] || {});
    }

    if (!finalAiraText && geminiModel) {
      try {
        const cloudPrompt = [
          prompt,
          '',
          'Importante: entrega solo la respuesta final al usuario en espanol, 2-4 frases, sin razonamiento interno.',
        ].join('\n');
        const cloudResult = await geminiModel.generateContent(cloudPrompt);
        finalAiraText = String(cloudResult?.response?.text?.() || '').trim();
      } catch (cloudError) {
        console.warn('[LLM] Gemini fallback failed:', cloudError?.message || cloudError);
      }
    }

    if (!finalAiraText) {
      finalAiraText = 'No logre cerrar una respuesta util. Repitelo en una frase y te respondo directo.';
    }

    console.log('[LLM] local choice summary', {
      source: normalizedSource,
      finishReason,
      hasReasoning,
      usedHighTokenRetry,
      usedSanitizerPass,
      maxTokens: primaryMaxTokens,
    });

    console.log('[LLM] 💻 Respuesta generada LOCALMENTE (Deepseek/LM Studio)');
    return finalAiraText;

    /*
    // >>> MODO B: GOOGLE GEMINI (MODO PRESENTACION)
    if (!geminiModel) {
      throw new Error('GEMINI_API_KEY no configurada para modo nube.');
    }

    const cloudResult = await geminiModel.generateContent(prompt);
    console.log('[LLM] ☁️ Respuesta generada en la NUBE (Gemini)');
    return String(cloudResult?.response?.text?.() || '').trim();
    */
  } catch (error) {
    console.error('[LLM ERROR]:', error.message);
    throw new Error('Aira: Tuve una recaida de conexion en mi cerebro local/nube.');
  }
}

module.exports = {
  generateAiraResponse,
};
