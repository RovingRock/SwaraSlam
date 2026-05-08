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

const CLICK_FREQ = 1200;
const CLICK_DUR  = 0.018;

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
        setTimeout(() => onBeat(beat % 4, isDown), delay);

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

  return { startDrone, stopDrone, scheduleClick, stopScheduler, resumeCtx, updateDroneFreq };
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

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function SwaraSlamApp() {
  const [isPlaying,    setIsPlaying]    = useState(false);
  const [droneOn,      setDroneOn]      = useState(true);
  const [bpm,          setBpm]          = useState(90);
  const [saIndex,      setSaIndex]      = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isDownbeat,   setIsDownbeat]   = useState(false);
  const [beatFlash,    setBeatFlash]    = useState(false);
  const [currentBeat,  setCurrentBeat]  = useState(-1);
  const [started,      setStarted]      = useState(false);

  const appRef   = useRef(null);
  const bpmRef   = useRef(bpm);
  bpmRef.current = bpm;

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

  const makeOnBeat = useCallback(() => (beatIndex, isDown) => {
    setCurrentBeat(beatIndex);
    setIsDownbeat(isDown);
    setBeatFlash(true);
    setTimeout(() => { setIsDownbeat(false); setBeatFlash(false); }, 180);
  }, []);

  const handlePlay = useCallback(() => {
    engine.resumeCtx();
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

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,400;0,600;1,400&family=DM+Sans:wght@300;400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        .ss-app {
          min-height: 100vh;
          background: #F9F7F2;
          font-family: 'DM Sans', sans-serif;
          color: #1C1A17;
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 0 1.25rem 3rem;
          overflow-x: hidden;
        }

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
          font-size: 10px;
          font-weight: 500;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: #9A7B50;
          line-height: 1;
        }
        .ss-brand-top em {
          font-style: normal;
          font-weight: 500;
          color: #C05F2F;
        }

        .ss-brand-main {
          display: flex;
          align-items: baseline;
          gap: 5px;
          line-height: 1;
        }
        .ss-brand-swara {
          font-family: 'Cormorant Garamond', serif;
          font-size: 28px;
          font-weight: 600;
          color: #1C1A17;
          letter-spacing: 0.01em;
        }
        .ss-brand-slam {
          font-family: 'Cormorant Garamond', serif;
          font-size: 28px;
          font-weight: 600;
          font-style: italic;
          color: #C05F2F;
          letter-spacing: 0.01em;
        }

        .ss-header-actions { display: flex; gap: 8px; }

        .icon-btn {
          width: 38px; height: 38px;
          border-radius: 50%;
          border: 0.5px solid rgba(0,0,0,0.12);
          background: transparent;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: #5A4A35;
          transition: background 0.15s, border-color 0.15s;
          flex-shrink: 0;
        }
        .icon-btn:hover { background: rgba(0,0,0,0.05); }
        .icon-btn.active { color: #C05F2F; border-color: rgba(192,95,47,0.4); }

        .ss-divider {
          width: 100%;
          max-width: 680px;
          height: 0.5px;
          background: linear-gradient(90deg, transparent, rgba(0,0,0,0.1) 20%, rgba(0,0,0,0.1) 80%, transparent);
        }

        .ss-arena {
          width: 100%;
          max-width: 680px;
          flex: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          padding: 2rem 0;
        }

        .arena-field {
          width: 100%;
          max-width: 440px;
          min-height: 260px;
          border: 0.5px solid rgba(0,0,0,0.07);
          border-radius: 16px;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 1.5rem;
          position: relative;
          background: rgba(255,255,255,0.4);
          transition: background 0.1s, border-color 0.1s;
        }

        .arena-field::before, .arena-field::after {
          content: '';
          position: absolute;
          width: 16px; height: 16px;
          border-color: rgba(192,95,47,0.18);
          border-style: solid;
        }
        .arena-field::before {
          top: 12px; left: 12px;
          border-width: 1.5px 0 0 1.5px;
          border-radius: 3px 0 0 0;
        }
        .arena-field::after {
          bottom: 12px; right: 12px;
          border-width: 0 1.5px 1.5px 0;
          border-radius: 0 0 3px 0;
        }

        .arena-label {
          position: absolute;
          top: 10px; right: 14px;
          font-size: 9px;
          letter-spacing: 0.2em;
          text-transform: uppercase;
          color: rgba(0,0,0,0.15);
        }

        .arena-field.beat-active {
          background: rgba(192,95,47,0.04);
          border-color: rgba(192,95,47,0.18);
        }
        .arena-field.downbeat-active {
          background: rgba(192,95,47,0.09);
          border-color: rgba(192,95,47,0.38);
        }

        .beat-dots { display: flex; gap: 16px; align-items: center; }
        .beat-dot {
          width: 11px; height: 11px;
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

        .beat-label {
          font-size: 11px;
          letter-spacing: 0.12em;
          color: rgba(0,0,0,0.22);
          font-variant-numeric: tabular-nums;
        }

        .ss-controls {
          width: 100%;
          max-width: 480px;
          display: flex;
          flex-direction: column;
          gap: 1.4rem;
        }

        .ctrl-row { display: flex; align-items: center; gap: 1rem; }

        .ctrl-label {
          font-size: 10px;
          letter-spacing: 0.14em;
          text-transform: uppercase;
          color: #9A7B50;
          min-width: 38px;
          flex-shrink: 0;
        }

        .ctrl-val {
          font-family: 'Cormorant Garamond', serif;
          font-size: 20px;
          font-weight: 600;
          color: #1C1A17;
          min-width: 46px;
          text-align: right;
          flex-shrink: 0;
        }

        input[type="range"].ss-slider {
          -webkit-appearance: none;
          appearance: none;
          flex: 1;
          height: 3px;
          background: linear-gradient(to right, #C05F2F calc(var(--pct) * 1%), rgba(0,0,0,0.1) calc(var(--pct) * 1%));
          border-radius: 99px;
          outline: none;
          cursor: pointer;
        }
        input[type="range"].ss-slider::-webkit-slider-thumb {
          -webkit-appearance: none;
          width: 18px; height: 18px;
          border-radius: 50%;
          background: #C05F2F;
          border: 2.5px solid #F9F7F2;
          box-shadow: 0 0 0 1px rgba(192,95,47,0.35);
          transition: box-shadow 0.15s;
          cursor: pointer;
        }
        input[type="range"].ss-slider::-webkit-slider-thumb:hover {
          box-shadow: 0 0 0 5px rgba(192,95,47,0.15);
        }
        input[type="range"].ss-slider::-moz-range-thumb {
          width: 18px; height: 18px;
          border-radius: 50%;
          background: #C05F2F;
          border: 2.5px solid #F9F7F2;
          cursor: pointer;
        }

        select.ss-select {
          flex: 1;
          height: 38px;
          border: 0.5px solid rgba(0,0,0,0.14);
          border-radius: 8px;
          padding: 0 30px 0 12px;
          font-family: 'Cormorant Garamond', serif;
          font-size: 16px;
          color: #1C1A17;
          cursor: pointer;
          outline: none;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath d='M1 1l5 5 5-5' stroke='%239A7B50' stroke-width='1.5' fill='none' stroke-linecap='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          background-color: transparent;
        }
        select.ss-select:focus { border-color: rgba(192,95,47,0.5); }

        .play-btn-wrap { display: flex; justify-content: center; margin-top: 0.25rem; }
        .play-btn {
          width: 68px; height: 68px;
          border-radius: 50%;
          background: #1C1A17;
          border: none;
          cursor: pointer;
          display: flex; align-items: center; justify-content: center;
          color: #F9F7F2;
          transition: background 0.18s, transform 0.12s;
          box-shadow: 0 4px 20px rgba(0,0,0,0.14);
        }
        .play-btn:hover  { background: #C05F2F; transform: scale(1.05); }
        .play-btn:active { transform: scale(0.96); }
        .play-btn.playing { background: #C05F2F; }

        .start-overlay {
          position: fixed; inset: 0;
          background: #F9F7F2;
          display: flex; flex-direction: column;
          align-items: center; justify-content: center;
          gap: 1.25rem;
          z-index: 100;
        }
        .start-ornament {
          font-family: 'Cormorant Garamond', serif;
          font-size: 13px;
          color: rgba(0,0,0,0.18);
          letter-spacing: 0.35em;
        }
        .start-raaguru {
          font-family: 'DM Sans', sans-serif;
          font-size: 11px;
          font-weight: 500;
          letter-spacing: 0.22em;
          text-transform: uppercase;
          color: #9A7B50;
        }
        .start-raaguru em { font-style: normal; color: #C05F2F; }
        .start-title { display: flex; align-items: baseline; gap: 10px; }
        .start-swara {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(52px, 11vw, 84px);
          font-weight: 600;
          color: #1C1A17;
        }
        .start-slam {
          font-family: 'Cormorant Garamond', serif;
          font-size: clamp(52px, 11vw, 84px);
          font-weight: 600;
          font-style: italic;
          color: #C05F2F;
        }
        .start-sub {
          font-size: 11px;
          color: #9A7B50;
          letter-spacing: 0.2em;
          text-transform: uppercase;
        }
        .start-btn {
          margin-top: 0.5rem;
          padding: 14px 40px;
          border-radius: 99px;
          background: #1C1A17;
          border: none;
          color: #F9F7F2;
          font-family: 'DM Sans', sans-serif;
          font-size: 14px;
          font-weight: 500;
          letter-spacing: 0.06em;
          cursor: pointer;
          transition: background 0.18s, transform 0.12s;
          display: flex; align-items: center; gap: 8px;
        }
        .start-btn:hover  { background: #C05F2F; transform: scale(1.03); }
        .start-btn:active { transform: scale(0.97); }

        .module-tag {
          font-size: 10px;
          letter-spacing: 0.15em;
          text-transform: uppercase;
          color: rgba(0,0,0,0.2);
          margin-top: 2.5rem;
        }

        @media (min-width: 768px) {
          .arena-field { max-width: 520px; min-height: 300px; }
        }
        @media (min-width: 1200px) {
          .arena-field { max-width: 620px; min-height: 360px; }
          .ss-controls { max-width: 560px; }
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
            Module 01 — The Pulse &amp; Environment
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
          <div className={"arena-field" + (isDownbeat ? " downbeat-active" : beatFlash ? " beat-active" : "")}>
            <span className="arena-label">Arena</span>
            <BeatDots currentBeat={currentBeat} active={isPlaying} />
            <p className="beat-label" aria-live="polite">
              {isPlaying && currentBeat >= 0 ? "Beat " + (currentBeat + 1) + " of 4" : "\u2014"}
            </p>
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

        <p className="module-tag" aria-hidden="true">Module 01 — Pulse &amp; Environment</p>
      </div>
    </>
  );
}
