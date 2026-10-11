import { useCallback, useEffect, useRef } from "react";

/**
 * Play audio Blobs one at a time. `play(blob, { onPlaying })` resolves when
 * playback ends or is stopped, and rejects if the browser refuses to play
 * it; `onPlaying` fires when sound starts. `stop()` cuts it off.
 */
export default function useAudioPlayer() {
  const current = useRef(null); // { audio, url, finish }

  const stop = useCallback(() => {
    const playing = current.current;
    if (!playing) return;
    current.current = null;
    playing.audio.pause();
    URL.revokeObjectURL(playing.url);
    playing.finish();
  }, []);

  const play = useCallback(
    (blob, { onPlaying } = {}) => {
      stop();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      if (onPlaying) audio.onplaying = () => onPlaying();
      return new Promise((resolve, reject) => {
        const entry = { audio, url, finish: resolve };
        current.current = entry;
        const done = () => current.current === entry && stop();
        audio.onended = done;
        audio.onerror = () => {
          done();
          reject(new Error("The browser could not play the answer"));
        };
        audio.play().catch((e) => {
          done();
          reject(e);
        });
      });
    },
    [stop],
  );

  useEffect(() => stop, [stop]);
  return { play, stop };
}
