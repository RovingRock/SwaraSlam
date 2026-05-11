import { useState, useEffect, useRef, useCallback } from "react";
import { createClient } from "@supabase/supabase-js";

// ─── Supabase ─────────────────────────────────────────────────────────────────
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (mode === "signup" && !termsAccepted) {
      setError("Please accept the Terms & Conditions to continue");
      return;
    }
    setLoading(true); setError(""); setMessage("");
    try {
      if (mode === "signup") {
        const { data, error: err } = await supabase.auth.signUp({ email, password });
        if (err) throw err;
        if (data.user) {
          await supabase.from("profiles").update({
            marketing_consent: marketingConsent,
            terms_accepted: true,
            terms_accepted_at: new Date().toISOString(),
          }).eq("id", data.user.id);
          setMessage("✅ Account created! Check your email to confirm your account before logging in.");
          // Don't auto-switch to login — user must manually click "Log In" after confirming email
        }
      } else {
        const { data, error: err } = await supabase.auth.signInWithPassword({ email, password });
        if (err) throw err;
        // Check if email is confirmed
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

// ─── Paywall Overlay ──────────────────────────────────────────────────────────
// Shown directly (not inside the arena) when user is logged in but not premium.
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
        {/* 24-Hour Pass */}
        <div style={{background:"#fff",border:"1.5px solid #E5DFD3",borderRadius:14,padding:"22px 20px",flex:"1 1 180px",maxWidth:220,textAlign:"center"}}>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#9A7B50",fontWeight:700,letterSpacing:".12em",marginBottom:8}}>24-HOUR PASS</div>
          <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,fontWeight:600,color:"#1C1A17",lineHeight:1,marginBottom:4}}>$1.99</div>
          <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#6B6560",marginBottom:16}}>Try all levels for a day</div>
          <button disabled={redirecting} onClick={() => onCheckout("price_1TVpDNCevGY65XqMdTh1x4Qb")}
            style={{...btnBase,background:"#9A7B50",opacity:isRedirecting("price_1TVpDNCevGY65XqMdTh1x4Qb")?0.6:redirecting?0.3:1}}>
            {isRedirecting("price_1TVpDNCevGY65XqMdTh1x4Qb") ? "Redirecting…" : "Get 24-Hour Access"}
          </button>
        </div>

        {/* Lifetime */}
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

      <p style={{fontFamily:"'Cormorant Garamond',serif",fontSize:16,color:"#9A7B50",opacity:0.5,margin:"8px 0 0"}}>
        स &nbsp; र &nbsp; ग &nbsp; म
      </p>
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

  const stopScheduler = useCallback(() => { clearTimeout(schedTimerRef.current); schedTimerRef.current = null; }, []);
  const resumeCtx     = useCallback(() => { if (ctxRef.current?.state === "suspended") ctxRef.current.resume(); }, []);
  const updateDroneFreq = useCallback((freq) => {
    if (!droneNodesRef.current.length || !ctxRef.current) return;
    const t = ctxRef.current.currentTime + 0.05;
    [freq,freq*2,freq*3,freq*5,freq*1.5,freq*3].forEach((f,i) => {
      try { if (droneNodesRef.current[i]) droneNodesRef.current[i].frequency.setTargetAtTime(f, t, 0.1); } catch(e){}
    });
  }, []);

  return { startDrone, stopDrone, scheduleBeats, stopScheduler, resumeCtx, updateDroneFreq, playGuruNote };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function SwaraCard({ swara, state }) {
  const oct = swara.octave ?? 1;
  return (
    <div className={"swara-card card-" + state}>
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

// ─── Main App ─────────────────────────────────────────────────────────────────
// screen: "home" | "ready" | "game" | "auth" | "paywall"
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

  // Auth/paywall
  const [user,               setUser]               = useState(null);
  const [isPremium,          setIsPremium]          = useState(false);
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
  const isPremiumRef  = useRef(isPremium);
  const manualBpmRef  = useRef(manualBpm);
  const bpmRef        = useRef(bpm);
  const highestBpmRef = useRef(highestBpm);
  const engine        = useAudioEngine();

  saIdxRef.current = saIndex; cardsRef.current = cards; levelRef.current = level;
  setNumRef.current = setNum; userRef.current = user; isPremiumRef.current = isPremium;
  manualBpmRef.current = manualBpm; bpmRef.current = bpm; highestBpmRef.current = highestBpm;

  const autoBpm = BASE_BPM + setNum * BPM_INCREMENT;

  // ── Session restore — NEVER drives screen changes ──────────────────────────
  useEffect(() => {
    // Handle Stripe return URLs
    const params = new URLSearchParams(window.location.search);
    if (params.get("success") === "true") {
      window.history.replaceState({}, "", window.location.pathname);
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.user) {
          loadProfile(session.user.id).then(premium => {
            if (premium) {
              // Trigger confetti celebration
              setConfetti(true);
              setTimeout(() => setConfetti(false), 3500);
              // Show success screen, then route to game
              setScreen("premium-unlocked");
              setTimeout(() => setScreen("game"), 3500);
            }
          });
        }
      });
    } else if (params.get("canceled") === "true") {
      window.history.replaceState({}, "", window.location.pathname);
    }

    // Silently restore session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUser(session.user); userRef.current = session.user; loadProfile(session.user.id); }
    });

    // Auth state change — only syncs state, NEVER changes screen
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

  // Returns premium boolean
  const loadProfile = async (userId) => {
    try {
      const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();
      if (error || !data) return false;
      const lvl = Math.max(0, (data.current_level || 1) - 1);
      const sn  = Math.max(0, (data.current_set   || 1) - 1);
      const premium = data.is_premium || false;
      setLevel(lvl); setSetNum(sn);
      setIsPremium(premium); isPremiumRef.current = premium;
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

  // ── Cleanup
  useEffect(() => () => { engine.stopScheduler(); engine.stopDrone(); }, []);

  // ── Install banner
  useEffect(() => {
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    if (localStorage.getItem("installBannerDismissed")) return;
    const h = (e) => { e.preventDefault(); setDeferredPrompt(e); setTimeout(() => setShowInstallBanner(true), 3000); };
    window.addEventListener("beforeinstallprompt", h);
    if (/iphone|ipad|ipod/i.test(navigator.userAgent)) setTimeout(() => setShowInstallBanner(true), 3000);
    return () => window.removeEventListener("beforeinstallprompt", h);
  }, []);

  // ── BPM flash
  const prevSetRef = useRef(-1), prevLevelRef = useRef(-1);
  useEffect(() => {
    if (prevSetRef.current === -1) { prevSetRef.current = setNum; prevLevelRef.current = level; return; }
    if (prevSetRef.current !== setNum || prevLevelRef.current !== level) {
      prevSetRef.current = setNum; prevLevelRef.current = level;
      setBpmFlash(true); setTimeout(() => setBpmFlash(false), 1600);
    }
  }, [setNum, level]);

  // ── Advance set/level ──────────────────────────────────────────────────────
  const advanceSet = useCallback((lvl, sn) => {
    const nextSet = sn + 1;
    if (nextSet >= SETS_PER_LEVEL) {
      const nextLevel = lvl + 1;
      setConfetti(true); setTimeout(() => setConfetti(false), 3200);

      if (nextLevel === 1) {
        if (!userRef.current) {
          // Not logged in → Auth screen after confetti
          setTimeout(() => setScreen("auth"), 3200);
          return;
        }
        if (!isPremiumRef.current) {
          // Logged in, not premium → Paywall screen after confetti
          setTimeout(() => {
            setLevel(1); setSetNum(0);
            setCards(generateCards(1)); setCurrentCards(null);
            if (!manualBpmRef.current) setBpm(BASE_BPM);
            setScreen("paywall");
          }, 3200);
          return;
        }
      }

      if (nextLevel >= LEVEL_CONFIG.length) {
        setAllLevelsUp(true);
      } else {
        setLevelUpVisible(true);
        setTimeout(() => {
          setLevelUpVisible(false);
          setLevel(nextLevel); setSetNum(0);
          setCards(generateCards(nextLevel)); setCurrentCards(null);
          if (!manualBpmRef.current) setBpm(BASE_BPM);
          saveProgress(nextLevel, 0, BASE_BPM);
        }, 3000);
      }
    } else {
      setSetNum(nextSet);
      setCards(generateCards(lvl)); setCurrentCards(null);
      const newBpm = manualBpmRef.current ? bpmRef.current : BASE_BPM + nextSet * BPM_INCREMENT;
      if (!manualBpmRef.current) setBpm(newBpm);
      saveProgress(lvl, nextSet, newBpm);
    }
  }, [saveProgress]);

  // ── Playback ───────────────────────────────────────────────────────────────
  const startPlay = useCallback((replayCards) => {
    engine.stopScheduler();
    const playCards = replayCards || generateCards(levelRef.current);
    if (!replayCards) setCards(playCards);
    setCurrentCards(playCards); cardsRef.current = playCards;
    const effectiveBpm = manualBpmRef.current ? bpmRef.current : autoBpm;
    if (!manualBpmRef.current) setBpm(effectiveBpm);
    engine.resumeCtx();
    if (droneOn) engine.startDrone(SA_PITCHES[saIdxRef.current].freq);
    setPhase("leadin"); setActiveCard(-1); setDotBeat(-1); setIsPlaying(true);
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
        engine.stopDrone();
        advanceSet(levelRef.current, setNumRef.current);
      }
    );
  }, [engine, droneOn, autoBpm, advanceSet]);

  const stopPlay = useCallback(() => {
    engine.stopScheduler(); engine.stopDrone();
    setIsPlaying(false); setPhase("idle"); setActiveCard(-1); setDotBeat(-1);
  }, [engine]);

  const handleRetry = useCallback(() => {
    if (isPlaying) { engine.stopScheduler(); engine.stopDrone(); setIsPlaying(false); }
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
    setScreen("home");
  }, [stopPlay]);

  // Called after login (not signup — signup requires email confirm first)
  const handleAuthSuccess = useCallback(async (loggedInUser) => {
    setUser(loggedInUser); userRef.current = loggedInUser;
    const premium = await loadProfile(loggedInUser.id);
    if (premium) {
      setScreen("game");
    } else {
      setLevel(1); setSetNum(0); setCards(generateCards(1)); setCurrentCards(null); setBpm(BASE_BPM);
      setScreen("paywall");
    }
  }, []);

  // Stripe checkout — user is guaranteed logged in when PaywallScreen is shown
  const handleStripeCheckout = useCallback(async (priceId) => {
    setPaywallRedirecting(true);
    setRedirectingPriceId(priceId); // Track which button was clicked
    try {
      // Always refresh first — avoids stale token 401s after auth redirects
      const { data: refreshData, error: refreshErr } = await supabase.auth.refreshSession();
      const session = refreshData?.session;

      if (refreshErr || !session?.access_token) {
        // Refresh failed — fall back to getSession
        const { data: { session: fallback }, error: se } = await supabase.auth.getSession();
        if (se || !fallback?.access_token) {
          console.error("No valid session at checkout:", se);
          setPaywallRedirecting(false);
          setRedirectingPriceId(null);
          setScreen("auth");
          return;
        }
        // Use fallback session
        return doCheckout(priceId, fallback.access_token);
      }

      return doCheckout(priceId, session.access_token);
    } catch (err) {
      console.error("Stripe checkout error:", err);
      alert(`Payment setup failed: ${err.message}`);
      setPaywallRedirecting(false);
      setRedirectingPriceId(null);
    }

    async function doCheckout(priceId, token) {
      try {
        const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/create-checkout`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`,
          },
          body: JSON.stringify({ priceId }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          console.error("Edge function error:", res.status, errBody);
          throw new Error(`Server error: ${res.status} — ${errBody}`);
        }
        const data = await res.json();
        if (!data.url) throw new Error("No checkout URL received from server");
        window.location.href = data.url;
      } catch (err) {
        console.error("doCheckout error:", err);
        alert(`Payment setup failed: ${err.message}`);
        setPaywallRedirecting(false);
        setRedirectingPriceId(null);
      }
    }
  }, []);

  const startWalkthrough = useCallback(() => {
    setShowWalkthrough(true); setWalkthroughStep(0);
    localStorage.setItem("walkthroughSeen", "true");
  }, []);

  const displayCards = currentCards || cards;
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

        /* ── Full-page screens ── */
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

        /* ── Game UI ── */
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

        /* ── Overlays ── */
        .overlay{position:fixed;inset:0;z-index:300;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:rgba(249,247,242,.94);backdrop-filter:blur(6px);animation:fadeIn .3s ease both}
        .overlay-title{font-family:'Cormorant Garamond',serif;font-size:clamp(42px,10vw,80px);font-weight:600;color:#C05F2F;font-style:italic;animation:titlePop .5s .1s cubic-bezier(.34,1.56,.64,1) both}
        .overlay-sub{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#9A7B50}

        /* ── Walkthrough ── */
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

        /* ── Install banner ── */
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

      {/* ── Level Up overlay ── */}
      {levelUpVisible && (
        <div className="overlay">
          <p className="ready-ornament">स &nbsp; र &nbsp; ग &nbsp; म</p>
          <div className="overlay-title">Level Up!</div>
          <p className="overlay-sub">Entering Level {level + 2} — {LEVEL_CONFIG[Math.min(level + 1, 3)].label}</p>
        </div>
      )}

      {/* ── All Levels Done ── */}
      {allLevelsUp && (
        <div className="overlay">
          <div className="overlay-title" style={{fontSize:"clamp(38px,9vw,68px)"}}>All Levels Up!</div>
          <p className="overlay-sub" style={{marginBottom:".5rem"}}>You have mastered all four levels</p>
          <button className="primary-btn" onClick={() => {
            setAllLevelsUp(false); setConfetti(false);
            setLevel(0); setSetNum(0); setCards(generateCards(0)); setCurrentCards(null);
            setManualBpm(false); setBpm(BASE_BPM); setPhase("idle"); setActiveCard(-1);
            saveProgress(0, 0, BASE_BPM); setScreen("ready");
          }}>Play Again</button>
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
          <button className="primary-btn" style={{marginTop:8}} onClick={() => setScreen("ready")}>
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

      {/* READY */}
      {screen === "ready" && (
        <div className="screen">
          <p className="ready-ornament">स &nbsp; र &nbsp; ग &nbsp; म</p>
          <div className="ready-title">Ready?</div>
          <p className="ready-sub">Level 1 — {LEVEL_CONFIG[0].label}</p>
          <button className="primary-btn" style={{marginTop:16}} onClick={() => {
            setScreen("game");
            const isFirstTime = !localStorage.getItem("walkthroughSeen");
            if (isFirstTime) setTimeout(() => startWalkthrough(), 200);
          }}>
            Begin ▶
          </button>
          <button className="ghost-btn" style={{marginTop:8}} onClick={() => setScreen("home")}>← Back</button>
        </div>
      )}

      {/* PREMIUM UNLOCKED — celebration screen */}
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

      {/* AUTH — modal rendered over a blank screen, never hides behind game */}
      {screen === "auth" && (
        <div style={{minHeight:"100vh",background:"#F9F7F2",display:"flex",alignItems:"center",justifyContent:"center"}}>
          <AuthModal
            onClose={() => setScreen(user ? "game" : "home")}
            onAuthSuccess={handleAuthSuccess}
          />
        </div>
      )}

      {/* PAYWALL — full screen, no game behind it */}
      {screen === "paywall" && (
        <div className="screen" style={{justifyContent:"flex-start",paddingTop:32,overflowY:"auto",gap:0}}>
          <PaywallScreen onCheckout={handleStripeCheckout} redirecting={paywallRedirecting} redirectingPriceId={redirectingPriceId} />
          <button className="ghost-btn" style={{marginTop:4}} onClick={() => setScreen("game")}>
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

          <main className="ss-arena">
            <div className={"arena-field" + (phase === "active" ? " phase-active-border" : "")}>
              <div className="card-grid" style={{filter: isLocked ? "blur(6px)" : "none", transition:"filter 0.3s", pointerEvents: isLocked ? "none" : "auto"}}>
                {displayCards.map((sw, i) => <SwaraCard key={i} swara={sw} state={getCardState(i)} />)}
              </div>
              <BeatDots beat={dotBeat} active={isPlaying} />
            </div>

            {/* Locked notice — just a prompt, no glassmorphism overlay */}
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
