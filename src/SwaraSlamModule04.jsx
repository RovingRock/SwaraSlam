import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ═══════════════════════════════════════════════════════════════════════════════
// ─── usePitchDetection Hook ───────────────────────────────────────────────────
// RULE #2: Fully encapsulated. No game state is read or written from inside.
// Accepts: isActive (bool), targetFreq (number)
// Returns: isMatch (bool)
// ═══════════════════════════════════════════════════════════════════════════════
function usePitchDetection({ isActive, targetFreq }) {
  const [isMatch, setIsMatch] = useState(false);

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
  // Classic McLeod / YIN-adjacent approach using Web Audio AnalyserNode buffer.
  const detectPitch = useCallback((analyser, sampleRate) => {
    const buffer = bufferRef.current;
    analyser.getFloatTimeDomainData(buffer);

    // RMS silence gate — skip if signal too quiet (< -60 dBFS ≈ 0.001)
    let rms = 0;
    for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / buffer.length);
    if (rms < 0.012) return null;

    // Autocorrelation
    const n = buffer.length;
    let bestOffset = -1;
    let bestCorr   = 0;
    let lastCorr   = 1;
    let foundGo    = false;

    // Search range: 50 Hz – 1200 Hz covers all vocal ranges + upper swaras
    const minOffset = Math.floor(sampleRate / 1200);
    const maxOffset = Math.ceil(sampleRate / 50);

    for (let offset = minOffset; offset <= maxOffset; offset++) {
      let corr = 0;
      for (let i = 0; i < n - offset; i++) {
        corr += Math.abs(buffer[i] - buffer[i + offset]);
      }
      corr = 1 - corr / (n - offset);

      if (corr > 0.9 && corr > lastCorr) {
        foundGo = true;
      }
      if (foundGo && corr < lastCorr) {
        // Local peak found
        if (corr > bestCorr) {
          bestCorr   = corr;
          bestOffset = offset - 1;
        }
        foundGo = false;
      }
      lastCorr = corr;
    }

    if (bestOffset === -1 || bestCorr < 0.92) return null;

    // Parabolic interpolation for sub-sample accuracy
    // Compute normalised correlation at a given offset
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
    const refinedOffset = bestOffset + shift;

    return sampleRate / refinedOffset;
  }, []);

  // ── Frequency → Cents deviation from target ────────────────────────────────
  const freqToCents = (detected, target) => {
    if (!detected || !target || detected <= 0 || target <= 0) return Infinity;
    return 1200 * Math.log2(detected / target);
  };

  // ── Check match across all octaves of the target swara ────────────────────
  // A singer may produce the swara in mandra (lower) or taar (upper) saptak.
  const checkMatchAcrossOctaves = useCallback((detectedHz, targetHz) => {
    if (!detectedHz || !targetHz) return false;
    // Check target octave, one below, one above
    for (const mult of [0.5, 1, 2]) {
      const octaveTarget = targetHz * mult;
      const cents = Math.abs(freqToCents(detectedHz, octaveTarget));
      if (cents <= 25) return true;   // ±25 cents tolerance as specified
    }
    return false;
  }, []);

  // ── Detection loop ─────────────────────────────────────────────────────────
  const startLoop = useCallback(() => {
    const analyser   = analyserRef.current;
    const sampleRate = audioCtxRef.current?.sampleRate ?? 44100;

    const loop = () => {
      if (!isActiveRef.current) {
        setIsMatch(false);
        return;
      }
      rafRef.current = requestAnimationFrame(loop);

      const hz = detectPitch(analyser, sampleRate);
      const matched = checkMatchAcrossOctaves(hz, targetFreqRef.current);
      setIsMatch(matched);
    };

    rafRef.current = requestAnimationFrame(loop);
  }, [detectPitch, checkMatchAcrossOctaves]);

  // ── Teardown helper ────────────────────────────────────────────────────────
  const teardown = useCallback(() => {
    cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    setIsMatch(false);

    try { sourceRef.current?.disconnect(); } catch (e) {}
    try { analyserRef.current?.disconnect(); } catch (e) {}

    // Stop all mic tracks — removes browser "mic in use" indicator
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;

    try { audioCtxRef.current?.close(); } catch (e) {}
    audioCtxRef.current = null;
    bufferRef.current = null;
  }, []);

  // ── Main effect: start / stop based on isActive ───────────────────────────
  useEffect(() => {
    if (!isActive) {
      teardown();
      return;
    }

    let cancelled = false;

    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

        streamRef.current = stream;

        const ctx      = new (window.AudioContext || window.webkitAudioContext)();
        audioCtxRef.current = ctx;
        if (ctx.state === "suspended") await ctx.resume();

        const analyser = ctx.createAnalyser();
        analyser.fftSize          = 2048;
        analyser.smoothingTimeConstant = 0.0; // No smoothing for pitch accuracy
        analyserRef.current = analyser;
        bufferRef.current = new Float32Array(analyser.fftSize);

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);
        // NOTE: Do NOT connect to ctx.destination — avoids mic feedback
        sourceRef.current = source;

        startLoop();
      } catch (err) {
        // Mic permission denied or hardware unavailable — fail silently
        console.warn("usePitchDetection: mic unavailable:", err.message);
        setIsMatch(false);
      }
    })();

    return () => {
      cancelled = true;
      teardown();
    };
  }, [isActive]); // eslint-disable-line react-hooks/exhaustive-deps
  // targetFreq changes are handled via ref — no need to restart AudioContext

  return { isMatch };
}

