import { useRef } from "react";

// ─── Confetti ─────────────────────────────────────────────────────────────────
export default function Confetti({ active }) {
  const pieces = useRef(Array.from({ length: 54 }, (_, i) => ({
    id: i, x: Math.random() * 100, delay: Math.random() * 0.7,
    dur: 1.8 + Math.random() * 1.2,
    color: ["#C05F2F","#9A7B50","#E8700A","#F2C94C","#1C1A17","#fff"][i % 6],
    size: 6 + Math.random() * 6, rot: Math.random() * 360,
  }))).current;
  if (!active) return null;
  return (
    <div style={{position:"fixed",inset:0,pointerEvents:"none",zIndex:200,overflow:"hidden"}}>
      {pieces.map(p => (
        <div key={p.id} style={{position:"absolute",left:p.x+"%",top:"-20px",width:p.size,height:p.size*0.5,background:p.color,borderRadius:2,
          animation:`confettiFall ${p.dur}s ${p.delay}s ease-in forwards`,transform:`rotate(${p.rot}deg)`}}/>
      ))}
      <style>{`@keyframes confettiFall{0%{transform:translateY(0) rotate(0deg);opacity:1}100%{transform:translateY(110vh) rotate(720deg);opacity:0}}`}</style>
    </div>
  );
}
