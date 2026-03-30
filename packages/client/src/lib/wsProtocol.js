import { normalizeSpeechKey } from './textNormalization';

export const WS_PROTOCOL_NAME = 'aira-ws';
export const WS_PROTOCOL_VERSION = '1.1.0';

export function buildClientMessageId(source) {
  const randomChunk = Math.random().toString(36).slice(2, 8);
  return `${source}-${Date.now()}-${randomChunk}`;
}

export function buildUserInputPayload({
  content,
  source,
  interruptActiveTts = false,
  timestamp = Date.now(),
  clientMessageId,
  fingerprint,
}) {
  const text = String(content || '').trim();
  const normalizedSource = String(source || 'unknown').trim().toLowerCase() || 'unknown';
  const normalizedFingerprint =
    String(fingerprint || '').trim() || `${normalizedSource}:${normalizeSpeechKey(text)}`;

  return {
    content: text,
    clientMessageId: clientMessageId || buildClientMessageId(normalizedSource),
    fingerprint: normalizedFingerprint,
    timestamp,
    protocol: {
      name: WS_PROTOCOL_NAME,
      version: WS_PROTOCOL_VERSION,
    },
    metadata: {
      source: normalizedSource,
      interrupt_active_tts: Boolean(interruptActiveTts),
    },
  };
}

export function buildInterruptPayload(source) {
  const normalizedSource = String(source || 'unknown').trim().toLowerCase() || 'unknown';
  return buildUserInputPayload({
    content: '',
    source: normalizedSource,
    interruptActiveTts: true,
    fingerprint: `interrupt:${normalizedSource}:${Date.now()}`,
  });
}
