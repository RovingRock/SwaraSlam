// ─── Cookie Consent Banner ────────────────────────────────────────────────────
export default function CookieBanner({ onAccept, onLearnMore }) {
  const s = {
    banner:    { position:"fixed",bottom:0,left:0,right:0,backgroundColor:"#1C1A17",borderTop:"2px solid #9A7B50",padding:"16px 20px",display:"flex",alignItems:"center",justifyContent:"space-between",gap:"16px",flexWrap:"wrap",zIndex:999998,boxShadow:"0 -4px 20px rgba(0,0,0,0.15)" },
    text:      { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#F9F7F2",lineHeight:1.5,flex:"1 1 320px",minWidth:280 },
    btnRow:    { display:"flex",gap:10,flexShrink:0 },
    acceptBtn: { fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,padding:"10px 20px",backgroundColor:"#C05F2F",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",whiteSpace:"nowrap",transition:"background .15s" },
    learnBtn:  { fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:500,padding:"10px 18px",backgroundColor:"transparent",color:"#9A7B50",border:"1.5px solid #9A7B50",borderRadius:8,cursor:"pointer",whiteSpace:"nowrap",transition:"border-color .15s, color .15s" },
  };
  return (
    <div style={s.banner}>
      <p style={s.text}>We use cookies to enhance your Swara Slam experience and analyze arena traffic. By continuing to play, you agree to our use of cookies.</p>
      <div style={s.btnRow}>
        <button style={s.learnBtn} onClick={onLearnMore}>Learn More</button>
        <button style={s.acceptBtn} onClick={onAccept}>Got it, let's Slam! 🎵</button>
      </div>
    </div>
  );
}
