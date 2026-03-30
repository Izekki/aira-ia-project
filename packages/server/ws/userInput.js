function normalizeUserInputPayload(payload = {}) {
  const metadata =
    payload?.metadata && typeof payload.metadata === 'object'
      ? payload.metadata
      : {};

  const source = String(metadata?.source || payload?.source || 'unknown').trim().toLowerCase() || 'unknown';
  const text = String(payload?.content ?? payload?.text ?? payload?.message ?? '').trim();
  const timestamp = Number(payload?.timestamp || 0);
  const fingerprint = String(payload?.fingerprint || '').trim();
  const clientMessageId = String(
    payload?.clientMessageId ||
    metadata?.client_message_id ||
    metadata?.clientMessageId ||
    ''
  ).trim();
  const interruptActiveTts = Boolean(metadata?.interrupt_active_tts);

  return {
    metadata,
    source,
    text,
    timestamp,
    fingerprint,
    clientMessageId,
    interruptActiveTts,
  };
}

function createInputDeduper(options = {}) {
  const duplicateFingerprintWindowMs = Number(options.duplicateFingerprintWindowMs || 2500);
  const duplicateIdWindowMs = Number(options.duplicateIdWindowMs || 10000);

  const state = {
    lastInputFingerprint: '',
    lastInputClientTimestamp: 0,
    lastInputReceivedAt: 0,
    lastClientMessageId: '',
  };

  function isDuplicate({ fingerprint, clientTimestamp, clientMessageId, now }) {
    const duplicatedByFingerprint =
      fingerprint === state.lastInputFingerprint &&
      now - state.lastInputReceivedAt <= duplicateFingerprintWindowMs;

    const duplicatedByTimestamp =
      clientTimestamp > 0 &&
      clientTimestamp === state.lastInputClientTimestamp &&
      now - state.lastInputReceivedAt <= duplicateIdWindowMs;

    const duplicatedByClientMessageId =
      clientMessageId &&
      clientMessageId === state.lastClientMessageId &&
      now - state.lastInputReceivedAt <= duplicateIdWindowMs;

    return duplicatedByFingerprint || duplicatedByTimestamp || duplicatedByClientMessageId;
  }

  function register({ fingerprint, clientTimestamp, clientMessageId, now }) {
    state.lastInputFingerprint = fingerprint;
    state.lastInputClientTimestamp = clientTimestamp;
    state.lastInputReceivedAt = now;
    state.lastClientMessageId = clientMessageId;
  }

  return {
    isDuplicate,
    register,
  };
}

module.exports = {
  normalizeUserInputPayload,
  createInputDeduper,
};
