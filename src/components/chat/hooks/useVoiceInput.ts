import { useCallback, useEffect, useRef, useState } from 'react';

import { transcribeVoice } from '../../../utils/voiceApi';

const RECORDING_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/ogg;codecs=opus',
  'audio/ogg',
];

function recordingType(): string {
  if (typeof MediaRecorder === 'undefined') return '';

  for (const candidate of RECORDING_TYPES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch {
      // Some browser implementations throw while probing a type.
    }
  }

  return '';
}

function extensionFor(type: string): string {
  if (type.includes('mp4')) return 'm4a';
  return type.includes('ogg') ? 'ogg' : 'webm';
}

export type VoiceInputState = 'idle' | 'recording' | 'transcribing';

export function useVoiceInput(
  onTranscript: (text: string, send?: boolean) => void,
  onError?: (msg: string) => void,
) {
  const [state, setState] = useState<VoiceInputState>('idle');
  const recording = useRef({
    recorder: null as MediaRecorder | null,
    stream: null as MediaStream | null,
    chunks: [] as Blob[],
    starting: false,
    disposed: false,
    sendWhenDone: false,
  });

  const releaseMicrophone = useCallback(() => {
    const { stream } = recording.current;
    stream?.getTracks().forEach((track) => track.stop());
    recording.current.stream = null;
  }, []);

  useEffect(() => {
    const session = recording.current;
    session.disposed = false;

    return () => {
      session.disposed = true;
      session.starting = false;
      session.stream?.getTracks().forEach((track) => track.stop());
      session.stream = null;
      session.recorder = null;
    };
  }, []);

  const begin = useCallback(async () => {
    const session = recording.current;
    if (session.starting || (session.recorder && session.recorder.state !== 'inactive')) return;

    session.starting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });

      if (recording.current.disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }

      recording.current.stream = stream;
      const type = recordingType();
      const recorder = type ? new MediaRecorder(stream, { mimeType: type }) : new MediaRecorder(stream);
      recording.current.recorder = recorder;
      recording.current.chunks = [];

      recorder.ondataavailable = ({ data }) => {
        if (data.size > 0) recording.current.chunks.push(data);
      };

      recorder.onstop = async () => {
        releaseMicrophone();
        if (recording.current.disposed) return;

        const send = recording.current.sendWhenDone;
        recording.current.sendWhenDone = false;
        const recordedType = recorder.mimeType || 'audio/webm';
        const audio = new Blob(recording.current.chunks, { type: recordedType });

        if (audio.size < 800) {
          setState('idle');
          onError?.('Recording too short');
          return;
        }

        setState('transcribing');
        try {
          const response = await transcribeVoice(audio, `recording.${extensionFor(recordedType)}`);
          if (!response.ok) throw new Error(`transcribe ${response.status}`);

          const payload = await response.json();
          if (recording.current.disposed) return;
          const transcript = String(payload?.text || '').trim();
          if (transcript) onTranscript(transcript, send);
          else onError?.('No speech detected');
        } catch (error) {
          if (!recording.current.disposed) {
            onError?.(`Transcription failed: ${error instanceof Error ? error.message : String(error)}`);
          }
        } finally {
          if (!recording.current.disposed) setState('idle');
        }
      };

      recorder.start();
      setState('recording');
    } catch (error) {
      recording.current.recorder = null;
      releaseMicrophone();
      if (recording.current.disposed) return;

      const microphoneError = error as { name?: string; message?: string };
      let message = `Mic error: ${microphoneError?.message || error}`;
      if (microphoneError?.name === 'NotAllowedError') message = 'Microphone access denied.';
      else if (microphoneError?.name === 'NotFoundError') message = 'No microphone found.';
      onError?.(message);
      setState('idle');
    } finally {
      recording.current.starting = false;
    }
  }, [onError, onTranscript, releaseMicrophone]);

  const stop = useCallback((opts?: { send?: boolean }) => {
    const recorder = recording.current.recorder;
    if (!recorder || recorder.state === 'inactive') return;

    recording.current.sendWhenDone = opts?.send ?? false;
    recorder.stop();
  }, []);

  const toggle = useCallback(() => {
    if (state === 'idle') begin();
    else if (state === 'recording') stop();
  }, [begin, state, stop]);

  return { state, toggle, stop };
}
