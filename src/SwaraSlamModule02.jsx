import { useState, useEffect, useRef, useCallback } from "react";

// ─── Inline Icons ─────────────────────────────────────────────────────────────
const Play     = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>;
const Pause    = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>;
const Volume2  = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>;
const VolumeX  = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>;
const Maximize = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>;
const Minimize = () => <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4,14 10,14 10,20"/><polyline points="20,10 14,10 14,4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>;

// ─── Constants ────────────────────────────────────────────────────────────────
const SA_PITCHES = [
  { label: "C",  freq: 130.81 },
  { label: "C#", freq: 138.59 },
  { label: "D",  freq: 146.83 },
  { label: "D#", freq: 155.56 },
  { label: "E",  freq: 164.81 },
  { label: "F",  freq: 174.61 },
  { label: "F#", freq: 185.00 },
  { label: "G",  freq: 196.00 },
  { label: "G#", freq: 207.65 },
  { label: "A",  freq: 220.00 },
  { label: "A#", freq: 233.08 },
  { label: "B",  freq: 246.94 },
];

// Swara names and their just-intonation ratios relative to Sa
const SWARAS = [
  { name: "Sa",   devanagari: "स",  ratio: 1.000 },
  { name: "Re",   devanagari: "रे", ratio: 1.125 },
  { name: "Ga",   devanagari: "ग",  ratio: 1.250 },
  { name: "Ma",   devanagari: "म",  ratio: 1.333 },
  { name: "Pa",   devanagari: "प",  ratio: 1.500 },
  { name: "Dha",  devanagari: "ध",  ratio: 1.667 },
  { name: "Ni",   devanagari: "नि", ratio: 1.875 },
  { name: "Sa'",  devanagari: "सं", ratio: 2.000 },
];

const CLICK_FREQ = 1200;
const CLICK_DUR  = 0.018;
const NOTE_DUR   = 0.38; // seconds each guru note sounds

