import { useEffect, useRef, useState } from 'react';

const PRIMARY_SPEECH_LANG = 'es-MX';
const DEFAULT_SPEECH_PROFILE = 'stable';

const SPEECH_PROFILES = {
  stable: {
    recoveryIntervalMs: 9000,
    quickRestartMs: 2200,
    noSpeechRestartMs: 1600,
    maxNetworkRetries: 3,
    networkBackoffMs: [7000, 12000],
    finalResultDedupWindowMs: 3000,
  },
  aggressive: {
    recoveryIntervalMs: 4500,
    quickRestartMs: 1000,
    noSpeechRestartMs: 900,
    maxNetworkRetries: 3,
    networkBackoffMs: [5000, 10000],
    finalResultDedupWindowMs: 1600,
  },
};

function resolveSpeechProfile(profileName) {
  const normalizedProfile = String(profileName || '').toLowerCase();
  return SPEECH_PROFILES[normalizedProfile] || SPEECH_PROFILES[DEFAULT_SPEECH_PROFILE];
}

export default function useSpeech(options = {}) {
  const { enabled = true, paused = false, profile = DEFAULT_SPEECH_PROFILE } = options;
  const profileConfig = resolveSpeechProfile(profile);

  const recognitionRef = useRef(null);
  const shouldRestartRef = useRef(true);
  const restartTimeoutRef = useRef(null);
  const recoveryIntervalRef = useRef(null);
  const enabledRef = useRef(enabled);
  const pausedRef = useRef(paused);
  const temporaryPauseRef = useRef(false);
  const isListeningRef = useRef(false);
  const networkRetryCountRef = useRef(0);
  const disposedRef = useRef(false);
  const startRecognitionRef = useRef(() => {});
  const lastFinalTextRef = useRef('');
  const lastFinalAtRef = useRef(0);

  const [isSupported, setIsSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalResult, setFinalResult] = useState(null);
  const [error, setError] = useState('');

  function emitVoiceEngineMissing(reason) {
    window.dispatchEvent(
      new CustomEvent('VOICE_ENGINE_MISSING', {
        detail: {
          reason,
          attempts: 1,
        },
      })
    );
  }

  function clearRestartTimeout() {
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
  }

  function clearRecoveryInterval() {
    if (recoveryIntervalRef.current) {
      clearInterval(recoveryIntervalRef.current);
      recoveryIntervalRef.current = null;
    }
  }

  function hardResetRecognition() {
    const previousRecognition = recognitionRef.current;

    if (previousRecognition) {
      previousRecognition.onstart = null;
      previousRecognition.onaudiostart = null;
      previousRecognition.onsoundstart = null;
      previousRecognition.onresult = null;
      previousRecognition.onerror = null;
      previousRecognition.onspeechend = null;
      previousRecognition.onend = null;

      try {
        previousRecognition.stop();
      } catch {
        // Ignore stop errors when recognition is already stopped.
      }

      try {
        previousRecognition.abort();
      } catch {
        // Ignore abort errors while forcing cleanup.
      }
    }

    recognitionRef.current = null;
  }

  function scheduleRestart(startRecognition, delayMs = profileConfig.quickRestartMs) {
    if (!shouldRestartRef.current || !enabledRef.current || pausedRef.current || disposedRef.current) {
      return;
    }

    clearRestartTimeout();

    restartTimeoutRef.current = setTimeout(() => {
      restartTimeoutRef.current = null;
      startRecognition();
    }, delayMs);
  }

  function createRecognition(startRecognition) {
    const NativeSpeechRecognition = window.webkitSpeechRecognition || window.SpeechRecognition;
    if (!NativeSpeechRecognition) {
      setIsSupported(false);
      setError('Motor de voz no disponible en este entorno.');
      emitVoiceEngineMissing('engine-constructor-missing');
      return null;
    }

    let recognition = null;

    try {
      recognition = new NativeSpeechRecognition();
    } catch {
      setIsSupported(false);
      setError('Motor de voz no disponible en este entorno.');
      emitVoiceEngineMissing('engine-constructor-failed');
      return null;
    }

    recognition.lang = PRIMARY_SPEECH_LANG;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onstart = () => {
      setIsListening(true);
      isListeningRef.current = true;
      temporaryPauseRef.current = false;
      setError('');
    };

    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';

      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        const transcript = result[0]?.transcript || '';

        if (result.isFinal) {
          finalText += transcript;
        } else {
          interim += transcript;
        }
      }

      setInterimTranscript(interim.trim());

      const normalizedFinal = finalText.trim();
      if (normalizedFinal) {
        const normalizedKey = normalizedFinal.toLowerCase();
        const now = Date.now();
        const isDuplicatedFinal =
          normalizedKey === lastFinalTextRef.current &&
          now - lastFinalAtRef.current <= profileConfig.finalResultDedupWindowMs;

        if (isDuplicatedFinal) {
          return;
        }

        lastFinalTextRef.current = normalizedKey;
        lastFinalAtRef.current = now;
        networkRetryCountRef.current = 0;
        setFinalResult({
          id: now,
          text: normalizedFinal,
        });
        setInterimTranscript('');
      }
    };

    recognition.onerror = (event) => {
      const errorCode = event?.error || 'unknown';

      if (!shouldRestartRef.current || !enabledRef.current) {
        return;
      }

      if (errorCode === 'aborted' && (pausedRef.current || temporaryPauseRef.current)) {
        return;
      }

      if (errorCode === 'network') {
        networkRetryCountRef.current += 1;
        const currentNetworkRetry = networkRetryCountRef.current;

        if (currentNetworkRetry >= profileConfig.maxNetworkRetries) {
          shouldRestartRef.current = false;
          clearRestartTimeout();
          setIsListening(false);
          isListeningRef.current = false;
          setError('FATAL_ERROR: Error de red de voz tras 3 intentos. Reinicia la aplicacion.');
          hardResetRecognition();
          return;
        }

        const backoffDelayMs = profileConfig.networkBackoffMs[Math.min(currentNetworkRetry - 1, profileConfig.networkBackoffMs.length - 1)];
        setError(`Reconocimiento de voz inestable. Reintento ${currentNetworkRetry} en ${Math.round(backoffDelayMs / 1000)} segundos...`);
        scheduleRestart(startRecognition, backoffDelayMs);
        return;
      }

      if (errorCode === 'no-speech') {
        setError('Sin voz detectada. Reintentando...');
        scheduleRestart(startRecognition, profileConfig.noSpeechRestartMs);
        return;
      }

      setError(`Error de reconocimiento: ${errorCode}`);
      scheduleRestart(startRecognition, profileConfig.quickRestartMs);
    };

    recognition.onend = () => {
      setIsListening(false);
      isListeningRef.current = false;

      if (!shouldRestartRef.current || !enabledRef.current || pausedRef.current || temporaryPauseRef.current) {
        return;
      }

      if (restartTimeoutRef.current) {
        return;
      }

      scheduleRestart(startRecognition, profileConfig.quickRestartMs);
    };

    return recognition;
  }

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    pausedRef.current = paused;

    if (!enabledRef.current) {
      return;
    }

    if (paused) {
      temporaryPauseRef.current = true;
      hardResetRecognition();
      setIsListening(false);
      return;
    }

    if (shouldRestartRef.current) {
      startRecognitionRef.current();
    }
  }, [paused, enabled]);

  useEffect(() => {
    async function requestMicrophonePermission() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch {
        setError('No se pudo acceder al microfono. Revisa permisos.');
      }
    }

    function startRecognition() {
      if (!enabledRef.current || pausedRef.current || !shouldRestartRef.current || disposedRef.current) {
        return;
      }

      temporaryPauseRef.current = false;
      hardResetRecognition();

      const recognition = createRecognition(startRecognition);
      if (!recognition) {
        return;
      }

      recognitionRef.current = recognition;

      try {
        recognition.start();
      } catch {
        setError('No se pudo iniciar el reconocimiento de voz. Reintentando...');
        scheduleRestart(startRecognition, profileConfig.quickRestartMs);
      }
    }

    startRecognitionRef.current = startRecognition;

    if (!enabled) {
      shouldRestartRef.current = false;
      clearRestartTimeout();
      clearRecoveryInterval();
      hardResetRecognition();
      startRecognitionRef.current = () => {};
      setIsListening(false);
      isListeningRef.current = false;
      return undefined;
    }

    disposedRef.current = false;
    shouldRestartRef.current = true;
    setIsSupported(true);
    networkRetryCountRef.current = 0;

    recoveryIntervalRef.current = setInterval(() => {
      if (!enabledRef.current || pausedRef.current || isListeningRef.current || !shouldRestartRef.current) {
        return;
      }

      startRecognition();
    }, profileConfig.recoveryIntervalMs);

    requestMicrophonePermission().finally(() => {
      if (!disposedRef.current && enabledRef.current && !pausedRef.current) {
        startRecognition();
      }
    });

    return () => {
      disposedRef.current = true;
      shouldRestartRef.current = false;
      clearRestartTimeout();
      clearRecoveryInterval();
      hardResetRecognition();
      startRecognitionRef.current = () => {};
    };
  }, [enabled, profileConfig]);

  return {
    isSupported,
    isListening,
    interimTranscript,
    finalResult,
    error,
  };
}
