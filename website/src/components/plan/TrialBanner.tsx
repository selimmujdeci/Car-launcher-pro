'use client';

import { usePlan } from '@/hooks/usePlan';

export function TrialBanner() {
  const { plan, isPro, isTrial, daysLeft, loaded } = usePlan();

  if (!loaded) return null;

  // Trial aktif → yeşil banner
  if (isTrial && isPro && daysLeft > 0) {
    return (
      <div
        className="flex items-center justify-between px-4 py-2 text-xs font-semibold"
        style={{
          background: 'linear-gradient(90deg, rgba(52,211,153,0.12) 0%, rgba(16,185,129,0.06) 100%)',
          borderBottom: '1px solid rgba(52,211,153,0.15)',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest"
            style={{ background: 'rgba(52,211,153,0.18)', color: '#34d399', border: '1px solid rgba(52,211,153,0.3)' }}
          >
            DENEME
          </span>
          <span style={{ color: 'rgba(255,255,255,0.55)' }}>
            Tüm PRO özellikler aktif —{' '}
            <span style={{ color: '#34d399' }}>{daysLeft} gün kaldı</span>
          </span>
        </div>

        {/* Progress bar */}
        <div className="hidden sm:flex items-center gap-2">
          <div className="w-24 h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.08)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.min(100, (daysLeft / 30) * 100)}%`,
                background: daysLeft > 10 ? '#34d399' : daysLeft > 5 ? '#fbbf24' : '#ef4444',
                transition: 'width 0.5s',
              }}
            />
          </div>
          <span className="text-[10px]" style={{ color: 'rgba(255,255,255,0.3)' }}>{daysLeft}/30</span>
        </div>
      </div>
    );
  }

  // Trial bitti → kırmızı uyarı
  if (isTrial && !isPro) {
    return (
      <div
        className="flex items-center justify-between px-4 py-2 text-xs font-semibold"
        style={{
          background: 'linear-gradient(90deg, rgba(239,68,68,0.12) 0%, rgba(220,38,38,0.06) 100%)',
          borderBottom: '1px solid rgba(239,68,68,0.2)',
        }}
      >
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-widest"
            style={{ background: 'rgba(239,68,68,0.18)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
          >
            SÜRE DOLDU
          </span>
          <span style={{ color: 'rgba(255,255,255,0.45)' }}>
            Deneme süreniz bitti — PRO özellikler kilitlendi
          </span>
        </div>
        <a
          href="/contact"
          className="px-3 py-1 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all active:scale-95"
          style={{ background: 'rgba(239,68,68,0.15)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)' }}
        >
          PRO'ya Geç →
        </a>
      </div>
    );
  }

  // Free plan → sessiz banner
  if (plan === 'free') {
    return (
      <div
        className="flex items-center justify-between px-4 py-2 text-xs"
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderBottom: '1px solid rgba(255,255,255,0.05)',
        }}
      >
        <span style={{ color: 'rgba(255,255,255,0.3)' }}>
          Ücretsiz plan — PRO özellikler kilitli
        </span>
        <a
          href="/contact"
          className="text-[10px] font-bold"
          style={{ color: 'rgba(96,165,250,0.7)' }}
        >
          PRO'ya Geç →
        </a>
      </div>
    );
  }

  return null;
}
