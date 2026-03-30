import { useEffect, useRef, useState } from 'react';

// ============================================================================
// Importar configuración centralizada desde packages/config
// ============================================================================
// Si quieres cambiar la wake word, sensibilidad, idioma, etc., edita:
// packages/config/voice-detection-config.js
// ============================================================================
let VOICE_CONFIG = null;

// Intenta cargar desde el objeto global (si fue inyectado)
if (typeof window !== 'undefined' && window.VOICE_DETECTION_CONFIG) {
  VOICE_CONFIG = window.VOICE_DETECTION_CONFIG;
}

// Fallback: configuración por defecto si no está disponible
if (!VOICE_CONFIG) {
  VOICE_CONFIG = {
    WAKE_WORDS_CONFIG: { client: { default: ['aira'], language: 'es-MX' } },
    CONFIDENCE_THRESHOLDS: { client: { minConfidence: 0.2 } },
    TIMING_CONFIG: { detectionCooldownMs: { client: 1500 } },
    DEBUG_CONFIG: { enableDetailedLogs: false },
  };
}

const DEFAULT_WAKE_WORDS = VOICE_CONFIG.WAKE_WORDS_CONFIG?.client?.default || ['aira'];
const PRIMARY_SPEECH_LANG = VOICE_CONFIG.WAKE_WORDS_CONFIG?.client?.language || 'es-MX';
const DETECTION_COOLDOWN_MS = VOICE_CONFIG.TIMING_CONFIG?.detectionCooldownMs?.client || 1500;
const DEFAULT_MIN_CONFIDENCE = VOICE_CONFIG.CONFIDENCE_THRESHOLDS?.client?.minConfidence || 0.2;

function isDebugEnabled() {
  if (typeof window === 'undefined') {
    return false;
  }

  try {
    return window.localStorage?.getItem('AIRA_WAKEWORD_DEBUG') === '1';
  } catch {
    return false;
  }
}

