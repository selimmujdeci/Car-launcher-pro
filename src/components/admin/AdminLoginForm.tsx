/**
 * AdminLoginForm — Super Admin Giriş ve Şifre Sıfırlama Formu
 *
 * Modlar:
 *   'login'        → E-posta + Şifre + "Şifremi Unuttum" bağlantısı
 *   'reset-request'→ Sadece e-posta, sıfırlama e-postası gönder
 *   'reset-confirm'→ Yeni şifre belirle (deep link / recovery)
 *
 * Güvenlik:
 *   Şifreler loglanmaz.
 *   Hata mesajları mühendislik terminolojisiyle gösterilir.
 */

import { useState } from 'react';
import { ShieldAlert, Loader2, CheckCircle, Eye, EyeOff, ExternalLink } from 'lucide-react';
import { useRoleStore } from '../../platform/roleSystem/RoleStore';
import { SUPABASE_URL } from '../../platform/supabaseClient';

// ── Renkler ───────────────────────────────────────────────────────────────────
const BG    = '#0a0a0a';
const SURF  = '#111111';
const BORD  = '#1c1c1c';
const TEXT  = '#e5e7eb';
const MUTED = '#4b5563';
const DIM   = '#2d3748';
const RED   = '#dc2626';
const GREEN = '#4ade80';
const BLUE  = '#60a5fa';

// ── AdminLoginForm ────────────────────────────────────────────────────────────

interface Props {
  mode: 'login' | 'reset-request' | 'reset-confirm';
}

