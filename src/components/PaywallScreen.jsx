import { useState, useEffect } from "react";
import { getPriceId, getDisplayPrice } from "../constants/pricing";

// ─── Paywall Screen ───────────────────────────────────────────────────────────
// ABSOLUTE SOURCE OF TRUTH: reads localStorage directly.
// Profile fetch errors (HTTP 400, RLS gaps, network failures) have zero effect
// on what this component displays. Database state is never consulted here.
export default function PaywallScreen({ onCheckout, redirecting, redirectingPriceId }) {
  // ── Geographic pricing state ──────────────────────────────────────────────
  // userCountry: ISO 3166-1 alpha-2 code ("IN", "SG", "US", etc.)
  // Defaults to null while geolocation is in flight; falls back to "US" on error.
  // pricesLoaded: gates rendering of the pricing cards so we never flash wrong prices.
  const [userCountry,  setUserCountry]  = useState(null);
  const [pricesLoaded, setPricesLoaded] = useState(false);

  useEffect(() => {
    // ipapi.co free tier: 1000 req/day, no API key required.
    // Falls back to "US" (default USD pricing) on any network or parse error.
    fetch("https://ipapi.co/json/")
      .then(res => res.json())
      .then(data => {
        setUserCountry(data.country_code || "US");
        setPricesLoaded(true);
      })
      .catch(() => {
        setUserCountry("US");
        setPricesLoaded(true);
      });
  }, []);

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

  // Resolve the price IDs for the current user country.
  // These are stable once pricesLoaded is true — no risk of mid-click drift.
  const lifetimePriceId = pricesLoaded ? getPriceId(userCountry, "lifetime") : null;
  const hourPriceId     = pricesLoaded ? getPriceId(userCountry, "24hour")   : null;

  return (
    <div style={{width:"100%",maxWidth:480,margin:"0 auto",display:"flex",flexDirection:"column",alignItems:"center",gap:20,padding:"32px 16px"}}>
      <div style={{fontSize:44}}>🔒</div>
      <h2 style={{fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:600,color:"#1C1A17",margin:0,textAlign:"center"}}>Unlock All 4 Levels</h2>
      <p style={{fontFamily:"'DM Sans',sans-serif",fontSize:14,color:"#6B6560",textAlign:"center",margin:0,maxWidth:360,lineHeight:1.6}}>{dynamicSubtitle}</p>

      {/* Loading state — shown while ipapi.co resolves (~200–400ms) */}
      {!pricesLoaded && (
        <div style={{display:"flex",gap:8,alignItems:"center",padding:"32px 0",color:"#9A7B50",fontFamily:"'DM Sans',sans-serif",fontSize:13}}>
          {[0,1,2].map(i => (
            <div key={i} style={{width:7,height:7,borderRadius:"50%",background:"#9A7B50",animation:`micPulse 1.4s ease-in-out ${i*0.22}s infinite`}}/>
          ))}
          <span style={{marginLeft:6}}>Loading prices…</span>
        </div>
      )}

      {/* Pricing cards — only rendered after country is resolved */}
      {pricesLoaded && (
        <div style={{display:"flex",gap:16,flexWrap:"wrap",justifyContent:"center",width:"100%",marginTop:8}}>
          {/* ── 24-HOUR PASS ── */}
          <div style={{background:"#fff",border:"1.5px solid #E5DFD3",borderRadius:14,padding:"22px 20px",flex:"1 1 180px",maxWidth:220,textAlign:"center"}}>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#9A7B50",fontWeight:700,letterSpacing:".12em",marginBottom:8}}>24-HOUR PASS</div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,fontWeight:600,color:"#1C1A17",lineHeight:1,marginBottom:4}}>
              {getDisplayPrice(userCountry, "24hour")}
            </div>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#6B6560",marginBottom:16}}>Try all levels for a day</div>
            <button disabled={redirecting} onClick={() => onCheckout(hourPriceId)}
              style={{...btnBase,background:"#9A7B50",opacity:isRedirecting(hourPriceId)?0.6:redirecting?0.3:1}}>
              {isRedirecting(hourPriceId) ? "Redirecting…" : "Get 24-Hour Access"}
            </button>
          </div>

          {/* ── LIFETIME ACCESS ── */}
          <div style={{background:"linear-gradient(135deg,rgba(192,95,47,0.08),rgba(154,123,80,0.08))",border:"2px solid #C05F2F",borderRadius:14,padding:"22px 20px",flex:"1 1 180px",maxWidth:220,textAlign:"center",position:"relative"}}>
            <div style={{position:"absolute",top:-12,left:"50%",transform:"translateX(-50%)",background:"#C05F2F",color:"#fff",padding:"3px 12px",borderRadius:20,fontSize:10,fontWeight:700,fontFamily:"'DM Sans',sans-serif",whiteSpace:"nowrap"}}>BEST VALUE</div>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:11,color:"#C05F2F",fontWeight:700,letterSpacing:".12em",marginBottom:8}}>LIFETIME ACCESS</div>
            <div style={{fontFamily:"'Cormorant Garamond',serif",fontSize:38,fontWeight:600,color:"#C05F2F",lineHeight:1,marginBottom:4}}>
              {getDisplayPrice(userCountry, "lifetime")}
            </div>
            <div style={{fontFamily:"'DM Sans',sans-serif",fontSize:12,color:"#6B6560",marginBottom:16}}>Unlock forever</div>
            <button disabled={redirecting} onClick={() => onCheckout(lifetimePriceId)}
              style={{...btnBase,background:"#C05F2F",boxShadow:"0 4px 12px rgba(192,95,47,0.3)",opacity:isRedirecting(lifetimePriceId)?0.6:redirecting?0.3:1}}>
              {isRedirecting(lifetimePriceId) ? "Redirecting…" : "✦ Get Lifetime Access"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
