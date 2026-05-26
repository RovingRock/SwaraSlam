import { createClient } from "@supabase/supabase-js";

// ─── Supabase (anon — used for all user-facing operations) ────────────────────
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ─── Supabase Admin (service role — used ONLY for AdminDashboard reads) ───────
// IMPORTANT: VITE_SUPABASE_SERVICE_ROLE_KEY must be set in your .env file.
// This key bypasses RLS. Never expose it to end users.
// The AdminDashboard component is only reachable via ?admin=true in the URL.
//
// FIX 1a — storageKey isolation:
// Two createClient() calls against the same project URL share the same
// localStorage key ("sb-<ref>-auth-token") by default in supabase-js v2.
// The service-role client has no user session; without isolation it can
// overwrite the anon client's stored JWT with null on initialisation,
// silently invalidating auth and breaking confirmation email flows.
// Setting a unique storageKey keeps the two clients' token storage separate.
export const supabaseAdmin = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: {
      persistSession:    false,   // service-role client never needs a persisted session
      autoRefreshToken:  false,   // no token to refresh
      detectSessionInUrl: false,  // don't let it intercept auth callback URLs
      storageKey: "sb-admin-auth-token", // isolated key — never conflicts with anon client
    },
  }
);
