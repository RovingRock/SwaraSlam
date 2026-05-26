import { useRef, useCallback } from "react";
import * as Tone from "tone";
import { NOTE_DUR, CLICK_FREQ, CLICK_DUR } from "../constants/swaras";

export default function useAudioEngine() {
  const droneNodesRef  = useRef([]);
  const schedTimerRef  = useRef(null);
  const nextBeatRef    = useRef(0);
  const beatCountRef   = useRef(0);
  const droneFreqRef   = useRef(0);
  const droneSynthsRef = useRef([]);

  // ── warmUp: call inside button tap to unlock audio on iOS ────────────────
  const warmUp = useCallback(async () => {
    await Tone.start();
  }, []);

  // ── getAudioContext: expose underlying context ────────────────────────────
  const getAudioContext = useCallback(() => {
    return Tone.getContext().rawContext;
  }, []);

  // ── resumeCtx ─────────────────────────────────────────────────────────────
  const resumeCtx = useCallback(() => {
    Tone.getContext().resume();
  }, []);

  // ── stopDrone ─────────────────────────────────────────────────────────────
  const stopDrone = useCallback(() => {
    droneFreqRef.current = 0;
    droneSynthsRef.current.forEach(s => {
      try { s.stop(); s.dispose(); } catch(e) {}
    });
    droneSynthsRef.current = [];
  }, []);

  // ── startDrone ────────────────────────────────────────────────────────────
  const startDrone = useCallback((freq) => {
    stopDrone();
    droneFreqRef.current = freq;
    Tone.start().then(() => {
      const synths = [];
      // Root + harmonics
      [[1,.28],[2,.11],[3,.06],[5,.035]].forEach(([m, a]) => {
        const osc = new Tone.Oscillator({
          frequency: freq * m,
          type: "sine",
          volume: Tone.gainToDb(a * 0.38)
        }).toDestination();
        osc.start();
        synths.push(osc);
      });
      // Pa (fifth) harmonics
      const pf = freq * 1.5;
      [[1,.07],[2,.03]].forEach(([m, a]) => {
        const osc = new Tone.Oscillator({
          frequency: pf * m,
          type: "sine",
          volume: Tone.gainToDb(a * 0.38)
        }).toDestination();
        osc.start();
        synths.push(osc);
      });
      droneSynthsRef.current = synths;
    }).catch(() => {});
  }, [stopDrone]);

  // ── updateDroneFreq ───────────────────────────────────────────────────────
  const updateDroneFreq = useCallback((freq) => {
    if (!droneSynthsRef.current.length) return;
    droneFreqRef.current = freq;
    const freqs = [freq,freq*2,freq*3,freq*5,freq*1.5,freq*3];
    droneSynthsRef.current.forEach((osc, i) => {
      try {
        if (freqs[i]) osc.frequency.rampTo(freqs[i], 0.1);
      } catch(e) {}
    });
  }, []);

  // ── playGuruNote ──────────────────────────────────────────────────────────
  const playGuruNote = useCallback((freq, t) => {
    // t is AudioContext time — convert to Tone time
    const ctx = Tone.getContext().rawContext;
    const delaySeconds = Math.max(0, t - ctx.currentTime);
    const toneTime = Tone.now() + delaySeconds;

    const env = new Tone.AmplitudeEnvelope({
      attack: 0.035,
      decay: 0.065,
      sustain: 0.77,
      release: 0.12,
    }).toDestination();

    const synths = [[1,1.0],[2,0.26],[3,0.07]].map(([m, a]) => {
      const osc = new Tone.Oscillator({
        frequency: freq * m,
        type: "sine",
        volume: Tone.gainToDb(a * 0.13)
      }).connect(env);
      return osc;
    });

    synths.forEach(s => s.start(toneTime));
    env.triggerAttackRelease(NOTE_DUR, toneTime);
    // Cleanup after note ends
    setTimeout(() => {
      synths.forEach(s => { try { s.stop(); s.dispose(); } catch(e){} });
      try { env.dispose(); } catch(e) {}
    }, (delaySeconds + NOTE_DUR + 0.5) * 1000);
  }, []);

  // ── scheduleBeats ─────────────────────────────────────────────────────────
  const scheduleBeats = useCallback((bpm, totalBeats, onBeat, onDone) => {
    const ctx = Tone.getContext().rawContext;
    const spb = 60 / bpm;
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const schedAhead = isSafari ? 0.35 : isMobile ? 0.25 : 0.12;
    const lookAhead  = isSafari ? 50   : isMobile ? 40   : 25;
    const startOffset = isSafari ? 0.15 : isMobile ? 0.20 : 0.05;
    let scheduled = 0;

    const tick = () => {
      const now = ctx.currentTime;
      while (nextBeatRef.current < now + schedAhead && scheduled < totalBeats) {
        const t = nextBeatRef.current;
        const beat = beatCountRef.current;
        const isDown = beat % 4 === 0;

        // Schedule metronome click using Tone.js
        const delaySeconds = Math.max(0, t - now);
        const toneTime = Tone.now() + delaySeconds;
        const cf = isDown ? CLICK_FREQ : CLICK_FREQ * 0.65;
        const clickGain = isDown ? 0.52 : 0.26;
        const clickOsc = new Tone.Oscillator({
          frequency: cf,
          type: "sine",
          volume: Tone.gainToDb(clickGain)
        }).toDestination();
        const clickEnv = new Tone.AmplitudeEnvelope({
          attack: 0.001,
          decay: CLICK_DUR,
          sustain: 0,
          release: 0.01
        }).toDestination();
        clickOsc.connect(clickEnv);
        clickOsc.start(toneTime);
        clickEnv.triggerAttackRelease(CLICK_DUR, toneTime);
        setTimeout(() => {
          try { clickOsc.stop(); clickOsc.dispose(); clickEnv.dispose(); } catch(e){}
        }, (delaySeconds + CLICK_DUR + 0.2) * 1000);

        // Visual callback via setTimeout
        const delay = Math.max(0, (t - now) * 1000);
        const cb = beat, cs = scheduled;
        setTimeout(() => onBeat(cb % 4, isDown, cs, t), delay);

        nextBeatRef.current += spb;
        beatCountRef.current++;
        scheduled++;
      }

      if (scheduled < totalBeats) {
        schedTimerRef.current = setTimeout(tick, lookAhead);
      } else {
        const lastT = nextBeatRef.current - spb;
        const doneDelay = Math.max(0, (lastT - ctx.currentTime) * 1000) + 300;
        schedTimerRef.current = setTimeout(onDone, doneDelay);
      }
    };

    beatCountRef.current = 0;
    const _waitForClock = () => {
      const now = Tone.getContext().rawContext.currentTime;
      if (now > 0) {
        nextBeatRef.current = now + startOffset;
        tick();
      } else {
        setTimeout(_waitForClock, 10);
      }
    };
    _waitForClock();
  }, []);

  // ── stopScheduler ─────────────────────────────────────────────────────────
  const stopScheduler = useCallback(() => {
    clearTimeout(schedTimerRef.current);
    schedTimerRef.current = null;
  }, []);

  // ── playSetDing ───────────────────────────────────────────────────────────
  const playSetDing = useCallback(() => {
    const t = Tone.now() + 0.05;
    [[880, 0],[1320, 0.12]].forEach(([freq, delay]) => {
      const osc = new Tone.Oscillator({
        frequency: freq,
        type: "triangle",
        volume: -15
      }).toDestination();
      const env = new Tone.AmplitudeEnvelope({
        attack: 0.012, decay: 0.45, sustain: 0, release: 0.05
      }).toDestination();
      osc.connect(env);
      osc.start(t + delay);
      env.triggerAttackRelease(0.45, t + delay);
      setTimeout(() => {
        try { osc.stop(); osc.dispose(); env.dispose(); } catch(e){}
      }, (delay + 0.8) * 1000);
    });
  }, []);

  // ── playLevelUpArp ────────────────────────────────────────────────────────
  const playLevelUpArp = useCallback(() => {
    const t = Tone.now() + 0.08;
    const freqs = [261.63,293.66,329.63,392.00,523.25];
    freqs.forEach((freq, i) => {
      const osc = new Tone.Oscillator({
        frequency: freq, type: "square", volume: -22
      }).toDestination();
      const env = new Tone.AmplitudeEnvelope({
        attack: 0.015, decay: 0.22, sustain: 0, release: 0.05
      }).toDestination();
      osc.connect(env);
      osc.start(t + i * 0.11);
      env.triggerAttackRelease(0.22, t + i * 0.11);
      setTimeout(() => {
        try { osc.stop(); osc.dispose(); env.dispose(); } catch(e){}
      }, (i * 0.11 + 0.5) * 1000);
    });
  }, []);

  // ── playGrandSlamFanfare ──────────────────────────────────────────────────
  const playGrandSlamFanfare = useCallback(() => {
    const t = Tone.now() + 0.08;
    const freqs = [261.63,293.66,329.63,349.23,392.00,440.00,493.88,523.25];
    freqs.forEach((freq, i) => {
      const type = i < 4 ? "square" : "triangle";
      const osc = new Tone.Oscillator({
        frequency: freq, type, volume: -21
      }).toDestination();
      const env = new Tone.AmplitudeEnvelope({
        attack: 0.015, decay: 0.3, sustain: 0, release: 0.05
      }).toDestination();
      osc.connect(env);
      osc.start(t + i * 0.09);
      env.triggerAttackRelease(0.3, t + i * 0.09);
      setTimeout(() => {
        try { osc.stop(); osc.dispose(); env.dispose(); } catch(e){}
      }, (i * 0.09 + 0.6) * 1000);
    });
    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = new Tone.Oscillator({
        frequency: freq, type: "sine", volume: Tone.gainToDb(0.09 - i * 0.02)
      }).toDestination();
      osc.start(t + freqs.length * 0.09);
      setTimeout(() => {
        try { osc.stop(); osc.dispose(); } catch(e){}
      }, (freqs.length * 0.09 + 1.5) * 1000);
    });
  }, []);

  return {
    startDrone, stopDrone, scheduleBeats, stopScheduler, resumeCtx,
    updateDroneFreq, playGuruNote, playSetDing, playLevelUpArp,
    playGrandSlamFanfare, getAudioContext, warmUp
  };
}
