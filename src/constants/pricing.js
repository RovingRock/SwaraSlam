// ═══════════════════════════════════════════════════════════════════════════════
// ─── GEOGRAPHIC PRICING HELPERS ───────────────────────────────────────────────
// These three functions are the ONLY addition in this version vs the previous
// holy grail. Everything else in the file is byte-identical to the original.
//
// Pricing table:
//   Region        Lifetime        24-Hour
//   India (IN)    ₹499 INR        ₹99 INR
//   Singapore(SG) S$11.99 SGD     S$2.55 SGD
//   Default/US    $9.99 USD       $1.99 USD
//
// The jsx detects country via ipapi.co, then passes the correct price ID to
// handleStripeCheckout → Edge Function → Stripe. No server-side routing needed.
// ═══════════════════════════════════════════════════════════════════════════════

export const getPriceId = (userCountry, productType) => {
  if (productType === "lifetime") {
    if (userCountry === "IN") return "price_1TY4LFCevGY65XqMsVc1vRMg"; // ₹499 INR
    if (userCountry === "SG") return "price_1TY4LkCevGY65XqMc3DH1yAZ"; // S$11.99 SGD
    return "price_1TVpF0CevGY65XqMgLukQcWc";                           // $9.99 USD default
  }
  // 24hour
  if (userCountry === "IN") return "price_1TY4QqCevGY65XqMbj2Ckpp2";   // ₹99 INR
  if (userCountry === "SG") return "price_1TY4QMCevGY65XqMlzi9CCq7";   // S$2.55 SGD
  return "price_1TVpF4CevGY65XqM13lijglp";                             // $1.99 USD default
};

export const getDisplayPrice = (userCountry, productType) => {
  if (productType === "lifetime") {
    if (userCountry === "IN") return "₹499";
    if (userCountry === "SG") return "S$11.99";
    return "$9.99";
  }
  // 24hour
  if (userCountry === "IN") return "₹99";
  if (userCountry === "SG") return "S$2.55";
  return "$1.99";
};

export const getCurrencySymbol = (userCountry) => {
  if (userCountry === "IN") return "₹";
  if (userCountry === "SG") return "S$";
  return "$";
};