// ─── Auth Modal ───────────────────────────────────────────────────────────────
function AuthModal({ onClose, onAuthSuccess }) {
  const [mode, setMode]                   = useState("signup");
  const [email, setEmail]                 = useState("");
  const [password, setPassword]           = useState("");
  const [marketingConsent, setMktConsent] = useState(false);
  const [termsAccepted, setTerms]         = useState(false);
  const [loading, setLoading]             = useState(false);
  const [error, setError]                 = useState("");
  const [message, setMessage]             = useState("");
  const [honeypot, setHoneypot]           = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (honeypot) return;
    if (mode === "signup" && !termsAccepted) {
      setError("Please accept the Terms & Conditions to continue");
      return;
    }
    setLoading(true); setError(""); setMessage("");
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: "https://swara-slam.vercel.app",
            data: { marketing_consent: marketingConsent }
          }
        });
        if (err) {
          if (err.message.includes("already registered") || err.message.includes("already exists")) {
            setError("This email is already registered. Please log in.");
            setTimeout(() => setMode("login"), 2000);
          } else { throw err; }
          return;
        }
        if (data.user) {
          const needsConfirmation = !data.session;
          if (needsConfirmation) {
            setMessage("✅ Verification email sent! Please check your inbox and click the link to activate your account.");
          } else {
            await supabase.from("profiles").update({
              marketing_consent: marketingConsent,
              terms_accepted: true,
              terms_accepted_at: new Date().toISOString(),
            }).eq("id", data.user.id);
            setMessage("✅ Account created successfully!");
            setTimeout(() => onAuthSuccess(data.user), 1000);
          }
        }
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        if (data.user && !data.user.email_confirmed_at) {
          setError("Please confirm your email address before logging in. Check your inbox for the confirmation link.");
          return;
        }
        if (data.user) onAuthSuccess(data.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const s = {
    overlay:   { position:"fixed",inset:0,backgroundColor:"rgba(28,26,23,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999999,backdropFilter:"blur(4px)" },
    modal:     { backgroundColor:"#F9F7F2",borderRadius:16,padding:"40px 40px 36px",maxWidth:440,width:"90%",boxShadow:"0 20px 60px rgba(192,95,47,0.2)",position:"relative",border:"2px solid #9A7B50" },
    closeBtn:  { position:"absolute",top:14,right:14,background:"none",border:"none",cursor:"pointer",padding:8,opacity:0.5 },
    logo:      { textAlign:"center",marginBottom:20,fontSize:26 },
    heading:   { fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:600,color:"#1C1A17",textAlign:"center",margin:"0 0 6px" },
    sub:       { fontFamily:"'DM Sans',sans-serif",fontSize:14,color:"#6B6560",textAlign:"center",margin:"0 0 28px" },
    form:      { display:"flex",flexDirection:"column",gap:14 },
    input:     { fontFamily:"'DM Sans',sans-serif",fontSize:15,padding:13,border:"1.5px solid #E5DFD3",borderRadius:8,backgroundColor:"#fff",color:"#1C1A17",outline:"none" },
    checkRow:  { display:"flex",alignItems:"flex-start",gap:10,fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#6B6560",lineHeight:1.5 },
    error:     { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#D84315",backgroundColor:"#FFEBEE",padding:10,borderRadius:6,textAlign:"center" },
    success:   { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#2E7D32",backgroundColor:"#E8F5E9",padding:10,borderRadius:6,textAlign:"center" },
    btn:       { fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:600,padding:15,backgroundColor:"#C05F2F",color:"#fff",border:"none",borderRadius:8,cursor:"pointer",marginTop:4 },
    toggle:    { fontFamily:"'DM Sans',sans-serif",fontSize:13,color:"#6B6560",textAlign:"center",marginTop:20 },
    toggleBtn: { background:"none",border:"none",color:"#C05F2F",fontWeight:600,cursor:"pointer",textDecoration:"underline",padding:0 },
    link:      { color:"#C05F2F",textDecoration:"underline" },
  };

  return (
    <div style={s.overlay}>
      <div style={s.modal}>
        <button style={s.closeBtn} onClick={onClose}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="#1C1A17" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <div style={s.logo}>
          <span style={{fontFamily:"'Cormorant Garamond',serif",color:"#9A7B50",fontWeight:600}}>Raag</span>
          <span style={{fontFamily:"'DM Sans',sans-serif",color:"#C05F2F",fontWeight:600,letterSpacing:1}}>GURU</span>
        </div>
        <h2 style={s.heading}>{mode === "login" ? "Welcome Back" : "Create Free Account"}</h2>
        <p style={s.sub}>{mode === "login" ? "Continue your Swara practice" : "Sign up to save progress & unlock levels"}</p>
        <form onSubmit={handleSubmit} style={s.form}>
          <input
            type="text" name="website_verification" value={honeypot}
            onChange={e => setHoneypot(e.target.value)}
            style={{position:"absolute",left:"-9999px",width:1,height:1,opacity:0}}
            tabIndex={-1} autoComplete="off"
          />
          <input type="email" placeholder="Email address" value={email} onChange={e => setEmail(e.target.value)} required style={s.input} />
          <input type="password" placeholder="Password (min. 6 characters)" value={password} onChange={e => setPassword(e.target.value)} required minLength={6} style={s.input} />
          {mode === "signup" && (
            <>
              <label style={s.checkRow}>
                <input type="checkbox" checked={termsAccepted} onChange={e => setTerms(e.target.checked)} style={{width:17,height:17,accentColor:"#C05F2F",flexShrink:0,marginTop:2}} />
                <span>I agree to the{" "}
                  <a href="#" style={s.link} onClick={e => { e.preventDefault(); alert("Terms & Conditions coming soon!"); }}>Terms & Conditions</a>
                  {" "}and{" "}
                  <a href="#" style={s.link} onClick={e => { e.preventDefault(); alert("Privacy Policy coming soon!"); }}>Privacy Policy</a>
                </span>
              </label>
              <label style={s.checkRow}>
                <input type="checkbox" checked={marketingConsent} onChange={e => setMktConsent(e.target.checked)} style={{width:17,height:17,accentColor:"#C05F2F",flexShrink:0,marginTop:2}} />
                <span>Keep me updated on new RaagGuru features</span>
              </label>
            </>
          )}
          {error   && <div style={s.error}>{error}</div>}
          {message && <div style={s.success}>{message}</div>}
          <button type="submit" disabled={loading || (mode === "signup" && !termsAccepted)}
            style={{...s.btn, opacity:(loading || (mode === "signup" && !termsAccepted)) ? 0.5 : 1}}>
            {loading ? "Processing…" : mode === "login" ? "Log In" : "Create Account"}
          </button>
        </form>
        <div style={s.toggle}>
          {mode === "login"
            ? <>Don't have an account?{" "}<button type="button" onClick={() => setMode("signup")} style={s.toggleBtn}>Sign Up</button></>
            : <>Already have an account?{" "}<button type="button" onClick={() => setMode("login")} style={s.toggleBtn}>Log In</button></>}
        </div>
      </div>
    </div>
  );
}

// ─── Paywall Screen ───────────────────────────────────────────────────────────
function PaywallScreen({ onCheckout, redirecting, redirectingPriceId }) {
  const btnBase = { fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,padding:"13px 24px",color:"#fff",border:"none",borderRadius:8,cursor:redirecting?"not-allowed":"pointer",width:"100%" };
  const isRedirecting = (priceId) => redirecting && redirectingPriceId === priceId;

  return (
    <div style={{width:"100%",maxWidth:480,margin:"0 auto",display:"flex",flexDirection:"column",alignItems:"center",gap:20,padding:"32px 16px"}}>
      <div style={{fontSize:44}}>🔒</div>
      <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:600,color:"#1C1A17",margin:0,textAlign:"center"}}>
        Unlock All 4 Levels
      </h2>
      <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:14,color:"#6B6560",textAlign:"center",margin:0,maxWidth:360,lineHeight:1.6}}>
        Level 1 is free. Unlock chromatic swaras, advanced jumps, and three octaves with full access.
      </p>
      <div style={{display:"flex",gap:16,flexWrap:"wrap",justifyContent:"center",width:"100%",marginTop:8}}>
        <div style={{background:"#fff",border:"1.5px solid #E5DFD3",borderRadius:14,padding:"22px 20px",flex:"1 1 180px",maxWidth:220,textAlign:"center"}}>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#9A7B50",fontWeight:700,letterSpacing:".12em",marginBottom:8}}>24-HOUR PASS</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,fontWeight:600,color:"#1C1A17",lineHeight:1,marginBottom:4}}>$1.99</div>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#6B6560",marginBottom:16}}>Try all levels for a day</div>
          <button disabled={redirecting} onClick={() => onCheckout("price_1TVpDNCevGY65XqMdTh1x4Qb")}
            style={{...btnBase,background:"#9A7B50",opacity:isRedirecting("price_1TVpDNCevGY65XqMdTh1x4Qb")?0.6:redirecting?0.3:1}}>
            {isRedirecting("price_1TVpDNCevGY65XqMdTh1x4Qb") ? "Redirecting…" : "Get 24-Hour Access"}
          </button>
        </div>
        <div style={{background:"linear-gradient(135deg,rgba(192,95,47,0.08),rgba(154,123,80,0.08))",border:"2px solid #C05F2F",borderRadius:14,padding:"22px 20px",flex:"1 1 180px",maxWidth:220,textAlign:"center",position:"relative"}}>
          <div style={{position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",background:"#C05F2F",color:"#fff",padding:"3px 12px",borderRadius:20,fontSize:10,fontWeight:700,fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>
            BEST VALUE
          </div>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#C05F2F",fontWeight:700,letterSpacing:".12em",marginBottom:8}}>LIFETIME ACCESS</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,fontWeight:600,color:"#C05F2F",lineHeight:1,marginBottom:4}}>$9.99</div>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#6B6560",marginBottom:16}}>Unlock forever</div>
          <button disabled={redirecting} onClick={() => onCheckout("price_1TVpBKCevGY65XqMA79vW9Rt")}
            style={{...btnBase,background:"#C05F2F",boxShadow:"0 4px 12px rgba(192,95,47,0.3)",opacity:isRedirecting("price_1TVpBKCevGY65XqMA79vW9Rt")?0.6:redirecting?0.3:1}}>
            {isRedirecting("price_1TVpBKCevGY65XqMA79vW9Rt") ? "Redirecting…" : "✦ Get Lifetime Access"}
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
        const cb = beat, ct = t, cs = scheduled;
        setTimeout(() => onBeat(cb % 4, isDown, cs, ct), delay);
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

  const stopScheduler    = useCallback(() => { clearTimeout(schedTimerRef.current); schedTimerRef.current = null; }, []);
  const resumeCtx        = useCallback(() => { if (ctxRef.current?.state === "suspended") ctxRef.current.resume(); }, []);
  const updateDroneFreq  = useCallback((freq) => {
    if (!droneNodesRef.current.length || !ctxRef.current) return;
    const t = ctxRef.current.currentTime + 0.05;
    [freq,freq*2,freq*3,freq*5,freq*1.5,freq*3].forEach((f,i) => {
      try { if (droneNodesRef.current[i]) droneNodesRef.current[i].frequency.setTargetAtTime(f, t, 0.1); } catch(e){}
    });
  }, []);

  // ── Set complete "ding" — bright triangle-wave chime, distinct from guru notes ──
  const playSetDing = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime + 0.05;
    // Two-note quick chime: root + fifth
    [[880, 0],[1320, 0.12]].forEach(([freq, delay]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(freq, t + delay);
      g.gain.setValueAtTime(0, t + delay);
      g.gain.linearRampToValueAtTime(0.18, t + delay + 0.012);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.45);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + delay); o.stop(t + delay + 0.5);
    });
  }, [getCtx]);

  // ── Level up arpeggio — 5-note rising synth, square wave for game-feel ──
  const playLevelUpArp = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime + 0.08;
    // Sa Re Ga Pa Sa' — pentatonic rise, feels triumphant not cheesy
    const freqs = [261.63, 293.66, 329.63, 392.00, 523.25];
    freqs.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "square";
      o.frequency.setValueAtTime(freq, t + i * 0.11);
      // Square wave can be harsh — low gain + steep decay
      g.gain.setValueAtTime(0, t + i * 0.11);
      g.gain.linearRampToValueAtTime(0.08, t + i * 0.11 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.11 + 0.22);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.25);
    });
    // Final sustain chord: Sa + Pa together
    [[261.63, 392.00]].forEach(([f]) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(f * 2, t + freqs.length * 0.11);
      g.gain.setValueAtTime(0.1, t + freqs.length * 0.11);
      g.gain.exponentialRampToValueAtTime(0.001, t + freqs.length * 0.11 + 0.6);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + freqs.length * 0.11); o.stop(t + freqs.length * 0.11 + 0.65);
    });
  }, [getCtx]);

  // ── Grand Slam fanfare — full ascending run + held chord ──
  const playGrandSlamFanfare = useCallback(() => {
    const ctx = getCtx();
    const t = ctx.currentTime + 0.08;
    const freqs = [261.63, 293.66, 329.63, 349.23, 392.00, 440.00, 493.88, 523.25];
    freqs.forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = i < 4 ? "square" : "triangle";
      o.frequency.setValueAtTime(freq, t + i * 0.09);
      g.gain.setValueAtTime(0, t + i * 0.09);
      g.gain.linearRampToValueAtTime(0.09, t + i * 0.09 + 0.015);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.09 + 0.3);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.35);
    });
    // Held major chord at end
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq, t + freqs.length * 0.09);
      g.gain.setValueAtTime(0.09 - i * 0.02, t + freqs.length * 0.09);
      g.gain.exponentialRampToValueAtTime(0.001, t + freqs.length * 0.09 + 1.2);
      o.connect(g); g.connect(ctx.destination);
      o.start(t + freqs.length * 0.09); o.stop(t + freqs.length * 0.09 + 1.3);
    });
  }, [getCtx]);

  return { startDrone, stopDrone, scheduleBeats, stopScheduler, resumeCtx, updateDroneFreq, playGuruNote, playSetDing, playLevelUpArp, playGrandSlamFanfare };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
