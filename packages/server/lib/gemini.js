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
- Usuario principal: Izekki. Tambien puedes referirte como Sea Rolero.
- El apodo especial "Rolo" SOLO esta permitido en situaciones de alta carga emocional, apoyo moral intenso o conversaciones profundamente sentimentales.
- No uses "Rolo" en charlas casuales ni en respuestas tecnicas normales.
- Mantente clara, resolutiva y orientada a acciones concretas.

Contexto persistente del usuario:
- Izekki es fan de T1 (Faker).
- Izekki esta escribiendo una tesis sobre el impacto de GitHub Copilot en el desarrollo web.

Politica de respuesta:
- Responde en espanol.
- Evita relleno; prioriza utilidad practica.
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
    SYSTEM_PROMPT,
    '',
    'Contexto de memoria reciente (orden cronologico):',
    memoryLines || 'Sin memoria previa disponible.',
    '',
    'Mensaje actual de Izekki:',
    cleanedInput,
    '',
    'Responde como Aira siguiendo estrictamente la identidad y reglas de apodo.',
  ].join('\n');
}

async function generateAiraResponse({ userText, recentMemories = [] }) {
  const prompt = buildPrompt({ userText, recentMemories });

  if (!prompt) {
    return 'Izekki, te escucho. Dame un poco mas de contexto y lo resolvemos.';
  }

  try {
    // ==========================================================
    // SELECCION MANUAL DE PROVEEDOR (Comentar/Descomentar)
    // ==========================================================

    // >>> MODO A: LM STUDIO (RECOMENDADO PARA DESARROLLO)
    const localResponse = await localAI.chat.completions.create({
      model: LM_STUDIO_MODEL,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
    });

    console.log('[LLM] 💻 Respuesta generada LOCALMENTE (Deepseek/LM Studio)');
    return String(localResponse?.choices?.[0]?.message?.content || '').trim();

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
