import { useState, useEffect, useRef, useCallback } from "react";
import "./styles/swaraslam.css";

import { supabase, supabaseAdmin } from "./utils/supabaseClients";
import {
  SA_PITCHES,
  LEVEL_CONFIG,
  SETS_PER_LEVEL,
  BASE_BPM,
  BPM_INCREMENT,
  LEAD_IN_BEATS,
  ACTIVE_BEATS,
  TOTAL_PER_LEVEL,
  TOTAL_ALL_LEVELS,
} from "./constants/swaras";
import { WT_STEPS } from "./constants/walkthrough";
import { generateCards } from "./utils/cards";
import { getTitleForPct, getLevelSummaryMessage } from "./utils/scoring";
import usePitchDetection from "./hooks/usePitchDetection";
import useAudioEngine from "./hooks/useAudioEngine";

import MicErrorBanner from "./components/MicErrorBanner";
import AdminDashboard from "./components/AdminDashboard";
import AuthModal from "./components/AuthModal";
import ResetPasswordModal from "./components/ResetPasswordModal";
import FeedbackModal from "./components/FeedbackModal";
import CookieBanner from "./components/CookieBanner";
import LegalModal from "./components/LegalModal";
import PaywallScreen from "./components/PaywallScreen";
import SwaraCard from "./components/SwaraCard";
import BeatDots from "./components/BeatDots";
import BpmFlash from "./components/BpmFlash";
import Confetti from "./components/Confetti";
import { Play, Pause, Volume2, VolumeX, SkipFwd, SkipBack } from "./components/Icons";

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
  const isPlayingRef = useRef(false);
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

  // ── DEBUG: ?debug=1 overlay (temporary) ──────────────────────────────────
  // Holds the snapshot returned by engine.getDebugInfo() — null when overlay off.
  const [debugInfo, setDebugInfo] = useState(null);

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
    isActive:   phase === "active" && activeCard >= 0,
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
        if (sessionUser) {
          supabase.from('profiles')
            .update({ free_plays_used: 0 })
            .eq('id', sessionUser.id)
            .then(() => {});
        }
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
          .select("is_premium, free_plays_used")
          .eq("id", user.id)
          .maybeSingle();
        if (profile?.is_premium === true) premium = true;
        // Restore free play count from Supabase — prevents cross-device bypass
        if (profile && profile.free_plays_used > 0) {
          const localPlays = Number(localStorage.getItem('swaraslam_free_plays') || 0);
          const serverPlays = profile.free_plays_used || 0;
          // Always use the higher of local vs server — prevents gaming the system
          const truePlays = Math.max(localPlays, serverPlays);
          localStorage.setItem('swaraslam_free_plays', String(truePlays));
          setFreePlayCount(truePlays);
          freePlayCountRef.current = truePlays;
        }
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

  // ── DEBUG: polls engine state every 500ms when ?debug=1 is in URL ─────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("debug") !== "1") return;
    const update = () => setDebugInfo(engine.getDebugInfo());
    update();
    const id = setInterval(update, 500);
    return () => clearInterval(id);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      // Mirror to Supabase for logged-in users so count persists across devices
      if (userRef.current) {
        supabase.from('profiles')
          .update({ free_plays_used: nextCount })
          .eq('id', userRef.current.id)
          .then(() => {});
      }
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
    setPhase("leadin"); setActiveCard(-1); setDotBeat(-1); setIsPlaying(true); isPlayingRef.current = true;
    setMicActive(true);
    if (droneOn) engine.startDrone(SA_PITCHES[saIdxRef.current].freq);
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
        setPhase("done"); setIsPlaying(false); isPlayingRef.current = false; setDotBeat(-1);
        setTimeout(() => {
          setActiveCard(-1);
          setMicActive(false);
          // Only stop drone if a new set hasn't already restarted it
          if (!isPlayingRef.current) engine.stopDrone();
        }, 1200);

        // Counter now lives in advanceSet level-complete branch (guaranteed path).
        advanceSet(levelRef.current, setNumRef.current);
      }
    );
  }, [engine, droneOn, autoBpm, advanceSet]);

  const stopPlay = useCallback(() => {
    engine.stopScheduler(); engine.stopDrone();
    setIsPlaying(false); isPlayingRef.current = false; setPhase("idle"); setActiveCard(-1); setDotBeat(-1);
    setMicActive(false);
    setScore(0); scoreRef.current = 0;
    scoredCardsRef.current = new Set();
    setScoredCards(new Set());
  }, [engine]);

  const handleRetry = useCallback(() => {
    if (isPlaying) { engine.stopScheduler(); engine.stopDrone(); setIsPlaying(false); isPlayingRef.current = false; setMicActive(false); }
    engine.warmUp();
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
    phase === "leadin" ? "Get Ready…" :
    phase === "active" ? "Sing Along 🎵" :
    phase === "done"   ? "Set Complete ✓" : "Ready";

  return (
    <>
      <Confetti active={confetti} />
      <BpmFlash bpm={manualBpm ? bpm : autoBpm} visible={bpmFlash} />

      {/* ── DEBUG overlay (?debug=1) — remove after mobile audio fix ── */}
      {debugInfo && (
        <div style={{
          position: "fixed", bottom: 0, left: 0,
          background: "#000", color: "#fff",
          fontFamily: "monospace", fontSize: 10,
          padding: 10, zIndex: 9999, opacity: 0.85,
          lineHeight: 1.4, pointerEvents: "none", whiteSpace: "pre",
        }}>
          <div>ctx.state:        {debugInfo.ctxState}</div>
          <div>ctx.currentTime:  {debugInfo.ctxTime.toFixed(3)}</div>
          <div>schedule start:   {debugInfo.scheduleStartTime.toFixed(3)}</div>
          <div>beats scheduled:  {debugInfo.scheduledCount}</div>
          <div>phase:            {phase}</div>
          <div>isSafari:         {String(debugInfo.isSafari)}</div>
        </div>
      )}

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
          {/* PaywallScreen now handles geo-pricing internally — no extra props needed */}
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
                onClick={() => {
                  if (isPlaying) { stopPlay(); }
                  else { engine.warmUp(); startPlay(null); }
                }}
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
