import { useEffect, useRef } from "react";

// A press held longer than this is hold-to-talk (release stops); a shorter
// one is a tap that toggles (tap again to stop).
const HOLD_MS = 350;

/** Space should not talk while the user is typing somewhere. */
function isTyping(target) {
  return target?.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target?.tagName);
}

/**
 * The big round mic button. Calls `onStart()` and `onStop()`; works both as
 * hold-to-talk and as tap-to-start / tap-to-stop, with the pointer or with
 * the Space bar (anywhere on the page).
 */
export default function MicButton({ recording, disabled, onStart, onStop }) {
  const pressedAt = useRef(0);
  const startedByThisPress = useRef(false);
  const spaceDown = useRef(false);

  // The latest props for the window key listeners, which are added once.
  const latest = useRef();
  latest.current = { recording, disabled, onStart, onStop };

  function press() {
    const { recording, disabled, onStart, onStop } = latest.current;
    if (disabled) return;
    pressedAt.current = Date.now();
    startedByThisPress.current = !recording;
    if (recording) onStop();
    else onStart();
  }

  function release() {
    if (!startedByThisPress.current) return;
    startedByThisPress.current = false;
    if (Date.now() - pressedAt.current >= HOLD_MS) latest.current.onStop();
  }

  useEffect(() => {
    function keyDown(e) {
      if (e.code !== "Space" || isTyping(e.target)) return;
      // Also stops a focused button from being clicked by this Space.
      e.preventDefault();
      if (e.repeat || spaceDown.current) return;
      spaceDown.current = true;
      press();
    }
    function keyUp(e) {
      if (e.code !== "Space" || !spaceDown.current) return;
      e.preventDefault();
      spaceDown.current = false;
      release();
    }
    window.addEventListener("keydown", keyDown);
    window.addEventListener("keyup", keyUp);
    return () => {
      window.removeEventListener("keydown", keyDown);
      window.removeEventListener("keyup", keyUp);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const label = recording ? "Stop recording" : "Talk";
  return (
    <button
      type="button"
      className={`mic${recording ? " recording" : ""}`}
      disabled={disabled}
      aria-label={label}
      aria-pressed={recording}
      title={`${label} — hold to talk, or tap to start and tap again to stop (or use Space)`}
      onPointerDown={(e) => {
        if (e.button > 0) return;
        e.currentTarget.setPointerCapture?.(e.pointerId);
        press();
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <rect x="9" y="2" width="6" height="12" rx="3" />
        <path d="M5 10v1a7 7 0 0 0 14 0v-1M12 18v4M8 22h8" />
      </svg>
    </button>
  );
}