export function AdminLoginForm({ mode: initialMode }: Props) {
  const {
    signInAdmin, resetPassword, updatePassword,
    authError, clearAuthError,
    adminAuthState,
  } = useRoleStore();

  const [mode,       setMode]       = useState<'login' | 'reset-request' | 'reset-confirm'>(initialMode);
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [newPw,      setNewPw]      = useState('');
  const [newPwConfirm, setNewPwConfirm] = useState('');
  const [showPw,     setShowPw]     = useState(false);
  const [resetSent,  setResetSent]  = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const isLoading = adminAuthState === 'signing_in' || adminAuthState === 'updating_pw';
  const error     = localError ?? authError;

  async function handleLogin() {
    if (!email.trim() || !password) {
      setLocalError('INPUT_MISSING: E-posta ve şifre zorunlu');
      return;
    }
    clearAuthError();
    setLocalError(null);
    await signInAdmin(email.trim(), password);
    setPassword(''); // şifreyi bellekten temizle
  }

  async function handleReset() {
    if (!email.trim()) {
      setLocalError('INPUT_MISSING: E-posta zorunlu');
      return;
    }
    clearAuthError();
    setLocalError(null);
    const ok = await resetPassword(email.trim());
    if (ok) setResetSent(true);
  }

  async function handleUpdatePassword() {
    if (!newPw || newPw.length < 8) {
      setLocalError('PW_TOO_SHORT: Şifre en az 8 karakter olmalı');
      return;
    }
    if (newPw !== newPwConfirm) {
      setLocalError('PW_MISMATCH: Şifreler eşleşmiyor');
      return;
    }
    clearAuthError();
    setLocalError(null);
    await updatePassword(newPw);
    setNewPw('');
    setNewPwConfirm('');
  }

  return (
    <div style={{
      flex:           1,
      display:        'flex',
      alignItems:     'center',
      justifyContent: 'center',
      background:      BG,
      padding:         24,
      fontFamily:     'system-ui, sans-serif',
    }}>
      <div style={{
        width:     '100%',
        maxWidth:   360,
        background:  SURF,
        border:     `1px solid ${BORD}`,
        borderRadius: 6,
        overflow:   'hidden',
      }}>

        {/* Header */}
        <div style={{
          padding:      '14px 18px',
          borderBottom: `1px solid ${BORD}`,
          background:   '#080808',
          display:      'flex',
          alignItems:   'center',
          gap:           10,
        }}>
          <div style={{
            width:32, height:32, borderRadius:8,
            background:'rgba(220,38,38,0.1)', border:`1px solid rgba(220,38,38,0.25)`,
            display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0,
          }}>
            <ShieldAlert size={16} style={{ color:RED }} />
          </div>
          <div>
            <p style={{ fontFamily:'monospace', fontSize:10, fontWeight:700,
              color:RED, letterSpacing:'0.12em', textTransform:'uppercase' }}>
              {mode === 'login'          && 'ADMIN_AUTH'}
              {mode === 'reset-request'  && 'RESET_PASSWORD'}
              {mode === 'reset-confirm'  && 'NEW_PASSWORD'}
            </p>
            <p style={{ fontSize:9, color:DIM, fontFamily:'monospace', marginTop:2 }}>
              {mode === 'login'         && 'Super Admin giriş paneli'}
              {mode === 'reset-request' && 'Sıfırlama e-postası gönder'}
              {mode === 'reset-confirm' && 'Kurtarma bağlantısı aktif'}
            </p>
          </div>
        </div>

        {/* Body */}
        <div style={{ padding:'16px 18px', display:'flex', flexDirection:'column', gap:12 }}>

          {/* ── LOGIN MODU ─────────────────────────────────────────────── */}
          {mode === 'login' && (
            <>
              <FormField
                label="E-POSTA"
                type="email"
                value={email}
                onChange={setEmail}
                placeholder="admin@carospro.com"
                disabled={isLoading}
              />
              <div style={{ position:'relative' }}>
                <FormField
                  label="ŞİFRE"
                  type={showPw ? 'text' : 'password'}
                  value={password}
                  onChange={setPassword}
                  placeholder="••••••••"
                  disabled={isLoading}
                  onEnter={() => { void handleLogin(); }}
                />
                <button
                  onClick={() => setShowPw((v) => !v)}
                  style={{
                    position:'absolute', right:10, bottom:9,
                    background:'transparent', border:'none', cursor:'pointer',
                    color:MUTED, padding:2,
                  }}
                >
                  {showPw ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>

              {error && <ErrorMsg msg={error} />}

              <ActionBtn
                label={isLoading ? 'DOĞRULANIYORU...' : 'GİRİŞ YAP'}
                loading={isLoading}
                color={BLUE}
                onClick={() => { void handleLogin(); }}
                disabled={isLoading}
              />

              <button
                onClick={() => { setMode('reset-request'); clearAuthError(); setLocalError(null); }}
                style={{
                  background:'transparent', border:'none', cursor:'pointer',
                  color:MUTED, fontFamily:'monospace', fontSize:9,
                  letterSpacing:'0.06em', textAlign:'center', padding:'2px 0',
                  textDecoration:'underline', textDecorationColor:DIM,
                }}
              >
                ŞİFREMİ UNUTTUM
              </button>
            </>
          )}

          {/* ── RESET REQUEST MODU ────────────────────────────────────── */}
          {mode === 'reset-request' && (
            <>
              {resetSent ? (
                <div style={{
                  display:'flex', alignItems:'center', gap:8,
                  padding:'10px 12px',
                  background:'rgba(74,222,128,0.06)', border:`1px solid rgba(74,222,128,0.2)`,
                  borderRadius:4,
                }}>
                  <CheckCircle size={13} style={{ color:GREEN, flexShrink:0 }} />
                  <p style={{ fontFamily:'monospace', fontSize:9, color:GREEN, letterSpacing:'0.06em' }}>
                    RESET_SENT: E-posta gönderildi. Gelen kutunuzu kontrol edin.
                  </p>
                </div>
              ) : (
                <FormField
                  label="E-POSTA"
                  type="email"
                  value={email}
                  onChange={setEmail}
                  placeholder="admin@carospro.com"
                  disabled={isLoading}
                />
              )}

              {error && !resetSent && <ResetErrorBlock msg={error} email={email} />}

              {!resetSent && (
                <ActionBtn
                  label={isLoading ? 'GÖNDERİLİYOR...' : 'SIFIRLAMA LİNKİ GÖNDER'}
                  loading={isLoading}
                  color={BLUE}
                  onClick={() => { void handleReset(); }}
                  disabled={isLoading}
                />
              )}

              <button
                onClick={() => { setMode('login'); clearAuthError(); setLocalError(null); setResetSent(false); }}
                style={{
                  background:'transparent', border:'none', cursor:'pointer',
                  color:MUTED, fontFamily:'monospace', fontSize:9,
                  letterSpacing:'0.06em', textAlign:'center', padding:'2px 0',
                  textDecoration:'underline', textDecorationColor:DIM,
                }}
              >
                ← GİRİŞ SAYFASINA DÖN
              </button>
            </>
          )}

          {/* ── RESET CONFIRM MODU (deep link) ────────────────────────── */}
          {mode === 'reset-confirm' && (
            <>
              <div style={{
                padding:'8px 12px',
                background:'rgba(96,165,250,0.06)', border:`1px solid rgba(96,165,250,0.2)`,
                borderRadius:4,
              }}>
                <p style={{ fontFamily:'monospace', fontSize:9, color:BLUE, letterSpacing:'0.06em' }}>
                  RECOVERY_ACTIVE: Kurtarma bağlantısı ile yönlendirildiniz.
                </p>
              </div>

              <div style={{ position:'relative' }}>
                <FormField
                  label="YENİ ŞİFRE"
                  type={showPw ? 'text' : 'password'}
                  value={newPw}
                  onChange={setNewPw}
                  placeholder="En az 8 karakter"
                  disabled={isLoading}
                />
                <button
                  onClick={() => setShowPw((v) => !v)}
                  style={{
                    position:'absolute', right:10, bottom:9,
                    background:'transparent', border:'none', cursor:'pointer',
                    color:MUTED, padding:2,
                  }}
                >
                  {showPw ? <EyeOff size={12} /> : <Eye size={12} />}
                </button>
              </div>

              <FormField
                label="ŞİFRE TEKRAR"
                type="password"
                value={newPwConfirm}
                onChange={setNewPwConfirm}
                placeholder="Şifreyi tekrar gir"
                disabled={isLoading}
                onEnter={() => { void handleUpdatePassword(); }}
              />

              {error && <ErrorMsg msg={error} />}

              <ActionBtn
                label={isLoading ? 'KAYDEDİLİYOR...' : 'YENİ ŞİFREYİ KAYDET'}
                loading={isLoading}
                color={GREEN}
                onClick={() => { void handleUpdatePassword(); }}
                disabled={isLoading}
              />
            </>
          )}

        </div>

        {/* Footer — gizlilik notu */}
        <div style={{
          padding:'8px 18px',
          borderTop:`1px solid ${BORD}`,
          background:'#080808',
        }}>
          <p style={{ fontFamily:'monospace', fontSize:7, color:DIM, letterSpacing:'0.06em', textAlign:'center' }}>
            SECURE_CHANNEL · Şifreler loglanmaz · Sadece yetkili hesaplar
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Yardımcı bileşenler ───────────────────────────────────────────────────────

function FormField({
  label, type, value, onChange, placeholder, disabled, onEnter,
}: {
  label:       string
  type:        string
  value:       string
  onChange:    (v: string) => void
  placeholder: string
  disabled:    boolean
  onEnter?:    () => void
}) {
  return (
    <div>
      <p style={{
        fontFamily:    'monospace',
        fontSize:       8,
        fontWeight:     700,
        color:          MUTED,
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        marginBottom:   5,
      }}>
        {label}
      </p>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter' && onEnter) onEnter(); }}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={type === 'password' ? 'current-password' : 'email'}
        style={{
          width:       '100%',
          padding:     '8px 10px',
          background:  '#080808',
          border:      `1px solid ${BORD}`,
          borderRadius: 4,
          color:        TEXT,
          fontFamily:  'monospace',
          fontSize:     12,
          outline:     'none',
          boxSizing:   'border-box',
          opacity:      disabled ? 0.5 : 1,
          transition:  'border-color 150ms ease',
        }}
        onFocus={(e) => { e.currentTarget.style.borderColor = '#374151'; }}
        onBlur={(e)  => { e.currentTarget.style.borderColor = BORD; }}
      />
    </div>
  );
}

function ActionBtn({
  label, loading, color, onClick, disabled,
}: {
  label:    string
  loading:  boolean
  color:    string
  onClick:  () => void
  disabled: boolean
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width:         '100%',
        padding:       '10px 14px',
        background:    `${color}10`,
        border:        `1px solid ${color}40`,
        borderRadius:   4,
        cursor:         disabled ? 'not-allowed' : 'pointer',
        display:       'flex',
        alignItems:    'center',
        justifyContent: 'center',
        gap:            8,
        color,
        fontFamily:    'monospace',
        fontSize:       10,
        fontWeight:     700,
        letterSpacing: '0.10em',
        textTransform: 'uppercase',
        opacity:        disabled ? 0.6 : 1,
        transition:    'opacity 150ms ease',
      }}
    >
      {loading && <Loader2 size={12} style={{ animation:'spin 1s linear infinite' }} />}
      {label}
    </button>
  );
}

function ErrorMsg({ msg }: { msg: string }) {
  return (
    <div style={{
      padding:     '7px 10px',
      background:  'rgba(220,38,38,0.06)',
      border:      `1px solid rgba(220,38,38,0.2)`,
      borderRadius: 4,
    }}>
      <p style={{ fontFamily:'monospace', fontSize:9, color:RED, letterSpacing:'0.04em' }}>
        {msg}
      </p>
    </div>
  );
}

/** Reset hatası + Supabase dashboard direktif kutusu */
function ResetErrorBlock({ msg, email }: { msg: string; email: string }) {
  // SUPABASE_URL → https://abcxyz.supabase.co → proje ref = abcxyz
  const projectRef = SUPABASE_URL
    ? (SUPABASE_URL.replace('https://', '').split('.')[0] ?? '')
    : '';
  const dashUrl = projectRef
    ? `https://supabase.com/dashboard/project/${projectRef}/auth/users`
    : 'https://supabase.com/dashboard';

  return (
    <div style={{
      padding:     '10px 12px',
      background:  'rgba(220,38,38,0.06)',
      border:      `1px solid rgba(220,38,38,0.25)`,
      borderRadius: 4,
      display:     'flex',
      flexDirection:'column',
      gap:          8,
    }}>
      <p style={{ fontFamily:'monospace', fontSize:9, color:RED, letterSpacing:'0.04em' }}>
        {msg}
      </p>
      <div style={{
        padding:     '8px 10px',
        background:  'rgba(255,255,255,0.03)',
        border:      '1px solid rgba(255,255,255,0.08)',
        borderRadius: 3,
      }}>
        <p style={{ fontFamily:'monospace', fontSize:8, color:'#9ca3af', letterSpacing:'0.06em', marginBottom:6 }}>
          MANUEL ÇÖZÜM:
        </p>
        <p style={{ fontFamily:'monospace', fontSize:8, color:'#6b7280', lineHeight:1.6 }}>
          1. Supabase Dashboard → Authentication → Users<br />
          2. {email || 'E-posta adresinizi'} arayın<br />
          3. &ldquo;Send Password Recovery&rdquo; veya<br />
          &nbsp;&nbsp;&nbsp;&ldquo;Reset Password&rdquo; tıklayın
        </p>
      </div>
      <a
        href={dashUrl}
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          gap:             5,
          padding:        '7px 10px',
          background:     'rgba(96,165,250,0.08)',
          border:         '1px solid rgba(96,165,250,0.25)',
          borderRadius:    3,
          color:           BLUE,
          fontFamily:     'monospace',
          fontSize:        9,
          fontWeight:      700,
          letterSpacing:  '0.08em',
          textDecoration: 'none',
          cursor:          'pointer',
        }}
      >
        <ExternalLink size={10} />
        SUPABASE DASHBOARD AÇ
      </a>
    </div>
  );
}
