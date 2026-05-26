import { useState, useEffect, useRef, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
// ─── usePitchDetection Hook ───────────────────────────────────────────────────
// RULE #2: Fully encapsulated. No game state is read or written from inside.
// Accepts: isActive (bool), targetFreq (number)
// Returns: isMatch (bool), micError (string|null), retryMic (fn)
// ═══════════════════════════════════════════════════════════════════════════════
export default function usePitchDetection({ isActive, targetFreq }) {
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
  const matchStreakRef = useRef(0);

  isActiveRef.current   = isActive;
  targetFreqRef.current = targetFreq;

  // ── Autocorrelation pitch detection ────────────────────────────────────────
  const detectPitch = useCallback((analyser, sampleRate) => {
    const buffer = bufferRef.current;
    analyser.getFloatTimeDomainData(buffer);

    let rms = 0;
    for (let i = 0; i < buffer.length; i++) rms += buffer[i] * buffer[i];
    rms = Math.sqrt(rms / buffer.length);
    if (rms < 0.006) return null;

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
      if (!isActiveRef.current) { matchStreakRef.current = 0; setIsMatch(false); return; }
      rafRef.current = requestAnimationFrame(loop);
      const hz = detectPitch(analyser, sampleRate);
      if (checkMatchAcrossOctaves(hz, targetFreqRef.current)) {
        matchStreakRef.current++;
        if (matchStreakRef.current >= 3) setIsMatch(true);
      } else {
        matchStreakRef.current = 0;
        setIsMatch(false);
      }
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
