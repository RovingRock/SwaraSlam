import { useState, useEffect, useRef, useCallback } from "react";

// ─── Inline Icons ─────────────────────────────────────────────────────────────
const Play     = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><polygon points="5,3 19,12 5,21"/></svg>;
const Pause    = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>;
const Volume2  = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg>;
const VolumeX  = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11,5 6,9 2,9 2,15 6,15 11,19"/><line x1="23" y1="9" x2="17" y2="15"/><line x1="17" y1="9" x2="23" y2="15"/></svg>;
const Maximize = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15,3 21,3 21,9"/><polyline points="9,21 3,21 3,15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>;
const Minimize = () => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="4,14 10,14 10,20"/><polyline points="20,10 14,10 14,4"/><line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/></svg>;
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
  { name:"Sa",   short:"S",  dv:"स",  ratio:1.0000, semitone:0  },
  { name:"Re♭",  short:"r",  dv:"रे♭",ratio:1.0667, semitone:1  },
  { name:"Re",   short:"R",  dv:"रे", ratio:1.1250, semitone:2  },
  { name:"Ga♭",  short:"g",  dv:"ग♭", ratio:1.2000, semitone:3  },
  { name:"Ga",   short:"G",  dv:"ग",  ratio:1.2500, semitone:4  },
  { name:"Ma",   short:"m",  dv:"म",  ratio:1.3333, semitone:5  },
  { name:"Ma#",  short:"M",  dv:"म#", ratio:1.4063, semitone:6  },
  { name:"Pa",   short:"P",  dv:"प",  ratio:1.5000, semitone:7  },
  { name:"Dha♭", short:"d",  dv:"ध♭", ratio:1.6000, semitone:8  },
  { name:"Dha",  short:"D",  dv:"ध",  ratio:1.6667, semitone:9  },
  { name:"Ni♭",  short:"n",  dv:"नि♭",ratio:1.7778, semitone:10 },
  { name:"Ni",   short:"N",  dv:"नि", ratio:1.8750, semitone:11 },
  { name:"Sa'",  short:"S'", dv:"सं", ratio:2.0000, semitone:12 },
];

