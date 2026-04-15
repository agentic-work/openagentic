/**
 * Copyright 2026 Gnomus.ai
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */



import { useState, useCallback, useEffect, useRef } from 'react';
import { useSettings } from '@/features/settings/hooks/useSettings';

interface UseTextToSpeechReturn {
  speak: (text: string) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  isSpeaking: boolean;
  isPaused: boolean;
  isSupported: boolean;
}

export const useTextToSpeech = (): UseTextToSpeechReturn => {
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const { settings } = useSettings();

  // Check if browser supports speech synthesis
  const isSupported = typeof window !== 'undefined' && 'speechSynthesis' in window;

  // Debug function to list available voices
  const logAvailableVoices = useCallback(() => {
    if (!isSupported) return;

    const voices = window.speechSynthesis.getVoices();
    // Debug logging disabled for production
    // console.log('TTS: Available voices:', voices.map(voice => ({
    //   name: voice.name,
    //   lang: voice.lang,
    //   gender: voice.name.toLowerCase().includes('female') ? 'female' :
    //           voice.name.toLowerCase().includes('male') ? 'male' : 'neutral',
    //   default: voice.default,
    //   localService: voice.localService
    // })));
    void voices; // Suppress unused variable warning
  }, [isSupported]);

  // Log available voices when the hook is first used
  useEffect(() => {
    if (isSupported) {
      // Try to get voices immediately
      logAvailableVoices();
      
      // Also listen for when voices become available
      const handleVoicesChanged = () => {
        logAvailableVoices();
        window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
      };
      
      window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
      
      return () => {
        window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
      };
    }
  }, [isSupported, logAvailableVoices]);

  // Clean up code blocks and markdown for better speech
  const cleanTextForSpeech = (text: string): string => {
    // Remove code blocks
    let cleaned = text.replace(/```[\s\S]*?```/g, 'code block');
    
    // Remove inline code
    cleaned = cleaned.replace(/`[^`]+`/g, 'code');
    
    // Remove markdown formatting
    cleaned = cleaned.replace(/[*_~#]/g, '');
    
    // Remove URLs
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, 'link');
    
    // Remove extra whitespace
    cleaned = cleaned.replace(/\n+/g, '. ').replace(/\s+/g, ' ').trim();
    
    return cleaned;
  };

  const speak = useCallback((text: string) => {
    if (!isSupported) {
      // console.warn('Text-to-speech is not supported in this browser');
      return;
    }
    
    if (!settings.audio?.enableTextToSpeech) {
      // console.warn('Text-to-speech is disabled in settings');
      return;
    }

    // Stop any ongoing speech
    stop();

    const cleanedText = cleanTextForSpeech(text);
    
    if (!cleanedText.trim()) {
      // console.warn('No text to speak after cleaning');
      return;
    }
    
    const utterance = new SpeechSynthesisUtterance(cleanedText);
    utterance.lang = settings.audio.voiceLanguage || 'en-US';
    utterance.rate = settings.audio.speechSpeed || 1.0;
    
    // Try to find a voice matching the language and gender preference
    const voices = window.speechSynthesis.getVoices();
    
    // If no voices loaded yet, wait for them to load
    if (voices.length === 0) {
      // Set up a listener for when voices are loaded
      const handleVoicesChanged = () => {
        const updatedVoices = window.speechSynthesis.getVoices();
        if (updatedVoices.length > 0) {
          const preferredVoice = updatedVoices.find(voice => {
            const matchesLang = voice.lang.startsWith((settings.audio.voiceLanguage || 'en-US').split('-')[0]);
            const matchesGender = settings.audio.voiceGender === 'neutral' || 
                                 voice.name.toLowerCase().includes(settings.audio.voiceGender || 'female');
            return matchesLang && matchesGender;
          });
          
          if (preferredVoice) {
            utterance.voice = preferredVoice;
          }
          
          // Remove the event listener after use
          window.speechSynthesis.removeEventListener('voiceschanged', handleVoicesChanged);
        }
      };
      
      window.speechSynthesis.addEventListener('voiceschanged', handleVoicesChanged);
    } else {
      const preferredVoice = voices.find(voice => {
        const matchesLang = voice.lang.startsWith((settings.audio.voiceLanguage || 'en-US').split('-')[0]);
        const matchesGender = settings.audio.voiceGender === 'neutral' || 
                             voice.name.toLowerCase().includes(settings.audio.voiceGender || 'female');
        return matchesLang && matchesGender;
      });
      
      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }
    }

    utterance.onstart = () => {
      // console.log('TTS: Started speaking');
      setIsSpeaking(true);
      setIsPaused(false);
    };

    utterance.onend = () => {
      // console.log('TTS: Finished speaking');
      setIsSpeaking(false);
      setIsPaused(false);
      utteranceRef.current = null;
    };

    utterance.onerror = (event) => {
      console.error('TTS: Speech synthesis error:', event.error, event);
      setIsSpeaking(false);
      setIsPaused(false);
      utteranceRef.current = null;
    };

    utterance.onpause = () => {
      // console.log('TTS: Paused');
      setIsPaused(true);
    };

    utterance.onresume = () => {
      // console.log('TTS: Resumed');
      setIsPaused(false);
    };

    utteranceRef.current = utterance;
    
    try {
      // console.log('TTS: Starting speech with text:', cleanedText.substring(0, 50) + '...');
      // console.log('TTS: Voice:', utterance.voice?.name || 'Default');
      // console.log('TTS: Language:', utterance.lang);
      // console.log('TTS: Rate:', utterance.rate);
      window.speechSynthesis.speak(utterance);
    } catch (error) {
      console.error('TTS: Failed to start speech:', error);
      setIsSpeaking(false);
      setIsPaused(false);
      utteranceRef.current = null;
    }
  }, [isSupported, settings.audio]);

  const stop = useCallback(() => {
    if (isSupported && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
      utteranceRef.current = null;
    }
  }, [isSupported]);

  const pause = useCallback(() => {
    if (isSupported && window.speechSynthesis.speaking && !isPaused) {
      window.speechSynthesis.pause();
      setIsPaused(true);
    }
  }, [isSupported, isPaused]);

  const resume = useCallback(() => {
    if (isSupported && isPaused) {
      window.speechSynthesis.resume();
      setIsPaused(false);
    }
  }, [isSupported, isPaused]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      stop();
    };
  }, [stop]);

  return {
    speak,
    stop,
    pause,
    resume,
    isSpeaking,
    isPaused,
    isSupported
  };
};