// ─── Web Audio Engine Hook ────────────────────────────────────────────────────
function useAudioEngine() {
  const ctxRef        = useRef(null);
  const droneNodesRef = useRef([]);
  const schedTimerRef = useRef(null);
  const nextBeatRef   = useRef(0);
  const beatCountRef  = useRef(0);

  const getCtx = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    return ctxRef.current;
  }, []);

  const stopDrone = useCallback(() => {
    droneNodesRef.current.forEach(n => { try { n.stop(); n.disconnect(); } catch(e) {} });
    droneNodesRef.current = [];
  }, []);

  const startDrone = useCallback((freq) => {
    stopDrone();
    const ctx = getCtx();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.18, ctx.currentTime);
    master.connect(ctx.destination);
    [[1, 0.18], [2, 0.07], [3, 0.04], [5, 0.025]].forEach(([mult, amp]) => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * mult, ctx.currentTime);
      g.gain.setValueAtTime(amp, ctx.currentTime);
      osc.connect(g); g.connect(master);
      osc.start();
      droneNodesRef.current.push(osc);
    });
    const paFreq = freq * 1.5;
    [[1, 0.07], [2, 0.03]].forEach(([mult, amp]) => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(paFreq * mult, ctx.currentTime);
      g.gain.setValueAtTime(amp, ctx.currentTime);
      osc.connect(g); g.connect(master);
      osc.start();
      droneNodesRef.current.push(osc);
    });
  }, [stopDrone, getCtx]);

  // Play a single guru note: layered sine + slight detuned 2nd for warmth
  const playGuruNote = useCallback((freq, startTime) => {
    const ctx = getCtx();
    const master = ctx.createGain();
    // ADSR-style envelope
    master.gain.setValueAtTime(0, startTime);
    master.gain.linearRampToValueAtTime(0.22, startTime + 0.04);
    master.gain.setValueAtTime(0.18, startTime + 0.12);
    master.gain.linearRampToValueAtTime(0, startTime + NOTE_DUR);
    master.connect(ctx.destination);

    // Fundamental + octave partial for flute-like tone
    [[1, 1.0], [2, 0.28], [3, 0.08]].forEach(([mult, amp]) => {
      const osc = ctx.createOscillator();
      const g   = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freq * mult, startTime);
      g.gain.setValueAtTime(amp, startTime);
      osc.connect(g); g.connect(master);
      osc.start(startTime);
      osc.stop(startTime + NOTE_DUR + 0.02);
    });
  }, [getCtx]);

  const scheduleClick = useCallback((bpm, onBeat) => {
    const ctx = getCtx();
    const secondsPerBeat = 60 / bpm;
    const scheduleAhead  = 0.12;
    const lookAhead      = 25;

    const tick = () => {
      while (nextBeatRef.current < ctx.currentTime + scheduleAhead) {
        const t    = nextBeatRef.current;
        const beat = beatCountRef.current;
        const isDown = beat % 4 === 0;

        const buf  = ctx.createBuffer(1, ctx.sampleRate * CLICK_DUR, ctx.sampleRate);
        const data = buf.getChannelData(0);
        const freq = isDown ? CLICK_FREQ : CLICK_FREQ * 0.65;
        for (let i = 0; i < data.length; i++) {
          const env = Math.exp(-i / (ctx.sampleRate * 0.008));
          data[i] = Math.sin(2 * Math.PI * freq * i / ctx.sampleRate) * env;
        }
        const src = ctx.createBufferSource();
        const g   = ctx.createGain();
        src.buffer = buf;
        g.gain.setValueAtTime(isDown ? 0.55 : 0.28, t);
        src.connect(g); g.connect(ctx.destination);
        src.start(t);

        const delay = Math.max(0, (t - ctx.currentTime) * 1000);
        // Pass absolute scheduled audio time so caller can use it for note scheduling
        setTimeout(() => onBeat(beat % 4, isDown, beat, t), delay);

        nextBeatRef.current += secondsPerBeat;
        beatCountRef.current++;
      }
      schedTimerRef.current = setTimeout(tick, lookAhead);
    };

    nextBeatRef.current  = ctx.currentTime + 0.05;
    beatCountRef.current = 0;
    tick();
  }, [getCtx]);

  const stopScheduler = useCallback(() => {
    clearTimeout(schedTimerRef.current);
    schedTimerRef.current = null;
  }, []);

  const resumeCtx = useCallback(() => {
    if (ctxRef.current?.state === "suspended") ctxRef.current.resume();
  }, []);

  const updateDroneFreq = useCallback((freq) => {
    if (droneNodesRef.current.length === 0) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    const t = ctx.currentTime + 0.05;
    const freqs = [freq, freq*2, freq*3, freq*5, freq*1.5, freq*3];
    droneNodesRef.current.forEach((osc, i) => {
      try { osc.frequency.setTargetAtTime(freqs[i] || freq, t, 0.1); } catch(e) {}
    });
  }, []);

  return { startDrone, stopDrone, scheduleClick, stopScheduler, resumeCtx, updateDroneFreq, playGuruNote, getCtx };
}

// ─── Swara Card ───────────────────────────────────────────────────────────────
function SwaraCard({ swara, isActive, isSlam }) {
  return (
    <div
      className={
        "swara-card" +
        (isActive ? (isSlam ? " card-slam" : " card-guru") : "")
      }
      aria-label={swara.name}
    >
      <span className="card-devanagari">{swara.devanagari}</span>
      <span className="card-name">{swara.name}</span>
    </div>
  );
}

// ─── Beat Dots ────────────────────────────────────────────────────────────────
function BeatDots({ currentBeat, active }) {
  return (
    <div className="beat-dots" role="presentation" aria-hidden="true">
      {[0,1,2,3].map(i => (
        <div
          key={i}
          className={"beat-dot" + (active && currentBeat === i ? (i === 0 ? " dot-down" : " dot-up") : "")}
        />
      ))}
    </div>
  );
}

