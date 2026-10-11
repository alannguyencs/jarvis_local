// How long each step of a turn took, shown under the answer and logged.

const sec = (ms) => `${(ms / 1000).toFixed(1)} s`;

/**
 * "heard 0.4 s · Claude 1.5 s (warm) · voice 0.8 s · first sound 3.1 s".
 * Each step is the browser's own measure (network included); `firstSound`
 * runs from releasing the mic to the voice starting. Missing steps are left out.
 */
export function formatTiming(t) {
  if (!t) return "";
  const parts = [];
  if (t.stt != null) parts.push(`heard ${sec(t.stt)}`);
  if (t.claude != null) parts.push(`Claude ${sec(t.claude)}${t.warm ? " (warm)" : ""}`);
  if (t.voice != null) parts.push(`voice ${sec(t.voice)}`);
  if (t.firstSound != null) parts.push(`first sound ${sec(t.firstSound)}`);
  return parts.join(" · ");
}
