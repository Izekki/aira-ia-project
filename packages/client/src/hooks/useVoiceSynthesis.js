import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const PREFERRED_LANG_PREFIX = 'es';

function scoreVoice(voice) {
  const name = (voice.name || '').toLowerCase();
  let score = 0;

  if ((voice.lang || '').toLowerCase().startsWith('es-es')) {
    score += 40;
  }

  if ((voice.lang || '').toLowerCase().startsWith(PREFERRED_LANG_PREFIX)) {
    score += 25;
  }

  if (name.includes('neural') || name.includes('natural') || name.includes('premium')) {
    score += 20;
  }

  if (name.includes('google') || name.includes('microsoft')) {
    score += 12;
  }

  if (name.includes('female') || name.includes('mujer')) {
    score += 2;
  }

  return score;
}

function pickBestSpanishVoice(voices) {
  const spanishVoices = voices.filter((voice) =>
    (voice.lang || '').toLowerCase().startsWith(PREFERRED_LANG_PREFIX)
  );

  if (spanishVoices.length === 0) {
    return null;
  }

  // FIRST: Try to get saved voice preference from localStorage
  try {
    const savedVoiceName = window?.localStorage?.getItem('AIRA_SELECTED_VOICE');
    if (savedVoiceName) {
      const savedVoice = spanishVoices.find((v) => v.name === savedVoiceName);
      if (savedVoice) {
        console.log('[useVoiceSynthesis] Using saved voice:', savedVoiceName);
        return savedVoice;
      }
    }
  } catch {
    // localStorage not available, continue to autopick
  }

  // FALLBACK: Score and pick best voice
  const bestVoice = [...spanishVoices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];

  // SAVE: Store the selected voice preference
  if (bestVoice) {
    try {
      window?.localStorage?.setItem('AIRA_SELECTED_VOICE', bestVoice.name);
      console.log('[useVoiceSynthesis] Selected and saved voice:', bestVoice.name);
    } catch {
      // localStorage not available, continue anyway
    }
  }

  return bestVoice;
}

export default function useVoiceSynthesis({ enabled = true } = {}) {
  const synthesisRef = useRef(null);
  const utteranceRef = useRef(null);

  const [availableVoices, setAvailableVoices] = useState([]);
  const [isAiraSpeaking, setIsAiraSpeaking] = useState(false);

  const selectedVoice = useMemo(
    () => (enabled ? pickBestSpanishVoice(availableVoices) : null),
    [availableVoices, enabled]
  );

  const cancel = useCallback(() => {
    const synthesis = synthesisRef.current;
    if (!enabled || !synthesis) {
      return;
    }

    synthesis.cancel();
    utteranceRef.current = null;
    setIsAiraSpeaking(false);
  }, []);

  const speak = useCallback(
    (text) => {
      const synthesis = synthesisRef.current;
      const normalizedText = String(text || '').trim();

      if (!enabled || !synthesis || !normalizedText) {
        return false;
      }

      if (synthesis.paused) {
        synthesis.resume();
      }

      synthesis.cancel();
      setIsAiraSpeaking(true);

      const utterance = new SpeechSynthesisUtterance(normalizedText);
      utterance.voice = selectedVoice || null;
      utterance.lang = selectedVoice?.lang || 'es-ES';
      utterance.rate = 1.03;
      utterance.pitch = 1.01;
      utterance.volume = 1;

      utterance.onstart = () => {
        setIsAiraSpeaking(true);
      };

      utterance.onend = () => {
        setIsAiraSpeaking(false);
        utteranceRef.current = null;
      };

      utterance.onerror = () => {
        setIsAiraSpeaking(false);
        utteranceRef.current = null;
      };

      utteranceRef.current = utterance;
      try {
        synthesis.speak(utterance);
      } catch {
        setIsAiraSpeaking(false);
        utteranceRef.current = null;
        return false;
      }
      return true;
    },
    [enabled, selectedVoice]
  );

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      synthesisRef.current = null;
      setAvailableVoices([]);
      return undefined;
    }

    synthesisRef.current = window.speechSynthesis;
    const synthesis = synthesisRef.current;
    if (!synthesis) {
      return undefined;
    }

    const handleVoicesChanged = () => {
      setAvailableVoices(synthesis.getVoices());
    };

    handleVoicesChanged();

    synthesis.addEventListener('voiceschanged', handleVoicesChanged);

    return () => {
      synthesis.removeEventListener('voiceschanged', handleVoicesChanged);
      synthesis.cancel();
    };
  }, [enabled]);

  return {
    speak,
    cancel,
    isAiraSpeaking,
    selectedVoiceName: selectedVoice?.name || '',
  };
}
