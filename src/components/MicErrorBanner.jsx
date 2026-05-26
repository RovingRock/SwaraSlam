// ─── MicErrorBanner ───────────────────────────────────────────────────────────
// Shown inside the game UI when usePitchDetection reports a mic error.
// Dismissible via the × button; has a Retry button that calls retryMic().
export default function MicErrorBanner({ message, onRetry, onDismiss }) {
  return (
    <div style={{
      width: "100%",
      maxWidth: 480,
      backgroundColor: "rgba(192,95,47,0.08)",
      border: "1px solid rgba(192,95,47,0.28)",
      borderRadius: 10,
      padding: "10px 14px",
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontFamily: "'DM Sans',sans-serif",
      fontSize: 12,
      color: "#7A3A18",
      lineHeight: 1.5,
    }}>
      {/* Warning icon */}
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C05F2F"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
      </svg>

      <span style={{flex:1}}>{message}</span>

      {/* Retry button */}
      <button
        onClick={onRetry}
        style={{
          flexShrink: 0,
          fontFamily: "'DM Sans',sans-serif",
          fontSize: 11,
          fontWeight: 600,
          color: "#C05F2F",
          background: "none",
          border: "1.5px solid rgba(192,95,47,0.4)",
          borderRadius: 6,
          padding: "4px 10px",
          cursor: "pointer",
          letterSpacing: ".04em",
          whiteSpace: "nowrap",
        }}
      >
        Retry
      </button>

      {/* Dismiss × */}
      <button
        onClick={onDismiss}
        aria-label="Dismiss"
        style={{
          flexShrink: 0,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "rgba(192,95,47,0.5)",
          padding: 2,
          lineHeight: 0,
        }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
        </svg>
      </button>
    </div>
  );
}
