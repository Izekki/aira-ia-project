import { useCallback, useEffect, useRef, useState } from 'react';

const PRIMARY_SPEECH_LANG = 'es-MX';
const FALLBACK_SPEECH_LANG = 'es-ES';
const DUPLICATE_FINAL_WINDOW_MS = 6000;

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
  const { enabled = true } = options;

  const recognitionRef = useRef(null);
  const enabledRef = useRef(enabled);
  const isPttActiveRef = useRef(false);
  const isListeningRef = useRef(false);
  const speechLangRef = useRef(PRIMARY_SPEECH_LANG);
  const lastFinalSpeechKeyRef = useRef('');
  const lastFinalSpeechAtRef = useRef(0);
  const processingBridgeTimeoutRef = useRef(null);

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
    if (!enabled) {
      isPttActiveRef.current = false;
      setIsPttProcessingBridge(false);

      if (processingBridgeTimeoutRef.current) {
        clearTimeout(processingBridgeTimeoutRef.current);
      }

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore stop errors while disabling speech.
        }
      }

      setIsListening(false);
      return undefined;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsSupported(false);
      setError('Tu entorno no soporta reconocimiento de voz.');
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
    };

    recognitionRef.current = recognition;

    requestMicrophonePermission();

    return () => {
      disposed = true;
      isPttActiveRef.current = false;
      setIsPttProcessingBridge(false);

      if (processingBridgeTimeoutRef.current) {
        clearTimeout(processingBridgeTimeoutRef.current);
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
  }, [enabled]);

  const startPTT = useCallback(() => {
    if (!enabledRef.current || !recognitionRef.current) {
      return false;
    }

    isPttActiveRef.current = true;
    setIsPttProcessingBridge(false);
    setInterimTranscript('');
    setError('');

    // Hard-set runtime params before each capture to avoid stale recognizer config.
    recognitionRef.current.lang = PRIMARY_SPEECH_LANG;
    recognitionRef.current.interimResults = true;
    recognitionRef.current.continuous = false;

    try {
      recognitionRef.current.start();
      return true;
    } catch {
      return false;
    }
  }, []);

  const stopPTT = useCallback(() => {
    if (!recognitionRef.current) {
      return;
    }

    isPttActiveRef.current = false;
    setIsPttProcessingBridge(true);

    if (processingBridgeTimeoutRef.current) {
      clearTimeout(processingBridgeTimeoutRef.current);
    }

    processingBridgeTimeoutRef.current = setTimeout(() => {
      setIsPttProcessingBridge(false);
    }, 1600);

    try {
      recognitionRef.current.stop();
    } catch {
      // Ignore stop errors when recognition is already stopped.
    }
  }, []);

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
