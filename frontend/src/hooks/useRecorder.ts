import { useCallback, useRef, useState } from 'react';

export type RecorderState = 'idle' | 'recording' | 'stopped';

export function useRecorder() {
  const [state, setState] = useState<RecorderState>('idle');
  const [blob, setBlob] = useState<Blob | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    const mimeType =
      ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg'].find((m) =>
        MediaRecorder.isTypeSupported(m),
      ) ?? '';

    const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : {});
    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      setBlob(new Blob(chunksRef.current, { type: mimeType || 'audio/webm' }));
      setState('stopped');
    };

    recorder.start(250);
    recorderRef.current = recorder;
    setState('recording');
  }, []);

  const stop = useCallback(() => {
    if (recorderRef.current?.state !== 'inactive') {
      recorderRef.current?.stop();
    }
  }, []);

  const reset = useCallback(() => {
    setBlob(null);
    setState('idle');
    chunksRef.current = [];
  }, []);

  return { state, blob, start, stop, reset };
}
