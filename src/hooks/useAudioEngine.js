import { useRef, useCallback } from "react";
import { NOTE_DUR, CLICK_FREQ, CLICK_DUR } from "../constants/swaras";

// ─── Audio Engine ─────────────────────────────────────────────────────────────
export default function useAudioEngine() {
  const ctxRef        = useRef(null);
  const droneNodesRef = useRef([]);
  const schedTimerRef = useRef(null);
  const nextBeatRef   = useRef(0);
  const beatCountRef  = useRef(0);
  // ── DEBUG: tracking for the ?debug=1 overlay (temporary) ──────────────────
  const scheduleStartTimeRef = useRef(0);
  const scheduledCountRef    = useRef(0);

  const getCtx = useCallback(() => {
    if (!ctxRef.current || ctxRef.current.state === "closed")
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    return ctxRef.current;
  }, []);

  const warmUp = useCallback(() => {
    // Create context if needed — must happen synchronously in user gesture
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new (window.AudioContext || window.webkitAudioContext)();
    }
    // Resume synchronously — Safari honours this when called in gesture
    if (ctxRef.current.state === "suspended") {
      ctxRef.current.resume().catch(() => {});
    }
    // Play a silent buffer — this is the standard iOS unlock trick
    // Forces Safari to fully activate the audio hardware
    const ctx = ctxRef.current;
    const buf = ctx.createBuffer(1, 1, ctx.sampleRate);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
  }, []);

  const stopDrone = useCallback(() => {
    droneNodesRef.current.forEach(n => { try { n.stop(); n.disconnect(); } catch(e){} });
    droneNodesRef.current = [];
  }, []);

  const startDrone = useCallback((freq) => {
    stopDrone();
    const ctx = getCtx();
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, ctx.currentTime);
    master.gain.linearRampToValueAtTime(0.32, ctx.currentTime + 0.5);
    master.connect(ctx.destination);
    [[1,.28],[2,.11],[3,.06],[5,.035]].forEach(([m,a]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(freq * m, ctx.currentTime);
      g.gain.setValueAtTime(a, ctx.currentTime);
      o.connect(g); g.connect(master); o.start();
      droneNodesRef.current.push(o);
    });
    const pf = freq * 1.5;
    [[1,.07],[2,.03]].forEach(([m,a]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine";
      o.frequency.setValueAtTime(pf * m, ctx.currentTime);
      g.gain.setValueAtTime(a, ctx.currentTime);
      o.connect(g); g.connect(master); o.start();
      droneNodesRef.current.push(o);
    });
  }, [stopDrone, getCtx]);

  const playGuruNote = useCallback((freq, t) => {
    const ctx = getCtx();
    if (ctx.state !== "running") return;
    // If scheduled time is in the past (mobile timing drift),
    // reschedule to play immediately with a tiny safety buffer
    const safeT = Math.max(t, ctx.currentTime + 0.02);
    // Build graph: oscillators → gainNodes → master → filter → destination
    const filter = ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(freq * 6, safeT);
    filter.Q.setValueAtTime(0.7, safeT);
    filter.connect(ctx.destination);
    const master = ctx.createGain();
    master.gain.setValueAtTime(0, safeT);
    master.gain.linearRampToValueAtTime(0.18, safeT + 0.06);
    master.gain.setValueAtTime(0.15, safeT + 0.20);
    master.gain.linearRampToValueAtTime(0, safeT + NOTE_DUR);
    master.connect(filter);
    [
      [1, 1.00],
      [2, 0.50],
      [3, 0.22],
      [4, 0.10],
      [5, 0.06],
    ].forEach(([m, a]) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "triangle";
      o.frequency.setValueAtTime(freq * m, safeT);
      o.detune.setValueAtTime(m > 2 ? (m % 2 === 0 ? 3 : -3) : 0, safeT);
      g.gain.setValueAtTime(a * 0.18, safeT);
      o.connect(g); g.connect(master);
      o.start(safeT); o.stop(safeT + NOTE_DUR + 0.05);
    });
  }, [getCtx]);

  const scheduleBeats = useCallback((bpm, totalBeats, onBeat, onDone) => {
    const ctx = getCtx(), spb = 60 / bpm;
    // DEBUG: capture ctx.currentTime at the moment scheduleBeats was called
    scheduleStartTimeRef.current = ctx.currentTime;
    scheduledCountRef.current    = 0;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const schedAhead = isSafari ? 0.40 : 0.25;
    const lookAhead  = isSafari ? 60   : 40;
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
        src.connect(g); g.connect(ctx.destination);
        const safeClickT = Math.max(t, ctx.currentTime + 0.01);
        src.start(safeClickT);
        const delay = Math.max(0, (t - ctx.currentTime) * 1000);
        const cb = beat, cs = scheduled;
        setTimeout(() => onBeat(cb % 4, isDown, cs, t), delay);
        nextBeatRef.current += spb; beatCountRef.current++; scheduled++;
      }
      scheduledCountRef.current = scheduled; // DEBUG: mirror to ref for overlay
      if (scheduled < totalBeats) {
        schedTimerRef.current = setTimeout(tick, lookAhead);
      } else {
        const lastT = nextBeatRef.current - spb;
        const doneDelay = Math.max(0, (lastT - (ctxRef.current?.currentTime ?? 0)) * 1000) + 300;
        schedTimerRef.current = setTimeout(onDone, doneDelay);
      }
    };
    beatCountRef.current = 0;
    const _waitForClock = () => {
      if (ctx.currentTime > 0) {
        // Add extra 200ms buffer on mobile to let audio hardware stabilise
        // before the first beat fires. This prevents the first-card glitch.
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        const startOffset = isMobile ? 0.30 : 0.08;
        nextBeatRef.current = ctx.currentTime + startOffset;
        tick();
      } else {
        setTimeout(_waitForClock, 10);
      }
    };
    _waitForClock();
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

  const getAudioContext = useCallback(() => getCtx(), [getCtx]);
  // DEBUG: snapshot of engine state for the ?debug=1 overlay (temporary)
  const getDebugInfo = useCallback(() => ({
    ctxState:          ctxRef.current?.state ?? "none",
    ctxTime:           ctxRef.current?.currentTime ?? 0,
    scheduleStartTime: scheduleStartTimeRef.current,
    scheduledCount:    scheduledCountRef.current,
    isSafari:          /^((?!chrome|android).)*safari/i.test(navigator.userAgent),
  }), []);
  return { startDrone, stopDrone, scheduleBeats, stopScheduler, resumeCtx, updateDroneFreq, playGuruNote, playSetDing, playLevelUpArp, playGrandSlamFanfare, getAudioContext, warmUp, getDebugInfo };
}
