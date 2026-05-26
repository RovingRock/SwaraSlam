import { useState } from "react";
import { supabase } from "../utils/supabaseClients";

// ─── Reset Password Modal ─────────────────────────────────────────────────────
export default function ResetPasswordModal({ onSuccess }) {
  const [newPassword,  setNewPassword]  = useState("");
  const [confirmPass,  setConfirmPass]  = useState("");
  const [loading,      setLoading]      = useState(false);
  const [error,        setError]        = useState("");
  const [done,         setDone]         = useState(false);

  const handleReset = async (e) => {
    e.preventDefault();
    setError("");
    if (newPassword.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (newPassword !== confirmPass) { setError("Passwords don't match — check both fields."); return; }
    setLoading(true);
    try {
      const { error: err } = await supabase.auth.updateUser({ password: newPassword });
      if (err) {
        if (err.message.includes("same password") || err.message.includes("should be different"))
          setError("New password must be different from your current one.");
        else if (err.message.includes("expired") || err.message.includes("invalid"))
          setError("This reset link has expired. Please request a new one from the login screen.");
        else setError(err.message.replace(/^AuthApiError:\s*/i, ""));
        return;
      }
      window.history.replaceState({}, "", window.location.pathname);
      setDone(true);
      setTimeout(() => onSuccess(), 1800);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  };

  const s = {
    wrap:      { minHeight:"100vh",background:"#F9F7F2",display:"flex",alignItems:"center",justifyContent:"center",padding:"1.5rem" },
    card:      { backgroundColor:"#F9F7F2",borderRadius:18,padding:"40px 36px 36px",maxWidth:420,width:"100%",boxShadow:"0 20px 60px rgba(192,95,47,0.18)",border:"2px solid #9A7B50",textAlign:"center" },
    logoRow:   { marginBottom:18 },
    eyebrow:   { fontFamily:"'DM Sans',sans-serif",fontSize:9,fontWeight:500,letterSpacing:".22em",textTransform:"uppercase",color:"#9A7B50",marginBottom:4 },
    brandRow:  { display:"flex",alignItems:"baseline",justifyContent:"center",gap:6 },
    swara:     { fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:600,color:"#1C1A17",lineHeight:1 },
    slam:      { fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:600,fontStyle:"italic",color:"#C05F2F",lineHeight:1 },
    heading:   { fontFamily:"'Cormorant Garamond',serif",fontSize:26,fontWeight:600,color:"#1C1A17",margin:"0 0 6px" },
    sub:       { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#6B6560",margin:"0 0 24px",lineHeight:1.55 },
    form:      { display:"flex",flexDirection:"column",gap:12,textAlign:"left" },
    label:     { fontFamily:"'DM Sans',sans-serif",fontSize:10,fontWeight:500,letterSpacing:".14em",textTransform:"uppercase",color:"#9A7B50",marginBottom:4,display:"block" },
    input:     { fontFamily:"'DM Sans',sans-serif",fontSize:15,padding:13,border:"1.5px solid #E5DFD3",borderRadius:8,backgroundColor:"#fff",color:"#1C1A17",outline:"none",width:"100%" },
    error:     { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#C05F2F",background:"rgba(192,95,47,0.07)",padding:"10px 12px",borderRadius:8,border:"1px solid rgba(192,95,47,0.18)",lineHeight:1.5 },
    btn:       { fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:600,padding:14,backgroundColor:"#C05F2F",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",marginTop:4,transition:"background .15s,transform .1s",letterSpacing:".03em" },
    successBox:{ display:"flex",flexDirection:"column",alignItems:"center",gap:14 },
    tick:      { fontSize:52 },
    successMsg:{ fontFamily:"'DM Sans',sans-serif",fontSize:14,color:"#2E7D32",background:"#E8F5E9",padding:"12px 16px",borderRadius:8,lineHeight:1.55,maxWidth:320 },
    hint:      { fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#9A7B50",letterSpacing:".06em" },
  };

  return (
    <div style={s.wrap}>
      <div style={s.card}>
        <div style={s.logoRow}>
          <p style={s.eyebrow}>Re-enter the arena</p>
          <div style={s.brandRow}>
            <span style={s.swara}>Swara</span>
            <span style={s.slam}>Slam</span>
          </div>
        </div>
        {done ? (
          <div style={s.successBox}>
            <span style={s.tick}>🔓</span>
            <h2 style={{...s.heading,marginBottom:0}}>You're Back In!</h2>
            <div style={s.successMsg}>Password updated. Your Swara journey continues — heading to the arena now…</div>
            <p style={s.hint}>Taking you to the Ready screen…</p>
          </div>
        ) : (
          <>
            <h2 style={s.heading}>Set Your New Password</h2>
            <p style={s.sub}>Choose a strong password to reclaim your spot in the arena.</p>
            <form onSubmit={handleReset} style={s.form}>
              <div>
                <label style={s.label} htmlFor="rp-new">New Password</label>
                <input id="rp-new" type="password" placeholder="At least 6 characters" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)} required minLength={6}
                  style={s.input} autoComplete="new-password" autoFocus/>
              </div>
              <div>
                <label style={s.label} htmlFor="rp-confirm">Confirm Password</label>
                <input id="rp-confirm" type="password" placeholder="Repeat your new password" value={confirmPass}
                  onChange={e => setConfirmPass(e.target.value)} required minLength={6}
                  style={s.input} autoComplete="new-password"/>
              </div>
              {error && <div style={s.error} role="alert">{error}</div>}
              <button type="submit" disabled={loading} style={{...s.btn, opacity: loading ? 0.55 : 1}}>
                {loading ? "Updating…" : "Update & Start Slamming 🎵"}
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
