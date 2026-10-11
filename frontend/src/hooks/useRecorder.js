import { useCallback, useEffect, useRef, useState } from "react";
import { pickMimeType } from "../utils/recording";

/**
 * Record from the microphone. `start()` begins a recording (asking for the
 * mic the first time); `stop()` ends it and resolves to the audio Blob.
 * The mic stays open between recordings so the next one starts at once.
 * `stop()` called while `start()` is still waiting for the mic waits for it,
 * so a very quick press still gives a (short) recording instead of failing.
 */
export default function useRecorder() {
  const [recording, setRecording] = useState(false);
  const streamRef = useRef(null);
  const recorderRef = useRef(null);
  const startingRef = useRef(null);

  const start = useCallback(() => {
    if (startingRef.current) return startingRef.current;
    const starting = (async () => {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
        });
      }
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(streamRef.current, mimeType ? { mimeType } : undefined);
      const chunks = [];
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.chunks = chunks;
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    })();
    // Cleared only after it is stored: once the mic is open the body above
    // finishes without ever waiting, so a `finally` inside it would run
    // before this assignment and leave a stale promise that blocks every
    // later start().
    startingRef.current = starting;
    starting
      .finally(() => {
        if (startingRef.current === starting) startingRef.current = null;
      })
      .catch(() => {}); // the caller handles the error
    return starting;
  }, []);

  const stop = useCallback(async () => {
    if (startingRef.current) await startingRef.current;
    const recorder = recorderRef.current;
    if (!recorder) return null;
    recorderRef.current = null;
    return new Promise((resolve) => {
      recorder.onstop = () => {
        setRecording(false);
        resolve(new Blob(recorder.chunks, { type: recorder.mimeType }));
      };
      recorder.stop();
    });
  }, []);

  // Release the mic when the page goes away.
  useEffect(
    () => () => {
      recorderRef.current?.state === "recording" && recorderRef.current.stop();
      streamRef.current?.getTracks().forEach((t) => t.stop());
    },
    [],
  );

  return { recording, start, stop };
}
