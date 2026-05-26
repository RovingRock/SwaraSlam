export function getTitleForPct(pct) {
  if (pct <= 20) return { title: "Shishya", emoji: "🌱", color: "#9A7B50" };
  if (pct <= 40) return { title: "Sadhak",  emoji: "🔥", color: "#C05F2F" };
  if (pct <= 59) return { title: "Gyani",   emoji: "⚡", color: "#C05F2F" };
  if (pct <= 79) return { title: "Pundit",  emoji: "🎯", color: "#1C1A17" };
  return              { title: "Guru",     emoji: "✦",  color: "#9A7B50"  };
}

export function getLevelSummaryMessage(score, total) {
  const pct = Math.round((score / total) * 100);
  const { title, emoji } = getTitleForPct(pct);
  if (pct === 100) return { msg: `Perfect Slam! You nailed all ${total}. ${emoji} Guru status — the Swara is strong with you.`, title, emoji };
  if (pct >= 80)  return { msg: `You Swara Slammed it! ${score}/${total} nailed. ${emoji} ${title} status achieved — you're on fire!`, title, emoji };
  if (pct >= 60)  return { msg: `Solid Slam! ${score} out of ${total}. ${emoji} ${title} vibes. Keep Swara Slamming to reach Guru!`, title, emoji };
  if (pct >= 41)  return { msg: `Nice hustle! ${score}/${total} right. ${emoji} ${title} level — your Swara game is building!`, title, emoji };
  if (pct >= 21)  return { msg: `${score}/${total} this round. ${emoji} ${title} status. Every Slam counts — slam again!`, title, emoji };
  return               { msg: `${score}/${total} — keep at it, ${emoji} ${title}! The Riyaz will sharpen you. Ready to Slam again?`, title, emoji };
}
