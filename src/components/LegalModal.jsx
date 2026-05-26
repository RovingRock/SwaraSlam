import { useState } from "react";

// ─── Legal Modal (Terms & Privacy) ────────────────────────────────────────────
export default function LegalModal({ onClose }) {
  const [tab, setTab] = useState("terms");

  const s = {
    overlay:   { position:"fixed",inset:0,backgroundColor:"rgba(28,26,23,0.88)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:999999,backdropFilter:"blur(5px)",padding:"1rem" },
    modal:     { backgroundColor:"#F9F7F2",borderRadius:16,padding:"32px",maxWidth:680,width:"100%",maxHeight:"85vh",display:"flex",flexDirection:"column",boxShadow:"0 20px 60px rgba(192,95,47,0.22)",position:"relative",border:"2px solid #9A7B50" },
    closeBtn:  { position:"absolute",top:12,right:12,background:"none",border:"none",cursor:"pointer",padding:8,opacity:0.45,lineHeight:0 },
    heading:   { fontFamily:"'Cormorant Garamond',serif",fontSize:28,fontWeight:600,color:"#1C1A17",margin:"0 0 16px",textAlign:"center" },
    tabs:      { display:"flex",gap:8,marginBottom:20,borderBottom:"1.5px solid #E5DFD3",paddingBottom:2 },
    tab:       { fontFamily:"'DM Sans',sans-serif",fontSize:14,fontWeight:600,padding:"8px 16px",background:"none",border:"none",cursor:"pointer",color:"#6B6560",borderBottom:"2.5px solid transparent",marginBottom:-2,transition:"color .15s, border-color .15s" },
    tabActive: { color:"#C05F2F",borderBottomColor:"#C05F2F" },
    content:   { fontFamily:"'DM Sans',sans-serif",fontSize:14,color:"#3C3935",lineHeight:1.7,overflowY:"auto",flex:1,paddingRight:8 },
    h2:        { fontFamily:"'Cormorant Garamond',serif",fontSize:20,fontWeight:600,color:"#1C1A17",marginTop:24,marginBottom:10 },
    h3:        { fontFamily:"'DM Sans',sans-serif",fontSize:15,fontWeight:600,color:"#1C1A17",marginTop:18,marginBottom:8 },
    p:         { marginBottom:14 },
    ul:        { paddingLeft:22,marginBottom:14 },
    li:        { marginBottom:6 },
  };

  const termsContent = (
    <div>
      <p style={s.p}><strong>Effective Date:</strong> May 14, 2026<br/><strong>Last Updated:</strong> May 14, 2026</p>
      <p style={s.p}>Welcome to <strong>Swara Slam</strong>, a Hindustani Classical Music practice application operated by <strong>RaagGuru</strong> ("we," "us," or "our"). By accessing or using Swara Slam (the "App"), you agree to be bound by these Terms & Conditions. If you do not agree, do not use the App.</p>
      <h2 style={s.h2}>1. Intellectual Property & Ownership</h2>
      <p style={s.p}>All content, features, and functionality of Swara Slam — including but not limited to the "Slam" branding, pitch-detection algorithms, audio synthesis logic, user interface design, gamification mechanics, and scoring systems — are the exclusive property of RaagGuru and are protected by international copyright, trademark, and other intellectual property laws.</p>
      <p style={s.p}><strong>You may not:</strong></p>
      <ul style={s.ul}>
        <li style={s.li}>Reverse-engineer, decompile, or disassemble any part of the App's pitch-detection or audio generation logic.</li>
        <li style={s.li}>Extract, copy, or redistribute the App's proprietary algorithms or training data.</li>
        <li style={s.li}>Use the "Swara Slam" name, logo, or branding without our prior written consent.</li>
        <li style={s.li}>Create derivative works, clones, or competing products based on the App's functionality.</li>
      </ul>
      <h2 style={s.h2}>2. License to Use</h2>
      <p style={s.p}>Subject to your compliance with these Terms, RaagGuru grants you a limited, non-exclusive, non-transferable, revocable license to access and use Swara Slam for your personal, non-commercial practice and training purposes.</p>
      <h2 style={s.h2}>3. Right to Modify, Suspend, or Terminate</h2>
      <p style={s.p}><strong>RaagGuru reserves the right to modify, suspend, or discontinue Swara Slam (or any part of it) at any time, with or without notice, for any reason.</strong> We may update features, change pricing, alter content, or terminate the service entirely without liability to you or any third party.</p>
      <p style={s.p}>We also reserve the right to terminate or suspend your access to the App at our sole discretion if we believe you have violated these Terms or engaged in conduct harmful to the App, other users, or RaagGuru's interests.</p>
      <h2 style={s.h2}>4. User Conduct</h2>
      <p style={s.p}>You agree to use the App responsibly and lawfully. Prohibited conduct includes:</p>
      <ul style={s.ul}>
        <li style={s.li}>Attempting to hack, scrape, or exploit the App's infrastructure.</li>
        <li style={s.li}>Uploading malicious code or engaging in activity that disrupts the App's functionality.</li>
        <li style={s.li}>Impersonating other users or providing false information during account creation.</li>
        <li style={s.li}>Using the App for any unlawful purpose or in violation of any applicable regulations.</li>
      </ul>
      <h2 style={s.h2}>5. Payment & Subscriptions</h2>
      <p style={s.p}>Certain features of Swara Slam require payment ("Premium Access"). All payments are processed securely through Stripe. By purchasing Premium Access, you agree to Stripe's terms and authorize RaagGuru to charge your selected payment method.</p>
      <p style={s.p}><strong>Refund Policy:</strong> All sales are final. We do not offer refunds for Premium Access purchases except as required by law.</p>
      <h2 style={s.h2}>6. No Warranty & Disclaimer</h2>
      <p style={s.p}><strong>THE APP IS PROVIDED "AS IS" AND "AS AVAILABLE" WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED.</strong> RaagGuru makes no guarantees regarding:</p>
      <ul style={s.ul}>
        <li style={s.li}>The accuracy of pitch detection or scoring.</li>
        <li style={s.li}>Uninterrupted or error-free operation.</li>
        <li style={s.li}>Compatibility with all devices or browsers.</li>
        <li style={s.li}>Results, progress, or skill improvement from using the App.</li>
      </ul>
      <p style={s.p}><strong>Health & Safety:</strong> Vocal practice can cause strain. Use the App responsibly and stop immediately if you experience discomfort. RaagGuru is not liable for any vocal injury, hearing damage, or hardware issues arising from your use of the App.</p>
      <h2 style={s.h2}>7. Limitation of Liability</h2>
      <p style={s.p}>TO THE MAXIMUM EXTENT PERMITTED BY LAW, RAAGGURU SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF PROFITS, REVENUE, DATA, OR USE, ARISING FROM YOUR USE OF THE APP, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</p>
      <h2 style={s.h2}>8. Indemnification</h2>
      <p style={s.p}>You agree to indemnify and hold harmless RaagGuru, its affiliates, and their respective officers, directors, and employees from any claims, damages, or expenses arising from your use of the App or violation of these Terms.</p>
      <h2 style={s.h2}>9. Governing Law</h2>
      <p style={s.p}>These Terms are governed by the laws of Singapore, without regard to its conflict of law principles. Any disputes shall be resolved exclusively in the courts of Singapore.</p>
      <h2 style={s.h2}>10. Changes to Terms</h2>
      <p style={s.p}>We may update these Terms from time to time. Continued use of the App after changes constitutes acceptance of the revised Terms. We will notify users of material changes via email or in-app notification.</p>
      <h2 style={s.h2}>11. Contact</h2>
      <p style={s.p}>For questions about these Terms, contact us via the in-app feedback feature or email <strong>legal@raagguru.com</strong> (placeholder).</p>
    </div>
  );

  const privacyContent = (
    <div>
      <p style={s.p}><strong>Effective Date:</strong> May 14, 2026<br/><strong>Last Updated:</strong> May 14, 2026</p>
      <p style={s.p}>RaagGuru ("we," "us," or "our") respects your privacy. This Privacy Policy explains how we collect, use, and protect your information when you use <strong>Swara Slam</strong> (the "App").</p>
      <h2 style={s.h2}>1. Information We Collect</h2>
      <h3 style={s.h3}>a. Account Information</h3>
      <p style={s.p}>When you create an account, we collect your <strong>email address</strong> and a securely hashed <strong>password</strong> (via Supabase authentication). Your email is used for account management, password recovery, and transactional communications.</p>
      <h3 style={s.h3}>b. Usage Data</h3>
      <p style={s.p}>We collect information about how you interact with the App, including:</p>
      <ul style={s.ul}>
        <li style={s.li}>Level progress, set completion, and scoring data.</li>
        <li style={s.li}>Pitch detection metrics (note accuracy, timing, BPM settings).</li>
        <li style={s.li}>Session duration and feature usage (e.g., Tanpura drone on/off, Sa pitch selection).</li>
      </ul>
      <h3 style={s.h3}>c. Device & Browser Information</h3>
      <p style={s.p}>We may collect technical information such as your browser type, device model, operating system, IP address, and screen resolution.</p>
      <h3 style={s.h3}>d. Cookies & Analytics</h3>
      <ul style={s.ul}>
        <li style={s.li}><strong>Essential Cookies:</strong> Required for authentication and session management (e.g., Supabase session tokens).</li>
        <li style={s.li}><strong>Analytics Cookies:</strong> Used to understand user behavior and improve the App (e.g., Google Analytics, Facebook Pixel — to be implemented).</li>
        <li style={s.li}><strong>Preference Cookies:</strong> Store your settings (e.g., cookie consent, walkthrough dismissal).</li>
      </ul>
      <h3 style={s.h3}>e. Microphone Access</h3>
      <p style={s.p}>The App requests <strong>microphone access</strong> to enable real-time pitch detection. Audio is processed locally in your browser and is <strong>not recorded, stored, or transmitted</strong> to our servers.</p>
      <h3 style={s.h3}>f. Feedback Submissions</h3>
      <p style={s.p}>When you submit feedback via the in-app modal, we collect your <strong>user ID</strong> (if logged in), <strong>email address</strong>, and the <strong>feedback text</strong>.</p>
      <h2 style={s.h2}>2. How We Use Your Information</h2>
      <ul style={s.ul}>
        <li style={s.li}>Provide, operate, and maintain the App.</li>
        <li style={s.li}>Personalize your practice experience.</li>
        <li style={s.li}>Process payments and manage subscriptions (via Stripe).</li>
        <li style={s.li}>Send transactional emails (e.g., password resets, payment confirmations).</li>
        <li style={s.li}>Analyze usage patterns to improve features and fix bugs.</li>
        <li style={s.li}>Respond to feedback and support inquiries.</li>
        <li style={s.li}>Comply with legal obligations and enforce our Terms & Conditions.</li>
      </ul>
      <h2 style={s.h2}>3. Information Sharing</h2>
      <p style={s.p}>We <strong>do not sell</strong> your personal information. We may share your data in the following limited circumstances:</p>
      <ul style={s.ul}>
        <li style={s.li}><strong>Service Providers:</strong> Supabase, Stripe, Vercel, future analytics providers.</li>
        <li style={s.li}><strong>Legal Compliance:</strong> If required by law or to protect our rights and safety.</li>
        <li style={s.li}><strong>Business Transfers:</strong> In the event of a merger or acquisition.</li>
      </ul>
      <h2 style={s.h2}>4. Data Security</h2>
      <ul style={s.ul}>
        <li style={s.li}>Encrypted HTTPS connections.</li>
        <li style={s.li}>Secure password hashing (bcrypt via Supabase).</li>
        <li style={s.li}>Role-based access controls (RLS) on our database.</li>
      </ul>
      <h2 style={s.h2}>5. Data Retention</h2>
      <p style={s.p}>We retain your account data for as long as your account is active. You may request account deletion via the feedback feature or <strong>privacy@raagguru.com</strong> (placeholder). Your data will be permanently removed within 30 days.</p>
      <h2 style={s.h2}>6. Your Rights</h2>
      <ul style={s.ul}>
        <li style={s.li}><strong>Access:</strong> Request a copy of your personal data.</li>
        <li style={s.li}><strong>Correction:</strong> Update or correct inaccurate information.</li>
        <li style={s.li}><strong>Deletion:</strong> Request deletion of your account and associated data.</li>
        <li style={s.li}><strong>Opt-Out:</strong> Unsubscribe from marketing emails.</li>
        <li style={s.li}><strong>Data Portability:</strong> Request your data in a machine-readable format.</li>
      </ul>
      <h2 style={s.h2}>7. Children's Privacy</h2>
      <p style={s.p}>Swara Slam is not intended for children under 13. We do not knowingly collect personal information from children.</p>
      <h2 style={s.h2}>8. International Data Transfers</h2>
      <p style={s.p}>Your data may be processed on servers outside your country of residence. By using the App, you consent to this transfer.</p>
      <h2 style={s.h2}>9. Changes to This Policy</h2>
      <p style={s.p}>We may update this Privacy Policy from time to time. Material changes will be communicated via email or in-app notification.</p>
      <h2 style={s.h2}>10. Contact Us</h2>
      <p style={s.p}>For privacy inquiries, contact us via the in-app feedback feature or email <strong>privacy@raagguru.com</strong> (placeholder).</p>
    </div>
  );

  return (
    <div style={s.overlay} onClick={onClose}>
      <div style={s.modal} onClick={e => e.stopPropagation()}>
        <button style={s.closeBtn} onClick={onClose} aria-label="Close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="#1C1A17" strokeWidth="2" strokeLinecap="round"/></svg>
        </button>
        <h1 style={s.heading}>Legal</h1>
        <div style={s.tabs}>
          <button style={{...s.tab,...(tab==="terms"?s.tabActive:{})}} onClick={()=>setTab("terms")}>Terms & Conditions</button>
          <button style={{...s.tab,...(tab==="privacy"?s.tabActive:{})}} onClick={()=>setTab("privacy")}>Privacy Policy</button>
        </div>
        <div style={s.content}>{tab === "terms" ? termsContent : privacyContent}</div>
      </div>
    </div>
  );
}
