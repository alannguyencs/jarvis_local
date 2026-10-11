// What the voice loop is doing.
const TEXT = {
  ready: "Ready — hold the mic (or Space) to talk, or tap it",
  listening: "Listening…",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  speaking: "Speaking… — press the mic or Space to interrupt",
};

export default function StatusLine({ status }) {
  return (
    <p className={`status ${status}`} role="status" aria-live="polite">
      {TEXT[status]}
    </p>
  );
}