// ─── Mode Badge ───────────────────────────────────────────────────────────────
function ModeBadge({ mode, animKey }) {
  if (!mode) return <div className="mode-badge-placeholder" />;
  const isSlam = mode === "slam";
  return (
    <div key={animKey} className={"mode-badge" + (isSlam ? " badge-slam" : " badge-guru")}>
      {isSlam ? "YOUR TURN: SLAM! 🔥" : "GURU IS SINGING"}
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function SwaraSlamApp() {
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [droneOn,      setDroneOn]      = useState(true);
  const [bpm,          setBpm]          = useState(90);
  const [saIndex,      setSaIndex]      = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDownbeat,   setIsDownbeat]   = useState(false);
  const [beatFlash,    setBeatFlash]    = useState(false);
  const [currentBeat,  setCurrentBeat]  = useState(-1);   // 0-3 for dot display
  const [started,      setStarted]      = useState(false);

  // Module 02 state
  const [activeCard,   setActiveCard]   = useState(-1);   // 0-7
  const [gameMode,     setGameMode]     = useState(null); // "guru" | "slam"
  const [badgeKey,     setBadgeKey]     = useState(0);    // re-mounts badge for animation

  const appRef    = useRef(null);
  const bpmRef    = useRef(bpm);
  bpmRef.current  = bpm;
  const saIdxRef  = useRef(saIndex);
  saIdxRef.current = saIndex;
  // Track game cycle position across beats (0-15: 0-7 guru, 8-15 slam)
  const cycleRef  = useRef(0);
  const gameModeRef = useRef(null);

  const engine = useAudioEngine();

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      appRef.current?.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", handler);
    return () => document.removeEventListener("fullscreenchange", handler);
  }, []);

  const makeOnBeat = useCallback(() => (beatIndex, isDown, globalBeat, scheduledTime) => {
    // ── Dot display (0-3 cycling every 4 beats)
    setCurrentBeat(beatIndex);
    setIsDownbeat(isDown);
    setBeatFlash(true);
    setTimeout(() => { setIsDownbeat(false); setBeatFlash(false); }, 180);

    // ── 16-beat cycle: 0-7 = Guru, 8-15 = Slam
    const pos = cycleRef.current % 16;
    const cardIdx = pos % 8;
    const newMode = pos < 8 ? "guru" : "slam";

    // Detect mode transitions at pos 0 and pos 8
    if (pos === 0 || pos === 8) {
      gameModeRef.current = newMode;
      setGameMode(newMode);
      setBadgeKey(k => k + 1);
    }

    setActiveCard(cardIdx);

    // Play guru note if in guru mode (schedule at audio time for precision)
    if (newMode === "guru") {
      const saFreq = SA_PITCHES[saIdxRef.current].freq;
      const noteFreq = saFreq * SWARAS[cardIdx].ratio;
      engine.playGuruNote(noteFreq, scheduledTime);
    }

    cycleRef.current++;
  }, [engine]);

  const handlePlay = useCallback(() => {
    engine.resumeCtx();
    cycleRef.current = 0;
    setActiveCard(-1);
    setGameMode(null);
    if (droneOn) engine.startDrone(SA_PITCHES[saIndex].freq);
    engine.scheduleClick(bpmRef.current, makeOnBeat());
    setIsPlaying(true);
    setStarted(true);
    setCurrentBeat(-1);
  }, [engine, droneOn, saIndex, makeOnBeat]);

  const handleStop = useCallback(() => {
    engine.stopScheduler();
    engine.stopDrone();
    setIsPlaying(false);
    setIsDownbeat(false);
    setBeatFlash(false);
    setCurrentBeat(-1);
    setActiveCard(-1);
    setGameMode(null);
    cycleRef.current = 0;
  }, [engine]);

  const togglePlay = useCallback(() => {
    isPlaying ? handleStop() : handlePlay();
  }, [isPlaying, handlePlay, handleStop]);

  const toggleDrone = useCallback(() => {
    if (!isPlaying) { setDroneOn(d => !d); return; }
    if (droneOn) { engine.stopDrone(); setDroneOn(false); }
    else { engine.startDrone(SA_PITCHES[saIndex].freq); setDroneOn(true); }
  }, [isPlaying, droneOn, engine, saIndex]);

  const handleSaChange = useCallback((e) => {
    const idx = Number(e.target.value);
    setSaIndex(idx);
    saIdxRef.current = idx;
    if (isPlaying && droneOn) engine.updateDroneFreq(SA_PITCHES[idx].freq);
  }, [isPlaying, droneOn, engine]);

  const handleBpmChange = useCallback((e) => {
    const val = Number(e.target.value);
    setBpm(val);
    if (isPlaying) {
      engine.stopScheduler();
      engine.scheduleClick(val, makeOnBeat());
    }
  }, [isPlaying, engine, makeOnBeat]);

  useEffect(() => () => { engine.stopScheduler(); engine.stopDrone(); }, []);

  const sliderPct = Math.round(((bpm - 40) / (700 - 40)) * 100);
  const isSlam = gameMode === "slam";

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400;1,600&family=DM+Sans:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ss-app {
          min-height: 100vh;
          background: #F9F7F2;
          font-family: 'DM Sans', sans-serif;
          color: #1C1A17;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0 1.25rem 2.5rem;
          overflow-x: hidden;
        }

        /* ── Header ── */
        .ss-header {
          width: 100%;
          max-width: 680px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 1.5rem 0 0.75rem;
        }
        .ss-wordmark { display: flex; flex-direction: column; gap: 3px; }
        .ss-brand-top {
          font-family: 'DM Sans', sans-serif;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.22em; text-transform: uppercase;
          color: #9A7B50; line-height: 1;
        }
        .ss-brand-top em { font-style: normal; font-weight: 500; color: #C05F2F; }
        .ss-brand-main { display: flex; align-items: baseline; gap: 5px; line-height: 1; }
        .ss-brand-swara {
          font-family: 'Cormorant Garamond', serif;
          font-size: 28px; font-weight: 600; color: #1C1A17; letter-spacing: 0.01em;
        }
        .ss-brand-slam {
          font-family: 'Cormorant Garamond', serif;
          font-size: 28px; font-weight: 600; font-style: italic;
          color: #C05F2F; letter-spacing: 0.01em;
        }
        .ss-header-actions { display: flex; gap: 8px; }
        .icon-btn {
          width: 38px; height: 38px; border-radius: 50%;
          border: 0.5px solid rgba(0,0,0,0.12);
          background: transparent; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: #5A4A35;
          transition: background 0.15s, border-color 0.15s;
          flex-shrink: 0;
        }
        .icon-btn:hover { background: rgba(0,0,0,0.05); }
        .icon-btn.active { color: #C05F2F; border-color: rgba(192,95,47,0.4); }

        .ss-divider {
          width: 100%; max-width: 680px; height: 0.5px;
          background: linear-gradient(90deg, transparent, rgba(0,0,0,0.1) 20%, rgba(0,0,0,0.1) 80%, transparent);
        }

        /* ── Arena ── */
        .ss-arena {
          width: 100%; max-width: 680px;
          display: flex; flex-direction: column;
          align-items: center;
          padding: 1.5rem 0 1rem;
          gap: 1rem;
        }

        /* ── Mode Badge ── */
        .mode-badge-placeholder { height: 28px; }
        .mode-badge {
          height: 28px;
          padding: 0 16px;
          border-radius: 99px;
          display: inline-flex; align-items: center;
          font-family: 'DM Sans', sans-serif;
          font-size: 10px; font-weight: 500;
          letter-spacing: 0.18em; text-transform: uppercase;
          animation: badgePop 0.32s cubic-bezier(0.34,1.56,0.64,1) both;
        }
        .badge-guru {
          background: rgba(154,123,80,0.12);
          color: #7A5E30;
          border: 0.5px solid rgba(154,123,80,0.28);
        }
        .badge-slam {
          background: linear-gradient(135deg, #E8700A, #C05F2F);
          color: #fff;
          border: none;
          box-shadow: 0 2px 16px rgba(232,112,10,0.38);
          font-weight: 700;
          letter-spacing: 0.12em;
          animation: badgeSlam 0.38s cubic-bezier(0.34,1.56,0.64,1) both;
        }

        @keyframes badgePop {
          0%   { opacity: 0; transform: scale(0.72) translateY(-6px); }
          100% { opacity: 1; transform: scale(1) translateY(0); }
        }
        @keyframes badgeSlam {
          0%   { opacity: 0; transform: scale(0.6) translateY(-10px) rotate(-3deg); }
          60%  { transform: scale(1.08) translateY(2px) rotate(1deg); }
          100% { opacity: 1; transform: scale(1) translateY(0) rotate(0deg); }
        }

        /* ── Arena Field ── */
        .arena-field {
          width: 100%;
          max-width: 480px;
          border: 0.5px solid rgba(0,0,0,0.07);
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 10px;
          padding: 20px 16px;
          position: relative;
          background: rgba(255,255,255,0.4);
          transition: background 0.1s, border-color 0.1s;
        }
        .arena-field::before, .arena-field::after {
          content: '';
          position: absolute;
          width: 16px; height: 16px;
          border-color: rgba(192,95,47,0.18); border-style: solid;
        }
        .arena-field::before {
          top: 12px; left: 12px;
          border-width: 1.5px 0 0 1.5px; border-radius: 3px 0 0 0;
        }
        .arena-field::after {
          bottom: 12px; right: 12px;
          border-width: 0 1.5px 1.5px 0; border-radius: 0 0 3px 0;
        }
        .arena-field.beat-active   { background: rgba(192,95,47,0.03); border-color: rgba(192,95,47,0.14); }
        .arena-field.downbeat-active { background: rgba(192,95,47,0.07); border-color: rgba(192,95,47,0.28); }

        /* ── Card Grid ── */
        .card-grid {
          display: grid;
          grid-template-columns: repeat(4, 1fr);
          gap: 8px;
          width: 100%;
        }

        .swara-card {
          aspect-ratio: 3/4;
          border-radius: 10px;
          border: 1px solid rgba(0,0,0,0.08);
          background: #FEFCF8;
          box-shadow: 0 1px 4px rgba(0,0,0,0.06), 0 0 0 0 transparent;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 4px;
          cursor: default;
          transition:
            transform 0.09s cubic-bezier(0.34,1.56,0.64,1),
            box-shadow 0.09s ease,
            border-color 0.09s ease,
            background 0.09s ease;
          will-change: transform;
        }

        .card-devanagari {
          font-family: 'Noto Sans Devanagari', 'Kohinoor Devanagari', serif;
          font-size: clamp(14px, 3.5vw, 20px);
          color: rgba(0,0,0,0.22);
          line-height: 1;
          transition: color 0.09s ease;
        }
        .card-name {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(15px, 3.8vw, 22px);
          font-weight: 600;
          color: #1C1A17;
          line-height: 1;
          letter-spacing: 0.01em;
        }

        /* Guru active: gold glow */
        .card-guru {
          transform: scale(1.10);
          background: #FFF8EE;
          border-color: #9A7B50;
          box-shadow:
            0 0 0 2.5px rgba(154,123,80,0.35),
            0 6px 22px rgba(154,123,80,0.22),
            0 2px 8px rgba(0,0,0,0.08);
          z-index: 2;
        }
        .card-guru .card-devanagari { color: rgba(154,123,80,0.7); }
        .card-guru .card-name       { color: #7A5E30; }

        /* Slam active: terracotta pop */
        .card-slam {
          transform: scale(1.10);
          background: #FFF3EE;
          border-color: #C05F2F;
          box-shadow:
            0 0 0 2.5px rgba(192,95,47,0.42),
            0 6px 26px rgba(192,95,47,0.28),
            0 2px 8px rgba(0,0,0,0.08);
          z-index: 2;
        }
        .card-slam .card-devanagari { color: rgba(192,95,47,0.5); }
        .card-slam .card-name       { color: #C05F2F; }

        /* ── Beat Dots ── */
        .beat-dots { display: flex; gap: 14px; align-items: center; padding-top: 4px; }
        .beat-dot {
          width: 9px; height: 9px;
          border-radius: 50%;
          background: rgba(0,0,0,0.1);
          transition: background 0.07s, transform 0.07s, box-shadow 0.07s;
          flex-shrink: 0;
        }
        .dot-down {
          background: #C05F2F !important;
          transform: scale(1.8) !important;
          box-shadow: 0 0 0 3px rgba(192,95,47,0.18) !important;
        }
        .dot-up {
          background: #9A7B50 !important;
          transform: scale(1.35) !important;
        }

        /* ── Controls ── */
        .ss-controls {
          width: 100%; max-width: 480px;
          display: flex; flex-direction: column;
          gap: 1.2rem;
        }
        .ctrl-row { display: flex; align-items: center; gap: 1rem; }
        .ctrl-label {
          font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase;
          color: #9A7B50; min-width: 38px; flex-shrink: 0;
        }
        .ctrl-val {
          font-family: 'Cormorant Garamond', serif;
          font-size: 20px; font-weight: 600; color: #1C1A17;
          min-width: 46px; text-align: right; flex-shrink: 0;
        }
        input[type="range"].ss-slider {
          -webkit-appearance: none; appearance: none;
          flex: 1; height: 3px;
          background: linear-gradient(to right, #C05F2F calc(var(--pct) * 1%), rgba(0,0,0,0.1) calc(var(--pct) * 1%));
          border-radius: 99px; outline: none; cursor: pointer;
        }
        input[type="range"].ss-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px; height: 18px; border-radius: 50%;
          background: #C05F2F; border: 2.5px solid #F9F7F2;
          box-shadow: 0 0 0 1px rgba(192,95,47,0.35);
          transition: box-shadow 0.15s; cursor: pointer;
        }
        input[type="range"].ss-slider::-webkit-slider-thumb:hover { box-shadow: 0 0 0 5px rgba(192,95,47,0.15); }
        input[type="range"].ss-slider::-moz-range-thumb {
          width: 18px; height: 18px; border-radius: 50%;
          background: #C05F2F; border: 2.5px solid #F9F7F2; cursor: pointer;
        }
        select.ss-select {
          flex: 1; height: 38px;
          border: 0.5px solid rgba(0,0,0,0.14); border-radius: 8px;
          padding: 0 30px 0 12px;
          font-family: 'Cormorant Garamond', serif; font-size: 16px; color: #1C1A17;
          cursor: pointer; outline: none; appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239A7B50' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat; background-position: right 10px center;
          background-color: transparent;
        }
        select.ss-select:focus { border-color: rgba(192,95,47,0.5); }

        .play-btn-wrap { display: flex; justify-content: center; margin-top: 0.1rem; }
        .play-btn {
          width: 68px; height: 68px; border-radius: 50%;
          background: #1C1A17; border: none; cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: #F9F7F2;
          transition: background 0.18s, transform 0.12s;
          box-shadow: 0 4px 20px rgba(0,0,0,0.14);
        }
        .play-btn:hover  { background: #C05F2F; transform: scale(1.05); }
        .play-btn:active { transform: scale(0.96); }
        .play-btn.playing { background: #C05F2F; }

        /* ── Start Overlay ── */
        .start-overlay {
          position: fixed; inset: 0;
          background: #F9F7F2;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 1.25rem; z-index: 100;
        }
        .start-ornament {
          font-family: 'Cormorant Garamond', serif;
          font-size: 13px; color: rgba(0,0,0,0.18); letter-spacing: 0.35em;
        }
        .start-raaguru {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px; font-weight: 500;
          letter-spacing: 0.22em; text-transform: uppercase; color: #9A7B50;
        }
        .start-raaguru em { font-style: normal; color: #C05F2F; }
        .start-title { display: flex; align-items: baseline; gap: 10px; }
        .start-swara {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(52px, 11vw, 84px); font-weight: 600; color: #1C1A17;
        }
        .start-slam {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(52px, 11vw, 84px); font-weight: 600; font-style: italic; color: #C05F2F;
        }
        .start-sub { font-size: 11px; color: #9A7B50; letter-spacing: 0.2em; text-transform: uppercase; }
        .start-btn {
          margin-top: 0.5rem; padding: 14px 40px; border-radius: 99px;
          background: #1C1A17; border: none; color: #F9F7F2;
          font-family: 'DM Sans', sans-serif; font-size: 14px; font-weight: 500;
          letter-spacing: 0.06em; cursor: pointer;
          transition: background 0.18s, transform 0.12s;
          display: flex; align-items: center; gap: 8px;
        }
        .start-btn:hover  { background: #C05F2F; transform: scale(1.03); }
        .start-btn:active { transform: scale(0.97); }

        .module-tag {
          font-size: 10px; letter-spacing: 0.15em; text-transform: uppercase;
          color: rgba(0,0,0,0.2); margin-top: 2rem;
        }

        /* ── Responsive ── */
        @media (min-width: 480px) {
          .card-grid { gap: 10px; }
          .swara-card { border-radius: 12px; }
        }
        @media (min-width: 768px) {
          .arena-field { max-width: 540px; padding: 24px 20px; }
          .card-grid { gap: 12px; }
          .ss-controls { max-width: 540px; }
        }
        @media (min-width: 1200px) {
          .arena-field { max-width: 620px; padding: 28px 24px; }
          .card-grid { gap: 14px; }
          .ss-controls { max-width: 580px; }
        }
      `}</style>

      {!started && (
        <div className="start-overlay" role="dialog" aria-modal="true">
          <p className="start-ornament">ॐ &nbsp; स &nbsp; र &nbsp; ग &nbsp; म</p>
          <p className="start-raaguru">Raag<em>GURU</em></p>
          <div className="start-title">
            <span className="start-swara">Swara</span>
            <span className="start-slam">Slam</span>
          </div>
          <p className="start-sub">Hindustani Reflex Training</p>
          <button
            className="start-btn"
            onClick={() => { toggleFullscreen(); setStarted(true); }}
            aria-label="Start Practice"
          >
            <Maximize /> Start Practice
          </button>
          <p className="start-ornament" style={{ marginTop: "1rem", fontSize: "10px", letterSpacing: "0.2em" }}>
            Module 02 — The Game Board &amp; Listen/Slam Loop
          </p>
        </div>
      )}

      <div className="ss-app" ref={appRef}>
        <header className="ss-header">
          <div className="ss-wordmark">
            <span className="ss-brand-top">Raag<em>GURU</em></span>
            <div className="ss-brand-main">
              <span className="ss-brand-swara">Swara</span>
              <span className="ss-brand-slam">Slam</span>
            </div>
          </div>
          <div className="ss-header-actions">
            <button className={"icon-btn" + (droneOn ? " active" : "")} onClick={toggleDrone} aria-label={droneOn ? "Mute Tanpura" : "Enable Tanpura"}>
              {droneOn ? <Volume2 /> : <VolumeX />}
            </button>
            <button className="icon-btn" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {isFullscreen ? <Minimize /> : <Maximize />}
            </button>
          </div>
        </header>

        <div className="ss-divider" />

        <main className="ss-arena">
          <ModeBadge mode={gameMode} animKey={badgeKey} />

          <div className={"arena-field" + (isDownbeat ? " downbeat-active" : beatFlash ? " beat-active" : "")}>
            {/* 2×4 Card Grid */}
            <div className="card-grid">
              {SWARAS.map((sw, i) => (
                <SwaraCard
                  key={sw.name}
                  swara={sw}
                  isActive={isPlaying && activeCard === i}
                  isSlam={isSlam}
                />
              ))}
            </div>

            {/* Beat dots */}
            <BeatDots currentBeat={currentBeat} active={isPlaying} />
          </div>
        </main>

        <section className="ss-controls" aria-label="Practice controls">
          <div className="ctrl-row">
            <span className="ctrl-label">BPM</span>
            <input
              type="range" className="ss-slider"
              min="40" max="700" step="1" value={bpm}
              style={{ "--pct": sliderPct }}
              onChange={handleBpmChange}
              aria-label={"Tempo: " + bpm + " BPM"}
            />
            <span className="ctrl-val">{bpm}</span>
          </div>

          <div className="ctrl-row">
            <span className="ctrl-label">Sa</span>
            <select className="ss-select" value={saIndex} onChange={handleSaChange} aria-label="Select Sa pitch">
              {SA_PITCHES.map((p, i) => (
                <option key={p.label} value={i}>{p.label} — {p.freq.toFixed(0)} Hz</option>
              ))}
            </select>
          </div>

          <div className="play-btn-wrap">
            <button className={"play-btn" + (isPlaying ? " playing" : "")} onClick={togglePlay} aria-label={isPlaying ? "Stop" : "Play"}>
              {isPlaying ? <Pause /> : <Play />}
            </button>
          </div>
        </section>

        <p className="module-tag" aria-hidden="true">Module 02 — Game Board &amp; Listen/Slam Loop</p>
      </div>
    </>
  );
}