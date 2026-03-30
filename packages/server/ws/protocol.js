const WS_PROTOCOL_NAME = 'aira-ws';
const WS_PROTOCOL_VERSION = '1.1.0';
const SERVER_VERSION = '0.3.0';

function buildProtocolMeta(eventType) {
  return {
    protocol: WS_PROTOCOL_NAME,
    version: WS_PROTOCOL_VERSION,
    eventType,
    timestamp: Date.now(),
  };
}

module.exports = {
  WS_PROTOCOL_NAME,
  WS_PROTOCOL_VERSION,
  SERVER_VERSION,
  buildProtocolMeta,
};
