import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase (anon — used for all user-facing operations) ────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── Supabase Admin (service role — used ONLY for AdminDashboard reads) ───────
// IMPORTANT: VITE_SUPABASE_SERVICE_ROLE_KEY must be set in your .env file.
// This key bypasses RLS. Never expose it to end users.
// The AdminDashboard component is only reachable via ?admin=true in the URL.
//
// FIX 1a — storageKey isolation:
// Two createClient() calls against the same project URL share the same
// localStorage key ("sb-<ref>-auth-token") by default in supabase-js v2.
// The service-role client has no user session; without isolation it can
// overwrite the anon client's stored JWT with null on initialisation,
// silently invalidating auth and breaking confirmation email flows.
// Setting a unique storageKey keeps the two clients' token storage separate.
const supabaseAdmin = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession:    false,   // service-role client never needs a persisted session
      autoRefreshToken:  false,   // no token to refresh
      detectSessionInUrl: false,  // don't let it intercept auth callback URLs
      storageKey: "sb-admin-auth-token", // isolated key — never conflicts with anon client
    },
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// ─── usePitchDetection Hook ───────────────────────────────────────────────────
// RULE #2: Fully encapsulated. No game state is read or written from inside.
// Accepts: isActive (bool), targetFreq (number)
// Returns: isMatch (bool), micError (string|null), retryMic (fn)
// ═══════════════════════════════════════════════════════════════════════════════
function usePitchDetection({ isActive, targetFreq }) {
  const [isMatch,  setIsMatch]  = useState(false);
  // ── NEW: micError holds a human-readable error string, or null if OK ──────
  const [micError, setMicError] = useState(null);

  const audioCtxRef    = useRef(null);
  const analyserRef    = useRef(null);
  const streamRef      = useRef(null);
  const sourceRef      = useRef(null);
  const rafRef         = useRef(null);
  const bufferRef      = useRef(null);
  const isActiveRef    = useRef(isActive);
  const targetFreqRef  = useRef(targetFreq);

  isActiveRef.current   = isActive;
  targetFreqRef.current = targetFreq;

  // ── Autocorrelation pitch detection ────────────────────────────────────────
  const detectPitch = useCallback((analyser, sampleRate) => {
    const buffer = bufferRef.current;
    analyser.getFloatTimeDomainData(buffer);

    let rms = 0;
    for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / buffer.length);
    if (rms < 0.012) return null;

    const n = buffer.length;
    let bestOffset = -1;
    let bestCorr   = 0;
    let lastCorr   = 1;
    let foundGo    = false;

    const minOffset = Math.floor(sampleRate / 1200);
    const maxOffset = Math.ceil(sampleRate / 50);

    for (let offset = minOffset; offset <= maxOffset; offset++) {
      let corr = 0;
      for (let i = 0; i < n - offset; i++) {
        corr += Math.abs(buffer[i] - buffer[i + offset]);
      }
      corr = 1 - corr / (n - offset);

      if (corr > 0.9 && corr > lastCorr) foundGo = true;
      if (foundGo && corr < lastCorr) {
        if (corr > bestCorr) { bestCorr = corr; bestOffset = offset - 1; }
        foundGo = false;
      }
      lastCorr = corr;
    }

    if (bestOffset === -1 || bestCorr < 0.92) return null;

    const corrAt = (offset) => {
      let c = 0;
      const len = n - offset;
      for (let i = 0; i < len; i++) c += Math.abs(buffer[i] - buffer[i + offset]);
      return 1 - c / len;
    };

    const prev = bestOffset > 0        ? corrAt(bestOffset - 1) : corrAt(bestOffset);
    const curr = bestCorr;
    const next = bestOffset < maxOffset ? corrAt(bestOffset + 1) : corrAt(bestOffset);

    const denom = 2 * (2 * curr - next - prev);
    const shift = denom !== 0 ? (next - prev) / denom : 0;
    return sampleRate / (bestOffset + shift);
  }, []);

  const freqToCents = (detected, target) => {
    if (!detected || !target || detected <= 0 || target <= 0) return Infinity;
    return 1200 * Math.log2(detected / target);
  };

  const checkMatchAcrossOctaves = useCallback((detectedHz, targetHz) => {
    if (!detectedHz || !targetHz) return false;
    for (const mult of [0.5, 1, 2]) {
      if (Math.abs(freqToCents(detectedHz, targetHz * mult)) <= 25) return true;
    }
    return false;
  }, []);

  const startLoop = useCallback(() => {
    const analyser   = analyserRef.current;
    const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;
    const loop = () => {
      if (!isActiveRef.current) { setIsMatch(false); return; }
      rafRef.current = requestAnimationFrame(loop);
      const hz = detectPitch(analyser, sampleRate);
      setIsMatch(checkMatchAcrossOctaves(hz, targetFreqRef.current));
    };
    rafRef.current = requestAnimationFrame(loop);
  }, [detectPitch, checkMatchAcrossOctaves]);

  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setIsMatch(false);
    try { sourceRef.current?.disconnect(); }  catch (e) {}
    try { analyserRef.current?.disconnect(); } catch (e) {}
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    try { audioCtxRef.current?.close(); } catch (e) {}
    audioCtxRef.current = null;
    bufferRef.current = null;
  }, []);

  // ── NEW: acquireMic — extracted so retryMic can call it independently ──────
  const acquireMic = useCallback(async () => {
    setMicError(null); // clear any previous error
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      return stream;
    } catch (err) {
      // Map DOMException names to friendly messages
      let msg = "Microphone unavailable. Scoring is disabled.";
      if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
        msg = "Microphone access was denied. Tap Retry to grant permission, or check your browser settings.";
      } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
        msg = "No microphone found. Connect a mic and tap Retry.";
      } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
        msg = "Microphone is in use by another app. Close it and tap Retry.";
      }
      console.warn("usePitchDetection:", err.name, err.message);
      setMicError(msg);
      setIsMatch(false);
      return null;
    }
  }, []);

  // ── Main effect: start / stop based on isActive ───────────────────────────
  useEffect(() => {
    if (!isActive) { teardown(); return; }

    let cancelled = false;
    (async () => {
      const stream = await acquireMic();
      if (!stream || cancelled) {
        if (stream) stream.getTracks().forEach(t => t.stop());
        return;
      }

      streamRef.current = stream;
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();

      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.0;
      analyserRef.current = analyser;
      bufferRef.current = new Float32Array(analyser.fftSize);

      const source = ctx.createMediaStreamSource(stream);
      source.connect(analyser);
      sourceRef.current = source;

      startLoop();
    })();

    return () => { cancelled = true; teardown(); };
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── NEW: retryMic — lets the user re-request permission after denial ───────
  // Tears down any stale audio context, clears the error, and re-acquires.
  const retryMic = useCallback(async () => {
    teardown();
    if (!isActiveRef.current) return;

    const stream = await acquireMic();
    if (!stream) return; // acquireMic already set micError

    streamRef.current = stream;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    audioCtxRef.current = ctx;
    if (ctx.state === "suspended") await ctx.resume();

    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.0;
    analyserRef.current = analyser;
    bufferRef.current = new Float32Array(analyser.fftSize);

    const source = ctx.createMediaStreamSource(stream);
    source.connect(analyser);
    sourceRef.current = source;

    startLoop();
  }, [teardown, acquireMic, startLoop]);

  return { isMatch, micError, retryMic };
}

// ─── MicErrorBanner ───────────────────────────────────────────────────────────
// Shown inside the game UI when usePitchDetection reports a mic error.
// Dismissible via the × button; has a Retry button that calls retryMic().
function MicErrorBanner({ message, onRetry, onDismiss }) {
  return (
    <div style={{
      width: "100%",
      maxWidth: 480,
      backgroundColor: "rgba(192,95,47,0.08)",
      border: "1px solid rgba(192,95,47,0.28)",
      borderRadius: 10,
      padding: "10px 14px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontFamily: "'DM Sans',sans-serif",
      fontSize: 12,
      color: "#7A3A18",
      lineHeight: 1.5,
    }}>
      {/* Warning icon */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C05F2F"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>

      <span style={{flex:1}}>{message}</span>

      {/* Retry button */}
      <button
        onClick={onRetry}
        style={{
          flexShrink: 0,
          fontFamily: "'DM Sans',sans-serif",
          fontSize: 11,
          fontWeight: 600,
          color: "#C05F2F",
          background: "none",
          border: "1.5px solid rgba(192,95,47,0.4)",
          borderRadius: 6,
          padding: "4px 10px",
          cursor: "pointer",
          letterSpacing: ".04em",
          whiteSpace: "nowrap",
        }}
      >
        Retry
      </button>

      {/* Dismiss × */}
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          flexShrink: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "rgba(192,95,47,0.5)",
          padding: 2,
          lineHeight: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}

// ─── AdminDashboard ───────────────────────────────────────────────────────────
// Protected admin view. Only rendered when showAdmin === true (set via ?admin=true URL param).
// Uses supabaseAdmin (service role) to bypass RLS and read all feedback rows.
// Status updates also use supabaseAdmin so they succeed regardless of user auth state.
function AdminDashboard({ onClose }) {
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");
  const [filter,     setFilter]     = useState("all"); // "all" | "new" | "reviewed" | "archived"
  const [updating,   setUpdating]   = useState(null);  // row id being updated

  const STATUS_OPTIONS = ["new", "reviewed", "archived"];

  const fetchFeedback = useCallback(async () => {
    setLoading(true); setError("");
    try {
      let q = supabaseAdmin
        .from("feedback")
        .select("*")
        .order("created_at", { ascending: false });
      if (filter !== "all") q = q.eq("status", filter);
      const { data, error: err } = await q;
      if (err) throw err;
      setRows(data || []);
    } catch (e) {
      setError("Failed to load feedback: " + (e.message || String(e)));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchFeedback(); }, [fetchFeedback]);

  const handleStatusChange = async (id, newStatus) => {
    setUpdating(id);
    try {
      const { error: err } = await supabaseAdmin
        .from("feedback")
        .update({ status: newStatus })
        .eq("id", id);
      if (err) throw err;
      setRows(prev => prev.map(r => r.id === id ? { ...r, status: newStatus } : r));
    } catch (e) {
      alert("Status update failed: " + e.message);
    } finally {
      setUpdating(null);
    }
  };

  const s = {
    overlay:  { position:"fixed",inset:0,backgroundColor:"rgba(28,26,23,0.92)",zIndex:999999,overflowY:"auto",fontFamily:"'DM Sans',sans-serif" },
    container:{ maxWidth:860,margin:"0 auto",padding:"32px 24px 48px" },
    header:   { display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28,borderBottom:"1px solid rgba(255,255,255,.1)",paddingBottom:20 },
    title:    { fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:600,color:"#F9F7F2",margin:0 },
    sub:      { fontSize:12,color:"rgba(249,247,242,.45)",letterSpacing:".1em",marginTop:4 },
    closeBtn: { background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)",color:"#F9F7F2",width:36,height:36,borderRadius:"50%",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 },
    filterRow:{ display:"flex",gap:8,marginBottom:20,flexWrap:"wrap" },
    filterBtn:{ fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,padding:"6px 16px",borderRadius:99,cursor:"pointer",transition:"background .15s,color .15s,border-color .15s",letterSpacing:".04em" },
    table:    { width:"100%",borderCollapse:"collapse" },
    th:       { fontFamily:"'DM Sans',sans-serif",fontSize:10,fontWeight:600,letterSpacing:".14em",textTransform:"uppercase",color:"rgba(154,123,80,1)",padding:"8px 12px",textAlign:"left",borderBottom:"1px solid rgba(255,255,255,.08)" },
    td:       { fontSize:13,color:"rgba(249,247,242,.8)",padding:"12px 12px",borderBottom:"1px solid rgba(255,255,255,.05)",verticalAlign:"top",lineHeight:1.55 },
    statusSel:{ fontFamily:"'DM Sans',sans-serif",fontSize:12,padding:"4px 8px",borderRadius:6,border:"1px solid rgba(255,255,255,.15)",background:"rgba(255,255,255,.06)",color:"#F9F7F2",cursor:"pointer",outline:"none" },
    badge:    { display:"inline-block",fontSize:10,fontWeight:600,letterSpacing:".1em",padding:"2px 8px",borderRadius:99,textTransform:"uppercase" },
    emptyMsg: { textAlign:"center",color:"rgba(249,247,242,.35)",padding:"40px 0",fontSize:14 },
  };

  const badgeStyle = (status) => {
    if (status === "new")      return { background:"rgba(192,95,47,.2)",color:"#E07040" };
    if (status === "reviewed") return { background:"rgba(46,125,50,.18)",color:"#4CAF50" };
    if (status === "archived") return { background:"rgba(255,255,255,.08)",color:"rgba(249,247,242,.4)" };
    return {};
  };

  const filterStyle = (f) => filter === f
    ? { background:"#9A7B50",color:"#fff",border:"1px solid #9A7B50" }
    : { background:"rgba(255,255,255,.05)",color:"rgba(249,247,242,.55)",border:"1px solid rgba(255,255,255,.12)" };

  const fmt = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("en-SG", { day:"numeric",month:"short",year:"2-digit" })
      + " " + d.toLocaleTimeString("en-SG", { hour:"2-digit",minute:"2-digit",hour12:false });
  };

  return (
    <div style={s.overlay}>
      <div style={s.container}>
        {/* Header */}
        <div style={s.header}>
          <div>
            <h1 style={s.title}>🔑 Feedback Admin</h1>
            <p style={s.sub}>Swara Slam · {rows.length} row{rows.length !== 1 ? "s" : ""} shown</p>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <button style={{...s.closeBtn,width:"auto",borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:600}}
              onClick={fetchFeedback}>↻ Refresh</button>
            <button style={s.closeBtn} onClick={onClose} aria-label="Close admin">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="#F9F7F2" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div style={s.filterRow}>
          {["all", ...STATUS_OPTIONS].map(f => (
            <button key={f} style={{...s.filterBtn,...filterStyle(f)}} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Loading / error / empty */}
        {loading && <p style={s.emptyMsg}>Loading…</p>}
        {!loading && error && <p style={{...s.emptyMsg,color:"#E07040"}}>{error}</p>}
        {!loading && !error && rows.length === 0 && (
          <p style={s.emptyMsg}>No feedback found{filter !== "all" ? ` with status "${filter}"` : ""}.</p>
        )}

        {/* Table */}
        {!loading && !error && rows.length > 0 && (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Date</th>
                <th style={s.th}>User</th>
                <th style={s.th}>Feedback</th>
                <th style={{...s.th,width:130}}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td style={{...s.td,whiteSpace:"nowrap",color:"rgba(249,247,242,.4)",fontSize:11}}>{fmt(row.created_at)}</td>
                  <td style={{...s.td,maxWidth:160,wordBreak:"break-all",fontSize:12,color:"rgba(154,123,80,1)"}}>
                    {row.user_email || "anon"}
                  </td>
                  <td style={s.td}>{row.feedback_text}</td>
                  <td style={s.td}>
                    {/* Badge for quick read */}
                    <span style={{...s.badge,...badgeStyle(row.status || "new"),marginBottom:6,display:"block",width:"fit-content"}}>
                      {row.status || "new"}
                    </span>
                    {/* Dropdown to change status */}
                    <select
                      style={{...s.statusSel, opacity: updating === row.id ? 0.5 : 1}}
                      value={row.status || "new"}
                      disabled={updating === row.id}
                      onChange={e => handleStatusChange(row.id, e.target.value)}
                    >
                      {STATUS_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────
function AuthModal({ onClose, onAuthSuccess, onOpenLegal, preferredMode = "signup" }) {
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

// ─── Reset Password Modal ─────────────────────────────────────────────────────
function ResetPasswordModal({ onSuccess }) {
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

// ─── Feedback Modal ───────────────────────────────────────────────────────────
function FeedbackModal({ user, onClose }) {
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

// ─── Cookie Consent Banner ────────────────────────────────────────────────────
function CookieBanner({ onAccept, onLearnMore }) {
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

// ─── Legal Modal (Terms & Privacy) ────────────────────────────────────────────
function LegalModal({ onClose }) {
  const [tab, setTab] = useState("terms");

  const s = {
    overlay:   { position:"fixed",inset:0,backgroundColor:"rgba(28,26,23,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999999,backdropFilter:"blur(5px)",padding:"1rem" },
    modal:     { backgroundColor:"#F9F7F2",borderRadius:16,padding:"32px",maxWidth:680,width:"100%",maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(192,95,47,0.22)",position:"relative",border:"2px solid #9A7B50" },
    closeBtn:  { position:"absolute",top:12,right:12,background:"none",border:"none",cursor:"pointer",padding:8,opacity:0.45,lineHeight:0 },
    heading:   { fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:600,color:"#1C1A17",margin:"0 0 16px",textAlign:"center" },
    tabs:      { display:"flex",gap:8,marginBottom:20,borderBottom:"1.5px solid #E5DFD3",paddingBottom:2 },
    tab:       { fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,padding:"8px 16px",background:"none",border:"none",cursor:"pointer",color:"#6B6560",borderBottom:"2.5px solid transparent",marginBottom:-2,transition:"color .15s, border-color .15s" },
    tabActive: { color:"#C05F2F",borderBottomColor:"#C05F2F" },
    content:   { fontFamily:"'DM Sans',sans-serif",fontSize:14,color:"#3C3935",lineHeight:1.7,overflowY:"auto",flex:1,paddingRight:8 },
    h2:        { fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:600,color:"#1C1A17",marginTop:24,marginBottom:10 },
    h3:        { fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:600,color:"#1C1A17",marginTop:18,marginBottom:8 },
    p:         { marginBottom:14 },
    ul:        { paddingLeft:22,marginBottom:14 },
    li:        { marginBottom:6 },
  };

  const termsContent = (
    <div>
      <p style={s.p}><strong>Effective Date:</strong> May 14, 2026<br/><strong>Last Updated:</strong> May 14, 2026</p>
      <p style={s.p}>Welcome to <strong>Swara Slam</strong>, a Hindustani Classical Music practice application operated by <strong>RaagGuru</strong> ("we," "us," or "our"). By accessing or using Swara Slam (the "App"), you agree to be bound by these Terms & Conditions. If you do not agree, do not use the App.</p>
      <h2 style={s.h2}>1. Intellectual Property & Ownership</h2>
      <p style={s.p}>All content, features, and functionality of Swara Slam — including but not limited to the "Slam" branding, pitch-detection algorithms, audio synthesis logic, user interface design, gamification mechanics, and scoring systems — are the exclusive property of RaagGuru and are protected by international copyright, trademark, and other intellectual property laws.</p>
      <p style={s.p}><strong>You may not:</strong></p>
      <ul style={s.ul}>
        <li style={s.li}>Reverse-engineer, decompile, or disassemble any part of the App's pitch-detection or audio generation logic.</li>
        <li style={s.li}>Extract, copy, or redistribute the App's proprietary algorithms or training data.</li>
        <li style={s.li}>Use the "Swara Slam" name, logo, or branding without our prior written consent.</li>
        <li style={s.li}>Create derivative works, clones, or competing products based on the App's functionality.</li>
      </ul>
      <h2 style={s.h2}>2. License to Use</h2>
      <p style={s.p}>Subject to your compliance with these Terms, RaagGuru grants you a limited, non-exclusive, non-transferable, revocable license to access and use Swara Slam for your personal, non-commercial practice and training purposes.</p>
      <h2 style={s.h2}>3. Right to Modify, Suspend, or Terminate</h2>
      <p style={s.p}><strong>RaagGuru reserves the right to modify, suspend, or discontinue Swara Slam (or any part of it) at any time, with or without notice, for any reason.</strong> We may update features, change pricing, alter content, or terminate the service entirely without liability to you or any third party.</p>
      <p style={s.p}>We also reserve the right to terminate or suspend your access to the App at our sole discretion if we believe you have violated these Terms or engaged in conduct harmful to the App, other users, or RaagGuru's interests.</p>
      <h2 style={s.h2}>4. User Conduct</h2>
      <p style={s.p}>You agree to use the App responsibly and lawfully. Prohibited conduct includes:</p>
      <ul style={s.ul}>
        <li style={s.li}>Attempting to hack, scrape, or exploit the App's infrastructure.</li>
        <li style={s.li}>Uploading malicious code or engaging in activity that disrupts the App's functionality.</li>
        <li style={s.li}>Impersonating other users or providing false information during account creation.</li>
        <li style={s.li}>Using the App for any unlawful purpose or in violation of any applicable regulations.</li>
      </ul>
      <h2 style={s.h2}>5. Payment & Subscriptions</h2>
      <p style={s.p}>Certain features of Swara Slam require payment ("Premium Access"). All payments are processed securely through Stripe. By purchasing Premium Access, you agree to Stripe's terms and authorize RaagGuru to charge your selected payment method.</p>
      <p style={s.p}><strong>Refund Policy:</strong> All sales are final. We do not offer refunds for Premium Access purchases except as required by law.</p>
      <h2 style={s.h2}>6. No Warranty & Disclaimer</h2>
      <p style={s.p}><strong>THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.</strong> RaagGuru makes no guarantees regarding:</p>
      <ul style={s.ul}>
        <li style={s.li}>The accuracy of pitch detection or scoring.</li>
        <li style={s.li}>Uninterrupted or error-free operation.</li>
        <li style={s.li}>Compatibility with all devices or browsers.</li>
        <li style={s.li}>Results, progress, or skill improvement from using the App.</li>
      </ul>
      <p style={s.p}><strong>Health & Safety:</strong> Vocal practice can cause strain. Use the App responsibly and stop immediately if you experience discomfort. RaagGuru is not liable for any vocal injury, hearing damage, or hardware issues arising from your use of the App.</p>
      <h2 style={s.h2}>7. Limitation of Liability</h2>
      <p style={s.p}>TO THE MAXIMUM EXTENT PERMITTED BY LAW, RAAGGURU SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, OR USE, ARISING FROM YOUR USE OF THE APP, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</p>
      <h2 style={s.h2}>8. Indemnification</h2>
      <p style={s.p}>You agree to indemnify and hold harmless RaagGuru, its affiliates, and their respective officers, directors, and employees from any claims, damages, or expenses arising from your use of the App or violation of these Terms.</p>
      <h2 style={s.h2}>9. Governing Law</h2>
      <p style={s.p}>These Terms are governed by the laws of Singapore, without regard to its conflict of law principles. Any disputes shall be resolved exclusively in the courts of Singapore.</p>
      <h2 style={s.h2}>10. Changes to Terms</h2>
      <p style={s.p}>We may update these Terms from time to time. Continued use of the App after changes constitutes acceptance of the revised Terms. We will notify users of material changes via email or in-app notification.</p>
      <h2 style={s.h2}>11. Contact</h2>
      <p style={s.p}>For questions about these Terms, contact us via the in-app feedback feature or email <strong>legal@raagguru.com</strong> (placeholder).</p>
    </div>
  );

  const privacyContent = (
    <div>
      <p style={s.p}><strong>Effective Date:</strong> May 14, 2026<br/><strong>Last Updated:</strong> May 14, 2026</p>
      <p style={s.p}>RaagGuru ("we," "us," or "our") respects your privacy. This Privacy Policy explains how we collect, use, and protect your information when you use <strong>Swara Slam</strong> (the "App").</p>
      <h2 style={s.h2}>1. Information We Collect</h2>
      <h3 style={s.h3}>a. Account Information</h3>
      <p style={s.p}>When you create an account, we collect your <strong>email address</strong> and a securely hashed <strong>password</strong> (via Supabase authentication). Your email is used for account management, password recovery, and transactional communications.</p>
      <h3 style={s.h3}>b. Usage Data</h3>
      <p style={s.p}>We collect information about how you interact with the App, including:</p>
      <ul style={s.ul}>
        <li style={s.li}>Level progress, set completion, and scoring data.</li>
        <li style={s.li}>Pitch detection metrics (note accuracy, timing, BPM settings).</li>
        <li style={s.li}>Session duration and feature usage (e.g., Tanpura drone on/off, Sa pitch selection).</li>
      </ul>
      <h3 style={s.h3}>c. Device & Browser Information</h3>
      <p style={s.p}>We may collect technical information such as your browser type, device model, operating system, IP address, and screen resolution.</p>
      <h3 style={s.h3}>d. Cookies & Analytics</h3>
      <ul style={s.ul}>
        <li style={s.li}><strong>Essential Cookies:</strong> Required for authentication and session management (e.g., Supabase session tokens).</li>
        <li style={s.li}><strong>Analytics Cookies:</strong> Used to understand user behavior and improve the App (e.g., Google Analytics, Facebook Pixel — to be implemented).</li>
        <li style={s.li}><strong>Preference Cookies:</strong> Store your settings (e.g., cookie consent, walkthrough dismissal).</li>
      </ul>
      <h3 style={s.h3}>e. Microphone Access</h3>
      <p style={s.p}>The App requests <strong>microphone access</strong> to enable real-time pitch detection. Audio is processed locally in your browser and is <strong>not recorded, stored, or transmitted</strong> to our servers.</p>
      <h3 style={s.h3}>f. Feedback Submissions</h3>
      <p style={s.p}>When you submit feedback via the in-app modal, we collect your <strong>user ID</strong> (if logged in), <strong>email address</strong>, and the <strong>feedback text</strong>.</p>
      <h2 style={s.h2}>2. How We Use Your Information</h2>
      <ul style={s.ul}>
        <li style={s.li}>Provide, operate, and maintain the App.</li>
        <li style={s.li}>Personalize your practice experience.</li>
        <li style={s.li}>Process payments and manage subscriptions (via Stripe).</li>
        <li style={s.li}>Send transactional emails (e.g., password resets, payment confirmations).</li>
        <li style={s.li}>Analyze usage patterns to improve features and fix bugs.</li>
        <li style={s.li}>Respond to feedback and support inquiries.</li>
        <li style={s.li}>Comply with legal obligations and enforce our Terms & Conditions.</li>
      </ul>
      <h2 style={s.h2}>3. Information Sharing</h2>
      <p style={s.p}>We <strong>do not sell</strong> your personal information. We may share your data in the following limited circumstances:</p>
      <ul style={s.ul}>
        <li style={s.li}><strong>Service Providers:</strong> Supabase, Stripe, Vercel, future analytics providers.</li>
        <li style={s.li}><strong>Legal Compliance:</strong> If required by law or to protect our rights and safety.</li>
        <li style={s.li}><strong>Business Transfers:</strong> In the event of a merger or acquisition.</li>
      </ul>
      <h2 style={s.h2}>4. Data Security</h2>
      <ul style={s.ul}>
        <li style={s.li}>Encrypted HTTPS connections.</li>
        <li style={s.li}>Secure password hashing (bcrypt via Supabase).</li>
        <li style={s.li}>Role-based access controls (RLS) on our database.</li>
      </ul>
      <h2 style={s.h2}>5. Data Retention</h2>
      <p style={s.p}>We retain your account data for as long as your account is active. You may request account deletion via the feedback feature or <strong>privacy@raagguru.com</strong> (placeholder). Your data will be permanently removed within 30 days.</p>
      <h2 style={s.h2}>6. Your Rights</h2>
      <ul style={s.ul}>
        <li style={s.li}><strong>Access:</strong> Request a copy of your personal data.</li>
        <li style={s.li}><strong>Correction:</strong> Update or correct inaccurate information.</li>
        <li style={s.li}><strong>Deletion:</strong> Request deletion of your account and associated data.</li>
        <li style={s.li}><strong>Opt-Out:</strong> Unsubscribe from marketing emails.</li>
        <li style={s.li}><strong>Data Portability:</strong> Request your data in a machine-readable format.</li>
      </ul>
      <h2 style={s.h2}>7. Children's Privacy</h2>
      <p style={s.p}>Swara Slam is not intended for children under 13. We do not knowingly collect personal information from children.</p>
      <h2 style={s.h2}>8. International Data Transfers</h2>
      <p style={s.p}>Your data may be processed on servers outside your country of residence. By using the App, you consent to this transfer.</p>
      <h2 style={s.h2}>9. Changes to This Policy</h2>
      <p style={s.p}>We may update this Privacy Policy from time to time. Material changes will be communicated via email or in-app notification.</p>
      <h2 style={s.h2}>10. Contact Us</h2>
      <p style={s.p}>For privacy inquiries, contact us via the in-app feedback feature or email <strong>privacy@raagguru.com</strong> (placeholder).</p>
    </div>
  );

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <button style={s.closeBtn} onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="#1C1A17" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <h1 style={s.heading}>Legal</h1>
        <div style={s.tabs}>
          <button style={{...s.tab,...(tab==="terms"?s.tabActive:{})}} onClick={()=>setTab("terms")}>Terms & Conditions</button>
          <button style={{...s.tab,...(tab==="privacy"?s.tabActive:{})}} onClick={()=>setTab("privacy")}>Privacy Policy</button>
        </div>
        <div style={s.content}>{tab === "terms" ? termsContent : privacyContent}</div>
      </div>
    </div>
  );
}

// ─── Paywall Screen ───────────────────────────────────────────────────────────
// ABSOLUTE SOURCE OF TRUTH: reads localStorage directly.
// Profile fetch errors (HTTP 400, RLS gaps, network failures) have zero effect
// on what this component displays. Database state is never consulted here.
function PaywallScreen({ onCheckout, redirecting, redirectingPriceId }) {
  const btnBase = { fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,padding:"13px 24px",color:"#fff",border:"none",borderRadius:8,cursor:redirecting?"not-allowed":"pointer",width:"100%" };
  const isRedirecting = (priceId) => redirecting && redirectingPriceId === priceId;

  // Reads localStorage at render time — always the live count, never stale.
  const actualPlays = Number(localStorage.getItem('swaraslam_free_plays') || 0);
  const piecesRemaining = Math.max(0, 5 - actualPlays);
  const dynamicSubtitle = actualPlays >= 5
    ? "You've mastered your first 5 sets! To continue your Riyaz and unlock all 4 levels, choose a plan below."
    : actualPlays > 0
      ? `You have [${piecesRemaining}] Free slam${piecesRemaining === 1 ? "" : "s"} remaining. To continue Swara slamming and unlock all levels, choose a plan below.`
      : "Level 1 is free. Unlock chromatic swaras, advanced jumps, and three octaves with full access.";

  return (
    <div style={{width:"100%",maxWidth:480,margin:"0 auto",display:"flex",flexDirection:"column",alignItems:"center",gap:20,padding:"32px 16px"}}>
      <div style={{fontSize:44}}>🔒</div>
      <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:600,color:"#1C1A17",margin:0,textAlign:"center"}}>Unlock All 4 Levels</h2>
      <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:14,color:"#6B6560",textAlign:"center",margin:0,maxWidth:360,lineHeight:1.6}}>{dynamicSubtitle}</p>
      <div style={{display:"flex",gap:16,flexWrap:"wrap",justifyContent:"center",width:"100%",marginTop:8}}>
        <div style={{background:"#fff",border:"1.5px solid #E5DFD3",borderRadius:14,padding:"22px 20px",flex:"1 1 180px",maxWidth:220,textAlign:"center"}}>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#9A7B50",fontWeight:700,letterSpacing:".12em",marginBottom:8}}>24-HOUR PASS</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,fontWeight:600,color:"#1C1A17",lineHeight:1,marginBottom:4}}>$1.99</div>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#6B6560",marginBottom:16}}>Try all levels for a day</div>
          <button disabled={redirecting} onClick={() => onCheckout("price_1TVpF4CevGY65XqM13lijglp")}
            style={{...btnBase,background:"#9A7B50",opacity:isRedirecting("price_1TVpF4CevGY65XqM13lijglp")?0.6:redirecting?0.3:1}}>
            {isRedirecting("price_1TVpF4CevGY65XqM13lijglp") ? "Redirecting…" : "Get 24-Hour Access"}
          </button>
        </div>
        <div style={{background:"linear-gradient(135deg,rgba(192,95,47,0.08),rgba(154,123,80,0.08))",border:"2px solid #C05F2F",borderRadius:14,padding:"22px 20px",flex:"1 1 180px",maxWidth:220,textAlign:"center",position:"relative"}}>
          <div style={{position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",background:"#C05F2F",color:"#fff",padding:"3px 12px",borderRadius:20,fontSize:10,fontWeight:700,fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>BEST VALUE</div>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#C05F2F",fontWeight:700,letterSpacing:".12em",marginBottom:8}}>LIFETIME ACCESS</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,fontWeight:600,color:"#C05F2F",lineHeight:1,marginBottom:4}}>$9.99</div>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#6B6560",marginBottom:16}}>Unlock forever</div>
          <button disabled={redirecting} onClick={() => onCheckout("price_1TVpF0CevGY65XqMgLukQcWc")}
            style={{...btnBase,background:"#C05F2F",boxShadow:"0 4px 12px rgba(192,95,47,0.3)",opacity:isRedirecting("price_1TVpF0CevGY65XqMgLukQcWc")?0.6:redirecting?0.3:1}}>
            {isRedirecting("price_1TVpF0CevGY65XqMgLukQcWc") ? "Redirecting…" : "✦ Get Lifetime Access"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Inline Icons ─────────────────────────────────────────────────────────────
const Play     = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>;
const Pause    = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>;
const Volume2  = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>;
const VolumeX  = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>;
const SkipFwd  = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="5,4 15,12 5,20"/><line x1="19" y1="4" x2="19" y2="20"/></svg>;
const SkipBack = () => <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="19,4 9,12 19,20"/><line x1="5" y1="4" x2="5" y2="20"/></svg>;

// ─── Constants ────────────────────────────────────────────────────────────────
const SA_PITCHES = [
  { label:"C",  freq:130.81 }, { label:"C#", freq:138.59 },
  { label:"D",  freq:146.83 }, { label:"D#", freq:155.56 },
  { label:"E",  freq:164.81 }, { label:"F",  freq:174.61 },
  { label:"F#", freq:185.00 }, { label:"G",  freq:196.00 },
  { label:"G#", freq:207.65 }, { label:"A",  freq:220.00 },
  { label:"A#", freq:233.08 }, { label:"B",  freq:246.94 },
];

const ALL_SWARAS_BASE = [
  { name:"Sa",   short:"S",  dv:"स",   ratio:1.0000, semitone:0  },
  { name:"Re♭",  short:"r",  dv:"रे♭", ratio:1.0667, semitone:1  },
  { name:"Re",   short:"R",  dv:"रे",  ratio:1.1250, semitone:2  },
  { name:"Ga♭",  short:"g",  dv:"ग♭",  ratio:1.2000, semitone:3  },
  { name:"Ga",   short:"G",  dv:"ग",   ratio:1.2500, semitone:4  },
  { name:"Ma",   short:"m",  dv:"म",   ratio:1.3333, semitone:5  },
  { name:"Ma#",  short:"M",  dv:"म#",  ratio:1.4063, semitone:6  },
  { name:"Pa",   short:"P",  dv:"प",   ratio:1.5000, semitone:7  },
  { name:"Dha♭", short:"d",  dv:"ध♭",  ratio:1.6000, semitone:8  },
  { name:"Dha",  short:"D",  dv:"ध",   ratio:1.6667, semitone:9  },
  { name:"Ni♭",  short:"n",  dv:"नि♭", ratio:1.7778, semitone:10 },
  { name:"Ni",   short:"N",  dv:"नि",  ratio:1.8750, semitone:11 },
  { name:"Sa'",  short:"S'", dv:"सं",  ratio:2.0000, semitone:12 },
];

const buildThreeOctavePool = (idxArr) =>
  [0,1,2].flatMap(oct =>
    idxArr.map(i => {
      const b = ALL_SWARAS_BASE[i];
      const rm = oct === 0 ? 0.5 : oct === 2 ? 2.0 : 1.0;
      return { ...b, octave: oct, ratio: b.ratio * rm, absSemitone: b.semitone + (oct - 1) * 13 };
    })
  );

const SHUDDHA_IDX = [0,2,4,5,7,9,11,12];
const ALL_IDX     = [0,1,2,3,4,5,6,7,8,9,10,11,12];

const LEVEL_CONFIG = [
  { label:"Shuddha",        pool: SHUDDHA_IDX.map(i => ({ ...ALL_SWARAS_BASE[i], octave:1, absSemitone: ALL_SWARAS_BASE[i].semitone })), maxJump:3  },
  { label:"Komal & Tivra",  pool: ALL_IDX.map(i => ({ ...ALL_SWARAS_BASE[i], octave:1, absSemitone: ALL_SWARAS_BASE[i].semitone })),     maxJump:6  },
  { label:"Advanced Jumps", pool: ALL_IDX.map(i => ({ ...ALL_SWARAS_BASE[i], octave:1, absSemitone: ALL_SWARAS_BASE[i].semitone })),     maxJump:13 },
  { label:"Three Octaves",  pool: buildThreeOctavePool(ALL_IDX),                                                                          maxJump:13 },
];

const SETS_PER_LEVEL = 5;
const BASE_BPM       = 80;
const BPM_INCREMENT  = 20;
const LEAD_IN_BEATS  = 4;
const ACTIVE_BEATS   = 8;
const NOTE_DUR       = 0.36;
const CLICK_FREQ     = 1200;
const CLICK_DUR      = 0.018;

// ─── Card Generation ──────────────────────────────────────────────────────────
function generateCards(levelIdx) {
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

// ─── Confetti ─────────────────────────────────────────────────────────────────
function Confetti({ active }) {
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

// ─── Audio Engine ─────────────────────────────────────────────────────────────
function useAudioEngine() {
  const ctxRef        = useRef(null);
  const droneNodesRef = useRef([]);
  const schedTimerRef = useRef(null);
  const nextBeatRef   = useRef(0);
  const beatCountRef  = useRef(0);

  const getCtx = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed")
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    return ctxRef.current;
  }, []);

  const stopDrone = useCallback(() => {
    droneNodesRef.current.forEach(n => { try { n.stop(); n.disconnect(); } catch(e){} });
    droneNodesRef.current = [];
  }, []);

  const startDrone = useCallback((freq) => {
    stopDrone();
    const ctx = getCtx(), master = ctx.createGain();
    master.gain.setValueAtTime(0.28, ctx.currentTime);
    master.connect(ctx.destination);
    [[1,.28],[2,.11],[3,.06],[5,.035]].forEach(([m,a]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(freq*m, ctx.currentTime);
      g.gain.setValueAtTime(a, ctx.currentTime); o.connect(g); g.connect(master); o.start();
      droneNodesRef.current.push(o);
    });
    const pf = freq * 1.5;
    [[1,.07],[2,.03]].forEach(([m,a]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(pf*m, ctx.currentTime);
      g.gain.setValueAtTime(a, ctx.currentTime); o.connect(g); g.connect(master); o.start();
      droneNodesRef.current.push(o);
    });
  }, [stopDrone, getCtx]);

  const playGuruNote = useCallback((freq, t) => {
    const ctx = getCtx(), master = ctx.createGain();
    master.gain.setValueAtTime(0, t);
    master.gain.linearRampToValueAtTime(0.24, t + 0.035);
    master.gain.setValueAtTime(0.19, t + 0.10);
    master.gain.linearRampToValueAtTime(0, t + NOTE_DUR);
    master.connect(ctx.destination);
    [[1,1.0],[2,0.26],[3,0.07]].forEach(([m,a]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(freq*m, t);
      g.gain.setValueAtTime(a, t); o.connect(g); g.connect(master);
      o.start(t); o.stop(t + NOTE_DUR + 0.02);
    });
  }, [getCtx]);

  const scheduleBeats = useCallback((bpm, totalBeats, onBeat, onDone) => {
    const ctx = getCtx(), spb = 60 / bpm;
    const schedAhead = 0.12, lookAhead = 25;
    let scheduled = 0;
    const tick = () => {
      while (nextBeatRef.current < ctx.currentTime + schedAhead && scheduled < totalBeats) {
        const t = nextBeatRef.current, beat = beatCountRef.current, isDown = beat % 4 === 0;
        const buf = ctx.createBuffer(1, ctx.sampleRate * CLICK_DUR, ctx.sampleRate);
        const d = buf.getChannelData(0), cf = isDown ? CLICK_FREQ : CLICK_FREQ * 0.65;
        for (let i = 0; i < d.length; i++)
          d[i] = Math.sin(2*Math.PI*cf*i/ctx.sampleRate) * Math.exp(-i/(ctx.sampleRate*0.008));
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buf; g.gain.setValueAtTime(isDown ? 0.52 : 0.26, t);
        src.connect(g); g.connect(ctx.destination); src.start(t);
        const delay = Math.max(0, (t - ctx.currentTime) * 1000);
        const cb = beat, cs = scheduled;
        setTimeout(() => onBeat(cb % 4, isDown, cs, t), delay);
        nextBeatRef.current += spb; beatCountRef.current++; scheduled++;
      }
      if (scheduled < totalBeats) {
        schedTimerRef.current = setTimeout(tick, lookAhead);
      } else {
        const lastT = nextBeatRef.current - spb;
        const doneDelay = Math.max(0, (lastT - (ctxRef.current?.currentTime ?? 0)) * 1000) + 300;
        schedTimerRef.current = setTimeout(onDone, doneDelay);
      }
    };
    nextBeatRef.current = ctx.currentTime + 0.08; beatCountRef.current = 0; tick();
  }, [getCtx]);

  const stopScheduler   = useCallback(() => { clearTimeout(schedTimerRef.current); schedTimerRef.current = null; }, []);
  const resumeCtx       = useCallback(() => { if (ctxRef.current?.state === "suspended") ctxRef.current.resume(); }, []);
  const updateDroneFreq = useCallback((freq) => {
    if (!droneNodesRef.current.length || !ctxRef.current) return;
    const t = ctxRef.current.currentTime + 0.05;
    [freq,freq*2,freq*3,freq*5,freq*1.5,freq*3].forEach((f,i) => {
      try { if (droneNodesRef.current[i]) droneNodesRef.current[i].frequency.setTargetAtTime(f, t, 0.1); } catch(e){}
    });
  }, []);

  const playSetDing = useCallback(() => {
    const ctx = getCtx(), t = ctx.currentTime + 0.05;
    [[880,0],[1320,0.12]].forEach(([freq,delay]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle"; o.frequency.setValueAtTime(freq, t+delay);
      g.gain.setValueAtTime(0, t+delay);
      g.gain.linearRampToValueAtTime(0.18, t+delay+0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t+delay+0.45);
      o.connect(g); g.connect(ctx.destination); o.start(t+delay); o.stop(t+delay+0.5);
    });
  }, [getCtx]);

  const playLevelUpArp = useCallback(() => {
    const ctx = getCtx(), t = ctx.currentTime + 0.08;
    const freqs = [261.63,293.66,329.63,392.00,523.25];
    freqs.forEach((freq,i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "square"; o.frequency.setValueAtTime(freq, t+i*0.11);
      g.gain.setValueAtTime(0, t+i*0.11);
      g.gain.linearRampToValueAtTime(0.08, t+i*0.11+0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t+i*0.11+0.22);
      o.connect(g); g.connect(ctx.destination); o.start(t+i*0.11); o.stop(t+i*0.11+0.25);
    });
    [[261.63,392.00]].forEach(([f]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(f*2, t+freqs.length*0.11);
      g.gain.setValueAtTime(0.1, t+freqs.length*0.11);
      g.gain.exponentialRampToValueAtTime(0.001, t+freqs.length*0.11+0.6);
      o.connect(g); g.connect(ctx.destination);
      o.start(t+freqs.length*0.11); o.stop(t+freqs.length*0.11+0.65);
    });
  }, [getCtx]);

  const playGrandSlamFanfare = useCallback(() => {
    const ctx = getCtx(), t = ctx.currentTime + 0.08;
    const freqs = [261.63,293.66,329.63,349.23,392.00,440.00,493.88,523.25];
    freqs.forEach((freq,i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = i<4?"square":"triangle"; o.frequency.setValueAtTime(freq, t+i*0.09);
      g.gain.setValueAtTime(0, t+i*0.09);
      g.gain.linearRampToValueAtTime(0.09, t+i*0.09+0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t+i*0.09+0.3);
      o.connect(g); g.connect(ctx.destination); o.start(t+i*0.09); o.stop(t+i*0.09+0.35);
    });
    [523.25,659.25,783.99].forEach((freq,i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(freq, t+freqs.length*0.09);
      g.gain.setValueAtTime(0.09-i*0.02, t+freqs.length*0.09);
      g.gain.exponentialRampToValueAtTime(0.001, t+freqs.length*0.09+1.2);
      o.connect(g); g.connect(ctx.destination);
      o.start(t+freqs.length*0.09); o.stop(t+freqs.length*0.09+1.3);
    });
  }, [getCtx]);

  return { startDrone, stopDrone, scheduleBeats, stopScheduler, resumeCtx, updateDroneFreq, playGuruNote, playSetDing, playLevelUpArp, playGrandSlamFanfare };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function SwaraCard({ swara, state, pitchMatched }) {
  const oct = swara.octave ?? 1;
  return (
    <div className={"swara-card card-" + state + (pitchMatched ? " card-match" : "")}>
      <span className="card-dv">{swara.dv}</span>
      <span className={"card-name" + (oct === 0 ? " oct-mandra" : "")}>
        {swara.short}{oct === 2 && <span className="oct-dot-above">·</span>}
      </span>
    </div>
  );
}

function BeatDots({ beat, active }) {
  return (
    <div className="beat-dots">
      {[0,1,2,3].map(i => (
        <div key={i} className={"beat-dot" + (active && beat === i ? (i===0?" dot-dn":" dot-up") : "")}/>
      ))}
    </div>
  );
}

function BpmFlash({ bpm, visible }) {
  return <div className={"bpm-flash" + (visible ? " bpm-flash-in" : "")}>{"\u2669"} {bpm} BPM</div>;
}

const WT_STEPS = [
  { title:"Welcome to Swara Slam!", body:"Sing Sargam (Sa Re Ga Ma…) in sync with the rhythm. The Guru plays each note — you sing along. Simple, powerful Riyaz." },
  { title:"The Card Grid", body:"8 Swara cards light up one by one. Sing the highlighted note in time with the beat. Cards show the Devanagari symbol and Sargam notation." },
  { title:"Beat & Tanpura Drone", body:"The 4 dots pulse with the metronome — downbeat lights terracotta, upbeats light gold. Toggle the Tanpura drone on/off with the volume icon." },
  { title:"Tune Your Practice", body:"Use the BPM slider to set your tempo. Change the Sa pitch to match your vocal range. BPM auto-increases each set as you progress." },
  { title:"Levels & Sets", body:"Each level has 5 sets. Complete all 5 to advance. Level 1 is free — unlock Full Access for Levels 2–4 with chromatic notes and wider jumps." },
];

const TOTAL_PER_LEVEL  = ACTIVE_BEATS * SETS_PER_LEVEL;
const TOTAL_ALL_LEVELS = TOTAL_PER_LEVEL * LEVEL_CONFIG.length;

function getTitleForPct(pct) {
  if (pct <= 20) return { title: "Shishya", emoji: "🌱", color: "#9A7B50" };
  if (pct <= 40) return { title: "Sadhak",  emoji: "🔥", color: "#C05F2F" };
  if (pct <= 59) return { title: "Gyani",   emoji: "⚡", color: "#C05F2F" };
  if (pct <= 79) return { title: "Pundit",  emoji: "🎯", color: "#1C1A17" };
  return              { title: "Guru",     emoji: "✦",  color: "#9A7B50"  };
}

function getLevelSummaryMessage(score, total) {
  const pct = Math.round((score / total) * 100);
  const { title, emoji } = getTitleForPct(pct);
  if (pct === 100) return { msg: `Perfect Slam! You nailed all ${total}. ${emoji} Guru status — the Swara is strong with you.`, title, emoji };
  if (pct >= 80)  return { msg: `You Swara Slammed it! ${score}/${total} nailed. ${emoji} ${title} status achieved — you're on fire!`, title, emoji };
  if (pct >= 60)  return { msg: `Solid Slam! ${score} out of ${total}. ${emoji} ${title} vibes. Keep Swara Slamming to reach Guru!`, title, emoji };
  if (pct >= 41)  return { msg: `Nice hustle! ${score}/${total} right. ${emoji} ${title} level — your Swara game is building!`, title, emoji };
  if (pct >= 21)  return { msg: `${score}/${total} this round. ${emoji} ${title} status. Every Slam counts — slam again!`, title, emoji };
  return               { msg: `${score}/${total} — keep at it, ${emoji} ${title}! The Riyaz will sharpen you. Ready to Slam again?`, title, emoji };
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function SwaraSlamApp() {

  const [screen, setScreen] = useState("home");
  const [authMode, setAuthMode] = useState("signup");

  // ── NEW: Admin dashboard visibility ───────────────────────────────────────
  // showAdmin is set to true only when ?admin=true is present in the URL.
  // It renders AdminDashboard as a fixed overlay on top of any screen.
  const [showAdmin, setShowAdmin] = useState(false);

  // Game
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [droneOn,      setDroneOn]      = useState(true);
  const [saIndex,      setSaIndex]      = useState(0);
  const [level,        setLevel]        = useState(0);
  const [setNum,       setSetNum]       = useState(0);
  const [cards,        setCards]        = useState(() => generateCards(0));
  const [currentCards, setCurrentCards] = useState(null);
  const [phase,        setPhase]        = useState("idle");
  const [activeCard,   setActiveCard]   = useState(-1);
  const [dotBeat,      setDotBeat]      = useState(-1);
  const [bpm,          setBpm]          = useState(BASE_BPM);
  const [manualBpm,    setManualBpm]    = useState(false);
  const [bpmFlash,     setBpmFlash]     = useState(false);
  const [confetti,     setConfetti]     = useState(false);
  const [allLevelsUp,  setAllLevelsUp]  = useState(false);
  const [showFeedback,     setShowFeedback]     = useState(false);
  const [showCookieBanner, setShowCookieBanner] = useState(false);
  const [showLegalModal,   setShowLegalModal]   = useState(false);

  // Scoring & pitch detection
  const [score,       setScore]       = useState(0);
  const [scoredCards, setScoredCards] = useState(new Set());
  const scoredCardsRef = useRef(new Set());
  const [micActive,   setMicActive]   = useState(false);

  // ── NEW: micErrorDismissed — lets user hide the banner without retrying ───
  const [micErrorDismissed, setMicErrorDismissed] = useState(false);

  // ── FREE PLAY LIMIT ────────────────────────────────────────────────────────
  // freePlayCount: number of sets completed on Level 1 by a non-premium user.
  // Incremented inside advanceSet whenever lvl === 0 and !isPremiumRef.current.
  // When it reaches FREE_PLAY_LIMIT the paywall is shown with custom copy
  // instead of allowing a 6th set to begin.
  // A ref mirror (freePlayCountRef) is used inside the advanceSet callback
  // so the closure always reads the latest value without needing it as a dep.
  const FREE_PLAY_LIMIT = 5;
  // localStorage persistence — survives page reloads and React re-mounts.
  // The lazy initializer runs once; the ref is seeded from the same value
  // so the onDone closure always reads the persisted count correctly.
  const [freePlayCount, setFreePlayCount] = useState(() => {
    return Number(localStorage.getItem('swaraslam_free_plays') || 0);
  });
  const freePlayCountRef = useRef(
    Number(localStorage.getItem('swaraslam_free_plays') || 0)
  );

  // Cumulative level scoring
  const [levelTotalScore,  setLevelTotalScore]  = useState(0);
  const levelTotalScoreRef = useRef(0);
  const [levelSummaryData, setLevelSummaryData] = useState(null);
  const [grandSlamScore,   setGrandSlamScore]   = useState(0);
  const grandSlamScoreRef  = useRef(0);
  const scoreRef = useRef(0);

  const activeCardRef = useRef(activeCard);
  activeCardRef.current = activeCard;
  scoreRef.current = score;

  // Auth / paywall
  const [user,               setUser]               = useState(null);
  const [isPremium,          setIsPremium]          = useState(false);
  const [hasCompletedLevel1, setHasCompletedLevel1] = useState(false);
  // profileLoadError: true when loadProfile fails (400, network, no row).
  // Used for diagnostics only — never clears freePlayCount or gating state.
  const [profileLoadError,   setProfileLoadError]   = useState(false);
  const [paywallRedirecting, setPaywallRedirecting] = useState(false);
  const [redirectingPriceId, setRedirectingPriceId] = useState(null);
  const [highestBpm,         setHighestBpm]         = useState(BASE_BPM);

  // Walkthrough
  const [showWalkthrough, setShowWalkthrough] = useState(false);
  const [walkthroughStep, setWalkthroughStep] = useState(0);

  // Install banner
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [deferredPrompt,    setDeferredPrompt]    = useState(null);

  // Refs
  const saIdxRef      = useRef(saIndex);
  const cardsRef      = useRef(cards);
  const levelRef      = useRef(level);
  const setNumRef     = useRef(setNum);
  const userRef       = useRef(user);
  const sessionRef    = useRef(null);   // stores full session including access_token
  const isPremiumRef  = useRef(isPremium);
  const manualBpmRef  = useRef(manualBpm);
  const bpmRef        = useRef(bpm);
  const highestBpmRef = useRef(highestBpm);
  const engine        = useAudioEngine();
  // ── Profile fetch lock — prevents infinite loop ───────────────────────
  // onAuthStateChange fires on every auth event including token refreshes
  // triggered by checkPremiumStatus. Without this lock, each refreshSession()
  // call emits SIGNED_IN → loadProfile → error → re-render → repeat.
  // hasFetchedProfile gates loadProfile to exactly one call per session.
  // Reset to false on logout so the next login gets a fresh fetch.
  const hasFetchedProfile = useRef(false);

  saIdxRef.current = saIndex; cardsRef.current = cards; levelRef.current = level;
  setNumRef.current = setNum; userRef.current = user; isPremiumRef.current = isPremium;
  manualBpmRef.current = manualBpm; bpmRef.current = bpm; highestBpmRef.current = highestBpm;

  const autoBpm = BASE_BPM + setNum * BPM_INCREMENT;

  // ── usePitchDetection — now also returns micError + retryMic ──────────────
  const activeCardData = (cardsRef.current && activeCard >= 0 && activeCard < cardsRef.current.length)
    ? cardsRef.current[activeCard] : null;
  const targetFreq = activeCardData ? SA_PITCHES[saIndex].freq * activeCardData.ratio : -1;

  const { isMatch, micError, retryMic } = usePitchDetection({
    isActive:   micActive && phase === "active" && activeCard >= 0,
    targetFreq: targetFreq > 0 ? targetFreq : 1,
  });

  // ── Clear micErrorDismissed when a new set starts ─────────────────────────
  useEffect(() => {
    if (phase === "leadin") setMicErrorDismissed(false);
  }, [phase]);

  // ── Scoring logic ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isMatch) return;
    if (phase !== "active") return;
    if (activeCard < 0) return;
    if (scoredCardsRef.current.has(activeCard)) return;
    const next = new Set(scoredCardsRef.current);
    next.add(activeCard);
    scoredCardsRef.current = next;
    setScoredCards(next);
    setScore(s => { scoreRef.current = s + 1; return s + 1; });
    setLevelTotalScore(lt => { levelTotalScoreRef.current = lt + 1; return lt + 1; });
    setGrandSlamScore(gs => { grandSlamScoreRef.current = gs + 1; return gs + 1; });
  }, [isMatch, activeCard, phase]);

  useEffect(() => {
    if (phase === "idle" || phase === "leadin") {
      scoredCardsRef.current = new Set();
      setScoredCards(new Set());
    }
  }, [phase]);

  // ── NEW: URL listener — activates admin dashboard via ?admin=true ─────────
  // Checked once on mount. Clean the param from the URL after reading it to
  // avoid accidental sharing of admin-enabled URLs.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("admin") === "true") {
      setShowAdmin(true);
      // Remove ?admin=true from browser URL bar (keeps page state intact)
      params.delete("admin");
      const newSearch = params.toString();
      window.history.replaceState(
        {},
        "",
        window.location.pathname + (newSearch ? "?" + newSearch : "")
      );
    }
  }, []);

  // ── Session restore & Stripe return handling ──────────────────────────────
  useEffect(() => {
    // ── 1. Stripe return URLs ──────────────────────────────────────────────
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      window.history.replaceState({}, "", window.location.pathname);
      // Show verifying screen immediately — user must not see paywall while polling
      setScreen("verifying");
      hasFetchedProfile.current = true; // prevent onAuthStateChange from interrupting

      let attempts = 0;
      const maxAttempts = 20;      // 20 × 2s = 40s window — plenty for webhook
      const POLL_INTERVAL = 2000;  // fixed 2s — fast enough, not hammering

      // Activate premium in React state and clear the localStorage gate
      const activatePremium = (sessionUser) => {
        setIsPremium(true); isPremiumRef.current = true;
        userRef.current = sessionUser; setUser(sessionUser);
        setFreePlayCount(0); freePlayCountRef.current = 0;
        localStorage.removeItem('swaraslam_free_plays');
        setConfetti(true); setTimeout(() => setConfetti(false), 3500);
        setScreen("premium-unlocked");
        setTimeout(() => setScreen("game"), 3500);
      };

      // Force-write premium via service role if webhook timed out
      const forcePremiumUpdate = async (userId) => {
        try {
          await supabaseAdmin.from("profiles")
            .update({ is_premium: true })
            .eq("id", userId);
          await supabaseAdmin.auth.admin.updateUserById(
            userId, { user_metadata: { is_premium: true } }
          );
          console.log("forcePremiumUpdate: service role write complete.");
        } catch (e) { console.error("forcePremiumUpdate failed:", e); }
      };

      const checkPremiumStatus = async () => {
        attempts++;
        console.log(`[SwaraSlam] premium poll attempt ${attempts}/${maxAttempts}`);

        // Step 1: get current session (fast — reads local cache)
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id;
        if (!userId) {
          // No session yet — keep waiting
          if (attempts < maxAttempts) setTimeout(checkPremiumStatus, POLL_INTERVAL);
          else setScreen("paywall"); // give up
          return;
        }

        // Step 2: query profiles table directly — the ground truth the webhook writes to.
        // This bypasses JWT caching entirely. refreshSession() won't return updated
        // user_metadata until the token naturally expires, so we can't rely on it.
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("is_premium")
          .eq("id", userId)
          .maybeSingle();

        if (profile?.is_premium === true) {
          // Webhook has fired and profiles row is updated — activate immediately
          console.log("[SwaraSlam] premium confirmed via profiles table");
          // Force a session refresh so the JWT also carries the flag going forward
          await supabase.auth.refreshSession();
          const { data: { session: freshSession } } = await supabase.auth.getSession();
          activatePremium(freshSession?.user || session.user);
          return;
        }

        // Also check user_metadata in case webhook used updateUserById directly
        const metaFlag = session.user?.user_metadata?.is_premium === true;
        if (metaFlag) {
          console.log("[SwaraSlam] premium confirmed via user_metadata");
          activatePremium(session.user);
          return;
        }

        if (attempts < maxAttempts) {
          setTimeout(checkPremiumStatus, POLL_INTERVAL);
        } else {
          // Webhook timed out entirely — force-write and unlock anyway
          console.warn("[SwaraSlam] webhook timeout — forcing premium via service role");
          await forcePremiumUpdate(userId);
          activatePremium(session.user);
        }
      };

      setTimeout(checkPremiumStatus, 1500); // 1.5s head start for webhook
      return;
    }

    if (params.get("canceled") === "true") {
      window.history.replaceState({}, "", window.location.pathname);
    }

    // ── 2. Restore persisted session on mount ─────────────────────────────
    supabase.auth.getSession().then(({ data: { session }, error }) => {
      if (error) { console.warn("Session restore error:", error.message); return; }
      if (session?.user && !hasFetchedProfile.current) {
        hasFetchedProfile.current = true;          // lock: one fetch per session
        setUser(session.user);
        userRef.current = session.user;
        sessionRef.current = session;              // cache full session for PWA token access
        loadProfile(session.user.id).then(() => {
          setScreen(prev => prev === "home" ? "home" : prev);
        });
      }
    });

    // ── 3. Auth state change listener ────────────────────────────────────
    // FIX 1b — Email confirmation gate.
    // onAuthStateChange fires SIGNED_IN for every auth event including token
    // refreshes from checkPremiumStatus. Without hasFetchedProfile, each
    // refreshSession() call triggers SIGNED_IN → loadProfile → 400 error →
    // setProfileLoadError(true) → re-render → another SIGNED_IN → infinite loop.
    // The hasFetchedProfile lock breaks this cycle: loadProfile is called exactly
    // once per session regardless of how many SIGNED_IN events fire.
    // Unconfirmed accounts are still blocked (email_confirmed_at guard).
    // PASSWORD_RECOVERY is exempt — it routes to reset-password, not loadProfile.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY" && session?.user) {
        setUser(session.user); userRef.current = session.user;
        setScreen("reset-password");
        return;
      }
      if (session?.user) {
        if (!session.user.email_confirmed_at) return;  // unconfirmed — block
        setUser(session.user); userRef.current = session.user;
        sessionRef.current = session;              // cache for PWA token access
        // Route confirmed user to home if they're sitting on the auth screen.
        // This handles the email confirmation link click — Supabase fires SIGNED_IN
        // with the confirmed session, but screen is still "auth" from the signup form.
        setScreen(prev => prev === "auth" ? "home" : prev);
        if (!hasFetchedProfile.current) {
          hasFetchedProfile.current = true;
          loadProfile(session.user.id);
        }
      } else {
        // SIGNED_OUT — reset lock so next login gets a fresh fetch
        hasFetchedProfile.current = false;
        setUser(null); userRef.current = null;
        setIsPremium(false); isPremiumRef.current = false;
      }
    });

    return () => subscription.unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          setUser(session.user); userRef.current = session.user;
          setScreen("reset-password");
        }
      });
    }
    // Clear stale play counter on fresh email confirmation.
    // A newly confirmed user always starts with 0 free plays regardless
    // of any leftover localStorage from previous test sessions on this device.
    if (hash.includes("type=signup")) {
      localStorage.removeItem('swaraslam_free_plays');
      setFreePlayCount(0); freePlayCountRef.current = 0;
      window.history.replaceState({}, "", window.location.pathname);
      // Route to home explicitly — the confirmation link opens a fresh tab
      // where screen starts as "home" but the previous tab may still show
      // the signup form. Force home so the user lands correctly.
      setScreen("home");
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadProfile = async (userId) => {
    // ── NUCLEAR: zero database reads ─────────────────────────────────────
    // All supabase.from("profiles") SELECT queries have been removed because
    // the profiles table is returning HTTP 400 on every call, causing an
    // infinite loop that freezes the app.
    //
    // is_premium is now read from the Supabase JWT user_metadata, which is
    // attached to every session object at no extra network cost.
    // The Stripe webhook must set user_metadata.is_premium = true via:
    //   supabaseAdmin.auth.admin.updateUserById(userId, { user_metadata: { is_premium: true } })
    //
    // Free users: is_premium is undefined/false in metadata → isPremium = false.
    // Premium users: metadata.is_premium = true → isPremium = true.
    // The 5-play localStorage gate works independently of this value.
    try {
      // Check user_metadata first (set by stripe webhook via updateUserById)
      const { data: { user } } = await supabase.auth.getUser();
      let premium = user?.user_metadata?.is_premium === true;

      // If not set in metadata, check profiles table directly via service role.
      // This covers the case where the webhook updated the profiles row but
      // not user_metadata (e.g. older webhook version without updateUserById).
      if (!premium && user?.id) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("is_premium")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.is_premium === true) premium = true;
      }

      setIsPremium(premium);
      isPremiumRef.current = premium;
      setProfileLoadError(false);
      return premium;
    } catch (e) {
      console.warn("loadProfile: could not read premium status:", e.message);
      setProfileLoadError(false);
      return false;
    }
  };

  const saveProgress = useCallback((lvl, sn, curBpm) => {
    // ── NUCLEAR: profiles UPDATE removed — table returns 400 ─────────────
    // Progress is maintained in React state and localStorage (freePlayCount).
    // Cross-device sync via the profiles table will be re-enabled once the
    // database RLS policies are confirmed working in the Supabase dashboard.
    const newHighest = Math.max(highestBpmRef.current, curBpm);
    setHighestBpm(newHighest);
    highestBpmRef.current = newHighest;
    // Silently skipping DB write — no network call, no 400, no crash.
  }, []);

  useEffect(() => () => { engine.stopScheduler(); engine.stopDrone(); }, []);

  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (localStorage.getItem("installBannerDismissed")) return;
    const h = (e) => { e.preventDefault(); setDeferredPrompt(e); setTimeout(() => setShowInstallBanner(true), 3000); };
    window.addEventListener("beforeinstallprompt", h);
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) setTimeout(() => setShowInstallBanner(true), 3000);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  useEffect(() => {
    const consent = localStorage.getItem("cookieConsent");
    if (!consent) { setTimeout(() => setShowCookieBanner(true), 1500); }
    else if (consent === "accepted") { initializeAnalytics(); }
  }, []);

  const handleCookieAccept = useCallback(() => {
    localStorage.setItem("cookieConsent", "accepted");
    setShowCookieBanner(false);
    initializeAnalytics();
  }, []);

  const handleCookieLearnMore = useCallback(() => {
    setShowCookieBanner(false);
    setShowLegalModal(true);
  }, []);

  const initializeAnalytics = useCallback(() => {
    console.log("Analytics initialized (placeholder)");
  }, []);

  const prevSetRef = useRef(-1), prevLevelRef = useRef(-1);
  useEffect(() => {
    if (prevSetRef.current === -1) { prevSetRef.current = setNum; prevLevelRef.current = level; return; }
    if (prevSetRef.current !== setNum || prevLevelRef.current !== level) {
      prevSetRef.current = setNum; prevLevelRef.current = level;
      setBpmFlash(true); setTimeout(() => setBpmFlash(false), 1600);
    }
  }, [setNum, level]);

  const advanceSet = useCallback((lvl, sn) => {
    const nextSet = sn + 1;
    if (nextSet < SETS_PER_LEVEL) {
      engine.playSetDing();
      setSetNum(nextSet);
      setCards(generateCards(lvl)); setCurrentCards(null);
      const newBpm = manualBpmRef.current ? bpmRef.current : BASE_BPM + nextSet * BPM_INCREMENT;
      if (!manualBpmRef.current) setBpm(newBpm);
      saveProgress(lvl, nextSet, newBpm);
      return;
    }
    const nextLevel  = lvl + 1;
    const levelTotal = levelTotalScoreRef.current;
    const summary    = getLevelSummaryMessage(levelTotal, TOTAL_PER_LEVEL);
    if (nextLevel >= LEVEL_CONFIG.length) { engine.playGrandSlamFanfare(); }
    else { engine.playLevelUpArp(); }
    setConfetti(true); setTimeout(() => setConfetti(false), 3200);
    if (nextLevel === 1) setHasCompletedLevel1(true);

    // ── FREE PLAY COUNTER (moved here from onDone) ────────────────────────
    // advanceSet level-complete branch is the single guaranteed execution
    // path when all 5 sets finish — runs whether the audio engine fires
    // the onDone callback or not. Count every completed Level 1 run.
    if (lvl === 0) {
      const currentPlays = Number(localStorage.getItem('swaraslam_free_plays') || 0);
      const nextCount = currentPlays + 1;
      localStorage.setItem('swaraslam_free_plays', String(nextCount));
      freePlayCountRef.current = nextCount;
      setFreePlayCount(nextCount);
      console.log('[SwaraSlam] play counted:', nextCount, '/ limit:', FREE_PLAY_LIMIT);
    }

    const requiresUnlock = !isPremiumRef.current && nextLevel >= 1;
    setLevelSummaryData({
      ...summary, levelTotal,
      levelNum: lvl + 1, nextLevel,
      isGrandSlam: nextLevel >= LEVEL_CONFIG.length,
      grandTotal: grandSlamScoreRef.current,
      requiresUnlock,
    });
  }, [engine, saveProgress]);

  const startPlay = useCallback((replayCards) => {
    // ── HARD GATE: free-play limit check before audio starts ─────────────
    // Reads localStorage directly so this is always accurate regardless of
    // React state timing, re-mounts, or ref drift. Only applies to Level 1
    // non-premium sessions.
    if (levelRef.current === 0 && !isPremiumRef.current) {
      const currentPlays = Number(localStorage.getItem('swaraslam_free_plays') || 0);
      if (currentPlays >= FREE_PLAY_LIMIT) {
        setScreen("paywall");
        return;
      }
    }
    engine.stopScheduler();
    const playCards = replayCards || generateCards(levelRef.current);
    if (!replayCards) setCards(playCards);
    setCurrentCards(playCards); cardsRef.current = playCards;
    setScore(0); scoreRef.current = 0;
    scoredCardsRef.current = new Set();
    setScoredCards(new Set());
    const effectiveBpm = manualBpmRef.current ? bpmRef.current : autoBpm;
    if (!manualBpmRef.current) setBpm(effectiveBpm);
    engine.resumeCtx();
    if (droneOn) engine.startDrone(SA_PITCHES[saIdxRef.current].freq);
    setPhase("leadin"); setActiveCard(-1); setDotBeat(-1); setIsPlaying(true);
    setMicActive(true);
    engine.scheduleBeats(effectiveBpm, LEAD_IN_BEATS + ACTIVE_BEATS,
      (_dot, _isDown, seqIdx, sTime) => {
        setDotBeat(_dot);
        if (seqIdx < LEAD_IN_BEATS) { setPhase("leadin"); setActiveCard(-1); }
        else {
          setPhase("active");
          const ci = seqIdx - LEAD_IN_BEATS;
          setActiveCard(ci);
          engine.playGuruNote(SA_PITCHES[saIdxRef.current].freq * cardsRef.current[ci].ratio, sTime);
        }
      },
      () => {
        setPhase("done"); setIsPlaying(false); setActiveCard(-1); setDotBeat(-1);
        setMicActive(false); engine.stopDrone();

        // Counter now lives in advanceSet level-complete branch (guaranteed path).
        advanceSet(levelRef.current, setNumRef.current);
      }
    );
  }, [engine, droneOn, autoBpm, advanceSet]);

  const stopPlay = useCallback(() => {
    engine.stopScheduler(); engine.stopDrone();
    setIsPlaying(false); setPhase("idle"); setActiveCard(-1); setDotBeat(-1);
    setMicActive(false);
    setScore(0); scoreRef.current = 0;
    scoredCardsRef.current = new Set();
    setScoredCards(new Set());
  }, [engine]);

  const handleRetry = useCallback(() => {
    if (isPlaying) { engine.stopScheduler(); engine.stopDrone(); setIsPlaying(false); setMicActive(false); }
    setTimeout(() => startPlay(currentCards || cards), 80);
  }, [isPlaying, engine, currentCards, cards, startPlay]);

  const handleNextSet = useCallback(() => {
    if (isPlaying) stopPlay();
    setPhase("idle"); setActiveCard(-1);
    advanceSet(levelRef.current, setNumRef.current);
  }, [isPlaying, stopPlay, advanceSet]);

  const handleContinueLevel = useCallback((summaryData) => {
    setLevelSummaryData(null);
    if (summaryData.isGrandSlam) { setAllLevelsUp(true); return; }
    if (summaryData.requiresUnlock) {
      setLevel(0); setSetNum(0);
      setCards(generateCards(0)); setCurrentCards(null);
      if (!manualBpmRef.current) setBpm(BASE_BPM);
      setScore(0); scoreRef.current = 0;
      setLevelTotalScore(0); levelTotalScoreRef.current = 0;
      setScreen("paywall"); return;
    }
    const nextLevel = summaryData.nextLevel;
    setLevelTotalScore(0); levelTotalScoreRef.current = 0;
    setLevel(nextLevel); setSetNum(0);
    setCards(generateCards(nextLevel)); setCurrentCards(null);
    if (!manualBpmRef.current) setBpm(BASE_BPM);
    setScore(0); scoreRef.current = 0;
    setScoredCards(new Set()); scoredCardsRef.current = new Set();
    setPhase("idle"); setActiveCard(-1);
    saveProgress(nextLevel, 0, BASE_BPM);
  }, [saveProgress]);

  const toggleDrone = useCallback(() => {
    if (!isPlaying) { setDroneOn(d => !d); return; }
    if (droneOn) { engine.stopDrone(); setDroneOn(false); }
    else { engine.startDrone(SA_PITCHES[saIdxRef.current].freq); setDroneOn(true); }
  }, [isPlaying, droneOn, engine]);

  const handleSaChange = useCallback((e) => {
    const idx = Number(e.target.value); setSaIndex(idx); saIdxRef.current = idx;
    if (isPlaying && droneOn) engine.updateDroneFreq(SA_PITCHES[idx].freq);
  }, [isPlaying, droneOn, engine]);

  const handleBpmChange = useCallback((e) => { setBpm(Number(e.target.value)); setManualBpm(true); }, []);

  const handleLogout = useCallback(async () => {
    stopPlay(); await supabase.auth.signOut();
    setUser(null); userRef.current = null;
    setIsPremium(false); isPremiumRef.current = false;
    setLevel(0); setSetNum(0); setCards(generateCards(0)); setCurrentCards(null);
    setManualBpm(false); setBpm(BASE_BPM); setPhase("idle"); setActiveCard(-1);
    setScore(0); scoreRef.current = 0;
    setLevelTotalScore(0); levelTotalScoreRef.current = 0;
    setGrandSlamScore(0); grandSlamScoreRef.current = 0;
    setMicActive(false); setLevelSummaryData(null);
    setFreePlayCount(0); freePlayCountRef.current = 0;
    localStorage.removeItem('swaraslam_free_plays'); // clear gate on logout
    hasFetchedProfile.current = false;              // reset lock for next login
    setScreen("home");
  }, [stopPlay]);

  const handleAuthSuccess = useCallback(async (loggedInUser) => {
    setUser(loggedInUser); userRef.current = loggedInUser;
    hasFetchedProfile.current = true;  // prevent duplicate call from onAuthStateChange
    // Cache the full session so PWA context can access the token without localStorage
    const { data: { session: s } } = await supabase.auth.getSession();
    if (s) sessionRef.current = s;
    await loadProfile(loggedInUser.id);
    setScreen("ready");
  }, []);

  const handlePasswordResetSuccess = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.user) {
      setUser(session.user); userRef.current = session.user;
      hasFetchedProfile.current = true;  // prevent duplicate call from onAuthStateChange
      await loadProfile(session.user.id);
    }
    setScreen("ready");
  }, []);

  const handleShare = useCallback(async () => {
    const pct = grandSlamScoreRef.current > 0
      ? Math.round((grandSlamScoreRef.current / TOTAL_ALL_LEVELS) * 100) : 0;
    const { title } = getTitleForPct(pct);
    const shareText = `I just Swara Slammed my way to ${title} status! Check out Swara Slam and test your rhythm: https://swara-slam.vercel.app`;
    if (navigator.share) {
      try { await navigator.share({ text: shareText }); }
      catch (err) { if (err.name !== "AbortError") console.error("Share failed:", err); }
    } else {
      try { await navigator.clipboard.writeText(shareText); alert("Link copied to clipboard! Share it anywhere you like."); }
      catch (err) { alert("Sharing not supported on this device."); }
    }
  }, []);

  const handleStripeCheckout = useCallback(async (priceId) => {
    setPaywallRedirecting(true); setRedirectingPriceId(priceId);
    try {
      // Resolve user identity — works across browser, Android PWA, and iOS/Mac PWA.
      // The Mac Safari PWA runs in an isolated storage context: when the confirmation
      // email link opens in Safari, the session is stored in Safari's partition, not
      // the PWA's. Bearer token approaches all fail because the PWA storage is empty.
      //
      // Solution: identify the user from React state (userRef) which is always
      // populated in memory during this session, then send user ID + anon key.
      // The Edge Function authenticates via service role on the server side.
      const userId = userRef.current?.id;
      const userEmail = userRef.current?.email;

      if (!userId || !userEmail) {
        // No user in memory — must sign in inside the app first
        setPaywallRedirecting(false); setRedirectingPriceId(null);
        setScreen("auth"); return;
      }

      const res = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            // Send anon key as the API key — Edge Function uses service role to verify
            "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`,
            "x-user-id": userId,
            "x-user-email": userEmail,
          },
          body: JSON.stringify({ priceId }),
        }
      );
      if (!res.ok) {
        const errBody = await res.text();
        throw new Error(`Server error: ${res.status} — ${errBody}`);
      }
      const data = await res.json();
      if (!data.url) throw new Error("No checkout URL received from server");
      window.location.href = data.url;
    } catch (err) {
      alert(`Payment setup failed: ${err.message}`);
      setPaywallRedirecting(false); setRedirectingPriceId(null);
    }
  }, []);

  const startWalkthrough = useCallback(() => {
    setShowWalkthrough(true); setWalkthroughStep(0);
    localStorage.setItem("walkthroughSeen", "true");
  }, []);

  const trueDisplayCards = currentCards || cards;
  const sliderPct = Math.round(((bpm - 40) / (700 - 40)) * 100);
  const isLocked  = level > 0 && !isPremium;

  const getCardState = (i) => {
    if (phase === "idle" || phase === "done") return "dim";
    if (phase === "leadin") return "idle";
    return i === activeCard ? "active" : "idle";
  };

  const phaseLabel =
    phase === "leadin" ? "Get Ready\u2026" :
    phase === "active" ? "Sing Along \uD83C\uDFB5" :
    phase === "done"   ? "Set Complete \u2713" : "Ready";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=DM+Sans:wght@300;400;500&display=swap');
        *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}

        .screen{min-height:100vh;background:#F9F7F2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.25rem;padding:2rem 1.5rem;text-align:center;animation:fadeIn .25s ease}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes titlePop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}

        .home-raaguru{font-family:'DM Sans',sans-serif;font-size:11px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:#9A7B50}
        .home-raaguru em{font-style:normal;color:#C05F2F}
        .home-title{display:flex;align-items:baseline;gap:10px}
        .home-swara{font-family:'Cormorant Garamond',serif;font-size:clamp(52px,11vw,84px);font-weight:600;color:#1C1A17}
        .home-slam{font-family:'Cormorant Garamond',serif;font-size:clamp(52px,11vw,84px);font-weight:600;font-style:italic;color:#C05F2F}
        .home-sub{font-size:11px;color:#9A7B50;letter-spacing:.12em;text-transform:uppercase;line-height:1.6;max-width:280px}

        .primary-btn{padding:14px 40px;border-radius:99px;background:#1C1A17;border:none;color:#F9F7F2;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;letter-spacing:.06em;cursor:pointer;transition:background .18s,transform .12s}
        .primary-btn:hover{background:#C05F2F;transform:scale(1.03)}
        .primary-btn:active{transform:scale(.97)}
        .ghost-btn{font-family:'DM Sans',sans-serif;font-size:11px;color:#9A7B50;background:none;border:none;cursor:pointer;text-decoration:underline;padding:0;letter-spacing:.04em}
        .ghost-btn:hover{color:#C05F2F}

        .ready-ornament{font-family:'Cormorant Garamond',serif;font-size:14px;color:rgba(0,0,0,.18);letter-spacing:.35em}
        .ready-title{font-family:'Cormorant Garamond',serif;font-size:clamp(52px,12vw,88px);font-weight:600;color:#C05F2F;font-style:italic;animation:titlePop .5s .1s cubic-bezier(.34,1.56,.64,1) both}
        .ready-sub{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#9A7B50}

        .ss-app{min-height:100vh;background:#F9F7F2;font-family:'DM Sans',sans-serif;color:#1C1A17;display:flex;flex-direction:column;align-items:center;padding:0 1.25rem 2.5rem;overflow-x:hidden}
        .ss-header{width:100%;max-width:680px;display:flex;align-items:center;justify-content:space-between;padding:1.25rem 0 0.6rem}
        .ss-wordmark{display:flex;flex-direction:column;gap:3px}
        .ss-brand-top{font-family:'DM Sans',sans-serif;font-size:10px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:#9A7B50;line-height:1}
        .ss-brand-top em{font-style:normal;color:#C05F2F}
        .ss-brand-main{display:flex;align-items:baseline;gap:5px;line-height:1}
        .ss-brand-swara{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:600;color:#1C1A17}
        .ss-brand-slam{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:600;font-style:italic;color:#C05F2F}
        .ss-header-actions{display:flex;align-items:center;gap:6px}
        .icon-btn{width:36px;height:36px;border-radius:50%;border:.5px solid rgba(0,0,0,.12);background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#5A4A35;transition:background .15s;flex-shrink:0}
        .icon-btn:hover{background:rgba(0,0,0,.05)}
        .icon-btn.active{color:#C05F2F;border-color:rgba(192,95,47,.4)}
        .user-chip{display:flex;flex-direction:column;align-items:flex-end;gap:1px;margin-right:2px}
        .user-chip-name{font-family:'DM Sans',sans-serif;font-size:11px;font-weight:500;color:#1C1A17;display:flex;align-items:center;gap:3px;white-space:nowrap}
        .user-chip-crown{color:#9A7B50;font-size:12px}
        .user-chip-logout{font-family:'DM Sans',sans-serif;font-size:10px;color:#C05F2F;background:none;border:none;cursor:pointer;padding:0;text-decoration:underline}
        .ss-divider{width:100%;max-width:680px;height:.5px;background:linear-gradient(90deg,transparent,rgba(0,0,0,.1) 20%,rgba(0,0,0,.1) 80%,transparent)}
        .progress-bar{width:100%;max-width:480px;display:flex;align-items:center;justify-content:space-between;padding:.7rem 0 .35rem;gap:.75rem}
        .prog-badge{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9A7B50;font-weight:500;white-space:nowrap}
        .prog-badge strong{color:#1C1A17;font-weight:600}
        .prog-dots{display:flex;gap:5px;align-items:center}
        .prog-dot{width:7px;height:7px;border-radius:50%;background:rgba(0,0,0,.1);transition:background .25s,transform .25s}
        .prog-dot.filled{background:#9A7B50}
        .prog-dot.current{background:#C05F2F;transform:scale(1.4)}
        .phase-label{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:rgba(0,0,0,.3);white-space:nowrap}
        .phase-label.phase-active{color:#C05F2F;font-weight:500}
        .phase-label.phase-done{color:#9A7B50;font-weight:500}

        .bpm-flash{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) scale(.7);background:#1C1A17;color:#F9F7F2;font-family:'Cormorant Garamond',serif;font-size:clamp(32px,7vw,52px);font-weight:600;padding:.4em .9em;border-radius:12px;pointer-events:none;z-index:150;opacity:0}
        .bpm-flash-in{animation:bpmPop 1.5s cubic-bezier(.34,1.56,.64,1) forwards}
        @keyframes bpmPop{0%{opacity:0;transform:translate(-50%,-50%) scale(.7)}15%{opacity:1;transform:translate(-50%,-50%) scale(1.05)}30%{transform:translate(-50%,-50%) scale(1)}75%{opacity:1;transform:translate(-50%,-50%) scale(1)}100%{opacity:0;transform:translate(-50%,-50%) scale(.95)}}

        .ss-arena{width:100%;max-width:680px;display:flex;flex-direction:column;align-items:center;padding:0 0 .75rem;gap:.6rem}
        .arena-field{width:100%;max-width:480px;border:.5px solid rgba(0,0,0,.07);border-radius:16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:16px 14px;position:relative;background:rgba(255,255,255,.4);transition:border-color .12s,background .12s}
        .arena-field::before,.arena-field::after{content:'';position:absolute;width:14px;height:14px;border-color:rgba(192,95,47,.18);border-style:solid}
        .arena-field::before{top:10px;left:10px;border-width:1.5px 0 0 1.5px;border-radius:3px 0 0 0}
        .arena-field::after{bottom:10px;right:10px;border-width:0 1.5px 1.5px 0;border-radius:0 0 3px 0}
        .arena-field.phase-active-border{border-color:rgba(192,95,47,.25);background:rgba(192,95,47,.025)}
        .card-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:7px;width:100%}

        .swara-card{aspect-ratio:3/4;border-radius:10px;border:1px solid rgba(0,0,0,.08);background:#FEFCF8;box-shadow:0 1px 3px rgba(0,0,0,.05);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;transition:transform .09s cubic-bezier(.34,1.56,.64,1),box-shadow .09s,border-color .09s,background .09s,opacity .2s}
        .card-dv{font-size:clamp(11px,2.8vw,17px);color:rgba(0,0,0,.2);line-height:1;transition:color .09s}
        .card-name{font-family:'Cormorant Garamond',serif;font-size:clamp(14px,3.5vw,21px);font-weight:600;color:#1C1A17;line-height:1;position:relative;display:inline-flex;align-items:center}
        .oct-mandra{text-decoration:underline;text-underline-offset:3px;text-decoration-thickness:1.5px}
        .oct-dot-above{font-size:.55em;line-height:0;vertical-align:super;margin-left:1px;opacity:.75}
        .card-dim{opacity:.28;box-shadow:none}
        .card-idle{opacity:1}
        .card-active{transform:scale(1.1);background:#FFF3EE;border-color:#C05F2F;box-shadow:0 0 0 2.5px rgba(192,95,47,.4),0 6px 22px rgba(192,95,47,.25),0 2px 6px rgba(0,0,0,.07)}
        .card-active .card-dv{color:rgba(192,95,47,.5)}
        .card-active .card-name{color:#C05F2F}
        .card-match{background:#E8F5E9 !important;border-color:#2E7D32 !important;box-shadow:0 0 15px rgba(46,125,50,0.4),0 0 0 2px rgba(46,125,50,0.25) !important}
        .card-match .card-dv{color:rgba(46,125,50,0.5) !important}
        .card-match .card-name{color:#2E7D32 !important}

        .score-strip{width:100%;max-width:480px;display:flex;align-items:center;justify-content:space-between;padding:.15rem 0 .45rem;min-height:24px}
        .score-label{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9A7B50;font-weight:500}
        .score-pips{display:flex;gap:4px;align-items:center}
        .score-pip{width:10px;height:10px;border-radius:50%;border:1.5px solid rgba(0,0,0,.12);background:transparent;transition:background .15s,border-color .15s,transform .15s}
        .score-pip.hit{background:#2E7D32;border-color:#2E7D32;transform:scale(1.25)}
        .score-pip.hit-anim{animation:pipPop .25s cubic-bezier(.34,1.56,.64,1) both}
        @keyframes pipPop{0%{transform:scale(0.5)}60%{transform:scale(1.5)}100%{transform:scale(1.25)}}
        .score-fraction{font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:600;color:#2E7D32;letter-spacing:.04em;min-width:32px;text-align:right;transition:opacity .2s}
        .score-fraction.zero{color:rgba(0,0,0,.2)}

        .mic-status{display:flex;align-items:center;gap:4px;font-size:10px;letter-spacing:.1em;text-transform:uppercase;color:rgba(0,0,0,.25);font-family:'DM Sans',sans-serif}
        .mic-dot{width:5px;height:5px;border-radius:50%;background:rgba(0,0,0,.15);flex-shrink:0}
        .mic-dot.listening{background:#2E7D32;animation:micPulse 1.4s ease-in-out infinite}
        @keyframes micPulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:0.5;transform:scale(0.7)}}

        .beat-dots{display:flex;gap:13px;align-items:center;padding-top:2px}
        .beat-dot{width:8px;height:8px;border-radius:50%;background:rgba(0,0,0,.1);transition:background .07s,transform .07s,box-shadow .07s;flex-shrink:0}
        .dot-dn{background:#C05F2F !important;transform:scale(1.8) !important;box-shadow:0 0 0 3px rgba(192,95,47,.18) !important}
        .dot-up{background:#9A7B50 !important;transform:scale(1.35) !important}

        .ss-controls{width:100%;max-width:480px;display:flex;flex-direction:column;gap:1.1rem}
        .ctrl-row{display:flex;align-items:center;gap:.85rem}
        .ctrl-label{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9A7B50;min-width:34px;flex-shrink:0}
        .ctrl-val{font-family:'Cormorant Garamond',serif;font-size:19px;font-weight:600;color:#1C1A17;min-width:42px;text-align:right;flex-shrink:0}
        input[type="range"].ss-slider{-webkit-appearance:none;appearance:none;flex:1;height:3px;background:linear-gradient(to right,#C05F2F calc(var(--pct)*1%),rgba(0,0,0,.1) calc(var(--pct)*1%));border-radius:99px;outline:none;cursor:pointer}
        input[type="range"].ss-slider::-webkit-slider-thumb{-webkit-appearance:none;width:17px;height:17px;border-radius:50%;background:#C05F2F;border:2.5px solid #F9F7F2;box-shadow:0 0 0 1px rgba(192,95,47,.35);cursor:pointer}
        input[type="range"].ss-slider::-moz-range-thumb{width:17px;height:17px;border-radius:50%;background:#C05F2F;border:2.5px solid #F9F7F2;cursor:pointer}
        select.ss-select{flex:1;height:38px;border:.5px solid rgba(0,0,0,.14);border-radius:8px;padding:0 30px 0 12px;font-family:'Cormorant Garamond',serif;font-size:15px;color:#1C1A17;cursor:pointer;outline:none;appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239A7B50' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 10px center;background-color:transparent}
        select.ss-select:focus{border-color:rgba(192,95,47,.5)}
        .play-row{display:flex;align-items:center;justify-content:center;gap:14px;margin-top:.1rem}
        .play-btn{width:64px;height:64px;border-radius:50%;background:#1C1A17;border:none;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#F9F7F2;transition:background .18s,transform .12s;box-shadow:0 4px 18px rgba(0,0,0,.14);flex-shrink:0}
        .play-btn:hover{background:#C05F2F;transform:scale(1.05)}
        .play-btn:active{transform:scale(.96)}
        .play-btn.playing{background:#C05F2F}
        .play-btn:disabled{opacity:.35;cursor:default;transform:none}
        .nav-btn{width:44px;height:44px;border-radius:50%;border:.5px solid rgba(0,0,0,.14);background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#5A4A35;transition:background .15s;flex-shrink:0}
        .nav-btn:hover{background:rgba(0,0,0,.05)}
        .nav-btn:disabled{opacity:.3;cursor:default}

        .overlay{position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:rgba(249,247,242,.96);backdrop-filter:blur(8px);animation:fadeIn .3s ease both;padding:2rem 1.5rem;text-align:center}
        .overlay-eyebrow{font-family:'DM Sans',sans-serif;font-size:10px;font-weight:500;letter-spacing:.26em;text-transform:uppercase;color:#9A7B50}
        .overlay-title{font-family:'Cormorant Garamond',serif;font-size:clamp(42px,10vw,80px);font-weight:600;color:#C05F2F;font-style:italic;animation:titlePop .5s .1s cubic-bezier(.34,1.56,.64,1) both}
        .overlay-sub{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#9A7B50}

        .summary-score-row{display:flex;align-items:baseline;gap:6px;margin:.2rem 0 .1rem}
        .summary-big{font-family:'Cormorant Garamond',serif;font-size:clamp(52px,12vw,88px);font-weight:600;color:#C05F2F;line-height:1;animation:titlePop .4s .2s cubic-bezier(.34,1.56,.64,1) both}
        .summary-of{font-family:'Cormorant Garamond',serif;font-size:clamp(22px,5vw,36px);font-weight:400;color:rgba(0,0,0,.3)}
        .summary-label{font-family:'DM Sans',sans-serif;font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9A7B50;align-self:flex-end;padding-bottom:6px}
        .summary-bar-wrap{width:100%;max-width:280px;height:4px;background:rgba(0,0,0,.08);border-radius:99px;overflow:hidden;margin:.3rem 0}
        .summary-bar-fill{height:100%;background:linear-gradient(90deg,#9A7B50,#C05F2F);border-radius:99px;transition:width .8s cubic-bezier(.34,1.56,.64,1)}
        .summary-msg{font-family:'DM Sans',sans-serif;font-size:14px;color:#5A4A35;max-width:320px;line-height:1.65}
        .summary-grand{font-family:'DM Sans',sans-serif;font-size:12px;color:#9A7B50;letter-spacing:.06em;margin-top:.25rem}
        .summary-grand strong{color:#C05F2F}
        .level-running-total{font-family:'DM Sans',sans-serif;font-size:9px;color:#9A7B50;letter-spacing:.1em;text-transform:uppercase;white-space:nowrap}

        .wt-backdrop{position:fixed;inset:0;background:rgba(28,26,23,0.72);z-index:8999}
        .wt-overlay{position:fixed;inset:0;z-index:9000;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;padding-bottom:48px;pointer-events:none}
        .wt-card{background:#F9F7F2;border-radius:20px;padding:28px 28px 24px;max-width:380px;width:calc(100% - 40px);box-shadow:0 20px 60px rgba(0,0,0,.3);pointer-events:all;border:2px solid #9A7B50;animation:slideUp .35s cubic-bezier(.34,1.56,.64,1) both}
        @keyframes slideUp{from{opacity:0;transform:translateY(40px)}to{opacity:1;transform:translateY(0)}}
        .wt-step-label{font-size:10px;letter-spacing:.2em;text-transform:uppercase;color:#9A7B50;margin-bottom:6px}
        .wt-title{font-family:'Cormorant Garamond',serif;font-size:24px;font-weight:600;color:#1C1A17;margin-bottom:8px}
        .wt-body{font-family:'DM Sans',sans-serif;font-size:14px;color:#5A4A35;line-height:1.65;margin-bottom:20px}
        .wt-footer{display:flex;align-items:center;justify-content:space-between}
        .wt-dots{display:flex;gap:5px}
        .wt-dot{width:6px;height:6px;border-radius:50%;background:rgba(0,0,0,.12)}
        .wt-dot.active{background:#C05F2F;transform:scale(1.3)}
        .wt-btn{padding:10px 24px;border-radius:99px;background:#1C1A17;border:none;color:#F9F7F2;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:500;cursor:pointer;transition:background .15s}
        .wt-btn:hover{background:#C05F2F}
        .wt-skip{font-family:'DM Sans',sans-serif;font-size:12px;color:rgba(0,0,0,.35);background:none;border:none;cursor:pointer;padding:0}
        .wt-skip:hover{color:#C05F2F}

        .install-tooltip{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);width:calc(100% - 40px);max-width:360px;background:#1C1A17;color:#F9F7F2;border-radius:16px;padding:20px;box-shadow:0 8px 40px rgba(0,0,0,.35);z-index:500;animation:tooltipUp .35s cubic-bezier(.34,1.56,.64,1) both}
        @keyframes tooltipUp{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .install-close{position:absolute;top:14px;right:14px;background:rgba(255,255,255,.1);border:none;color:#F9F7F2;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:14px}
        .install-close:hover{background:rgba(255,255,255,.2)}
        .install-steps{display:flex;flex-direction:column;gap:10px}
        .install-step{display:flex;align-items:flex-start;gap:10px;font-size:13px;line-height:1.4;color:rgba(255,255,255,.85)}
        .install-step-num{background:#C05F2F;color:#fff;width:20px;height:20px;border-radius:50%;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
        .install-step strong{color:#fff}
        .install-btn{width:100%;background:#C05F2F;color:#fff;border:none;border-radius:8px;padding:11px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;margin-top:10px}
        .install-btn:hover{background:#A0472A}

        /* ── NEW: Admin key button — invisible until hovered ── */
        .admin-key-btn{width:28px;height:28px;border-radius:50%;border:none;background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:14px;opacity:0.08;transition:opacity .2s;flex-shrink:0}
        .admin-key-btn:hover{opacity:0.55}

        @media(min-width:480px){.card-grid{gap:9px}}
        @media(min-width:768px){.arena-field{max-width:540px;padding:20px 18px}.card-grid{gap:11px}.ss-controls{max-width:540px}}
      `}</style>

      <Confetti active={confetti} />
      <BpmFlash bpm={manualBpm ? bpm : autoBpm} visible={bpmFlash} />

      {/* ── NEW: Admin Dashboard overlay ── */}
      {showAdmin && (
        <AdminDashboard onClose={() => setShowAdmin(false)} />
      )}

      {/* ── Walkthrough ── */}
      {showWalkthrough && (
        <>
          <div className="wt-backdrop" onClick={() => setShowWalkthrough(false)} />
          <div className="wt-overlay">
            <div className="wt-card">
              <p className="wt-step-label">Step {walkthroughStep + 1} of {WT_STEPS.length}</p>
              <div className="wt-title">{WT_STEPS[walkthroughStep].title}</div>
              <p className="wt-body">{WT_STEPS[walkthroughStep].body}</p>
              <div className="wt-footer">
                <div className="wt-dots">
                  {WT_STEPS.map((_, i) => <div key={i} className={"wt-dot" + (i === walkthroughStep ? " active" : "")} />)}
                </div>
                <div style={{display:"flex",gap:12,alignItems:"center"}}>
                  <button className="wt-skip" onClick={() => setShowWalkthrough(false)}>Skip</button>
                  <button className="wt-btn" onClick={() => {
                    if (walkthroughStep < WT_STEPS.length - 1) setWalkthroughStep(s => s + 1);
                    else setShowWalkthrough(false);
                  }}>{walkthroughStep < WT_STEPS.length - 1 ? "Next →" : "Let's Play!"}</button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ── Level Summary overlay ── */}
      {levelSummaryData && (
        <div className="overlay" style={{gap:"0.55rem"}}>
          <p className="overlay-eyebrow">Level {levelSummaryData.levelNum} Complete</p>
          <div className="overlay-title" style={{fontSize:"clamp(30px,8vw,58px)",lineHeight:1.1}}>
            {levelSummaryData.emoji} {levelSummaryData.title}
          </div>
          <div className="summary-score-row">
            <span className="summary-big">{levelSummaryData.levelTotal}</span>
            <span className="summary-of">/ {TOTAL_PER_LEVEL}</span>
            <span className="summary-label">Slam Points</span>
          </div>
          <div className="summary-bar-wrap">
            <div className="summary-bar-fill" style={{width: Math.round((levelSummaryData.levelTotal / TOTAL_PER_LEVEL) * 100) + "%"}} />
          </div>
          <p className="summary-msg">{levelSummaryData.msg}</p>
          {levelSummaryData.isGrandSlam && (
            <p className="summary-grand">Grand Slam Total: <strong>{levelSummaryData.grandTotal} / {TOTAL_ALL_LEVELS}</strong></p>
          )}
          <button className="primary-btn" style={{marginTop:6}} onClick={() => handleContinueLevel(levelSummaryData)}>
            {levelSummaryData.isGrandSlam
              ? "See Grand Slam Results"
              : levelSummaryData.requiresUnlock
                ? "🔒 Unlock Level " + (levelSummaryData.nextLevel + 1)
                : "Continue to Level " + (levelSummaryData.nextLevel + 1) + " →"}
          </button>
          {levelSummaryData.requiresUnlock && (() => {
            const _plays = Number(localStorage.getItem('swaraslam_free_plays') || 0);
            const _remaining = Math.max(0, 5 - _plays);
            const _summaryNote = _plays >= 5
              ? "You've mastered your first 5 sets! Choose a plan below to keep going."
              : `You have [${_remaining}] free slam${_remaining === 1 ? "" : "s"} remaining.`;
            return (
              <>
                <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#9A7B50",textAlign:"center",margin:"2px 0 0",letterSpacing:".02em"}}>
                  {_summaryNote}
                </p>
                <button className="ghost-btn" style={{marginTop:2}} onClick={() => {
                  const localPlays = Number(localStorage.getItem('swaraslam_free_plays') || 0);
                  if (localPlays >= 5) {
                    setScreen("paywall");
                    return;
                  }
                  setLevelSummaryData(null);
                  setLevel(0); setSetNum(0);
                  setCards(generateCards(0)); setCurrentCards(null);
                  if (!manualBpmRef.current) setBpm(BASE_BPM);
                  setScore(0); scoreRef.current = 0;
                  setLevelTotalScore(0); levelTotalScoreRef.current = 0;
                  setPhase("idle"); setActiveCard(-1);
                }}>← Replay Level 1</button>
              </>
            );
          })()}
        </div>
      )}

      {/* ── Grand Slam ── */}
      {allLevelsUp && (
        <div className="overlay" style={{gap:"0.7rem"}}>
          <p className="overlay-eyebrow">Grand Slam</p>
          <div className="overlay-title" style={{fontSize:"clamp(34px,8vw,64px)"}}>All 4 Levels!</div>
          <div className="summary-score-row">
            <span className="summary-big">{grandSlamScore}</span>
            <span className="summary-of">/ {TOTAL_ALL_LEVELS}</span>
            <span className="summary-label">Total Slam Points</span>
          </div>
          <div className="summary-bar-wrap">
            <div className="summary-bar-fill" style={{width: Math.round((grandSlamScore / TOTAL_ALL_LEVELS) * 100) + "%"}} />
          </div>
          {(() => {
            const pct = Math.round((grandSlamScore / TOTAL_ALL_LEVELS) * 100);
            const { title, emoji } = getTitleForPct(pct);
            return (
              <p className="summary-msg">
                {emoji} <strong>{title}</strong> — You totally Swara Slammed all four levels!
                {pct === 100 ? " A perfect 160. Legendary." : " Ready to Slam again?"}
              </p>
            );
          })()}
          <button className="primary-btn" style={{marginTop:8}} onClick={() => {
            setAllLevelsUp(false); setConfetti(false);
            setLevel(0); setSetNum(0); setCards(generateCards(0)); setCurrentCards(null);
            setManualBpm(false); setBpm(BASE_BPM); setPhase("idle"); setActiveCard(-1);
            setScore(0); scoreRef.current = 0;
            setLevelTotalScore(0); levelTotalScoreRef.current = 0;
            setGrandSlamScore(0); grandSlamScoreRef.current = 0;
            setMicActive(false); setLevelSummaryData(null);
            saveProgress(0, 0, BASE_BPM); setScreen("ready");
          }}>Slam Again ▶</button>
        </div>
      )}

      {/* ── Install Banner ── */}
      {showInstallBanner && (
        <div className="install-tooltip">
          <button className="install-close" onClick={() => { setShowInstallBanner(false); localStorage.setItem("installBannerDismissed","true"); }}>✕</button>
          <p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:600,fontStyle:"italic",marginBottom:14}}>Install Swara Slam</p>
          {deferredPrompt ? (
            <button className="install-btn" onClick={async () => {
              deferredPrompt.prompt();
              const { outcome } = await deferredPrompt.userChoice;
              if (outcome === "accepted") { setShowInstallBanner(false); localStorage.setItem("installBannerDismissed","true"); }
              setDeferredPrompt(null);
            }}>Add to Home Screen</button>
          ) : (
            <div className="install-steps">
              <div className="install-step"><span className="install-step-num">1</span><span>Tap the <strong>Share</strong> icon in Safari</span></div>
              <div className="install-step"><span className="install-step-num">2</span><span>Tap <strong>"Add to Home Screen"</strong></span></div>
              <div className="install-step"><span className="install-step-num">3</span><span>Tap <strong>"Add"</strong> ✓</span></div>
            </div>
          )}
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          SCREEN ROUTER
      ══════════════════════════════════════════════════════════════════════ */}

      {/* HOME */}
      {screen === "home" && (
        <div className="screen">
          <p className="home-raaguru">Raag<em>GURU</em></p>
          <div className="home-title">
            <span className="home-swara">Swara</span>
            <span className="home-slam">Slam</span>
          </div>
          <p className="home-sub">Swara expertise for Vocalists and Instrumentalists</p>
          <button className="primary-btn" style={{marginTop:8}} onClick={() => {
            // HARD BLOCK: read localStorage at click time — immune to React state resets.
            const localPlays = Number(localStorage.getItem('swaraslam_free_plays') || 0);
            if (localPlays >= 5) {
              setScreen("paywall"); return;
            }
            if (user) { setScreen("ready"); }
            else { setAuthMode("signup"); setScreen("auth"); }
          }}>Start Playing</button>
          <div style={{display:"flex",gap:16,alignItems:"center",marginTop:4}}>
            <button className="ghost-btn" onClick={startWalkthrough}>How to play?</button>
            <span style={{color:"#9A7B50",fontSize:11}}>•</span>
            {user
              ? <button className="ghost-btn" onClick={handleLogout}>Log out ({user.email.split("@")[0]})</button>
              : <button className="ghost-btn" onClick={() => { setAuthMode("login"); setScreen("auth"); }}>Sign-In</button>
            }
          </div>
          {/* Unlock all levels — shown to unauthenticated or non-premium free users */}
          {(!user || !isPremium) && (
            <button
              className="ghost-btn"
              style={{marginTop:2,letterSpacing:".06em"}}
              onClick={() => setScreen("paywall")}
            >
              Unlock all levels
            </button>
          )}
        </div>
      )}

      {/* READY */}
      {screen === "ready" && (
        <div className="screen">
          <div className="ready-title">Ready?</div>
          <p className="ready-sub">Level 1 — {LEVEL_CONFIG[0].label}</p>
          <button className="primary-btn" style={{marginTop:16}} onClick={async () => {
            // HARD BLOCK: check localStorage before doing anything else
            const localPlays = Number(localStorage.getItem('swaraslam_free_plays') || 0);
            if (localPlays >= 5) { setScreen("paywall"); return; }
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              stream.getTracks().forEach(t => t.stop());
            } catch (e) {
              console.info("Mic permission denied; scoring will be unavailable.");
            }
            setScreen("game");
            const isFirstTime = !localStorage.getItem("walkthroughSeen");
            if (isFirstTime) setTimeout(() => startWalkthrough(), 200);
          }}>Begin ▶</button>
          <button className="ghost-btn" style={{marginTop:8}} onClick={() => setScreen("home")}>← Back</button>
        </div>
      )}

      {/* PREMIUM UNLOCKED */}
      {screen === "premium-unlocked" && (
        <div className="screen">
          <div style={{fontSize:64,marginBottom:16}}>🎉</div>
          <div className="ready-title" style={{color:"#C05F2F",fontSize:"clamp(48px,10vw,72px)"}}>Premium Unlocked!</div>
          <p className="ready-sub" style={{maxWidth:320,lineHeight:1.7,marginTop:12}}>
            All 4 levels are now available. Chromatic swaras, advanced jumps, and three full octaves await.
          </p>
          <div style={{marginTop:24,display:"flex",gap:12,alignItems:"center",justifyContent:"center"}}>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#9A7B50"}}/>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#9A7B50"}}/>
            <div style={{width:8,height:8,borderRadius:"50%",background:"#9A7B50"}}/>
          </div>
        </div>
      )}

      {/* RESET PASSWORD */}
      {screen === "reset-password" && (
        <ResetPasswordModal onSuccess={handlePasswordResetSuccess} />
      )}

      {/* AUTH */}
      {screen === "auth" && (
        <div style={{minHeight:"100vh",background:"#F9F7F2",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <AuthModal
            onClose={() => setScreen(user ? "game" : "home")}
            onAuthSuccess={handleAuthSuccess}
            onOpenLegal={() => setShowLegalModal(true)}
            preferredMode={authMode}
          />
        </div>
      )}

      {/* VERIFYING — shown while post-payment premium polling runs */}
      {screen === "verifying" && (
        <div className="screen" style={{gap:24,textAlign:"center"}}>
          <div style={{fontSize:52}}>🎵</div>
          <div className="ready-title" style={{fontSize:"clamp(22px,5vw,32px)"}}>
            Verifying your Riyaz Pass…
          </div>
          <p className="ready-sub" style={{maxWidth:320,lineHeight:1.7}}>
            Your payment is being confirmed. Please do not close this window.
          </p>
          <div style={{display:"flex",gap:8,justifyContent:"center",marginTop:8}}>
            {[0,1,2].map(i => (
              <div key={i} style={{
                width:10,height:10,borderRadius:"50%",background:"#C05F2F",
                animation:`micPulse 1.4s ease-in-out ${i*0.25}s infinite`
              }}/>
            ))}
          </div>
        </div>
      )}

      {/* PAYWALL */}
      {screen === "paywall" && (
        <div className="screen" style={{justifyContent:"flex-start",paddingTop:32,overflowY:"auto",gap:0}}>
          {/* PaywallScreen reads localStorage directly — no contextMessage prop needed */}
          <PaywallScreen
            onCheckout={handleStripeCheckout}
            redirecting={paywallRedirecting}
            redirectingPriceId={redirectingPriceId}
          />
          {/* Back link: visible while plays remain (freePlayCount mirrors localStorage).
               Auth guard: unauthenticated users go to home, not the game loop. */}
          {(!isPremium && freePlayCount < FREE_PLAY_LIMIT) && (
            <button className="ghost-btn" style={{marginTop:4}} onClick={() => {
              setLevel(0); setSetNum(0); setCards(generateCards(0)); setCurrentCards(null);
              setPhase("idle"); setActiveCard(-1);
              setScore(0); scoreRef.current = 0;
              setLevelTotalScore(0); levelTotalScoreRef.current = 0;
              setMicActive(false); setLevelSummaryData(null);
              setScreen(user ? "game" : "home");
            }}>← Back to Level 1</button>
          )}
        </div>
      )}

      {/* GAME */}
      {screen === "game" && (
        <div className="ss-app">
          <header className="ss-header">
            <div className="ss-wordmark">
              <span className="ss-brand-top">Raag<em>GURU</em></span>
              <div className="ss-brand-main">
                <span className="ss-brand-swara">Swara</span>
                <span className="ss-brand-slam">Slam</span>
              </div>
            </div>
            <div className="ss-header-actions">
              {user && (
                <div className="user-chip">
                  <span className="user-chip-name">
                    {/* Crown only shown when the DB confirms is_premium === true */}
                    {isPremium && <span className="user-chip-crown">♛</span>}
                    {user.email.split("@")[0]}
                  </span>
                  <button className="user-chip-logout" onClick={handleLogout}>Log out</button>
                </div>
              )}
              {/* ── Share button ── */}
              <button className="icon-btn" onClick={handleShare} aria-label="Share Swara Slam" title="Share your progress">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
                  <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
                </svg>
              </button>
              {/* ── Feedback button ── */}
              <button className="icon-btn" onClick={() => setShowFeedback(true)} aria-label="Share Feedback" title="Send us feedback">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </button>
              {/* ── Tanpura drone toggle ── */}
              <button className={"icon-btn" + (droneOn ? " active" : "")} onClick={toggleDrone} aria-label={droneOn ? "Mute Tanpura" : "Enable Tanpura"}>
                {droneOn ? <Volume2 /> : <VolumeX />}
              </button>
              {/* ── NEW: Hidden admin key button ─────────────────────────────────
                   Nearly invisible (opacity 0.08) — visible only on hover.
                   Placed last in header actions so it doesn't disrupt layout.
                   Opens AdminDashboard without any URL change.               ── */}
              <button
                className="admin-key-btn"
                onClick={() => setShowAdmin(true)}
                aria-label="Admin"
                title="Admin dashboard"
              >🔑</button>
            </div>
          </header>

          <div className="ss-divider" />

          <div className="progress-bar">
            <span className="prog-badge"><strong>Level {level + 1}</strong> · {LEVEL_CONFIG[level].label}</span>
            <div className="prog-dots">
              {Array.from({ length: SETS_PER_LEVEL }, (_, i) => (
                <div key={i} className={"prog-dot" + (i < setNum ? " filled" : i === setNum ? " current" : "")} />
              ))}
            </div>
            <span className={"phase-label" + (phase === "active" ? " phase-active" : phase === "done" ? " phase-done" : "")}>
              {phaseLabel}
            </span>
          </div>

          {/* Score strip */}
          <div className="score-strip">
            <span className="score-label">Slam Score</span>
            <div className="score-pips">
              {Array.from({ length: ACTIVE_BEATS }, (_, i) => (
                <div key={i} className={"score-pip" + (scoredCards.has(i) ? " hit hit-anim" : "")} />
              ))}
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:1}}>
              <span className={"score-fraction" + (score === 0 ? " zero" : "")}>{score}/{ACTIVE_BEATS}</span>
              {levelTotalScore > 0 && (
                <span className="level-running-total">Level: {levelTotalScore}/{TOTAL_PER_LEVEL}</span>
              )}
            </div>
          </div>

          <main className="ss-arena">
            <div className={"arena-field" + (phase === "active" ? " phase-active-border" : "")}>
              {/* Mic listening indicator */}
              {micActive && (
                <div style={{position:"absolute",top:10,right:14,zIndex:2}}>
                  <div className="mic-status">
                    <div className={"mic-dot" + (phase === "active" ? " listening" : "")} />
                    <span>{phase === "active" ? "listening" : "ready"}</span>
                  </div>
                </div>
              )}

              <div className="card-grid" style={{filter: isLocked ? "blur(6px)" : "none", transition:"filter 0.3s", pointerEvents: isLocked ? "none" : "auto"}}>
                {trueDisplayCards.map((sw, i) => (
                  <SwaraCard
                    key={i}
                    swara={sw}
                    state={getCardState(i)}
                    pitchMatched={i === activeCard && isMatch && phase === "active"}
                  />
                ))}
              </div>
              <BeatDots beat={dotBeat} active={isPlaying} />
            </div>

            {/* ── NEW: MicErrorBanner — shown when mic fails and user hasn't dismissed ── */}
            {micError && !micErrorDismissed && (
              <MicErrorBanner
                message={micError}
                onRetry={() => {
                  setMicErrorDismissed(false);
                  retryMic();
                }}
                onDismiss={() => setMicErrorDismissed(true)}
              />
            )}

            {isLocked && (
              <div style={{textAlign:"center",padding:"8px 0 4px"}}>
                <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#9A7B50",marginBottom:10}}>
                  🔒 Level {level + 1} requires Full Access
                </p>
                <button className="primary-btn" style={{padding:"10px 28px",fontSize:13}} onClick={() => setScreen("paywall")}>
                  Unlock Now
                </button>
              </div>
            )}
          </main>

          <section className="ss-controls" aria-label="Practice controls">
            <div className="ctrl-row">
              <span className="ctrl-label">BPM</span>
              <input type="range" className="ss-slider" min="40" max="700" step="1" value={bpm}
                style={{"--pct": sliderPct}} onChange={handleBpmChange} aria-label={"Tempo: " + bpm + " BPM"} />
              <span className="ctrl-val">{bpm}</span>
            </div>
            <div className="ctrl-row">
              <span className="ctrl-label">Sa</span>
              <select className="ss-select" value={saIndex} onChange={handleSaChange} aria-label="Select Sa pitch">
                {SA_PITCHES.map((p, i) => <option key={p.label} value={i}>{p.label} — {p.freq.toFixed(0)} Hz</option>)}
              </select>
            </div>
            <div className="play-row">
              <button className="nav-btn" onClick={handleRetry} disabled={isPlaying || isLocked} aria-label="Retry"><SkipBack /></button>
              <button className={"play-btn" + (isPlaying ? " playing" : "")}
                onClick={() => isPlaying ? stopPlay() : startPlay(null)}
                disabled={isLocked} aria-label={isPlaying ? "Stop" : "Play"}>
                {isPlaying ? <Pause /> : <Play />}
              </button>
              <button className="nav-btn" onClick={handleNextSet} disabled={isPlaying || isLocked} aria-label="Next set"><SkipFwd /></button>
            </div>
          </section>
        </div>
      )}

      {/* Feedback Modal */}
      {showFeedback && (
        <FeedbackModal user={user} onClose={() => setShowFeedback(false)} />
      )}

      {/* Cookie Consent Banner */}
      {showCookieBanner && (
        <CookieBanner onAccept={handleCookieAccept} onLearnMore={handleCookieLearnMore} />
      )}

      {/* Legal Modal */}
      {showLegalModal && (
        <LegalModal onClose={() => setShowLegalModal(false)} />
      )}
    </>
  );
}
