import { useEffect, useRef, useState } from "react";
import { ApiError, getHealth } from "../api/client";
import { ask, stt, tts } from "../api/voice";
import MicButton from "../composites/MicButton";
import StatusLine from "../composites/StatusLine";
import Transcript from "../composites/Transcript";
import useAudioPlayer from "../hooks/useAudioPlayer";
import useRecorder from "../hooks/useRecorder";
import { loadChat, saveChat } from "../utils/chatStorage";
import { micErrorMessage } from "../utils/recording";
import { speechChunks } from "../utils/speechChunks";
import { formatTiming } from "../utils/timing";

/** The voice page: speak a question, hear (and read) Claude's answer, ask the next one. */
export default function VoicePage() {
  const [backend, setBackend] = useState("checking");
  const [status, setStatus] = useState("ready");
  // The chat (turns + Claude's session id) is restored after a page reload.
  const [chat, setChat] = useState(loadChat);
  const { turns, sessionId } = chat;
  const [speakingId, setSpeakingId] = useState(null);
  const [micError, setMicError] = useState(null);
  const recorder = useRecorder();
  const player = useAudioPlayer();
  const nextId = useRef(Math.max(0, ...chat.turns.map((t) => t.id)) + 1);
  // Bumped whenever the mic is pressed, speech is stopped or the chat is
  // cleared: a turn whose number is stale was interrupted, so it must not
  // start playing or reset the status.
  const turnNo = useRef(0);
  // Each answer's audio requests (one per spoken piece), so Replay never asks
  // for them again, even while they are still running (memory only).
  const audioCache = useRef(new Map());

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((h) => !cancelled && setBackend(h.status === "ok" ? "ok" : "down"))
      .catch(() => !cancelled && setBackend("down"));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    saveChat(chat);
  }, [chat]);

  const busy = status === "transcribing" || status === "thinking";
  const addTurn = (role, text) => {
    const id = nextId.current++;
    setChat((c) => ({ ...c, turns: [...c.turns, { id, role, text }] }));
    return id;
  };
  const setSession = (id) => setChat((c) => ({ ...c, sessionId: id }));
  const setTiming = (id, timing) =>
    setChat((c) => ({ ...c, turns: c.turns.map((t) => (t.id === id ? { ...t, timing } : t)) }));

  /** Cut off any spoken answer and make every running turn stale. */
  function interrupt() {
    turnNo.current += 1;
    player.stop();
    setSpeakingId(null);
  }

  /**
   * The audio for each spoken piece of an answer, as promises in order. Each
   * piece is asked for once the one before it has arrived, so they come in
   * order and the next is made while the current one plays.
   */
  function audioFor(turn) {
    if (!audioCache.current.has(turn.id)) {
      let previous = Promise.resolve();
      const requests = speechChunks(turn.text).map((chunk) => (previous = previous.then(() => tts(chunk))));
      audioCache.current.set(turn.id, requests);
      for (const request of requests) {
        request.catch(() => audioCache.current.delete(turn.id)); // let Replay retry
      }
    }
    return audioCache.current.get(turn.id);
  }

  /**
   * Read an answer aloud, piece by piece. Resolves when it ends or is
   * interrupted. `isStale()` says whether the caller's turn is over;
   * `onAudio()` fires when the first piece has arrived, `onPlaying()` when
   * sound starts.
   */
  async function speak(turn, isStale, { onAudio, onPlaying } = {}) {
    setStatus("speaking");
    setSpeakingId(turn.id);
    try {
      const pieces = audioFor(turn);
      for (const [i, request] of pieces.entries()) {
        const audio = await request;
        if (i === 0) onAudio?.();
        if (isStale()) break;
        await player.play(audio, i === 0 ? { onPlaying } : {});
        if (isStale()) break;
      }
    } catch (e) {
      if (!isStale()) addTurn("error", `Couldn't speak this answer: ${e.message}`);
    } finally {
      if (!isStale()) setSpeakingId(null);
    }
  }

  async function startListening() {
    setMicError(null);
    interrupt(); // pressing the mic stops the spoken answer
    try {
      await recorder.start();
      setStatus("listening");
    } catch (e) {
      setMicError(micErrorMessage(e));
      setStatus("ready");
    }
  }

  async function stopListening() {
    const released = performance.now();
    const blob = await recorder.stop();
    if (!blob) return;
    const timing = {};
    let mark = performance.now();
    const lap = () => {
      const now = performance.now();
      const ms = Math.round(now - mark);
      mark = now;
      return ms;
    };
    const myTurn = turnNo.current;
    const isStale = () => turnNo.current !== myTurn;
    try {
      setStatus("transcribing");
      let text;
      try {
        ({ text } = await stt(blob));
        timing.stt = lap();
      } catch (e) {
        addTurn("error", sttErrorMessage(e));
        return;
      }
      addTurn("user", text);

      setStatus("thinking");
      let answer;
      try {
        answer = await ask(text, sessionId);
        timing.claude = lap();
        timing.warm = answer.warm;
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) {
          // The CLI no longer has this conversation: the next question starts a new one.
          setSession(null);
          addTurn("error", "That conversation is gone — ask again to start a new one.");
        } else {
          addTurn("error", e.message);
        }
        return;
      }
      setSession(answer.session_id);
      const id = addTurn("assistant", answer.answer);
      if (!isStale()) {
        await speak({ id, text: answer.answer }, isStale, {
          onAudio: () => (timing.voice = lap()),
          onPlaying: () => {
            timing.firstSound = Math.round(performance.now() - released);
            setTiming(id, { ...timing });
            console.info(`[jarvis-local] ${formatTiming(timing)}`);
          },
        });
      }
      // No sound (stopped, or the voice failed): still show the steps that ran.
      if (timing.firstSound == null) setTiming(id, { ...timing });
    } finally {
      if (!isStale()) setStatus("ready");
    }
  }

  async function replay(turn) {
    interrupt();
    const myTurn = turnNo.current;
    const isStale = () => turnNo.current !== myTurn;
    await speak(turn, isStale);
    if (!isStale()) setStatus("ready");
  }

  function stopSpeaking() {
    interrupt();
    setStatus("ready");
  }

  function newConversation() {
    interrupt();
    audioCache.current.clear();
    setChat({ turns: [], sessionId: null });
    setStatus("ready");
  }

  return (
    <>
      <header className="topbar">
        <span className="brand">Jarvis Local</span>
        <span className="actions">
          <span className="small muted">
            Backend: <span className={backend === "down" ? "error" : undefined}>{backend}</span>
          </span>
          <button
            type="button"
            className="secondary small"
            onClick={newConversation}
            disabled={busy || recorder.recording || (turns.length === 0 && !sessionId)}
          >
            New conversation
          </button>
        </span>
      </header>
      <main className="page voice">
        {micError && (
          <p className="banner error" role="alert">
            {micError}
          </p>
        )}
        <Transcript
          turns={turns}
          onReplay={replay}
          replayDisabled={busy || recorder.recording}
          speakingId={speakingId}
        />
        <div className="controls">
          <MicButton recording={recorder.recording} disabled={busy} onStart={startListening} onStop={stopListening} />
          <StatusLine status={status} />
          {status === "speaking" && (
            <button type="button" className="secondary small" onClick={stopSpeaking}>
              Stop speaking
            </button>
          )}
        </div>
      </main>
    </>
  );
}

function sttErrorMessage(e) {
  if (e instanceof ApiError && e.status === 422) {
    return e.detail === "No speech heard" || e.detail === "Recording is too short"
      ? "I didn't catch that — try again."
      : e.detail;
  }
  return `Couldn't transcribe: ${e.message}`;
}
