import { LEVEL_CONFIG, ACTIVE_BEATS } from "../constants/swaras";

// ─── Card Generation ──────────────────────────────────────────────────────────
export function generateCards(levelIdx) {
  const { pool, maxJump } = LEVEL_CONFIG[levelIdx];
  const key = s => s.semitone + "_" + (s.octave ?? 1);
  const counts = Object.fromEntries(pool.map(s => [key(s), 0]));
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];
  const cards = [];
  let prev = null;
  for (let i = 0; i < ACTIVE_BEATS; i++) {
    const remaining = ACTIVE_BEATS - i;
    let cands = pool.filter(s => {
      if (counts[key(s)] >= 2) return false;
      if (counts[key(s)] >= 1 && remaining <= 1) return false;
      if (prev !== null) {
        const jump = Math.abs((s.absSemitone ?? s.semitone) - (prev.absSemitone ?? prev.semitone));
        if (jump > maxJump) return false;
      }
      return true;
    });
    if (!cands.length) cands = pool.filter(s => counts[key(s)] < 2);
    if (!cands.length) cands = pool;
    const chosen = rand(cands);
    counts[key(chosen)]++;
    cards.push(chosen);
    prev = chosen;
  }
  return cards;
}
