'use client';

/**
 * PushNotificationWidget — Topbar'da push bildirim izin rozeti.
 *
 * Durumlar:
 *   UNSUPPORTED         → gizli (render yok)
 *   PERMISSION_REQUIRED → "Bildirimleri Aç" butonu — OLED black + neon red
 *   REGISTERING         → "Bağlanıyor" spinner
 *   ACTIVE              → "Bildirimler Aktif" neon pill
 *   DENIED              → "İzin Verilmedi" sönük gri pill
 *   FAILED              → "Bildirim Kurulamadı" — GİZLENMEZ
 *
 * ── ÖLÇÜLEN KUSUR (F5.1) ─────────────────────────────────────────────────
 * `error` durumu GİZLENİYORDU ve `subscribe()` backend kaydı düşse bile
 * `'subscribed'` dönüyordu → rozet "Bildirimler Aktif" diyordu ama hiçbir
 * bildirim gelmiyordu. Artık `ACTIVE` yalnız backend kaydı kanıtlanınca
 * gösterilir; başarısızlık SESSİZCE GİZLENMEZ, kullanıcıya söylenir.
 *
 * Zero-Leak: mount'ta bir kez initPushEngine çağrılır.
 * İzin yalnızca kullanıcı tıklayınca istenir.
 */

import { useEffect, useState } from 'react';
import { initPushEngine, subscribe,
         type PushState, type PushFailureReason } from '@/lib/pushEngine';

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

/* ── Başarısızlık sebebi → kullanıcı metni ───────────────────
   Hiçbiri endpoint/anahtar/token TAŞIMAZ; teknik ayrıntı sızdırılmaz. */

const FAILURE_TITLE: Record<PushFailureReason, string> = {
  NO_VAPID_KEY:           'Bildirim sunucusu bu kurulumda yapılandırılmamış.',
  SW_REGISTRATION_FAILED: 'Tarayıcı arka plan servisi kaydedilemedi.',
  SUBSCRIBE_FAILED:       'Tarayıcı bildirim aboneliği oluşturulamadı.',
  NOT_AUTHENTICATED:      'Bildirimler için oturum açmanız gerekir.',
  BACKEND_UNAVAILABLE:    'Sunucuya ulaşılamadı; bildirim kaydı yapılamadı.',
  BACKEND_PERSIST_FAILED: 'Bildirim kaydı sunucuda oluşturulamadı.',
};

/* ── Widget ──────────────────────────────────────────────────── */

export function PushNotificationWidget() {
  const [state,   setState]   = useState<PushState | 'loading'>('loading');
  const [reason,  setReason]  = useState<PushFailureReason | undefined>(undefined);
  const [working, setWorking] = useState(false);

  // Init once on mount — izin İSTEMEDEN mevcut durumu oku
  useEffect(() => {
    initPushEngine().then((res) => { setState(res.state); setReason(res.reason); });
  }, []);

  async function handleClick() {
    if (working || state === 'ACTIVE' || state === 'DENIED') return;
    setWorking(true);
    const res = await subscribe();
    setState(res.state);
    setReason(res.reason);
    setWorking(false);
  }

  /* Yalnız durum HENÜZ BİLİNMİYORKEN veya tarayıcı desteklemiyorken gizlenir.
     FAILED ARTIK GİZLENMEZ — sessiz başarısızlık bu kusurun ta kendisiydi. */
  if (state === 'loading' || state === 'UNSUPPORTED') return null;

  /* ── ACTIVE — neon red active pill (backend kaydı KANITLI) ── */
  if (state === 'ACTIVE') {
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
        <BellCheckIcon className="text-critical" />
        <span className="text-[10px] font-black uppercase tracking-[0.28em] text-critical">
          Bildirimler Aktif
        </span>
      </div>
    );
  }

  /* ── DENIED — sönük gri pill ───────────────────────────────── */
  if (state === 'DENIED') {
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
        <span className="text-[10px] font-medium text-t3">İzin Verilmedi</span>
      </div>
    );
  }

  /* ── FAILED — kurulamadı, AÇIKÇA söylenir ──────────────────── */
  if (state === 'FAILED') {
    return (
      <div
        className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full select-none"
        style={{
          background: 'rgba(245,158,11,0.07)',
          border:     '1px solid rgba(245,158,11,0.22)',
        }}
        title={FAILURE_TITLE[reason ?? 'BACKEND_PERSIST_FAILED']}
      >
        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: '#f59e0b' }} />
        <span className="text-[10px] font-black uppercase tracking-[0.28em]" style={{ color: '#f59e0b' }}>
          Bildirim Kurulamadı
        </span>
      </div>
    );
  }

  /* ── Prompt — neon red "Bildirimleri Aç" butonu ────────────────
     ── YETENEK AŞIMI DÜZELTİLDİ (F5.2 §11) ─────────────────────────────
     Düğme eskiden "Hırsız Savar" diyordu. Bastığında yaptığı tek iş tarayıcı
     BİLDİRİM İZNİ istemektir. Üründe hırsızlık KANITI üreten bir yetenek
     YOKTUR: tüketici tarafında kontak/kapı/CAN kanıtı okunmaz ve GPS
     değişimi tek başına hırsızlık kanıtı DEĞİLDİR. Düğmenin adı yaptığı işi
     söyler; pazarlama metni teknik gerçeği aşamaz. */
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
      title="Bu cihazda bildirimleri etkinleştir"
    >
      {working ? (
        /* Spinner */
        <svg
          width="11" height="11" viewBox="0 0 11 11" fill="none"
          className="animate-spin text-critical"
        >
          <circle cx="5.5" cy="5.5" r="4" stroke="currentColor"
            strokeWidth="1.3" strokeDasharray="18" strokeDashoffset="6" opacity="0.4"/>
          <path d="M5.5 1.5a4 4 0 014 4" stroke="currentColor"
            strokeWidth="1.3" strokeLinecap="round"/>
        </svg>
      ) : (
        <AlarmShieldIcon className="text-critical group-hover:scale-110 transition-transform" />
      )}
      <span className="text-[10px] font-black uppercase tracking-[0.28em] text-critical">
        {working ? 'Bağlanıyor' : 'Bildirimleri Aç'}
      </span>
    </button>
  );
}
