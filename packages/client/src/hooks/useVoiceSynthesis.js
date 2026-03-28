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

  return [...spanishVoices].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
}

export default function useVoiceSynthesis() {
  const synthesisRef = useRef(
    typeof window !== 'undefined' ? window.speechSynthesis : null
  );
  const utteranceRef = useRef(null);

  const [availableVoices, setAvailableVoices] = useState([]);
  const [isAiraSpeaking, setIsAiraSpeaking] = useState(false);

  const selectedVoice = useMemo(
    () => pickBestSpanishVoice(availableVoices),
    [availableVoices]
  );

  const cancel = useCallback(() => {
    const synthesis = synthesisRef.current;
    if (!synthesis) {
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

      if (!synthesis || !normalizedText) {
        return false;
      }

      if (synthesis.paused) {
        synthesis.resume();
      }

      synthesis.cancel();

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
      synthesis.speak(utterance);
      return true;
    },
    [selectedVoice]
  );

  useEffect(() => {
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
  }, []);

  return {
    speak,
    cancel,
    isAiraSpeaking,
    selectedVoiceName: selectedVoice?.name || '',
  };
}
