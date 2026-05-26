import { useState } from "react";
import { supabase } from "../utils/supabaseClients";

// ─── Auth Modal ───────────────────────────────────────────────────────────────
export default function AuthModal({ onClose, onAuthSuccess, onOpenLegal, preferredMode = "signup" }) {
  const [mode, setMode]                   = useState(preferredMode);
  const [email, setEmail]                 = useState("");
  const [password, setPassword]           = useState("");
  const [marketingConsent, setMktConsent] = useState(false);
  const [termsAccepted, setTerms]         = useState(false);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState("");
  const [message, setMessage]             = useState("");
  const [honeypot, setHoneypot]           = useState("");

  const friendlyError = (err) => {
    const msg = err?.message ?? String(err);
    if (msg.includes("rate limit") || msg.includes("too many") || msg.includes("429"))
      return "Our email system is a little busy right now — please wait a few minutes and try again. ☕";
    if (msg.includes("already registered") || msg.includes("already exists") || msg.includes("User already"))
      return "This email already has an account. Try logging in instead!";
    if (msg.includes("Invalid login") || msg.includes("invalid_credentials") || msg.includes("Invalid email or password"))
      return "Email or password didn't match. Double-check and try again.";
    if (msg.includes("Email not confirmed"))
      return "Please confirm your email first — check your inbox for the activation link.";
    if (msg.includes("network") || msg.includes("fetch"))
      return "Connection issue — check your internet and try again.";
    return msg.replace(/^AuthApiError:\s*/i, "");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (honeypot) return;
    if (mode === "signup" && !termsAccepted) {
      setError("Please accept the Terms & Conditions to continue.");
      return;
    }
    setLoading(true); setError(""); setMessage("");
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email, password,
          options: {
            // Use window.location.origin so the confirmation link resolves
            // correctly in every environment (local, staging, production)
            // without hard-coding. Supabase appends the token; Vodien SMTP
            // dispatches the email to the user's inbox.
            emailRedirectTo: window.location.origin,
            data: { marketing_consent: marketingConsent },
          },
        });
        if (err) {
          if (err.message.includes("already registered") || err.message.includes("already exists") || err.message.includes("User already")) {
            setError("You're already a Slammer! Redirecting you to the login gate…");
            setTimeout(() => { setMode("login"); setError(""); }, 2000);
          } else { setError(friendlyError(err)); }
          return;
        }
        if (data.user) {
          if (!data.session) {
            setMessage("✅ Almost there! We've sent a confirmation link to your inbox. Click it to activate your account and start Slamming.");
          } else {
            // profiles.update removed — table returns 400 causing auth blockage.
            // Consent/terms tracking will be re-enabled once DB is confirmed healthy.
            setMessage("✅ Account created — your Swara journey starts now!");
            setTimeout(() => onAuthSuccess(data.user), 1000);
          }
        }
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) { setError(friendlyError(err)); return; }
        if (data.user && !data.user.email_confirmed_at) {
          setError("Your email isn't confirmed yet. Check your inbox for the activation link.");
          return;
        }
        if (data.user) onAuthSuccess(data.user);
      }
    } catch (err) {
      setError(friendlyError(err));
    } finally { setLoading(false); }
  };

  const handleForgotPassword = async (e) => {
    e.preventDefault();
    if (!email.trim()) { setError("Enter your email address above first."); return; }
    setLoading(true); setError(""); setMessage("");
    try {
      // The profiles table does not expose an email column (email lives in
      // auth.users which the anon key cannot query). The previous check was
      // causing a 400 by filtering on a non-existent column.
      //
      // Supabase's resetPasswordForEmail is a safe no-op for unknown emails
      // (it returns success without sending anything, preventing enumeration),
      // so we trust Supabase's handling and proceed directly to the API call.
      const { error: err } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        { redirectTo: window.location.origin + "/reset-password" }
      );
      if (err) { setError(friendlyError(err)); return; }
      setMode("forgot-sent");
    } catch (err) { setError(friendlyError(err)); }
    finally { setLoading(false); }
  };

  const s = {
    overlay:   { position:"fixed",inset:0,backgroundColor:"rgba(28,26,23,0.82)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999999,backdropFilter:"blur(5px)" },
    modal:     { backgroundColor:"#F9F7F2",borderRadius:16,padding:"36px 36px 32px",maxWidth:440,width:"90%",boxShadow:"0 20px 60px rgba(192,95,47,0.22)",position:"relative",border:"2px solid #9A7B50",maxHeight:"90vh",overflowY:"auto" },
    closeBtn:  { position:"absolute",top:14,right:14,background:"none",border:"none",cursor:"pointer",padding:8,opacity:0.45,lineHeight:0 },
    logo:      { textAlign:"center",marginBottom:16 },
    heading:   { fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:600,color:"#1C1A17",textAlign:"center",margin:"0 0 5px" },
    sub:       { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#6B6560",textAlign:"center",margin:"0 0 24px",lineHeight:1.5 },
    form:      { display:"flex",flexDirection:"column",gap:13 },
    input:     { fontFamily:"'DM Sans',sans-serif",fontSize:15,padding:13,border:"1.5px solid #E5DFD3",borderRadius:8,backgroundColor:"#fff",color:"#1C1A17",outline:"none" },
    checkRow:  { display:"flex",alignItems:"flex-start",gap:10,fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#6B6560",lineHeight:1.5 },
    error:     { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#C05F2F",backgroundColor:"rgba(192,95,47,0.08)",padding:"10px 12px",borderRadius:8,textAlign:"center",border:"1px solid rgba(192,95,47,0.2)",lineHeight:1.5 },
    success:   { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#2E7D32",backgroundColor:"#E8F5E9",padding:"10px 12px",borderRadius:8,textAlign:"center",lineHeight:1.5 },
    btn:       { fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:600,padding:14,backgroundColor:"#C05F2F",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",marginTop:2,transition:"background .15s" },
    toggle:    { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#6B6560",textAlign:"center",marginTop:18 },
    toggleBtn: { background:"none",border:"none",color:"#C05F2F",fontWeight:600,cursor:"pointer",textDecoration:"underline",padding:0,fontFamily:"'DM Sans',sans-serif",fontSize:13 },
    ghostLink: { background:"none",border:"none",color:"#9A7B50",cursor:"pointer",fontSize:12,fontFamily:"'DM Sans',sans-serif",textDecoration:"underline",padding:0,marginTop:2 },
    link:      { color:"#C05F2F",textDecoration:"underline" },
  };

  const copy = {
    signup:        { h: "Create Free Account",  sub: "Sign up to save your Slam progress and unlock levels." },
    login:         { h: "Back to the Slam",     sub: "Your Swara journey continues right here." },
    forgot:        { h: "Reset Your Password",  sub: "Enter your email and we'll send you a reset link." },
    "forgot-sent": { h: "Check Your Inbox",     sub: "A password reset link is on its way." },
  };

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <button style={s.closeBtn} onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="#1C1A17" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <div style={s.logo}>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"center",gap:6,marginBottom:3}}>
            <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:15,fontWeight:600,color:"#9A7B50",letterSpacing:".04em"}}>RaagGuru</span>
            <span style={{fontFamily:"'DM Sans',sans-serif",fontSize:9,fontWeight:500,color:"#9A7B50",letterSpacing:".18em",textTransform:"uppercase",alignSelf:"center",opacity:.7}}>presents</span>
          </div>
          <div style={{display:"flex",alignItems:"baseline",justifyContent:"center",gap:7}}>
            <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:600,color:"#1C1A17",lineHeight:1}}>Swara</span>
            <span style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:600,fontStyle:"italic",color:"#C05F2F",lineHeight:1}}>Slam</span>
          </div>
        </div>
        <h2 style={s.heading}>{copy[mode].h}</h2>
        <p style={s.sub}>{copy[mode].sub}</p>
        {mode === "forgot-sent" && (
          <div style={{textAlign:"center"}}>
            <div style={{fontSize:44,marginBottom:12}}>📬</div>
            <div style={{...s.success,marginBottom:20}}>
              We've sent a reset link to <strong>{email}</strong>. Check your inbox (and spam folder) — it expires in 1 hour.
            </div>
            <button style={s.btn} onClick={() => { setMode("login"); setError(""); setMessage(""); }}>Back to Log In</button>
          </div>
        )}
        {mode !== "forgot-sent" && (
          <form onSubmit={mode === "forgot" ? handleForgotPassword : handleSubmit} style={s.form}>
            <input type="text" name="website_verification" value={honeypot}
              onChange={e => setHoneypot(e.target.value)}
              style={{position:"absolute",left:"-9999px",width:1,height:1,opacity:0}} tabIndex={-1} autoComplete="off"/>
            <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)}
              required style={s.input} autoComplete="email"/>
            {mode !== "forgot" && (
              <input type="password"
                placeholder={mode === "signup" ? "Create a password (min. 6 chars)" : "Password"}
                value={password} onChange={e => setPassword(e.target.value)}
                required minLength={6} style={s.input}
                autoComplete={mode === "signup" ? "new-password" : "current-password"}/>
            )}
            {mode === "login" && (
              <button type="button" style={{...s.ghostLink,textAlign:"right",alignSelf:"flex-end"}}
                onClick={() => { setMode("forgot"); setError(""); setMessage(""); }}>Forgot password?</button>
            )}
            {mode === "signup" && (
              <>
                <label style={s.checkRow}>
                  <input type="checkbox" checked={termsAccepted} onChange={e => setTerms(e.target.checked)}
                    style={{width:16,height:16,accentColor:"#C05F2F",flexShrink:0,marginTop:2}}/>
                  <span>I agree to the{" "}
                    <a href="#" style={s.link} onClick={e => { e.preventDefault(); onOpenLegal(); }}>Terms & Conditions</a>
                    {" "}and{" "}
                    <a href="#" style={s.link} onClick={e => { e.preventDefault(); onOpenLegal(); }}>Privacy Policy</a>
                  </span>
                </label>
                <label style={s.checkRow}>
                  <input type="checkbox" checked={marketingConsent} onChange={e => setMktConsent(e.target.checked)}
                    style={{width:16,height:16,accentColor:"#C05F2F",flexShrink:0,marginTop:2}}/>
                  <span>Keep me in the loop on new RaagGuru features</span>
                </label>
              </>
            )}
            {error   && <div style={s.error} role="alert">{error}</div>}
            {message && <div style={s.success} role="status">{message}</div>}
            <button type="submit" disabled={loading || (mode === "signup" && !termsAccepted)}
              style={{...s.btn, opacity:(loading || (mode === "signup" && !termsAccepted)) ? 0.5 : 1}}>
              {loading ? "One moment…" : mode === "login" ? "Log In & Slam →" : mode === "forgot" ? "Send Reset Link" : "Create Account & Play"}
            </button>
            {mode === "forgot" && (
              <button type="button" style={{...s.ghostLink,textAlign:"center",alignSelf:"center"}}
                onClick={() => { setMode("login"); setError(""); }}>← Back to Log In</button>
            )}
          </form>
        )}
        {(mode === "signup" || mode === "login") && (
          <div style={s.toggle}>
            {mode === "login"
              ? <>Not a member?{" "}<button type="button" onClick={() => { setMode("signup"); setError(""); setMessage(""); }} style={s.toggleBtn}>Join the Arena</button></>
              : <>Already Slamming?{" "}<button type="button" onClick={() => { setMode("login"); setError(""); setMessage(""); }} style={s.toggleBtn}>Log In</button></>
            }
          </div>
        )}
      </div>
    </div>
  );
}
