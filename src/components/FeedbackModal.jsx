import { useState } from "react";
import { supabase } from "../utils/supabaseClients";

// ─── Feedback Modal ───────────────────────────────────────────────────────────
export default function FeedbackModal({ user, onClose }) {
  const [feedback, setFeedback] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [success,  setSuccess]  = useState(false);
  const [error,    setError]    = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!feedback.trim()) { setError("Please write something before submitting."); return; }
    setLoading(true); setError("");
    try {
      const { error: err } = await supabase.from("feedback").insert({
        user_id: user?.id || null,
        user_email: user?.email || "anonymous",
        feedback_text: feedback.trim(),
      });
      if (err) throw err;
      setSuccess(true);
      setTimeout(() => onClose(), 2000);
    } catch (err) {
      setError("Couldn't send feedback right now. Please try again.");
      console.error("Feedback error:", err);
    } finally { setLoading(false); }
  };

  const s = {
    overlay:  { position:"fixed",inset:0,backgroundColor:"rgba(28,26,23,0.85)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999999,backdropFilter:"blur(5px)",padding:"1rem" },
    modal:    { backgroundColor:"#F9F7F2",borderRadius:16,padding:"32px 32px 28px",maxWidth:480,width:"100%",boxShadow:"0 20px 60px rgba(192,95,47,0.2)",position:"relative",border:"2px solid #9A7B50" },
    closeBtn: { position:"absolute",top:12,right:12,background:"none",border:"none",cursor:"pointer",padding:8,opacity:0.45,lineHeight:0 },
    heading:  { fontFamily:"'Cormorant Garamond',serif",fontSize:26,fontWeight:600,color:"#1C1A17",margin:"0 0 6px",textAlign:"center" },
    sub:      { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#6B6560",textAlign:"center",margin:"0 0 20px",lineHeight:1.5 },
    form:     { display:"flex",flexDirection:"column",gap:12 },
    textarea: { fontFamily:"'DM Sans',sans-serif",fontSize:14,padding:"12px 14px",border:"1.5px solid #E5DFD3",borderRadius:8,backgroundColor:"#fff",color:"#1C1A17",outline:"none",resize:"vertical",minHeight:120,lineHeight:1.6 },
    error:    { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#C05F2F",background:"rgba(192,95,47,0.08)",padding:"9px 12px",borderRadius:8,textAlign:"center",border:"1px solid rgba(192,95,47,0.2)" },
    success:  { fontFamily:"'DM Sans',sans-serif",fontSize:14,color:"#2E7D32",background:"#E8F5E9",padding:"12px 16px",borderRadius:8,textAlign:"center",lineHeight:1.5 },
    btn:      { fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:600,padding:13,backgroundColor:"#C05F2F",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",marginTop:2,transition:"background .15s" },
  };

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <button style={s.closeBtn} onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="#1C1A17" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        {success ? (
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:52,marginBottom:12}}>🙏</div>
            <div style={s.success}>Thank you! Your feedback helps us make Swara Slam better for everyone.</div>
          </div>
        ) : (
          <>
            <h2 style={s.heading}>Share Your Feedback</h2>
            <p style={s.sub}>Help us improve Swara Slam — tell us what's working, what's not, or what you'd love to see next.</p>
            <form onSubmit={handleSubmit} style={s.form}>
              <textarea placeholder="Your thoughts, suggestions, bugs, or just a hello..."
                value={feedback} onChange={e => setFeedback(e.target.value)}
                style={s.textarea} maxLength={2000} autoFocus/>
              <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#9A7B50",textAlign:"right"}}>{feedback.length} / 2000</div>
              {error && <div style={s.error} role="alert">{error}</div>}
              <button type="submit" disabled={loading} style={{...s.btn, opacity: loading ? 0.55 : 1}}>
                {loading ? "Sending..." : "Send Feedback"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
