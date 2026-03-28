import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';
import useSpeech from './hooks/useSpeech';
import useVoiceSynthesis from './hooks/useVoiceSynthesis';
import Visualizer from './components/Visualizer';

const SOCKET_SERVER_URL = 'http://127.0.0.1:4000';
const VOICE_ENGINE_MISSING_MESSAGE =
  'Usa un navegador basado en Chromium (Chrome/Edge/Electron) con servicios de Google activos';
const VISUALIZER_STATE = {
  IDLE: 'IDLE',
  LISTENING: 'LISTENING',
  PROCESSING: 'PROCESSING',
  SPEAKING: 'SPEAKING',
};

const DEFAULT_SPEECH_PROFILE = 'stable';
const DUPLICATE_EMIT_WINDOW_MS = 7000;

function normalizeSpeechKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveSpeechProfile() {
  const runtimeProfile =
    typeof window !== 'undefined'
      ? window.localStorage?.getItem('AIRA_SPEECH_PROFILE')
      : '';

  return String(runtimeProfile || DEFAULT_SPEECH_PROFILE).toLowerCase() === 'aggressive'
    ? 'aggressive'
    : DEFAULT_SPEECH_PROFILE;
}

export default function App() {
  const socketRef = useRef(null);
  const chatBottomRef = useRef(null);
  const speechProfile = resolveSpeechProfile();
  const activePttKeyRef = useRef('');
  const processingCountRef = useRef(0);
  const isAiraSpeakingRef = useRef(false);

  const [isConnected, setIsConnected] = useState(false);
  const [serverTime, setServerTime] = useState('---');
  const [messages, setMessages] = useState([]);
  const [visualizerState, setVisualizerState] = useState(VISUALIZER_STATE.IDLE);
  const [chatInput, setChatInput] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  const lastProcessedFinalIdRef = useRef(null);
  const lastEmittedSpeechTextRef = useRef('');
  const lastEmittedSpeechAtRef = useRef(0);

  const [isWakeConfirmed, setIsWakeConfirmed] = useState(false);
  const [isSpeechBootReady, setIsSpeechBootReady] = useState(false);

  const { speak, cancel, isAiraSpeaking } = useVoiceSynthesis();

  const {
    isSupported,
    isListening,
    interimTranscript,
    finalResult,
    error,
    startPTT,
    stopPTT,
  } =
    useSpeech({
      enabled: isWakeConfirmed && isSpeechBootReady,
      profile: speechProfile,
    });

  function increaseProcessing() {
    processingCountRef.current += 1;
    setIsProcessing(true);
  }

  function decreaseProcessing() {
    processingCountRef.current = Math.max(0, processingCountRef.current - 1);
    setIsProcessing(processingCountRef.current > 0);
  }

  function handleWakeActivation() {
    setIsWakeConfirmed(true);
  }

  useEffect(() => {
    setIsSpeechBootReady(isWakeConfirmed);
  }, [isWakeConfirmed]);

  useEffect(() => {
    isAiraSpeakingRef.current = isAiraSpeaking;
  }, [isAiraSpeaking]);

  useEffect(() => {
    if (!socketRef.current) {
      socketRef.current = io(SOCKET_SERVER_URL, {
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionAttempts: 5,
        autoConnect: false,
      });
    }

    const socket = socketRef.current;

    function onConnect() {
      setIsConnected(true);
    }

    function onDisconnect() {
      setIsConnected(false);
    }

    function onConnectError(errorPayload) {
      setMessages((prev) => {
        const nextMessage = `Error de conexion Socket: ${errorPayload?.message || 'desconocido'}`;
        if (prev[0] === nextMessage) {
          return prev;
        }
        return [nextMessage, ...prev].slice(0, 12);
      });
    }

    function onServerReady(payload) {
      setMessages((prev) => [
        ...prev,
        `Servidor listo. Version: ${payload.version}`,
      ]);
    }

    function onHeartbeat(payload) {
      setServerTime(new Date(payload.timestamp).toLocaleTimeString());
    }

    function onSystemMessage(payload) {
      setMessages((prev) => [...prev, payload.message]);
    }

    function onAiraNudge(payload) {
      setMessages((prev) => [...prev, payload.message]);
      speak(String(payload?.message || '').trim());
    }

    function onAiraResponse(payload) {
      decreaseProcessing();
      const responseText = String(payload?.text || '').trim();
      if (!responseText) {
        return;
      }

      setMessages((prev) => [...prev, `Aira: ${responseText}`]);
      speak(responseText);
    }

    function onStopTts() {
      cancel();
    }

    setIsConnected(socket.connected);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('connect_error', onConnectError);
    socket.on('SERVER_READY', onServerReady);
    socket.on('HEARTBEAT', onHeartbeat);
    socket.on('SYSTEM_MESSAGE', onSystemMessage);
    socket.on('AIRA_NUDGE', onAiraNudge);
    socket.on('AIRA_RESPONSE', onAiraResponse);
    socket.on('STOP_TTS', onStopTts);

    socket.connect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('connect_error', onConnectError);
      socket.off('SERVER_READY', onServerReady);
      socket.off('HEARTBEAT', onHeartbeat);
      socket.off('SYSTEM_MESSAGE', onSystemMessage);
      socket.off('AIRA_NUDGE', onAiraNudge);
      socket.off('AIRA_RESPONSE', onAiraResponse);
      socket.off('STOP_TTS', onStopTts);
      socket.disconnect();
    };
  }, [speak, cancel]);

  useEffect(() => {
    if (isAiraSpeaking) {
      setVisualizerState(VISUALIZER_STATE.SPEAKING);
      return;
    }

    if (isListening) {
      setVisualizerState(VISUALIZER_STATE.LISTENING);
      return;
    }

    if (isProcessing) {
      setVisualizerState(VISUALIZER_STATE.PROCESSING);
      return;
    }

    setVisualizerState(VISUALIZER_STATE.IDLE);
  }, [isListening, isAiraSpeaking, isProcessing]);

  useEffect(() => {
    function onVoiceEngineMissing() {
      setMessages((prev) => {
        if (prev.includes(VOICE_ENGINE_MISSING_MESSAGE)) {
          return prev;
        }

        return [VOICE_ENGINE_MISSING_MESSAGE, ...prev].slice(0, 12);
      });
    }

    window.addEventListener('VOICE_ENGINE_MISSING', onVoiceEngineMissing);

    return () => {
      window.removeEventListener('VOICE_ENGINE_MISSING', onVoiceEngineMissing);
    };
  }, []);

  useEffect(() => {
    if (!finalResult || !finalResult.text) {
      return;
    }

    if (lastProcessedFinalIdRef.current === finalResult.id) {
      return;
    }

    lastProcessedFinalIdRef.current = finalResult.id;

    const normalizedSpeechText = String(finalResult.text || '').trim();
    const normalizedSpeechKey = normalizeSpeechKey(normalizedSpeechText);
    const now = Date.now();
    const isDuplicatedSpeech =
      normalizedSpeechKey === lastEmittedSpeechTextRef.current &&
      now - lastEmittedSpeechAtRef.current <= DUPLICATE_EMIT_WINDOW_MS;

    if (isDuplicatedSpeech) {
      return;
    }

    setMessages((prev) => [...prev, `Tu: ${normalizedSpeechText}`]);
    lastEmittedSpeechTextRef.current = normalizedSpeechKey;
    lastEmittedSpeechAtRef.current = now;

    if (!isConnected) {
      return;
    }

    increaseProcessing();
    socketRef.current?.emit('USER_INPUT', {
      content: normalizedSpeechText,
      fingerprint: `ptt:${normalizedSpeechKey}`,
      timestamp: now,
      metadata: {
        source: 'ptt',
        interrupt_active_tts: isAiraSpeakingRef.current,
      },
    });
  }, [finalResult, isConnected]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  function sendTextMessage(rawText) {
    const text = String(rawText || '').trim();
    if (!text) {
      return;
    }

    const now = Date.now();
    setMessages((prev) => [...prev, `Tu: ${text}`]);
    setChatInput('');

    if (!isConnected) {
      return;
    }

    const normalizedKey = normalizeSpeechKey(text);
    increaseProcessing();
    socketRef.current?.emit('USER_INPUT', {
      content: text,
      fingerprint: `keyboard:${normalizedKey}`,
      timestamp: now,
      metadata: {
        source: 'keyboard',
        interrupt_active_tts: isAiraSpeakingRef.current,
      },
    });
  }

  function handleInputKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      sendTextMessage(chatInput);
    }
  }

  useEffect(() => {
    function isEditableTarget(target) {
      if (!target || !(target instanceof HTMLElement)) {
        return false;
      }

      const tagName = target.tagName.toLowerCase();
      return (
        target.isContentEditable ||
        tagName === 'input' ||
        tagName === 'textarea' ||
        tagName === 'select'
      );
    }

    function emitInterrupt(source) {
      if (!isConnected || !socketRef.current) {
        return;
      }

      socketRef.current.emit('USER_INPUT', {
        content: '',
        fingerprint: `interrupt:${source}:${Date.now()}`,
        timestamp: Date.now(),
        metadata: {
          source,
          interrupt_active_tts: true,
        },
      });
    }

    function onKeyDown(event) {
      const isPttKey = event.code === 'Space' || event.code === 'AltLeft' || event.code === 'AltRight';
      if (!isPttKey || event.repeat || activePttKeyRef.current) {
        return;
      }

      if (isEditableTarget(event.target)) {
        return;
      }

      event.preventDefault();
      activePttKeyRef.current = event.code;

      if (isAiraSpeakingRef.current) {
        cancel();
        emitInterrupt('ptt');
      }

      startPTT();
    }

    function onKeyUp(event) {
      if (!activePttKeyRef.current || event.code !== activePttKeyRef.current) {
        return;
      }

      event.preventDefault();
      activePttKeyRef.current = '';
      stopPTT();
    }

    function onWindowBlur() {
      if (!activePttKeyRef.current) {
        return;
      }

      activePttKeyRef.current = '';
      stopPTT();
    }

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onWindowBlur);

    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onWindowBlur);
    };
  }, [isConnected, startPTT, stopPTT, cancel]);

  function sendPing() {
    socketRef.current?.emit('CLIENT_PING', {
      at: Date.now(),
      from: 'client-ui',
    });
  }

  const isFatalSpeechError = typeof error === 'string' && error.startsWith('FATAL_ERROR');

  return (
    <main className="app-shell">
      <section className="panel panel-left">
        <h1>Aira IA</h1>
        <p className="subtitle">Avatar reactivo en tiempo real</p>

        <Visualizer state={visualizerState} volume={0.18} />

        <div className="avatar-state" aria-live="polite">
          Estado: <strong>{visualizerState}</strong>
        </div>
      </section>

      <section className="panel panel-right">
        <h2 className="panel-title">Chat con Aira</h2>

        <div className="status-row">
          <span className={`status-dot ${isConnected ? 'ok' : 'off'}`} />
          <span>{isConnected ? 'Conectado al servidor' : 'Sin conexion'}</span>
        </div>

        <div className="status-row">
          <span className={`status-dot ${isListening ? 'ok' : isProcessing ? 'processing' : 'off'}`} />
          <span>
            {isSupported
              ? isFatalSpeechError
                ? 'FATAL_ERROR'
                : isListening
                  ? 'Escuchando microfono'
                  : isProcessing
                    ? 'Procesando consulta'
                  : !isWakeConfirmed
                    ? 'Pendiente de activacion'
                    : isSpeechBootReady
                      ? 'Reconocimiento en pausa'
                      : 'Inicializando canal de voz...'
              : 'Web Speech API no disponible'}
          </span>
        </div>

        <p className="server-time">Heartbeat del servidor: {serverTime}</p>
        {error && <p className="speech-error">{error}</p>}

        <section className="chat-container" aria-live="polite">
          {messages.length === 0 && (
            <article className="chat-bubble chat-bubble-aira">
              Hola, soy Aira. Escribe tu consulta o presiona el microfono.
            </article>
          )}

          {messages.map((message, index) => {
            const isUser = message.startsWith('Tu:');
            const bubbleClass = isUser ? 'chat-bubble-user' : 'chat-bubble-aira';
            const visibleMessage = isUser
              ? message.replace(/^Tu:\s*/, '')
              : message.replace(/^Aira:\s*/, '');

            return (
              <article className={`chat-bubble ${bubbleClass}`} key={`${message}-${index}`}>
                {visibleMessage}
              </article>
            );
          })}

          <div ref={chatBottomRef} />
        </section>

        <section className="control-bar" aria-label="Entrada multimodal">
          <button className="icon-btn add-media" type="button" onClick={sendPing}>
            +
          </button>

          <textarea
            className="chat-input"
            placeholder="Hola, que haremos hoy?"
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={handleInputKeyDown}
            rows={1}
          />

          <div className="action-buttons">
            <button
              className="icon-btn send-btn"
              type="button"
              onClick={() => sendTextMessage(chatInput)}
              aria-label="Enviar mensaje"
            >
              🚀
            </button>
            <button
              className={`icon-btn mic-btn ${isListening ? 'listening' : ''}`}
              type="button"
              onMouseDown={() => {
                if (isAiraSpeakingRef.current) {
                  cancel();
                }
                startPTT();
              }}
              onMouseUp={stopPTT}
              onMouseLeave={stopPTT}
              onTouchStart={(event) => {
                event.preventDefault();
                if (isAiraSpeakingRef.current) {
                  cancel();
                }
                startPTT();
              }}
              onTouchEnd={stopPTT}
              aria-label={isListening ? 'Listening' : 'Push to Talk'}
            >
              🎙️
            </button>
          </div>
        </section>

        <p className="voice-hint">
          {isListening
            ? 'PTT activo: suelta Space o Alt para enviar voz.'
            : interimTranscript || 'Pulsa Enter para enviar. Shift + Enter agrega salto de linea.'}
        </p>
      </section>

      {!isWakeConfirmed && (
        <div className="wake-overlay" role="dialog" aria-modal="true">
          <div className="wake-card">
            <h2>Activar Aira</h2>
            <p>
              Haz clic para habilitar microfono y canal de voz.
            </p>
            <button type="button" onClick={handleWakeActivation}>
              Hacer clic para activar a Aira
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