const buildThreeOctavePool = (baseIdxArr) =>
  [0,1,2].flatMap(oct =>
    baseIdxArr.map(i => {
      const b = ALL_SWARAS_BASE[i];
      const ratioMult = oct === 0 ? 0.5 : oct === 2 ? 2.0 : 1.0;
      return { ...b, octave: oct, ratio: b.ratio * ratioMult, absSemitone: b.semitone + (oct - 1) * 13 };
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
  const cfg  = LEVEL_CONFIG[levelIdx];
  const pool = cfg.pool;
  const maxJ = cfg.maxJump;
  const cards = [];
  const key = s => s.semitone + "_" + (s.octave !== undefined ? s.octave : 1);
  const counts = {};
  pool.forEach(s => { counts[key(s)] = 0; });
  const rand = arr => arr[Math.floor(Math.random() * arr.length)];
  let prev = null;
  for (let i = 0; i < ACTIVE_BEATS; i++) {
    const remaining = ACTIVE_BEATS - i;
    let candidates = pool.filter(s => {
      if (counts[key(s)] >= 2) return false;
      if (counts[key(s)] >= 1 && remaining <= 1) return false;
      if (prev !== null) {
        const jump = Math.abs((s.absSemitone !== undefined ? s.absSemitone : s.semitone) - (prev.absSemitone !== undefined ? prev.absSemitone : prev.semitone));
        if (jump > maxJ) return false;
      }
      return true;
    });
    if (!candidates.length) candidates = pool.filter(s => counts[key(s)] < 2);
    if (!candidates.length) candidates = pool;
    const chosen = rand(candidates);
    counts[key(chosen)] = (counts[key(chosen)] || 0) + 1;
    cards.push(chosen);
    prev = chosen;
  }
  return cards;
}

// ─── Confetti ─────────────────────────────────────────────────────────────────
function Confetti({ active }) {
  const pieces = useRef(
    Array.from({ length: 54 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      delay: Math.random() * 0.7,
      dur: 1.8 + Math.random() * 1.2,
      color: ["#C05F2F","#9A7B50","#E8700A","#F2C94C","#1C1A17","#fff"][i % 6],
      size: 6 + Math.random() * 6,
      rot: Math.random() * 360,
    }))
  ).current;
  if (!active) return null;
  return (
    <div style={{ position:"fixed", inset:0, pointerEvents:"none", zIndex:200, overflow:"hidden" }}>
      {pieces.map(p => (
        <div key={p.id} style={{
          position:"absolute", left: p.x + "%", top:"-20px",
          width: p.size, height: p.size * 0.5,
          background: p.color, borderRadius:2,
          animation: "confettiFall " + p.dur + "s " + p.delay + "s ease-in forwards",
          transform: "rotate(" + p.rot + "deg)",
        }}/>
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
    const ctx = getCtx();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0.28, ctx.currentTime);
    master.connect(ctx.destination);
    [[1,.28],[2,.11],[3,.06],[5,.035]].forEach(([m,a]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(freq*m, ctx.currentTime);
      g.gain.setValueAtTime(a, ctx.currentTime);
      o.connect(g); g.connect(master); o.start();
      droneNodesRef.current.push(o);
    });
    const pf = freq * 1.5;
    [[1,.07],[2,.03]].forEach(([m,a]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(pf*m, ctx.currentTime);
      g.gain.setValueAtTime(a, ctx.currentTime);
      o.connect(g); g.connect(master); o.start();
      droneNodesRef.current.push(o);
    });
  }, [stopDrone, getCtx]);

  const playGuruNote = useCallback((freq, startTime) => {
    const ctx = getCtx();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, startTime);
    master.gain.linearRampToValueAtTime(0.24, startTime + 0.035);
    master.gain.setValueAtTime(0.19, startTime + 0.10);
    master.gain.linearRampToValueAtTime(0, startTime + NOTE_DUR);
    master.connect(ctx.destination);
    [[1,1.0],[2,0.26],[3,0.07]].forEach(([m,a]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.setValueAtTime(freq*m, startTime);
      g.gain.setValueAtTime(a, startTime);
      o.connect(g); g.connect(master);
      o.start(startTime); o.stop(startTime + NOTE_DUR + 0.02);
    });
  }, [getCtx]);

  const scheduleBeats = useCallback((bpm, totalBeats, onBeat, onDone) => {
    const ctx = getCtx();
    const spb = 60 / bpm;
    const schedAhead = 0.12;
    const lookAhead  = 25;
    let scheduled = 0;
    const tick = () => {
      while (nextBeatRef.current < ctx.currentTime + schedAhead && scheduled < totalBeats) {
        const t = nextBeatRef.current;
        const beat = beatCountRef.current;
        const isDown = beat % 4 === 0;
        const buf  = ctx.createBuffer(1, ctx.sampleRate * CLICK_DUR, ctx.sampleRate);
        const data = buf.getChannelData(0);
        const cf   = isDown ? CLICK_FREQ : CLICK_FREQ * 0.65;
        for (let i = 0; i < data.length; i++)
          data[i] = Math.sin(2*Math.PI*cf*i/ctx.sampleRate) * Math.exp(-i/(ctx.sampleRate*0.008));
        const src = ctx.createBufferSource(), g = ctx.createGain();
        src.buffer = buf;
        g.gain.setValueAtTime(isDown ? 0.52 : 0.26, t);
        src.connect(g); g.connect(ctx.destination); src.start(t);
        const delay = Math.max(0, (t - ctx.currentTime) * 1000);
        const cb = beat, ct = t, cs = scheduled;
        setTimeout(() => onBeat(cb % 4, isDown, cs, ct), delay);
        nextBeatRef.current += spb;
        beatCountRef.current++;
        scheduled++;
      }
      if (scheduled < totalBeats) {
        schedTimerRef.current = setTimeout(tick, lookAhead);
      } else {
        const lastT = nextBeatRef.current - (60 / bpm);
        const doneDelay = Math.max(0, (lastT - (ctxRef.current ? ctxRef.current.currentTime : 0)) * 1000) + 300;
        schedTimerRef.current = setTimeout(onDone, doneDelay);
      }
    };
    nextBeatRef.current  = ctx.currentTime + 0.08;
    beatCountRef.current = 0;
    tick();
  }, [getCtx]);

  const stopScheduler = useCallback(() => {
    clearTimeout(schedTimerRef.current);
    schedTimerRef.current = null;
  }, []);

  const resumeCtx = useCallback(() => {
    if (ctxRef.current && ctxRef.current.state === "suspended") ctxRef.current.resume();
  }, []);

  const updateDroneFreq = useCallback((freq) => {
    if (!droneNodesRef.current.length || !ctxRef.current) return;
    const t = ctxRef.current.currentTime + 0.05;
    [freq, freq*2, freq*3, freq*5, freq*1.5, freq*3].forEach((f, i) => {
      try { if (droneNodesRef.current[i]) droneNodesRef.current[i].frequency.setTargetAtTime(f, t, 0.1); } catch(e){}
    });
  }, []);

  return { startDrone, stopDrone, scheduleBeats, stopScheduler, resumeCtx, updateDroneFreq, playGuruNote };
}

// ─── Sub-components ───────────────────────────────────────────────────────────
function SwaraCard({ swara, state }) {
  const oct = swara.octave !== undefined ? swara.octave : 1;
  return (
    <div className={"swara-card card-" + state}>
      <span className="card-dv">{swara.dv}</span>
      <span className={"card-name" + (oct === 0 ? " oct-mandra" : "")}>
        {swara.short}
        {oct === 2 && <span className="oct-dot-above">·</span>}
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
  return (
    <div className={"bpm-flash" + (visible ? " bpm-flash-in" : "")}>
      {"\u2669"} {bpm} BPM
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function SwaraSlamApp() {
  const [started,       setStarted]       = useState(false);
  const [showGetReady,  setShowGetReady]  = useState(false);
  const [isPlaying,     setIsPlaying]     = useState(false);
  const [droneOn,       setDroneOn]       = useState(true);
  const [isFullscreen,  setIsFullscreen]  = useState(false);
  const [saIndex,       setSaIndex]       = useState(0);
  const [level,         setLevel]         = useState(0);
  const [setNum,        setSetNum]        = useState(0);
  const [cards,         setCards]         = useState(() => generateCards(0));
  const [currentCards,  setCurrentCards]  = useState(null);
  const [phase,         setPhase]         = useState("idle");
  const [activeCard,    setActiveCard]    = useState(-1);
  const [dotBeat,       setDotBeat]       = useState(-1);
  const [bpm,           setBpm]           = useState(BASE_BPM);
  const [manualBpm,     setManualBpm]     = useState(false);
  const [bpmFlash,      setBpmFlash]      = useState(false);
  const [levelUpVisible,setLevelUpVisible]= useState(false);
  const [confetti,      setConfetti]      = useState(false);
  const [allLevelsUp,   setAllLevelsUp]   = useState(false);
  const [showInstallBanner, setShowInstallBanner] = useState(false);
  const [deferredPrompt,    setDeferredPrompt]    = useState(null);

  const appRef      = useRef(null);
  const saIdxRef    = useRef(saIndex);
  const cardsRef    = useRef(cards);
  const engine      = useAudioEngine();

  saIdxRef.current  = saIndex;
  cardsRef.current  = cards;

  const autoBpm = BASE_BPM + setNum * BPM_INCREMENT;

  // ── Fullscreen
  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      if (appRef.current && appRef.current.requestFullscreen) {
        appRef.current.requestFullscreen().catch(() => {});
      }
    } else {
      if (document.exitFullscreen) document.exitFullscreen().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", h);
    return () => document.removeEventListener("fullscreenchange", h);
  }, []);

  // ── Cleanup
  useEffect(() => () => { engine.stopScheduler(); engine.stopDrone(); }, []);

  // ── Install banner
  useEffect(() => {
    const isPWA = window.matchMedia("(display-mode: standalone)").matches;
    if (isPWA) return;
    const dismissed = localStorage.getItem("installBannerDismissed");
    if (dismissed) return;
    const handleBeforeInstall = (e) => {
      e.preventDefault();
      setDeferredPrompt(e);
      setTimeout(() => setShowInstallBanner(true), 2500);
    };
    window.addEventListener("beforeinstallprompt", handleBeforeInstall);
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isIOS    = /iphone|ipad|ipod/i.test(navigator.userAgent);
    if (isSafari || isIOS) setTimeout(() => setShowInstallBanner(true), 2500);
    return () => window.removeEventListener("beforeinstallprompt", handleBeforeInstall);
  }, []);

  const dismissInstallBanner = useCallback(() => {
    setShowInstallBanner(false);
    localStorage.setItem("installBannerDismissed", "true");
  }, []);

  const handleInstall = useCallback(async () => {
    if (deferredPrompt) {
      deferredPrompt.prompt();
      const { outcome } = await deferredPrompt.userChoice;
      if (outcome === "accepted") {
        setShowInstallBanner(false);
        localStorage.setItem("installBannerDismissed", "true");
      }
      setDeferredPrompt(null);
    }
  }, [deferredPrompt]);

  const handleShare = useCallback(async () => {
    if (navigator.share) {
      try {
        await navigator.share({ title:"Swara Slam", text:"Swara expertise for Vocalists and Instrumentalists", url: window.location.href });
      } catch(e) {}
    } else {
      navigator.clipboard.writeText(window.location.href);
      alert("Link copied to clipboard!");
    }
  }, []);

  // ── BPM flash on set change
  const prevSetRef = useRef(-1);
  useEffect(() => {
    if (prevSetRef.current === -1) { prevSetRef.current = setNum; return; }
    if (prevSetRef.current !== setNum) {
      prevSetRef.current = setNum;
      setBpmFlash(true);
      setTimeout(() => setBpmFlash(false), 1600);
    }
  }, [setNum]);

  // ── Advance set/level
  const advanceSet = useCallback((lvl, sn) => {
    const nextSet = sn + 1;
    if (nextSet >= SETS_PER_LEVEL) {
      const nextLevel = lvl + 1;
      if (nextLevel >= LEVEL_CONFIG.length) {
        setAllLevelsUp(true);
        setConfetti(true);
        setTimeout(() => setConfetti(false), 3200);
      } else {
        setLevelUpVisible(true);
        setConfetti(true);
        setTimeout(() => setConfetti(false), 3200);
        setTimeout(() => {
          setLevelUpVisible(false);
          setLevel(nextLevel);
          setSetNum(0);
          const nc = generateCards(nextLevel);
          setCards(nc); setCurrentCards(null);
          if (!manualBpm) setBpm(BASE_BPM);
        }, 3000);
      }
    } else {
      setSetNum(nextSet);
      const nc = generateCards(lvl);
      setCards(nc); setCurrentCards(null);
      if (!manualBpm) setBpm(BASE_BPM + nextSet * BPM_INCREMENT);
    }
  }, [manualBpm]);

  // ── Start play
  const startPlay = useCallback((replayCards) => {
    engine.stopScheduler();
    const playCards = replayCards || generateCards(level);
    if (!replayCards) setCards(playCards);
    setCurrentCards(playCards);
    cardsRef.current = playCards;
    const effectiveBpm = manualBpm ? bpm : autoBpm;
    if (!manualBpm) setBpm(effectiveBpm);
    engine.resumeCtx();
    if (droneOn) engine.startDrone(SA_PITCHES[saIdxRef.current].freq);
    setPhase("leadin");
    setActiveCard(-1);
    setDotBeat(-1);
    setIsPlaying(true);
    const totalBeats = LEAD_IN_BEATS + ACTIVE_BEATS;
    engine.scheduleBeats(effectiveBpm, totalBeats,
      (dotIdx, isDown, seqIdx, scheduledTime) => {
        setDotBeat(dotIdx);
        if (seqIdx < LEAD_IN_BEATS) {
          setPhase("leadin"); setActiveCard(-1);
        } else {
          setPhase("active");
          const cardIdx = seqIdx - LEAD_IN_BEATS;
          setActiveCard(cardIdx);
          const saFreq   = SA_PITCHES[saIdxRef.current].freq;
          const noteFreq = saFreq * cardsRef.current[cardIdx].ratio;
          engine.playGuruNote(noteFreq, scheduledTime);
        }
      },
      () => {
        setPhase("done");
        setIsPlaying(false);
        setActiveCard(-1);
        setDotBeat(-1);
        engine.stopDrone();
        setLevel(lvl => {
          setSetNum(sn => { advanceSet(lvl, sn); return sn; });
          return lvl;
        });
      }
    );
  }, [engine, droneOn, bpm, manualBpm, autoBpm, level, advanceSet]);

  const handlePlay  = useCallback(() => startPlay(null), [startPlay]);
  const handleStop  = useCallback(() => {
    engine.stopScheduler(); engine.stopDrone();
    setIsPlaying(false); setPhase("idle"); setActiveCard(-1); setDotBeat(-1);
  }, [engine]);
  const togglePlay  = useCallback(() => { isPlaying ? handleStop() : handlePlay(); }, [isPlaying, handlePlay, handleStop]);
  const handleRetry = useCallback(() => {
    if (isPlaying) { engine.stopScheduler(); engine.stopDrone(); setIsPlaying(false); }
    const replay = currentCards || cards;
    setTimeout(() => startPlay(replay), 80);
  }, [isPlaying, engine, currentCards, cards, startPlay]);
  const handleNextSet = useCallback(() => {
    if (isPlaying) { engine.stopScheduler(); engine.stopDrone(); setIsPlaying(false); }
    setPhase("idle"); setActiveCard(-1);
    setLevel(lvl => { setSetNum(sn => { advanceSet(lvl, sn); return sn; }); return lvl; });
  }, [isPlaying, engine, advanceSet]);

  const toggleDrone = useCallback(() => {
    if (!isPlaying) { setDroneOn(d => !d); return; }
    if (droneOn) { engine.stopDrone(); setDroneOn(false); }
    else { engine.startDrone(SA_PITCHES[saIdxRef.current].freq); setDroneOn(true); }
  }, [isPlaying, droneOn, engine]);

  const handleSaChange = useCallback((e) => {
    const idx = Number(e.target.value);
    setSaIndex(idx); saIdxRef.current = idx;
    if (isPlaying && droneOn) engine.updateDroneFreq(SA_PITCHES[idx].freq);
  }, [isPlaying, droneOn, engine]);

  const handleBpmChange = useCallback((e) => {
    setBpm(Number(e.target.value)); setManualBpm(true);
  }, []);

  const handleRestart = useCallback(() => {
    setAllLevelsUp(false); setConfetti(false);
    setLevel(0); setSetNum(0);
    const nc = generateCards(0);
    setCards(nc); setCurrentCards(null);
    setManualBpm(false); setBpm(BASE_BPM);
    setPhase("idle"); setActiveCard(-1);
  }, []);

  const displayCards = currentCards || cards;
  const sliderPct    = Math.round(((bpm - 40) / (700 - 40)) * 100);
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

        .ss-app{min-height:100vh;background:#F9F7F2;font-family:'DM Sans',sans-serif;color:#1C1A17;display:flex;flex-direction:column;align-items:center;padding:0 1.25rem 2.5rem;overflow-x:hidden}

        .ss-header{width:100%;max-width:680px;display:flex;align-items:center;justify-content:space-between;padding:1.25rem 0 0.6rem}
        .ss-wordmark{display:flex;flex-direction:column;gap:3px}
        .ss-brand-top{font-family:'DM Sans',sans-serif;font-size:10px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:#9A7B50;line-height:1}
        .ss-brand-top em{font-style:normal;color:#C05F2F}
        .ss-brand-main{display:flex;align-items:baseline;gap:5px;line-height:1}
        .ss-brand-swara{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:600;color:#1C1A17}
        .ss-brand-slam{font-family:'Cormorant Garamond',serif;font-size:26px;font-weight:600;font-style:italic;color:#C05F2F}
        .ss-header-actions{display:flex;gap:6px}
        .icon-btn{width:36px;height:36px;border-radius:50%;border:.5px solid rgba(0,0,0,.12);background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#5A4A35;transition:background .15s;flex-shrink:0}
        .icon-btn:hover{background:rgba(0,0,0,.05)}
        .icon-btn.active{color:#C05F2F;border-color:rgba(192,95,47,.4)}

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
        .nav-btn{width:42px;height:42px;border-radius:50%;border:.5px solid rgba(0,0,0,.14);background:transparent;cursor:pointer;display:flex;align-items:center;justify-content:center;color:#5A4A35;transition:background .15s,border-color .15s;flex-shrink:0}
        .nav-btn:hover{background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.22)}
        .nav-btn:disabled{opacity:.3;cursor:default}

        .levelup-overlay{position:fixed;inset:0;z-index:190;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1rem;background:rgba(249,247,242,.92);backdrop-filter:blur(6px);animation:fadeIn .3s ease both}
        .levelup-ornament{font-family:'Cormorant Garamond',serif;font-size:14px;color:rgba(0,0,0,.18);letter-spacing:.35em}
        .levelup-title{font-family:'Cormorant Garamond',serif;font-size:clamp(42px,10vw,80px);font-weight:600;color:#C05F2F;font-style:italic;animation:titlePop .5s .1s cubic-bezier(.34,1.56,.64,1) both}
        .levelup-sub{font-size:12px;letter-spacing:.2em;text-transform:uppercase;color:#9A7B50}
        .getready-eyebrow{font-family:'DM Sans',sans-serif;font-size:12px;font-weight:500;letter-spacing:.25em;text-transform:uppercase;color:#9A7B50;animation:fadeIn .4s ease both}
        @keyframes fadeIn{from{opacity:0}to{opacity:1}}
        @keyframes titlePop{from{opacity:0;transform:scale(.6)}to{opacity:1;transform:scale(1)}}

        .start-overlay{position:fixed;inset:0;background:#F9F7F2;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:1.25rem;z-index:100;padding:0 1.5rem;text-align:center}
        .start-raaguru{font-family:'DM Sans',sans-serif;font-size:11px;font-weight:500;letter-spacing:.22em;text-transform:uppercase;color:#9A7B50}
        .start-raaguru em{font-style:normal;color:#C05F2F}
        .start-title{display:flex;align-items:baseline;gap:10px}
        .start-swara{font-family:'Cormorant Garamond',serif;font-size:clamp(52px,11vw,84px);font-weight:600;color:#1C1A17}
        .start-slam{font-family:'Cormorant Garamond',serif;font-size:clamp(52px,11vw,84px);font-weight:600;font-style:italic;color:#C05F2F}
        .start-sub{font-size:11px;color:#9A7B50;letter-spacing:.12em;text-transform:uppercase;text-align:center;padding:0 1.5rem;line-height:1.6;max-width:280px}
        .start-btn{margin-top:.5rem;padding:14px 40px;border-radius:99px;background:#1C1A17;border:none;color:#F9F7F2;font-family:'DM Sans',sans-serif;font-size:14px;font-weight:500;letter-spacing:.06em;cursor:pointer;transition:background .18s,transform .12s;display:flex;align-items:center;gap:8px}
        .start-btn:hover{background:#C05F2F;transform:scale(1.03)}
        .start-btn:active{transform:scale(.97)}

        .module-tag{font-size:10px;letter-spacing:.15em;text-transform:uppercase;color:rgba(0,0,0,.18);margin-top:1.75rem}

        .install-tooltip{position:fixed;bottom:24px;left:50%;transform:translateX(-50%);width:calc(100% - 40px);max-width:360px;background:#1C1A17;color:#F9F7F2;border-radius:16px;padding:20px;box-shadow:0 8px 40px rgba(0,0,0,.35);z-index:150;animation:tooltipUp .35s cubic-bezier(.34,1.56,.64,1) both}
        @keyframes tooltipUp{from{opacity:0;transform:translateX(-50%) translateY(20px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}
        .install-tooltip-title{font-family:'Cormorant Garamond',serif;font-size:20px;font-weight:600;font-style:italic;color:#F9F7F2;margin-bottom:14px}
        .install-close{position:absolute;top:14px;right:14px;background:rgba(255,255,255,.1);border:none;color:#F9F7F2;width:26px;height:26px;border-radius:50%;cursor:pointer;font-size:14px;transition:background .15s}
        .install-close:hover{background:rgba(255,255,255,.2)}
        .install-steps{display:flex;flex-direction:column;gap:10px}
        .install-step{display:flex;align-items:flex-start;gap:10px;font-size:13px;line-height:1.4;color:rgba(255,255,255,.85)}
        .install-step-num{background:#C05F2F;color:#fff;width:20px;height:20px;border-radius:50%;font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
        .install-step strong{color:#fff}
        .share-icon-inline{width:14px;height:14px;display:inline;vertical-align:middle;margin:0 2px;stroke:#C05F2F}
        .install-buttons{display:flex;gap:8px}
        .install-btn{flex:1;background:#C05F2F;color:#fff;border:none;border-radius:8px;padding:11px 14px;font-family:'DM Sans',sans-serif;font-size:13px;font-weight:600;cursor:pointer;transition:background .15s;display:flex;align-items:center;justify-content:center;gap:6px}
        .install-btn:hover{background:#A0472A}
        .install-btn svg{width:15px;height:15px;flex-shrink:0}
        .install-btn-share{background:rgba(255,255,255,.12)}
        .install-btn-share:hover{background:rgba(255,255,255,.2)}

        @media(min-width:480px){.card-grid{gap:9px}}
        @media(min-width:768px){.arena-field{max-width:540px;padding:20px 18px}.card-grid{gap:11px}.ss-controls{max-width:540px}}
        @media(min-width:1200px){.arena-field{max-width:620px;padding:24px 22px}.card-grid{gap:13px}.ss-controls{max-width:580px}}
      `}</style>

      <Confetti active={confetti} />
      <BpmFlash bpm={manualBpm ? bpm : autoBpm} visible={bpmFlash} />

      {/* Get Ready overlay */}
      {showGetReady && (
        <div className="levelup-overlay">
          <p className="getready-eyebrow">Ready?</p>
          <div className="levelup-title">Level 1 coming up</div>
          <p className="levelup-sub">{LEVEL_CONFIG[0].label} Swaras &middot; {BASE_BPM} BPM</p>
        </div>
      )}

      {/* All Levels Up overlay */}
      {allLevelsUp && (
        <div className="levelup-overlay">
          <div className="levelup-title" style={{fontSize:"clamp(38px,9vw,68px)"}}>All Levels Up!</div>
          <p className="levelup-sub" style={{marginBottom:".5rem"}}>You have mastered all four levels</p>
          <button className="start-btn" onClick={handleRestart}>&#8617; Go back to start</button>
        </div>
      )}

      {/* Level Up overlay */}
      {levelUpVisible && (
        <div className="levelup-overlay">
          <p className="levelup-ornament">स &nbsp; र &nbsp; ग &nbsp; म</p>
          <div className="levelup-title">Level Up!</div>
          <p className="levelup-sub">Entering Level {level + 2} &mdash; {LEVEL_CONFIG[Math.min(level + 1, 3)].label}</p>
        </div>
      )}

      {/* Install tooltip */}
      {showInstallBanner && (
        <div className="install-tooltip">
          <button className="install-close" onClick={dismissInstallBanner} aria-label="Dismiss">&#10005;</button>
          <p className="install-tooltip-title">Install Swara Slam</p>
          {deferredPrompt ? (
            <div className="install-buttons">
              <button className="install-btn" onClick={handleInstall}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
                Add to Home Screen
              </button>
              <button className="install-btn install-btn-share" onClick={handleShare}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                Share
              </button>
            </div>
          ) : (
            <div className="install-steps">
              <div className="install-step">
                <span className="install-step-num">1</span>
                <span>Tap the <strong>Share</strong> icon
                  <svg className="share-icon-inline" viewBox="0 0 24 24" fill="none" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>
                  in Safari
                </span>
              </div>
              <div className="install-step">
                <span className="install-step-num">2</span>
                <span>Tap <strong>"Add to Home Screen"</strong></span>
              </div>
              <div className="install-step">
                <span className="install-step-num">3</span>
                <span>Tap <strong>"Add"</strong> &#10003;</span>
              </div>
              <button className="install-btn install-btn-share" onClick={handleShare} style={{marginTop:"8px"}}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/><line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/></svg>
                Share App
              </button>
            </div>
          )}
        </div>
      )}

      {/* Start overlay */}
      {!started && (
        <div className="start-overlay" role="dialog" aria-modal="true">
          <p className="start-raaguru">Raag<em>GURU</em></p>
          <div className="start-title">
            <span className="start-swara">Swara</span>
            <span className="start-slam">Slam</span>
          </div>
          <p className="start-sub">Swara expertise for Vocalists and Instrumentalists</p>
          <button className="start-btn" onClick={() => {
            toggleFullscreen();
            setStarted(true);
            setShowGetReady(true);
            setTimeout(() => setShowGetReady(false), 2200);
          }}>
            <Maximize /> Start Practice
          </button>
          <p style={{fontSize:"10px",letterSpacing:".2em",textTransform:"uppercase",color:"rgba(0,0,0,.18)",marginTop:".5rem"}}>
            Module 03 &mdash; Progression System
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

        <div className="progress-bar">
          <span className="prog-badge"><strong>Level {level + 1}</strong> &middot; {LEVEL_CONFIG[level].label}</span>
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
            <div className="card-grid">
              {displayCards.map((sw, i) => (
                <SwaraCard key={i} swara={sw} state={getCardState(i)} />
              ))}
            </div>
            <BeatDots beat={dotBeat} active={isPlaying} />
          </div>
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
              {SA_PITCHES.map((p, i) => (
                <option key={p.label} value={i}>{p.label} &mdash; {p.freq.toFixed(0)} Hz</option>
              ))}
            </select>
          </div>
          <div className="play-row">
            <button className="nav-btn" onClick={handleRetry} disabled={isPlaying} aria-label="Try again" title="Try Again"><SkipBack /></button>
            <button className={"play-btn" + (isPlaying ? " playing" : "")} onClick={togglePlay} aria-label={isPlaying ? "Stop" : "Play"}>
              {isPlaying ? <Pause /> : <Play />}
            </button>
            <button className="nav-btn" onClick={handleNextSet} disabled={isPlaying} aria-label="Next set" title="Next Set"><SkipFwd /></button>
          </div>
        </section>

        <p className="module-tag">Module 03 &mdash; Progression System</p>
      </div>
    </>
  );
}
