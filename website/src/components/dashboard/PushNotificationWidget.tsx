'use client';

/**
 * PushNotificationWidget — Topbar'da push bildirim izin rozeti.
 *
 * Durumlar:
 *   unsupported → gizli (render yok)
 *   prompt      → "Hırsız Savar" butonu — OLED black + neon red
 *   subscribed  → "Bildirimler Aktif" neon pill — neon-alarm animasyonu
 *   denied      → "İzin Verilmedi" sönük gri pill
 *   error       → gizli
 *
 * Zero-Leak: mount'ta bir kez initPushEngine çağrılır.
 * İzin yalnızca kullanıcı tıklayınca istenir.
 */

import { useEffect, useState } from 'react';
import { initPushEngine, subscribe, type PushState } from '@/lib/pushEngine';

/* ── Shield alarm icon (inline SVG) ─────────────────────────── */

function AlarmShieldIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1L1.5 3v3.5C1.5 9 3.5 10.8 6 11.5 8.5 10.8 10.5 9 10.5 6.5V3L6 1z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M6 4.5v2M6 7.5v.25" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

function BellCheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M6 1a3.5 3.5 0 013.5 3.5v2L10.5 8H1.5l1-1.5V4.5A3.5 3.5 0 016 1z"
        stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"/>
      <path d="M4.5 8.5a1.5 1.5 0 003 0" stroke="currentColor" strokeWidth="1.2"/>
      <path d="M8 1.5l1.5 1.5L11 1.5" stroke="currentColor" strokeWidth="1.2"
        strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

/* ── Widget ──────────────────────────────────────────────────── */

export function PushNotificationWidget() {
  const [state,   setState]   = useState<PushState | 'loading'>('loading');
  const [working, setWorking] = useState(false);

  // Init once on mount — read current state without prompting
  useEffect(() => {
    initPushEngine().then((res) => setState(res.state));
  }, []);

  async function handleClick() {
    if (working || state === 'subscribed' || state === 'denied') return;
    setWorking(true);
    const res = await subscribe();
    setState(res.state);
    setWorking(false);
  }

  // Hide until we know the state, or if unsupported/error
  if (state === 'loading' || state === 'unsupported' || state === 'error') return null;

  /* ── Subscribed — neon red active pill ─────────────────────── */
  if (state === 'subscribed') {
    return (
      <div
        className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full select-none"
        style={{
          background: 'rgba(239,68,68,0.08)',
          border:     '1px solid rgba(239,68,68,0.22)',
        }}
        title="Push bildirimleri aktif"
      >
        {/* Neon pulse dot */}
        <span className="relative flex h-2 w-2 flex-shrink-0">
          <span
            className="animate-ping absolute inline-flex h-full w-full rounded-full"
            style={{ background: 'rgba(239,68,68,0.5)' }}
          />
          <span
            className="relative inline-flex h-2 w-2 rounded-full"
            style={{
              background: '#ef4444',
              boxShadow:  '0 0 6px #ef4444, 0 0 12px rgba(239,68,68,0.5)',
            }}
          />
        </span>
        <BellCheckIcon className="text-red-400" />
        <span className="text-[10px] font-black uppercase tracking-[0.28em] text-red-400">
          Bildirimler Aktif
        </span>
      </div>
    );
  }

  /* ── Denied — sönük gri pill ───────────────────────────────── */
  if (state === 'denied') {
    return (
      <div
        className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full select-none"
        style={{
          background: 'rgba(255,255,255,0.03)',
          border:     '1px solid rgba(255,255,255,0.07)',
        }}
        title="Tarayıcı ayarlarından bildirim iznini etkinleştirin"
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-white/20" />
        <span className="text-[10px] font-medium text-white/25">İzin Verilmedi</span>
      </div>
    );
  }

  /* ── Prompt — neon red "Hırsız Savar" button ──────────────── */
  return (
    <button
      onClick={handleClick}
      disabled={working}
      className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all duration-150 active:scale-95 disabled:opacity-50 group"
      style={{
        background: working ? 'rgba(239,68,68,0.12)' : 'rgba(239,68,68,0.07)',
        border:     '1px solid rgba(239,68,68,0.25)',
        boxShadow:  'none',
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = '0 0 14px rgba(239,68,68,0.2)';
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLElement).style.boxShadow = 'none';
      }}
      title="Hırsız Savar alarm bildirimlerini etkinleştir"
    >
      {working ? (
        /* Spinner */
        <svg
          width="11" height="11" viewBox="0 0 11 11" fill="none"
          className="animate-spin text-red-400"
        >
          <circle cx="5.5" cy="5.5" r="4" stroke="currentColor"
            strokeWidth="1.3" strokeDasharray="18" strokeDashoffset="6" opacity="0.4"/>
          <path d="M5.5 1.5a4 4 0 014 4" stroke="currentColor"
            strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      ) : (
        <AlarmShieldIcon className="text-red-400 group-hover:scale-110 transition-transform" />
      )}
      <span className="text-[10px] font-black uppercase tracking-[0.28em] text-red-400">
        {working ? 'Bağlanıyor' : 'Hırsız Savar'}
      </span>
    </button>
  );
}
