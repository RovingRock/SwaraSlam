import { useState, useEffect, useCallback } from "react";
import { supabaseAdmin } from "../utils/supabaseClients";

// ─── AdminDashboard ───────────────────────────────────────────────────────────
// Protected admin view. Only rendered when showAdmin === true (set via ?admin=true URL param).
// Uses supabaseAdmin (service role) to bypass RLS and read all feedback rows.
// Status updates also use supabaseAdmin so they succeed regardless of user auth state.
export default function AdminDashboard({ onClose }) {
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState("");
  const [filter,     setFilter]     = useState("all"); // "all" | "new" | "reviewed" | "archived"
  const [updating,   setUpdating]   = useState(null);  // row id being updated

  const STATUS_OPTIONS = ["new", "reviewed", "archived"];

  const fetchFeedback = useCallback(async () => {
    setLoading(true); setError("");
    try {
      let q = supabaseAdmin
        .from("feedback")
        .select("*")
        .order("created_at", { ascending: false });
      if (filter !== "all") q = q.eq("status", filter);
      const { data, error: err } = await q;
      if (err) throw err;
      setRows(data || []);
    } catch (e) {
      setError("Failed to load feedback: " + (e.message || String(e)));
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => { fetchFeedback(); }, [fetchFeedback]);

  const handleStatusChange = async (id, newStatus) => {
    setUpdating(id);
    try {
      const { error: err } = await supabaseAdmin
        .from("feedback")
        .update({ status: newStatus })
        .eq("id", id);
      if (err) throw err;
      setRows(prev => prev.map(r => r.id === id ? { ...r, status: newStatus } : r));
    } catch (e) {
      alert("Status update failed: " + e.message);
    } finally {
      setUpdating(null);
    }
  };

  const s = {
    overlay:  { position:"fixed",inset:0,backgroundColor:"rgba(28,26,23,0.92)",zIndex:999999,overflowY:"auto",fontFamily:"'DM Sans',sans-serif" },
    container:{ maxWidth:860,margin:"0 auto",padding:"32px 24px 48px" },
    header:   { display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:28,borderBottom:"1px solid rgba(255,255,255,.1)",paddingBottom:20 },
    title:    { fontFamily:"'Cormorant Garamond',serif",fontSize:30,fontWeight:600,color:"#F9F7F2",margin:0 },
    sub:      { fontSize:12,color:"rgba(249,247,242,.45)",letterSpacing:".1em",marginTop:4 },
    closeBtn: { background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.12)",color:"#F9F7F2",width:36,height:36,borderRadius:"50%",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0 },
    filterRow:{ display:"flex",gap:8,marginBottom:20,flexWrap:"wrap" },
    filterBtn:{ fontFamily:"'DM Sans',sans-serif",fontSize:12,fontWeight:500,padding:"6px 16px",borderRadius:99,cursor:"pointer",transition:"background .15s,color .15s,border-color .15s",letterSpacing:".04em" },
    table:    { width:"100%",borderCollapse:"collapse" },
    th:       { fontFamily:"'DM Sans',sans-serif",fontSize:10,fontWeight:600,letterSpacing:".14em",textTransform:"uppercase",color:"rgba(154,123,80,1)",padding:"8px 12px",textAlign:"left",borderBottom:"1px solid rgba(255,255,255,.08)" },
    td:       { fontSize:13,color:"rgba(249,247,242,.8)",padding:"12px 12px",borderBottom:"1px solid rgba(255,255,255,.05)",verticalAlign:"top",lineHeight:1.55 },
    statusSel:{ fontFamily:"'DM Sans',sans-serif",fontSize:12,padding:"4px 8px",borderRadius:6,border:"1px solid rgba(255,255,255,.15)",background:"rgba(255,255,255,.06)",color:"#F9F7F2",cursor:"pointer",outline:"none" },
    badge:    { display:"inline-block",fontSize:10,fontWeight:600,letterSpacing:".1em",padding:"2px 8px",borderRadius:99,textTransform:"uppercase" },
    emptyMsg: { textAlign:"center",color:"rgba(249,247,242,.35)",padding:"40px 0",fontSize:14 },
  };

  const badgeStyle = (status) => {
    if (status === "new")      return { background:"rgba(192,95,47,.2)",color:"#E07040" };
    if (status === "reviewed") return { background:"rgba(46,125,50,.18)",color:"#4CAF50" };
    if (status === "archived") return { background:"rgba(255,255,255,.08)",color:"rgba(249,247,242,.4)" };
    return {};
  };

  const filterStyle = (f) => filter === f
    ? { background:"#9A7B50",color:"#fff",border:"1px solid #9A7B50" }
    : { background:"rgba(255,255,255,.05)",color:"rgba(249,247,242,.55)",border:"1px solid rgba(255,255,255,.12)" };

  const fmt = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    return d.toLocaleDateString("en-SG", { day:"numeric",month:"short",year:"2-digit" })
      + " " + d.toLocaleTimeString("en-SG", { hour:"2-digit",minute:"2-digit",hour12:false });
  };

  return (
    <div style={s.overlay}>
      <div style={s.container}>
        {/* Header */}
        <div style={s.header}>
          <div>
            <h1 style={s.title}>🔑 Feedback Admin</h1>
            <p style={s.sub}>Swara Slam · {rows.length} row{rows.length !== 1 ? "s" : ""} shown</p>
          </div>
          <div style={{display:"flex",gap:10,alignItems:"center"}}>
            <button style={{...s.closeBtn,width:"auto",borderRadius:8,padding:"8px 16px",fontSize:12,fontWeight:600}}
              onClick={fetchFeedback}>↻ Refresh</button>
            <button style={s.closeBtn} onClick={onClose} aria-label="Close admin">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M18 6L6 18M6 6l12 12" stroke="#F9F7F2" strokeWidth="2" strokeLinecap="round"/>
              </svg>
            </button>
          </div>
        </div>

        {/* Filter row */}
        <div style={s.filterRow}>
          {["all", ...STATUS_OPTIONS].map(f => (
            <button key={f} style={{...s.filterBtn,...filterStyle(f)}} onClick={() => setFilter(f)}>
              {f === "all" ? "All" : f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
        </div>

        {/* Loading / error / empty */}
        {loading && <p style={s.emptyMsg}>Loading…</p>}
        {!loading && error && <p style={{...s.emptyMsg,color:"#E07040"}}>{error}</p>}
        {!loading && !error && rows.length === 0 && (
          <p style={s.emptyMsg}>No feedback found{filter !== "all" ? ` with status "${filter}"` : ""}.</p>
        )}

        {/* Table */}
        {!loading && !error && rows.length > 0 && (
          <table style={s.table}>
            <thead>
              <tr>
                <th style={s.th}>Date</th>
                <th style={s.th}>User</th>
                <th style={s.th}>Feedback</th>
                <th style={{...s.th,width:130}}>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(row => (
                <tr key={row.id}>
                  <td style={{...s.td,whiteSpace:"nowrap",color:"rgba(249,247,242,.4)",fontSize:11}}>{fmt(row.created_at)}</td>
                  <td style={{...s.td,maxWidth:160,wordBreak:"break-all",fontSize:12,color:"rgba(154,123,80,1)"}}>
                    {row.user_email || "anon"}
                  </td>
                  <td style={s.td}>{row.feedback_text}</td>
                  <td style={s.td}>
                    {/* Badge for quick read */}
                    <span style={{...s.badge,...badgeStyle(row.status || "new"),marginBottom:6,display:"block",width:"fit-content"}}>
                      {row.status || "new"}
                    </span>
                    {/* Dropdown to change status */}
                    <select
                      style={{...s.statusSel, opacity: updating === row.id ? 0.5 : 1}}
                      value={row.status || "new"}
                      disabled={updating === row.id}
                      onChange={e => handleStatusChange(row.id, e.target.value)}
                    >
                      {STATUS_OPTIONS.map(opt => (
                        <option key={opt} value={opt}>{opt.charAt(0).toUpperCase() + opt.slice(1)}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
