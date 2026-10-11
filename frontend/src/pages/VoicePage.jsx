import { useEffect, useRef, useState } from "react";
import { ApiError, getHealth } from "../api/client";
import { askStream, stt, tts } from "../api/voice";
import MicButton from "../composites/MicButton";
import StatusLine from "../composites/StatusLine";
import Transcript from "../composites/Transcript";
import useAudioPlayer from "../hooks/useAudioPlayer";
import useRecorder from "../hooks/useRecorder";
import { loadChat, saveChat } from "../utils/chatStorage";
import { micErrorMessage } from "../utils/recording";
import { createChunker, speechChunks } from "../utils/speechChunks";
import { createSpeechQueue } from "../utils/speechQueue";
import { formatTiming } from "../utils/timing";

/**
 * The voice page: speak a question, hear (and read) Claude's answer, ask the
 * next one. The answer streams in as Claude writes it, and the voice starts
 * at its first sentence.
 */
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
  // Each answer's speech queue, so Replay never asks for its audio again,
  // even while it is still being made (memory only).
  const audioCache = useRef(new Map());
  // Stops the answer Claude is writing, if any.
  const stream = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then((h) => !cancelled && setBackend(h.status === "ok" ? "ok" : "down"))
      .catch(() => !cancelled && setBackend("down"));
    return () => {
      cancelled = true;
      stream.current?.abort();
    };
  }, []);

  useEffect(() => {
    saveChat(chat);
  }, [chat]);

  // Thinking lasts until the first sentence can be spoken; from then on the
  // mic interrupts.
  const busy = status === "transcribing" || status === "thinking";
  const addTurn = (role, text) => {
    const id = nextId.current++;
    setChat((c) => ({ ...c, turns: [...c.turns, { id, role, text }] }));
    return id;
  };
  const updateTurn = (id, fields) =>
    setChat((c) => ({ ...c, turns: c.turns.map((t) => (t.id === id ? { ...t, ...fields } : t)) }));
  const setSession = (id) => setChat((c) => ({ ...c, sessionId: id }));

  /** Cut off any spoken answer, stop Claude, and make every running turn stale. */
  function interrupt() {
    turnNo.current += 1;
    stream.current?.abort();
    stream.current = null;
    player.stop();
    setSpeakingId(null);
  }

  /** The speech queue of a finished answer: cached, else made from its text. */
  function queueFor(turn) {
    if (!audioCache.current.has(turn.id)) {
      const queue = createSpeechQueue(tts);
      speechChunks(turn.text).forEach((piece) => queue.add(piece));
      queue.close();
      audioCache.current.set(turn.id, queue);
    }
    return audioCache.current.get(turn.id);
  }

  /**
   * Play an answer's queue, piece by piece, waiting for pieces still being
   * written. Resolves when it ends or is interrupted. `isStale()` says
   * whether the caller's turn is over; `onAudio()` fires when the first
   * piece has arrived, `onPlaying()` when sound starts.
   */
  async function speak(id, queue, isStale, { onAudio, onPlaying } = {}) {
    setStatus("speaking");
    setSpeakingId(id);
    try {
      let i = 0;
      for await (const audio of queue) {
        if (i === 0) onAudio?.();
        if (isStale()) break;
        await player.play(audio, i === 0 ? { onPlaying } : {});
        if (isStale()) break;
        i += 1;
      }
    } catch (e) {
      audioCache.current.delete(id); // let Replay try again
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
    const myTurn = turnNo.current;
    const isStale = () => turnNo.current !== myTurn;
    // When each step finished, for the timing line under the answer.
    const at = { sttStart: performance.now() };
    let id = null;
    let speaking = null;
    try {
      setStatus("transcribing");
      let text;
      try {
        ({ text } = await stt(blob));
        at.heard = performance.now();
      } catch (e) {
        addTurn("error", sttErrorMessage(e));
        return;
      }
      addTurn("user", text);

      setStatus("thinking");
      const queue = createSpeechQueue(tts);
      const chunker = createChunker();
      const showTiming = (extra = {}) => id !== null && updateTurn(id, { timing: { ...timingFrom(at), ...extra } });
      const startSpeaking = () => {
        if (speaking || isStale() || queue.size === 0) return;
        speaking = speak(id, queue, isStale, {
          onAudio: () => (at.audio = performance.now()),
          onPlaying: () => {
            at.sound = performance.now();
            showTiming({ firstSound: Math.round(at.sound - released) });
          },
        });
      };
      const addPieces = (pieces) => {
        for (const piece of pieces) {
          at.sentence ??= performance.now();
          queue.add(piece);
        }
        startSpeaking();
      };
      const answerTurn = (answerText) => {
        if (id === null) {
          id = addTurn("assistant", answerText);
          audioCache.current.set(id, queue);
        } else {
          updateTurn(id, { text: answerText });
        }
      };

      const controller = new AbortController();
      stream.current = controller;
      let written = "";
      let answer;
      try {
        answer = await askStream(text, sessionId, {
          signal: controller.signal,
          // Known before any text, so a follow-up works even after a stop partway.
          onSession: (sid) => !isStale() && setSession(sid),
          onDelta: (delta) => {
            at.firstWords ??= performance.now();
            written += delta;
            answerTurn(written);
            addPieces(chunker.push(delta));
          },
        });
      } catch (e) {
        queue.close();
        if (e.name === "AbortError" || isStale()) return; // interrupted: what was written stays
        if (e instanceof ApiError && e.status === 404) {
          // The CLI no longer has this conversation: the next question starts a new one.
          setSession(null);
          addTurn("error", "That conversation is gone — ask again to start a new one.");
        } else {
          addTurn("error", e.message);
        }
        return;
      } finally {
        if (stream.current === controller) stream.current = null;
      }

      answerTurn(answer.answer);
      addPieces(chunker.flush());
      queue.close();
      if (!isStale()) setSession(answer.session_id);
      at.warm = answer.warm;
      startSpeaking();
      await speaking;
      const t = timingFrom(at, released);
      showTiming(t);
      if (t.firstSound != null) console.info(`[jarvis-local] ${formatTiming(t)}`);
    } finally {
      // An error partway still lets what was already queued finish playing.
      await speaking;
      if (!isStale()) setStatus("ready");
    }
  }

  async function replay(turn) {
    interrupt();
    const myTurn = turnNo.current;
    const isStale = () => turnNo.current !== myTurn;
    await speak(turn.id, queueFor(turn), isStale);
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

/** Each step's time from the moments in `at` (see formatTiming). */
function timingFrom(at, released) {
  const span = (from, to) => (from != null && to != null ? Math.round(to - from) : undefined);
  return {
    stt: span(at.sttStart, at.heard),
    claude: span(at.heard, at.firstWords),
    sentence: span(at.firstWords, at.sentence),
    voice: span(at.sentence, at.audio),
    firstSound: released != null ? span(released, at.sound) : undefined,
    warm: at.warm,
  };
}

function sttErrorMessage(e) {
  if (e instanceof ApiError && e.status === 422) {
    return e.detail === "No speech heard" || e.detail === "Recording is too short"
      ? "I didn't catch that — try again."
      : e.detail;
  }
  return `Couldn't transcribe: ${e.message}`;
}