// MODIFIED: Added pitchMatched prop for green glow feedback
function SwaraCard({ swara, state, pitchMatched }) {
  const oct = swara.octave ?? 1;
  // pitchMatched adds .card-match on top of the existing state class
  const extraClass = pitchMatched ? " card-match" : "";
  return (
    <div className={"swara-card card-" + state + extraClass}>
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
        <div key={i} className={"beat-dot" + (active && beat === i ? (i===0 ? " dot-dn" : " dot-up") : "")}/>
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

// ─── Title Hierarchy ──────────────────────────────────────────────────────────
const TOTAL_PER_LEVEL  = ACTIVE_BEATS * SETS_PER_LEVEL; // 40
const TOTAL_ALL_LEVELS = TOTAL_PER_LEVEL * LEVEL_CONFIG.length; // 160

function getTitleForPct(pct) {
  if (pct <= 20) return { title: "Shishya",  emoji: "🌱", color: "#9A7B50" };
  if (pct <= 40) return { title: "Sadhak",   emoji: "🔥", color: "#C05F2F" };
  if (pct <= 59) return { title: "Gyani",    emoji: "⚡", color: "#C05F2F" };
  if (pct <= 79) return { title: "Pundit",   emoji: "🎯", color: "#1C1A17" };
  return              { title: "Guru",      emoji: "✦",  color: "#9A7B50"  };
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

  // Game
  const [isPlaying,      setIsPlaying]      = useState(false);
  const [droneOn,        setDroneOn]        = useState(true);
  const [saIndex,        setSaIndex]        = useState(0);
  const [level,          setLevel]          = useState(0);
  const [setNum,         setSetNum]         = useState(0);
  const [cards,          setCards]          = useState(() => generateCards(0));
  const [currentCards,   setCurrentCards]   = useState(null);
  const [phase,          setPhase]          = useState("idle");
  const [activeCard,     setActiveCard]     = useState(-1);
  const [dotBeat,        setDotBeat]        = useState(-1);
  const [bpm,            setBpm]            = useState(BASE_BPM);
  const [manualBpm,      setManualBpm]      = useState(false);
  const [bpmFlash,       setBpmFlash]       = useState(false);
  const [levelUpVisible, setLevelUpVisible] = useState(false);
  const [confetti,       setConfetti]       = useState(false);
  const [allLevelsUp,    setAllLevelsUp]    = useState(false);

  // ── NEW: Scoring & pitch detection state ──────────────────────────────────
  // score: total matched swaras in current set (resets each set)
  // scoredCards: Set of card indices already scored this set (one-hit-per-card)
  // micActive: drives usePitchDetection — true only when game is actively playing
  const [score,        setScore]        = useState(0);
  const [scoredCards,  setScoredCards]  = useState(new Set());
  const scoredCardsRef = useRef(new Set());  // Ref mirror for use inside callbacks
  const [micActive,    setMicActive]    = useState(false);

  // ── NEW: Cumulative level scoring ─────────────────────────────────────────
  // levelTotalScore: accumulates set scores across a full level (resets on level change)
  // levelSummaryData: { score, total, title, emoji, msg } — shown in Level Summary overlay
  // grandSlamScore: total points across all 4 levels (160 max)
  const [levelTotalScore,   setLevelTotalScore]   = useState(0);
  const levelTotalScoreRef  = useRef(0);
  const [levelSummaryData,  setLevelSummaryData]  = useState(null); // null = hidden
  const [grandSlamScore,    setGrandSlamScore]    = useState(0);
  const grandSlamScoreRef   = useRef(0);
  // scoreRef: mirrors current set `score` for use inside advanceSet callback
  const scoreRef = useRef(0);

  // Compute the target frequency the user should be singing right now.
  const activeCardRef = useRef(activeCard);
  activeCardRef.current = activeCard;
  scoreRef.current = score;

  // Auth/paywall
  const [user,                  setUser]                  = useState(null);
  const [isPremium,             setIsPremium]             = useState(false);
  const [hasCompletedLevel1,    setHasCompletedLevel1]    = useState(false);
  const [paywallRedirecting,    setPaywallRedirecting]    = useState(false);
  const [redirectingPriceId,    setRedirectingPriceId]    = useState(null);
  const [highestBpm,            setHighestBpm]            = useState(BASE_BPM);

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
  const isPremiumRef  = useRef(isPremium);
  const manualBpmRef  = useRef(manualBpm);
  const bpmRef        = useRef(bpm);
  const highestBpmRef = useRef(highestBpm);
  const engine        = useAudioEngine();

  saIdxRef.current = saIndex; cardsRef.current = cards; levelRef.current = level;
  setNumRef.current = setNum; userRef.current = user; isPremiumRef.current = isPremium;
  manualBpmRef.current = manualBpm; bpmRef.current = bpm; highestBpmRef.current = highestBpm;

  const autoBpm = BASE_BPM + setNum * BPM_INCREMENT;

  // ── usePitchDetection — RULE #2 compliant isolated hook ───────────────────
  // targetFreq = Sa * ratio of active card. -1 when no card is active.
  const activeCardData = (cardsRef.current && activeCard >= 0 && activeCard < cardsRef.current.length)
    ? cardsRef.current[activeCard]
    : null;
  const targetFreq = activeCardData
    ? SA_PITCHES[saIndex].freq * activeCardData.ratio
    : -1;

  const { isMatch } = usePitchDetection({
    isActive:   micActive && phase === "active" && activeCard >= 0,
    targetFreq: targetFreq > 0 ? targetFreq : 1, // prevent log(0)
  });

  // ── Scoring logic — one-hit-per-card ─────────────────────────────────────
  // When isMatch flips true for a card index not yet scored this set, add point.
  useEffect(() => {
    if (!isMatch) return;
    if (phase !== "active") return;
    if (activeCard < 0) return;
    if (scoredCardsRef.current.has(activeCard)) return; // already scored

    const next = new Set(scoredCardsRef.current);
    next.add(activeCard);
    scoredCardsRef.current = next;
    setScoredCards(next);
    setScore(s => {
      scoreRef.current = s + 1;
      return s + 1;
    });
    // Accumulate into level total
    setLevelTotalScore(lt => {
      levelTotalScoreRef.current = lt + 1;
      return lt + 1;
    });
    // Accumulate into grand slam total
    setGrandSlamScore(gs => {
      grandSlamScoreRef.current = gs + 1;
      return gs + 1;
    });
  }, [isMatch, activeCard, phase]);

  // Reset per-set scoring state when a new set begins (activeCard resets to -1)
  useEffect(() => {
    if (phase === "idle" || phase === "leadin") {
      scoredCardsRef.current = new Set();
      setScoredCards(new Set());
      // Don't reset total score here — it accumulates across the set
    }
  }, [phase]);

  // ── Session restore ────────────────────────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      window.history.replaceState({}, "", window.location.pathname);
      let attempts = 0;
      const maxAttempts = 5;
      const checkPremiumStatus = async () => {
        attempts++;
        const { data: { session } } = await supabase.auth.getSession();
        if (!session?.user) return;
        const { data: profile } = await supabase
          .from("profiles").select("is_premium").eq("id", session.user.id).single();
        if (profile?.is_premium) {
          setIsPremium(true); isPremiumRef.current = true;
          userRef.current = session.user; setUser(session.user);
          setConfetti(true); setTimeout(() => setConfetti(false), 3500);
          setScreen("premium-unlocked");
          setTimeout(() => setScreen("game"), 3500);
        } else if (attempts < maxAttempts) {
          setTimeout(checkPremiumStatus, 1000 * attempts);
        } else {
          alert("Payment received but premium status not updated. Please refresh the page or contact support.");
          setScreen("game");
        }
      };
      setTimeout(checkPremiumStatus, 1000);
    } else if (params.get("canceled") === "true") {
      window.history.replaceState({}, "", window.location.pathname);
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUser(session.user); userRef.current = session.user; loadProfile(session.user.id); }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      if (session?.user) {
        setUser(session.user); userRef.current = session.user;
        loadProfile(session.user.id);
      } else {
        setUser(null); userRef.current = null;
        setIsPremium(false); isPremiumRef.current = false;
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  const loadProfile = async (userId) => {
    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
      if (error || !data) return false;
      const lvl = Math.max(0, (data.current_level || 1) - 1);
      const sn  = Math.max(0, (data.current_set   || 1) - 1);
      const premium = data.is_premium || false;
      const completedL1 = lvl >= 1 || (lvl === 0 && sn >= SETS_PER_LEVEL);
      setLevel(lvl); setSetNum(sn);
      setIsPremium(premium);
      setHasCompletedLevel1(completedL1);
      isPremiumRef.current = premium;
      userRef.current = user;
      setHighestBpm(data.last_bpm || data.highest_bpm || BASE_BPM);
      setCards(generateCards(lvl)); setCurrentCards(null);
      return premium;
    } catch (e) { console.error("loadProfile:", e); return false; }
  };

  const saveProgress = useCallback(async (lvl, sn, curBpm) => {
    if (!userRef.current) return;
    try {
      const newHighest = Math.max(highestBpmRef.current, curBpm);
      setHighestBpm(newHighest); highestBpmRef.current = newHighest;
      await supabase.from("profiles").update({ current_level: lvl+1, current_set: sn+1, last_bpm: newHighest }).eq("id", userRef.current.id);
    } catch (e) { console.error("saveProgress:", e); }
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

  const prevSetRef = useRef(-1), prevLevelRef = useRef(-1);
  useEffect(() => {
    if (prevSetRef.current === -1) { prevSetRef.current = setNum; prevLevelRef.current = level; return; }
    if (prevSetRef.current !== setNum || prevLevelRef.current !== level) {
      prevSetRef.current = setNum; prevLevelRef.current = level;
      setBpmFlash(true); setTimeout(() => setBpmFlash(false), 1600);
    }
  }, [setNum, level]);

  // ── Advance set/level ──────────────────────────────────────────────────────
  // RULE #1: Paywall / auth / navigation logic unchanged.
  // Added: sound effects, levelTotalScore accumulation, Level Summary overlay.
  const advanceSet = useCallback((lvl, sn) => {
    const nextSet    = sn + 1;
    const setScore_  = scoreRef.current; // snapshot before any resets

    // ── Free users on Level 1 (unchanged paywall logic) ──────────────────
    if (lvl === 0 && !isPremiumRef.current && userRef.current) {
      engine.playSetDing();
      if (nextSet >= SETS_PER_LEVEL) {
        setConfetti(true);
        setTimeout(() => setConfetti(false), 3200);
        setTimeout(() => {
          setLevel(0); setSetNum(0);
          setCards(generateCards(0)); setCurrentCards(null);
          if (!manualBpmRef.current) setBpm(BASE_BPM);
          setScore(0); scoreRef.current = 0;
          setLevelTotalScore(0); levelTotalScoreRef.current = 0;
          setScreen("paywall");
        }, 3200);
        return;
      } else {
        setSetNum(nextSet);
        setCards(generateCards(0)); setCurrentCards(null);
        const newBpm = manualBpmRef.current ? bpmRef.current : BASE_BPM + nextSet * BPM_INCREMENT;
        if (!manualBpmRef.current) setBpm(newBpm);
        saveProgress(0, nextSet, newBpm);
        setTimeout(() => setScreen("paywall"), 1500);
        return;
      }
    }

    // ── End of a level (Set 5 completed) ─────────────────────────────────
    if (nextSet >= SETS_PER_LEVEL) {
      const nextLevel  = lvl + 1;
      const levelTotal = levelTotalScoreRef.current; // all 5 sets accumulated
      const pct        = Math.round((levelTotal / TOTAL_PER_LEVEL) * 100);
      const summary    = getLevelSummaryMessage(levelTotal, TOTAL_PER_LEVEL);

      // Play level-up arpeggio (more celebratory than ding)
      engine.playLevelUpArp();
      setConfetti(true); setTimeout(() => setConfetti(false), 3200);
      if (nextLevel === 1) setHasCompletedLevel1(true);

      if (nextLevel >= LEVEL_CONFIG.length) {
        // All 4 levels done — grand slam
        engine.playGrandSlamFanfare();
        setLevelSummaryData({
          ...summary,
          levelTotal,
          levelNum: lvl + 1,
          isGrandSlam: true,
          grandTotal: grandSlamScoreRef.current,
        });
        // Show level summary first, then grand slam overlay
        setTimeout(() => {
          setLevelSummaryData(null);
          setAllLevelsUp(true);
        }, 5000);
      } else {
        // Normal level completion — show Level Summary, then advance
        setLevelSummaryData({
          ...summary,
          levelTotal,
          levelNum: lvl + 1,
          isGrandSlam: false,
          grandTotal: grandSlamScoreRef.current,
        });
        setTimeout(() => {
          setLevelSummaryData(null);
          setLevelUpVisible(true);
          // Reset level total for next level
          setLevelTotalScore(0); levelTotalScoreRef.current = 0;
          setTimeout(() => {
            setLevelUpVisible(false);
            setLevel(nextLevel); setSetNum(0);
            setCards(generateCards(nextLevel)); setCurrentCards(null);
            if (!manualBpmRef.current) setBpm(BASE_BPM);
            setScore(0); scoreRef.current = 0;
            saveProgress(nextLevel, 0, BASE_BPM);
          }, 2800);
        }, 4800);
      }

    // ── Mid-level set completed ───────────────────────────────────────────
    } else {
      engine.playSetDing();
      setSetNum(nextSet);
      setCards(generateCards(lvl)); setCurrentCards(null);
      const newBpm = manualBpmRef.current ? bpmRef.current : BASE_BPM + nextSet * BPM_INCREMENT;
      if (!manualBpmRef.current) setBpm(newBpm);
      saveProgress(lvl, nextSet, newBpm);
    }
  }, [engine, saveProgress]);

  // ── Playback ───────────────────────────────────────────────────────────────
  const startPlay = useCallback((replayCards) => {
    engine.stopScheduler();
    const playCards = replayCards || generateCards(levelRef.current);
    if (!replayCards) setCards(playCards);
    setCurrentCards(playCards); cardsRef.current = playCards;

    // Reset per-set scoring (levelTotalScore accumulates — not reset here)
    setScore(0); scoreRef.current = 0;
    scoredCardsRef.current = new Set();
    setScoredCards(new Set());

    const effectiveBpm = manualBpmRef.current ? bpmRef.current : autoBpm;
    if (!manualBpmRef.current) setBpm(effectiveBpm);
    engine.resumeCtx();
    if (droneOn) engine.startDrone(SA_PITCHES[saIdxRef.current].freq);

    setPhase("leadin"); setActiveCard(-1); setDotBeat(-1); setIsPlaying(true);
    setMicActive(true); // ← Start pitch detection when playback begins

    engine.scheduleBeats(effectiveBpm, LEAD_IN_BEATS + ACTIVE_BEATS,
      (_dot, _isDown, seqIdx, sTime) => {
        setDotBeat(_dot);
        if (seqIdx < LEAD_IN_BEATS) {
          setPhase("leadin"); setActiveCard(-1);
        } else {
          setPhase("active");
          const ci = seqIdx - LEAD_IN_BEATS;
          setActiveCard(ci);
          engine.playGuruNote(SA_PITCHES[saIdxRef.current].freq * cardsRef.current[ci].ratio, sTime);
        }
      },
      () => {
        setPhase("done"); setIsPlaying(false); setActiveCard(-1); setDotBeat(-1);
        setMicActive(false); // ← Stop pitch detection when set ends
        engine.stopDrone();
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
    setScreen("home");
  }, [stopPlay]);

  const handleAuthSuccess = useCallback(async (loggedInUser) => {
    setUser(loggedInUser); userRef.current = loggedInUser;
    await loadProfile(loggedInUser.id);
    setScreen("ready");
  }, []);

  const handleStripeCheckout = useCallback(async (priceId) => {
    setPaywallRedirecting(true);
    setRedirectingPriceId(priceId);
    try {
      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
      const session = refreshData?.session;
      if (refreshErr || !session?.access_token) {
        const { data: { session: fallback }, error: se } = await supabase.auth.getSession();
        if (se || !fallback?.access_token) {
          setPaywallRedirecting(false); setRedirectingPriceId(null);
          setScreen("auth"); return;
        }
        return doCheckout(priceId, fallback.access_token);
      }
      return doCheckout(priceId, session.access_token);
    } catch (err) {
      alert(`Payment setup failed: ${err.message}`);
      setPaywallRedirecting(false); setRedirectingPriceId(null);
    }

    async function doCheckout(priceId, token) {
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${token}` },
          body: JSON.stringify({ priceId }),
        });
        if (!res.ok) { const errBody = await res.text(); throw new Error(`Server error: ${res.status} — ${errBody}`); }
        const data = await res.json();
        if (!data.url) throw new Error("No checkout URL received from server");
        window.location.href = data.url;
      } catch (err) {
        alert(`Payment setup failed: ${err.message}`);
        setPaywallRedirecting(false); setRedirectingPriceId(null);
      }
    }
  }, []);

  const startWalkthrough = useCallback(() => {
    setShowWalkthrough(true); setWalkthroughStep(0);
    localStorage.setItem("walkthroughSeen", "true");
  }, []);

  const trueDisplayCards = currentCards || cards;
  const sliderPct    = Math.round(((bpm - 40) / (700 - 40)) * 100);
  const isLocked     = level > 0 && !isPremium;

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

        /* ── NEW: Pitch match green glow ── */
        .card-match{background:#E8F5E9 !important;border-color:#2E7D32 !important;box-shadow:0 0 15px rgba(46,125,50,0.4),0 0 0 2px rgba(46,125,50,0.25) !important}
        .card-match .card-dv{color:rgba(46,125,50,0.5) !important}
        .card-match .card-name{color:#2E7D32 !important}

        /* ── NEW: Score display ── */
        .score-strip{width:100%;max-width:480px;display:flex;align-items:center;justify-content:space-between;padding:.15rem 0 .45rem;min-height:24px}
        .score-label{font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:#9A7B50;font-weight:500}
        .score-pips{display:flex;gap:4px;align-items:center}
        .score-pip{width:10px;height:10px;border-radius:50%;border:1.5px solid rgba(0,0,0,.12);background:transparent;transition:background .15s,border-color .15s,transform .15s}
        .score-pip.hit{background:#2E7D32;border-color:#2E7D32;transform:scale(1.25)}
        .score-pip.hit-anim{animation:pipPop .25s cubic-bezier(.34,1.56,.64,1) both}
        @keyframes pipPop{0%{transform:scale(0.5)}60%{transform:scale(1.5)}100%{transform:scale(1.25)}}
        .score-fraction{font-family:'Cormorant Garamond',serif;font-size:16px;font-weight:600;color:#2E7D32;letter-spacing:.04em;min-width:32px;text-align:right;transition:opacity .2s}
        .score-fraction.zero{color:rgba(0,0,0,.2)}

        /* ── NEW: Mic status indicator (subtle, top-right of arena) ── */
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

        /* ── Level Summary overlay ── */
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

        @media(min-width:480px){.card-grid{gap:9px}}
        @media(min-width:768px){.arena-field{max-width:540px;padding:20px 18px}.card-grid{gap:11px}.ss-controls{max-width:540px}}
      `}</style>

      <Confetti active={confetti} />
      <BpmFlash bpm={manualBpm ? bpm : autoBpm} visible={bpmFlash} />

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

      {/* ── Level Summary overlay — shown at end of every 5-set level ── */}
      {levelSummaryData && (
        <div className="overlay" style={{gap:"0.6rem"}}>
          <p className="overlay-eyebrow">Level {levelSummaryData.levelNum} Complete</p>
          <div className="overlay-title" style={{fontSize:"clamp(32px,8vw,60px)",lineHeight:1.1}}>
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
            <p className="summary-grand">
              Grand Slam Total: <strong>{levelSummaryData.grandTotal} / {TOTAL_ALL_LEVELS}</strong>
            </p>
          )}
        </div>
      )}

      {/* ── Level Up overlay ── */}
      {levelUpVisible && (
        <div className="overlay">
          <p className="overlay-eyebrow">Next Up</p>
          <div className="overlay-title">Level {level + 2}!</div>
          <p className="overlay-sub">{LEVEL_CONFIG[Math.min(level + 1, 3)].label} — Ready to Slam?</p>
        </div>
      )}

      {/* ── Grand Slam — All Levels Done ── */}
      {allLevelsUp && (
        <div className="overlay" style={{gap:"0.7rem"}}>
          <p className="overlay-eyebrow">Grand Slam</p>
          <div className="overlay-title" style={{fontSize:"clamp(34px,8vw,64px)"}}>
            All 4 Levels!
          </div>
          <div className="summary-score-row">
            <span className="summary-big">{grandSlamScore}</span>
            <span className="summary-of">/ {TOTAL_ALL_LEVELS}</span>
            <span className="summary-label">Total Slam Points</span>
          </div>
          <div className="summary-bar-wrap">
            <div className="summary-bar-fill" style={{width: Math.round((grandSlamScore / TOTAL_ALL_LEVELS) * 100) + "%" }} />
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
          SCREEN ROUTER — RULE #1: No changes to any screen logic below
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
            if (user) { setScreen("ready"); }
            else { setScreen("auth"); }
          }}>
            Start Playing
          </button>
          <div style={{display:"flex",gap:16,alignItems:"center",marginTop:4}}>
            <button className="ghost-btn" onClick={startWalkthrough}>How to play?</button>
            <span style={{color:"#9A7B50",fontSize:11}}>•</span>
            {user
              ? <button className="ghost-btn" onClick={handleLogout}>Log out ({user.email.split("@")[0]})</button>
              : <button className="ghost-btn" onClick={() => setScreen("auth")}>Sign In</button>
            }
          </div>
        </div>
      )}

      {/* READY — MODIFIED: mic permission requested on "Begin ▶" click */}
      {screen === "ready" && (
        <div className="screen">
          <div className="ready-title">Ready?</div>
          <p className="ready-sub">Level 1 — {LEVEL_CONFIG[0].label}</p>
          <button className="primary-btn" style={{marginTop:16}} onClick={async () => {
            // Request mic permission here, before entering the game screen.
            // If denied, the game still works — scoring just won't function.
            // usePitchDetection fails silently on permission denial.
            try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              // Immediately release — the hook will re-acquire when needed
              stream.getTracks().forEach(t => t.stop());
            } catch (e) {
              // Permission denied — continue gracefully without mic
              console.info("Mic permission denied; scoring will be unavailable.");
            }
            setScreen("game");
            const isFirstTime = !localStorage.getItem("walkthroughSeen");
            if (isFirstTime) setTimeout(() => startWalkthrough(), 200);
          }}>
            Begin ▶
          </button>
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

      {/* AUTH */}
      {screen === "auth" && (
        <div style={{minHeight:"100vh",background:"#F9F7F2",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <AuthModal
            onClose={() => setScreen(user ? "game" : "home")}
            onAuthSuccess={handleAuthSuccess}
          />
        </div>
      )}

      {/* PAYWALL */}
      {screen === "paywall" && (
        <div className="screen" style={{justifyContent:"flex-start",paddingTop:32,overflowY:"auto",gap:0}}>
          <PaywallScreen onCheckout={handleStripeCheckout} redirecting={paywallRedirecting} redirectingPriceId={redirectingPriceId} />
          <button className="ghost-btn" style={{marginTop:4}} onClick={() => {
            setLevel(0); setSetNum(0); setCards(generateCards(0)); setCurrentCards(null);
            setPhase("idle"); setActiveCard(-1);
            setScore(0); scoreRef.current = 0;
            setLevelTotalScore(0); levelTotalScoreRef.current = 0;
            setMicActive(false); setLevelSummaryData(null);
            setScreen("game");
          }}>
            ← Back to Level 1
          </button>
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
                  <span className="user-chip-name"><span className="user-chip-crown">♛</span>{user.email.split("@")[0]}</span>
                  <button className="user-chip-logout" onClick={handleLogout}>Log out</button>
                </div>
              )}
              <button className={"icon-btn" + (droneOn ? " active" : "")} onClick={toggleDrone} aria-label={droneOn ? "Mute Tanpura" : "Enable Tanpura"}>
                {droneOn ? <Volume2 /> : <VolumeX />}
              </button>
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

          {/* ── Slam Score strip — set pips + fraction + level running total ── */}
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
              {/* ── NEW: Mic listening indicator (top-right corner of field) ── */}
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
                    // pitchMatched: only show green on the ACTIVE card while isMatch is true
                    // Already-scored cards keep their normal state (no persistent green)
                    pitchMatched={i === activeCard && isMatch && phase === "active"}
                  />
                ))}
              </div>
              <BeatDots beat={dotBeat} active={isPlaying} />
            </div>

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
    </>
  );
}
