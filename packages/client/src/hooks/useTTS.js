import { useCallback } from 'react';
import useBackendTTSStream from './useBackendTTSStream';
import useVoiceSynthesis from './useVoiceSynthesis';

export default function useTTS({ mode = 'browser', socket }) {
  const normalizedMode = String(mode || 'browser').trim().toLowerCase();

  const {
    speak: browserSpeak,
    cancel: browserCancel,
    isAiraSpeaking: browserSpeaking,
    selectedVoiceName,
  } = useVoiceSynthesis({
    enabled: normalizedMode === 'browser',
  });
  const {
    speak: backendSpeak,
    cancel: backendCancel,
    isAiraSpeaking: backendSpeaking,
    activeRequestId,
  } = useBackendTTSStream({ socket });

  const speak = useCallback((text, options = {}) => {
    if (normalizedMode === 'backend') {
      return backendSpeak(text, options);
    }

    return browserSpeak(text, options);
  }, [backendSpeak, browserSpeak, normalizedMode]);

  const cancel = useCallback((options = {}) => {
    if (normalizedMode === 'backend') {
      backendCancel(options);
      return;
    }

    browserCancel(options);
  }, [backendCancel, browserCancel, normalizedMode]);

  return {
    speak,
    cancel,
    isAiraSpeaking: normalizedMode === 'backend'
      ? backendSpeaking
      : browserSpeaking,
    mode: normalizedMode,
    selectedVoiceName,
    activeRequestId,
  };
}