function normalize(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function canonicalizeWakeVariants(value) {
  const normalized = normalize(value);
  if (!normalized) {
    return '';
  }

  // Variantes tipicas de transcripcion en es-MX para "AIRA".
  return normalized
    .replace(/\bhey\s+aira\b/gu, 'aira')
    .replace(/\baira\s+ia\b/gu, 'aira')
    .replace(/\beyra\b/gu, 'aira')
    .replace(/\beira\b/gu, 'aira');
}

function isWordBoundary(value, index, length) {
  const before = index === 0 ? ' ' : value[index - 1];
  const afterIndex = index + length;
  const after = afterIndex >= value.length ? ' ' : value[afterIndex];
  return before === ' ' && after === ' ';
}

function findWakeWordMatch(normalizedTranscript, wakeWords) {
  let bestMatch = null;

  wakeWords.forEach((wakeWord) => {
    let fromIndex = 0;
    while (fromIndex < normalizedTranscript.length) {
      const matchIndex = normalizedTranscript.indexOf(wakeWord, fromIndex);
      if (matchIndex < 0) {
        break;
      }

      if (isWordBoundary(normalizedTranscript, matchIndex, wakeWord.length)) {
        const nextMatch = {
          wakeWord,
          index: matchIndex,
          end: matchIndex + wakeWord.length,
        };

        if (!bestMatch || nextMatch.index >= bestMatch.index) {
          bestMatch = nextMatch;
        }
      }

      fromIndex = matchIndex + wakeWord.length;
    }
  });

  return bestMatch;
}

function extractWakeCommand(normalizedTranscript, wakeWordMatch) {
  if (!wakeWordMatch) {
    return '';
  }

  let command = normalizedTranscript.slice(wakeWordMatch.end).trim();
  command = command.replace(/^[^\p{L}\p{N}]+/gu, '').trim();

  if (!command) {
    return '';
  }

  // Limpia repeticiones como "aira aira dime ..." para dejar solo el comando.
  const wakePrefix = new RegExp(`^(?:${wakeWordMatch.wakeWord}\\s+)+`, 'u');
  return command.replace(wakePrefix, '').trim();
}

export default function useWakeWordBrowser(options = {}) {
  const {
    enabled = false,
    suspended = false,
    wakeWords = DEFAULT_WAKE_WORDS,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    language = PRIMARY_SPEECH_LANG,
    cooldownMs = DETECTION_COOLDOWN_MS,
    onDetected,
  } = options;

  const recognitionRef = useRef(null);
  const enabledRef = useRef(enabled);
  const suspendedRef = useRef(suspended);
  const onDetectedRef = useRef(onDetected);
  const lastDetectedAtRef = useRef(0);
  const restartTimerRef = useRef(null);
  const wakeWordsRef = useRef(wakeWords.map((w) => normalize(w)).filter(Boolean));
  const minConfidenceRef = useRef(minConfidence);
  const languageRef = useRef(language || PRIMARY_SPEECH_LANG);
  const cooldownMsRef = useRef(cooldownMs || DETECTION_COOLDOWN_MS);

  const [isWakeListening, setIsWakeListening] = useState(false);
  const [wakeError, setWakeError] = useState('');

  useEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    suspendedRef.current = suspended;
  }, [suspended]);

  useEffect(() => {
    onDetectedRef.current = onDetected;
  }, [onDetected]);

  useEffect(() => {
    wakeWordsRef.current = wakeWords.map((w) => normalize(w)).filter(Boolean);
  }, [wakeWords]);

  useEffect(() => {
    const normalizedValue = Number(minConfidence);
    minConfidenceRef.current = Number.isFinite(normalizedValue)
      ? Math.max(0, Math.min(1, normalizedValue))
      : DEFAULT_MIN_CONFIDENCE;
  }, [minConfidence]);

  useEffect(() => {
    languageRef.current = String(language || PRIMARY_SPEECH_LANG);
    if (recognitionRef.current) {
      recognitionRef.current.lang = languageRef.current;
    }
  }, [language]);

  useEffect(() => {
    const parsed = Number(cooldownMs);
    cooldownMsRef.current = Number.isFinite(parsed)
      ? Math.max(0, parsed)
      : DETECTION_COOLDOWN_MS;
  }, [cooldownMs]);

  useEffect(() => {
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setWakeError('Wake word en navegador no disponible en este entorno.');
      return undefined;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.lang = languageRef.current;

    recognitionRef.current = recognition;

    const clearRestartTimer = () => {
      if (restartTimerRef.current) {
        clearTimeout(restartTimerRef.current);
        restartTimerRef.current = null;
      }
    };

    const stopWakeRecognition = () => {
      clearRestartTimer();
      if (!recognitionRef.current) {
        return;
      }

      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore repeated stop attempts.
      }
    };

    const startWakeRecognition = () => {
      if (!enabledRef.current || suspendedRef.current || !recognitionRef.current) {
        return;
      }

      clearRestartTimer();

      try {
        recognitionRef.current.start();
      } catch {
        // Browser may throw if start is called while already active.
      }
    };

    recognition.onstart = () => {
      setIsWakeListening(true);
      setWakeError('');
      if (isDebugEnabled()) {
        console.log('[wakeword-browser] listening:start', {
          lang: recognition.lang,
          minConfidence: minConfidenceRef.current,
          wakeWords: wakeWordsRef.current,
        });
      }
    };

    recognition.onresult = (event) => {
      const words = wakeWordsRef.current;
      if (!words.length) {
        return;
      }

      let transcriptChunk = '';
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const transcript = event.results[i][0]?.transcript || '';
        transcriptChunk += ` ${transcript}`;
      }

      const normalizedChunk = canonicalizeWakeVariants(transcriptChunk);
      if (!normalizedChunk) {
        return;
      }

      let bestConfidence = 0;
      let hasReportedConfidence = false;
      let hasFinalResult = false;
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i];
        if (result?.isFinal) {
          hasFinalResult = true;
        }

        const confidence = Number(event.results[i]?.[0]?.confidence || 0);
        if (confidence > bestConfidence) {
          bestConfidence = confidence;
        }

        if (confidence > 0) {
          hasReportedConfidence = true;
        }
      }

      const effectiveConfidence = hasReportedConfidence
        ? bestConfidence
        : hasFinalResult
          ? 1
          : 0;

      const wakeWordMatch = findWakeWordMatch(normalizedChunk, words);
      if (!wakeWordMatch) {
        if (isDebugEnabled() && hasFinalResult) {
          console.log('[wakeword-browser] final without wakeword', {
            transcript: normalizedChunk,
            confidence: effectiveConfidence,
          });
        }
        return;
      }

      const commandText = extractWakeCommand(normalizedChunk, wakeWordMatch);
      const strongWakeText =
        normalizedChunk === wakeWordMatch.wakeWord ||
        normalizedChunk.startsWith(`${wakeWordMatch.wakeWord} `) ||
        normalizedChunk.endsWith(` ${wakeWordMatch.wakeWord}`);

      if (effectiveConfidence < minConfidenceRef.current && !strongWakeText) {
        if (isDebugEnabled()) {
          console.log('[wakeword-browser] rejected by confidence', {
            transcript: normalizedChunk,
            confidence: effectiveConfidence,
            threshold: minConfidenceRef.current,
          });
        }
        return;
      }

      const now = Date.now();
      if (now - lastDetectedAtRef.current <= cooldownMsRef.current) {
        return;
      }

      lastDetectedAtRef.current = now;
      stopWakeRecognition();

      if (typeof onDetectedRef.current === 'function') {
        if (isDebugEnabled()) {
          console.log('[wakeword-browser] detected', {
            wakeWord: wakeWordMatch.wakeWord,
            commandText,
            transcript: normalizedChunk,
            confidence: effectiveConfidence,
          });
        }

        onDetectedRef.current({
          wakeWord: wakeWordMatch.wakeWord,
          confidence: effectiveConfidence,
          commandText,
          transcript: normalizedChunk,
        });
      }
    };

    recognition.onerror = (event) => {
      if (event?.error === 'aborted' || event?.error === 'no-speech') {
        return;
      }

      setWakeError(`Wake word error: ${event?.error || 'desconocido'}`);
      if (isDebugEnabled()) {
        console.log('[wakeword-browser] listening:error', {
          error: event?.error,
        });
      }

      // Some Chromium builds can throw transient network errors; force a clean retry.
      if (event?.error === 'network') {
        clearRestartTimer();
        if (enabledRef.current && !suspendedRef.current) {
          restartTimerRef.current = setTimeout(() => {
            if (!enabledRef.current || suspendedRef.current || !recognitionRef.current) {
              return;
            }

            try {
              recognitionRef.current.stop();
            } catch {
              // Ignore stop race.
            }

            try {
              recognitionRef.current.start();
              setWakeError('');
            } catch {
              // Ignore start race, onend flow will retry again.
            }
          }, 500);
        }
      }
    };

    recognition.onend = () => {
      setIsWakeListening(false);
      clearRestartTimer();

      if (isDebugEnabled()) {
        console.log('[wakeword-browser] listening:end');
      }

      if (!enabledRef.current || suspendedRef.current) {
        return;
      }

      // Gentle restart with backoff to avoid race conditions
      restartTimerRef.current = setTimeout(() => {
        if (enabledRef.current && !suspendedRef.current && recognitionRef.current) {
          try {
            recognitionRef.current.start();
          } catch (restartError) {
            if (isDebugEnabled()) {
              console.log('[wakeword-browser] restart failed', {
                error: restartError?.message,
              });
            }
            // Schedule another retry attempt
            restartTimerRef.current = setTimeout(() => {
              if (enabledRef.current && !suspendedRef.current && recognitionRef.current) {
                try {
                  recognitionRef.current.start();
                } catch {
                  // Silent fail on second attempt
                }
              }
            }, 500);
          }
        }
      }, 220);
    };

    return () => {
      clearRestartTimer();

      if (recognitionRef.current) {
        recognitionRef.current.onstart = null;
        recognitionRef.current.onresult = null;
        recognitionRef.current.onerror = null;
        recognitionRef.current.onend = null;

        try {
          recognitionRef.current.stop();
        } catch {
          // Ignore shutdown errors.
        }
      }

      recognitionRef.current = null;
    };
  }, [wakeWords]);

  useEffect(() => {
    if (!recognitionRef.current) {
      return;
    }

    if (!enabled || suspended) {
      try {
        recognitionRef.current.stop();
      } catch {
        // Ignore stop errors.
      }
      return;
    }

    try {
      recognitionRef.current.start();
    } catch {
      // Ignore duplicate starts.
    }
  }, [enabled, suspended]);

  return {
    isWakeListening,
    wakeError,
  };
}