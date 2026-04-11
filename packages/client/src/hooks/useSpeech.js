import { useCallback, useEffect, useRef, useState } from 'react';

const PRIMARY_SPEECH_LANG = 'es-MX';
const FALLBACK_SPEECH_LANG = 'es-ES';
const DUPLICATE_FINAL_WINDOW_MS = 6000;
const AUTO_STOP_AFTER_FINAL_FALLBACK_MS = 700;
const AUTO_STOP_SESSION_FALLBACK_MS = 18000;

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

export default function useSpeech(options = {}) {
  const {
    enabled = true,
    wakeAutoStopAfterFinalMs = AUTO_STOP_AFTER_FINAL_FALLBACK_MS,
    wakeMaxSessionMs = AUTO_STOP_SESSION_FALLBACK_MS,
  } = options;

  const recognitionRef = useRef(null);
  const enabledRef = useRef(enabled);
  const isPttActiveRef = useRef(false);
  const isListeningRef = useRef(false);
  const speechLangRef = useRef(PRIMARY_SPEECH_LANG);
  const lastFinalSpeechKeyRef = useRef('');
  const lastFinalSpeechAtRef = useRef(0);
  const processingBridgeTimeoutRef = useRef(null);
  const restartRecognitionTimeoutRef = useRef(null);
  const autoStopAfterFinalTimeoutRef = useRef(null);
  const maxSessionTimeoutRef = useRef(null);
  const pttAutoStopOnFinalRef = useRef(false);
  const wakeAutoStopAfterFinalMsRef = useRef(wakeAutoStopAfterFinalMs);
  const wakeMaxSessionMsRef = useRef(wakeMaxSessionMs);

  const [isSupported, setIsSupported] = useState(true);
  const [isListening, setIsListening] = useState(false);
  const [interimTranscript, setInterimTranscript] = useState('');
  const [finalResult, setFinalResult] = useState(null);
  const [error, setError] = useState('');
  const [isPttProcessingBridge, setIsPttProcessingBridge] = useState(false);

  useEffect(() => {
    isListeningRef.current = isListening;
  }, [isListening]);

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    const parsed = Number(wakeAutoStopAfterFinalMs);
    wakeAutoStopAfterFinalMsRef.current = Number.isFinite(parsed)
      ? Math.max(120, parsed)
      : AUTO_STOP_AFTER_FINAL_FALLBACK_MS;
  }, [wakeAutoStopAfterFinalMs]);

  useEffect(() => {
    const parsed = Number(wakeMaxSessionMs);
    wakeMaxSessionMsRef.current = Number.isFinite(parsed)
      ? Math.max(2000, parsed)
      : AUTO_STOP_SESSION_FALLBACK_MS;
  }, [wakeMaxSessionMs]);

  const clearWakeAutoStopTimers = useCallback(() => {
    if (autoStopAfterFinalTimeoutRef.current) {
      clearTimeout(autoStopAfterFinalTimeoutRef.current);
      autoStopAfterFinalTimeoutRef.current = null;
    }

    if (maxSessionTimeoutRef.current) {
      clearTimeout(maxSessionTimeoutRef.current);
      maxSessionTimeoutRef.current = null;
    }
  }, []);

  const stopPttCapture = useCallback(() => {
    isPttActiveRef.current = false;
    pttAutoStopOnFinalRef.current = false;
    setIsPttProcessingBridge(true);
    clearWakeAutoStopTimers();

    if (processingBridgeTimeoutRef.current) {
      clearTimeout(processingBridgeTimeoutRef.current);
    }

    if (restartRecognitionTimeoutRef.current) {
      clearTimeout(restartRecognitionTimeoutRef.current);
      restartRecognitionTimeoutRef.current = null;
    }

    processingBridgeTimeoutRef.current = setTimeout(() => {
      setIsPttProcessingBridge(false);
    }, 1600);

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors when recognition is already stopped.
      }
    }
  }, [clearWakeAutoStopTimers]);

  useEffect(() => {
    if (!enabled) {
      stopPttCapture();
      setIsPttProcessingBridge(false);

      if (processingBridgeTimeoutRef.current) {
        clearTimeout(processingBridgeTimeoutRef.current);
      }
      if (restartRecognitionTimeoutRef.current) {
        clearTimeout(restartRecognitionTimeoutRef.current);
        restartRecognitionTimeoutRef.current = null;
      }

      setIsListening(false);
      return undefined;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      setError('Reconocimiento de voz por navegador no disponible. El sistema usa el backend para STT.');
      return undefined;
    }

    let disposed = false;

    async function requestMicrophonePermission() {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
      } catch (micError) {
        if (!disposed) {
          setError('No se pudo acceder al microfono. Revisa permisos.');
        }
      }
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = speechLangRef.current;
    console.log('[useSpeech] recognition configured', {
      continuous: recognition.continuous,
      interimResults: recognition.interimResults,
      lang: recognition.lang,
    });

    recognition.onstart = () => {
      console.log('[useSpeech] onstart', { lang: recognition.lang });
      setIsListening(true);
      isListeningRef.current = true;
      setError('');
    };

    recognition.onaudiostart = () => {
      console.log('[useSpeech] onaudiostart');
    };

    recognition.onsoundstart = () => {
      console.log('[useSpeech] onsoundstart');
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

      console.log('[useSpeech] onresult', {
        resultIndex: event.resultIndex,
        resultCount: event.results.length,
      });

      setInterimTranscript(interim.trim());

      if (interim.trim() && autoStopAfterFinalTimeoutRef.current) {
        clearTimeout(autoStopAfterFinalTimeoutRef.current);
        autoStopAfterFinalTimeoutRef.current = null;
      }

      const normalizedFinal = finalText.trim();
      if (normalizedFinal) {
        const speechKey = normalizeSpeechKey(normalizedFinal);
        const now = Date.now();
        const isDuplicateFinal =
          speechKey &&
          speechKey === lastFinalSpeechKeyRef.current &&
          now - lastFinalSpeechAtRef.current <= DUPLICATE_FINAL_WINDOW_MS;

        if (isDuplicateFinal) {
          return;
        }

        if (processingBridgeTimeoutRef.current) {
          clearTimeout(processingBridgeTimeoutRef.current);
        }
        setIsPttProcessingBridge(false);

        lastFinalSpeechKeyRef.current = speechKey;
        lastFinalSpeechAtRef.current = now;
        setFinalResult({
          id: now,
          text: normalizedFinal,
        });
        setInterimTranscript('');

        if (pttAutoStopOnFinalRef.current) {
          if (autoStopAfterFinalTimeoutRef.current) {
            clearTimeout(autoStopAfterFinalTimeoutRef.current);
          }

          autoStopAfterFinalTimeoutRef.current = setTimeout(() => {
            autoStopAfterFinalTimeoutRef.current = null;
            stopPttCapture();
          }, wakeAutoStopAfterFinalMsRef.current);
        }
      }
    };

    recognition.onerror = (event) => {
      console.log('[useSpeech] onerror', {
        error: event.error,
        message: event.message,
        lang: recognition.lang,
      });

      if (
        event.error === 'language-not-supported' &&
        speechLangRef.current !== FALLBACK_SPEECH_LANG
      ) {
        speechLangRef.current = FALLBACK_SPEECH_LANG;
        recognition.lang = speechLangRef.current;
        console.log('[useSpeech] language fallback', {
          nextLang: speechLangRef.current,
        });
      }

      const nextError =
        event.error === 'aborted'
          ? ''
          : event.error === 'not-allowed' || event.error === 'service-not-allowed'
            ? 'No se pudo acceder al microfono. Revisa permisos.'
            : `Error de reconocimiento: ${event.error}`;

      setError(nextError);
      pttAutoStopOnFinalRef.current = false;
      clearWakeAutoStopTimers();
      setIsPttProcessingBridge(false);
    };

    recognition.onspeechend = () => {
      console.log('[useSpeech] onspeechend');
      // Keep recognizer alive in continuous mode.
    };

    recognition.onend = () => {
      console.log('[useSpeech] onend', {
        pttActive: isPttActiveRef.current,
      });
      setIsListening(false);
      isListeningRef.current = false;

      // Auto-restart if PTT key/button remains pressed.
      if (isPttActiveRef.current && enabledRef.current && !disposed) {
        if (restartRecognitionTimeoutRef.current) {
          clearTimeout(restartRecognitionTimeoutRef.current);
        }
        restartRecognitionTimeoutRef.current = setTimeout(() => {
          if (!isPttActiveRef.current || !enabledRef.current || !recognitionRef.current) {
            return;
          }

          try {
            recognitionRef.current.start();
          } catch {
            // Ignore restart race errors.
          }
        }, 120);
      }
    };

    recognitionRef.current = recognition;

    requestMicrophonePermission();

    return () => {
      disposed = true;
      pttAutoStopOnFinalRef.current = false;
      setIsPttProcessingBridge(false);
      clearWakeAutoStopTimers();

      if (processingBridgeTimeoutRef.current) {
        clearTimeout(processingBridgeTimeoutRef.current);
      }
      if (restartRecognitionTimeoutRef.current) {
        clearTimeout(restartRecognitionTimeoutRef.current);
        restartRecognitionTimeoutRef.current = null;
      }

      if (recognitionRef.current) {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onaudiostart = null;
        recognitionRef.current.onsoundstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onspeechend = null;
        recognitionRef.current.onend = null;

        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore stop errors during unmount.
        }
      }

      recognitionRef.current = null;
    };
  }, [enabled, clearWakeAutoStopTimers, stopPttCapture]);

  const startPTT = useCallback((startOptions = {}) => {
    if (!enabledRef.current || !recognitionRef.current) {
      return false;
    }

    const autoStopOnFinal = Boolean(startOptions?.autoStopOnFinal);
    const autoStopDelay = Number(startOptions?.autoStopAfterFinalMs);
    const maxSessionMs = Number(startOptions?.maxSessionMs);

    // Reset state for fresh capture
    isPttActiveRef.current = true;
    pttAutoStopOnFinalRef.current = autoStopOnFinal;
    clearWakeAutoStopTimers();

    wakeAutoStopAfterFinalMsRef.current = Number.isFinite(autoStopDelay)
      ? Math.max(120, autoStopDelay)
      : wakeAutoStopAfterFinalMsRef.current;

    if (autoStopOnFinal || Number.isFinite(maxSessionMs)) {
      const effectiveMaxSessionMs = Number.isFinite(maxSessionMs)
        ? Math.max(2000, maxSessionMs)
        : wakeMaxSessionMsRef.current;

      maxSessionTimeoutRef.current = setTimeout(() => {
        if (isPttActiveRef.current) {
          stopPttCapture();
        }
      }, effectiveMaxSessionMs);
    }

    setIsPttProcessingBridge(false);
    setInterimTranscript('');
    setFinalResult(null);
    setError('');

    // Hard-set runtime params before each capture to avoid stale recognizer config.
    recognitionRef.current.lang = PRIMARY_SPEECH_LANG;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.continuous = false;

    if (restartRecognitionTimeoutRef.current) {
      clearTimeout(restartRecognitionTimeoutRef.current);
      restartRecognitionTimeoutRef.current = null;
    }

    if (isListeningRef.current) {
      return true;
    }

    try {
      recognitionRef.current.start();
      return true;
    } catch (startError) {
      const errorName = String(startError?.name || '').toLowerCase();
      const errorMessage = String(startError?.message || '').toLowerCase();
      const blockedByPermission =
        errorName.includes('notallowed') ||
        errorName.includes('security') ||
        errorMessage.includes('not allowed') ||
        errorMessage.includes('permission');

      if (blockedByPermission) {
        setError('Wake word detectada, pero el navegador bloqueo el microfono/PTT. Revisa permisos.');
        return false;
      }

      restartRecognitionTimeoutRef.current = setTimeout(() => {
        if (!isPttActiveRef.current || !enabledRef.current || !recognitionRef.current) {
          return;
        }

        try {
          recognitionRef.current.start();
        } catch {
          // Ignore retry race errors.
        }
      }, 120);
      return true;
    }
  }, [clearWakeAutoStopTimers, stopPttCapture]);

  const stopPTT = useCallback(() => {
    stopPttCapture();
  }, [stopPttCapture]);

  return {
    isSupported,
    isListening,
    interimTranscript,
    finalResult,
    error,
    isPttProcessingBridge,
    startPTT,
    stopPTT,
  };
}
