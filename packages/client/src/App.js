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
  SPEAKING: 'SPEAKING',
};

const DEFAULT_SPEECH_PROFILE = 'stable';

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
  const speechProfile = resolveSpeechProfile();

  const [isConnected, setIsConnected] = useState(false);
  const [serverTime, setServerTime] = useState('---');
  const [messages, setMessages] = useState([]);
  const [transcriptHistory, setTranscriptHistory] = useState([]);
  const [visualizerState, setVisualizerState] = useState(VISUALIZER_STATE.IDLE);

  const lastProcessedFinalIdRef = useRef(null);
  const lastEmittedSpeechTextRef = useRef('');
  const lastEmittedSpeechAtRef = useRef(0);

  const [isWakeConfirmed, setIsWakeConfirmed] = useState(false);
  const [isSpeechBootReady, setIsSpeechBootReady] = useState(false);

  const { speak, isAiraSpeaking } = useVoiceSynthesis();

  const { isSupported, isListening, interimTranscript, finalResult, error } =
    useSpeech({
      enabled: isWakeConfirmed && isSpeechBootReady,
      paused: isAiraSpeaking,
      profile: speechProfile,
    });

  function handleWakeActivation() {
    setIsWakeConfirmed(true);
  }

  useEffect(() => {
    setIsSpeechBootReady(isWakeConfirmed);
  }, [isWakeConfirmed]);

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
      const responseText = String(payload?.text || '').trim();
      if (!responseText) {
        return;
      }

      setMessages((prev) => [...prev, `Aira: ${responseText}`]);
      speak(responseText);
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
      socket.disconnect();
    };
  }, [speak]);

  useEffect(() => {
    if (isAiraSpeaking) {
      setVisualizerState(VISUALIZER_STATE.SPEAKING);
      return;
    }

    if (isListening) {
      setVisualizerState(VISUALIZER_STATE.LISTENING);
      return;
    }

    setVisualizerState(VISUALIZER_STATE.IDLE);
  }, [isListening, isAiraSpeaking]);

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

    lastProcessedFinalIdRef.current = finalResult.id;

    const normalizedSpeechText = String(finalResult.text || '').trim();
    const normalizedSpeechKey = normalizedSpeechText.toLowerCase();
    const now = Date.now();
    const isDuplicatedSpeech =
      normalizedSpeechKey === lastEmittedSpeechTextRef.current &&
      now - lastEmittedSpeechAtRef.current <= 2800;

    if (isDuplicatedSpeech) {
      return;
    }

    setTranscriptHistory((prev) => [normalizedSpeechText, ...prev].slice(0, 8));

    if (!isConnected) {
      return;
    }

    lastEmittedSpeechTextRef.current = normalizedSpeechKey;
    lastEmittedSpeechAtRef.current = now;

    socketRef.current?.emit('USER_INPUT', {
      text: normalizedSpeechText,
      timestamp: now,
      source: 'speech',
    });
  }, [finalResult, isConnected]);

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
        <h2 className="panel-title">Canal de voz y eventos</h2>

        <div className="status-row">
          <span className={`status-dot ${isConnected ? 'ok' : 'off'}`} />
          <span>{isConnected ? 'Conectado al servidor' : 'Sin conexion'}</span>
        </div>

        <div className="status-row">
          <span className={`status-dot ${isListening ? 'ok' : 'off'}`} />
          <span>
            {isSupported
              ? isFatalSpeechError
                ? 'FATAL_ERROR'
                : isListening
                  ? 'Escuchando microfono'
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

        <section className="transcript-box" aria-live="polite">
          <h2>Transcripcion</h2>
          <p className="interim-text">
            {interimTranscript || 'Esperando voz del usuario...'}
          </p>

          <ul className="transcript-history">
            {transcriptHistory.length === 0 && (
              <li>Aun no hay frases finales detectadas.</li>
            )}
            {transcriptHistory.map((line, index) => (
              <li key={`${line}-${index}`}>{line}</li>
            ))}
          </ul>
        </section>

        <button type="button" onClick={sendPing} disabled={!isConnected}>
          Enviar ping
        </button>

        <ul className="messages">
          {messages.length === 0 && <li>Esperando eventos del servidor...</li>}
          {messages.map((message, index) => (
            <li key={`${message}-${index}`}>{message}</li>
          ))}
        </ul>
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
