import { useEffect, useRef } from "react";
import { formatTiming } from "../utils/timing";

const SPEAKER = { user: "You", assistant: "Jarvis", error: "" };

/**
 * The conversation so far, oldest first; keeps the newest turn in view.
 * Each answer has a Replay button (`onReplay(turn)`); the one being spoken
 * is marked.
 */
export default function Transcript({ turns, onReplay, replayDisabled, speakingId }) {
  const end = useRef(null);
  // Braces matter: Chrome's scrollIntoView returns a Promise, and an effect
  // that returns anything but a cleanup function crashes React on the next turn.
  useEffect(() => {
    end.current?.scrollIntoView?.({ behavior: "smooth", block: "end" });
  }, [turns.length]);

  if (turns.length === 0) return null;
  return (
    <ol className="transcript">
      {turns.map((turn) => (
        <li key={turn.id} className={`turn ${turn.role}${turn.id === speakingId ? " speaking" : ""}`}>
          {SPEAKER[turn.role] && <span className="speaker small">{SPEAKER[turn.role]}</span>}
          <p>{turn.text}</p>
          {turn.timing && <span className="timing small muted">{formatTiming(turn.timing)}</span>}
          {turn.role === "assistant" && onReplay && (
            <button
              type="button"
              className="secondary small replay"
              onClick={() => onReplay(turn)}
              disabled={replayDisabled}
              aria-label="Replay this answer"
            >
              {turn.id === speakingId ? "Speaking…" : "Replay"}
            </button>
          )}
        </li>
      ))}
      <li ref={end} aria-hidden="true" />
    </ol>
  );
}
