'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePinDialogStore } from '@/store/pinDialogStore';

const NUMPAD = ['1','2','3','4','5','6','7','8','9','','0','⌫'];

export function PinDialog() {
  const { visible, prompt, resolve } = usePinDialogStore();
  const [digits, setDigits] = useState<string[]>([]);
  const [shake,  setShake]  = useState(false);

  // Diyalog açılınca sıfırla
  useEffect(() => { if (visible) setDigits([]); }, [visible]);

  const press = useCallback((key: string) => {
    if (key === '') return;
    if (key === '⌫') {
      setDigits((d) => d.slice(0, -1));
      return;
    }
    setDigits((d) => {
      if (d.length >= 4) return d;
      const next = [...d, key];
      // 4 hane dolunca otomatik onayla
      if (next.length === 4) {
        setTimeout(() => resolve(next.join('')), 80);
      }
      return next;
    });
  }, [resolve]);

  const cancel = useCallback(() => {
    resolve(null);
  }, [resolve]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}
      onClick={cancel}
    >
      <div
        className="w-full max-w-xs rounded-3xl p-6 flex flex-col items-center gap-5"
        style={{
          background: 'linear-gradient(145deg, #0c1a2e, #070f1d)',
          border:     '1px solid rgba(239,68,68,0.25)',
          boxShadow:  '0 0 60px rgba(239,68,68,0.1), 0 24px 64px rgba(0,0,0,0.7)',
          animation:  shake ? 'shake 0.35s ease' : 'none',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Başlık */}
        <div className="flex flex-col items-center gap-2">
          <div
            className="w-12 h-12 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}
          >
            <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
              <rect x="3" y="10" width="16" height="10" rx="2.5" stroke="#ef4444" strokeWidth="1.6"/>
              <path d="M7 10V7a4 4 0 018 0v3" stroke="#ef4444" strokeWidth="1.6" strokeLinecap="round"/>
              <circle cx="11" cy="15" r="1.5" fill="#ef4444"/>
            </svg>
          </div>
          <p className="text-white font-bold text-sm">Kritik Komut</p>
          <p className="text-white/40 text-xs text-center">{prompt}</p>
        </div>

        {/* PIN noktaları */}
        <div className="flex gap-3">
          {[0,1,2,3].map((i) => (
            <div
              key={i}
              className="w-3.5 h-3.5 rounded-full transition-all duration-150"
              style={{
                background: i < digits.length ? '#ef4444' : 'rgba(255,255,255,0.1)',
                boxShadow:  i < digits.length ? '0 0 8px rgba(239,68,68,0.6)' : 'none',
                transform:  i < digits.length ? 'scale(1.2)' : 'scale(1)',
              }}
            />
          ))}
        </div>

        {/* Numpad */}
        <div className="grid grid-cols-3 gap-2 w-full">
          {NUMPAD.map((key, i) => (
            <button
              key={i}
              onClick={() => press(key)}
              disabled={key === ''}
              className="aspect-square rounded-2xl flex items-center justify-center text-lg font-bold transition-all duration-100 active:scale-90 disabled:opacity-0"
              style={{
                background: key === '⌫'
                  ? 'rgba(239,68,68,0.08)'
                  : key === ''
                  ? 'transparent'
                  : 'rgba(255,255,255,0.05)',
                border: key === '⌫'
                  ? '1px solid rgba(239,68,68,0.2)'
                  : key === ''
                  ? 'none'
                  : '1px solid rgba(255,255,255,0.08)',
                color: key === '⌫' ? '#ef4444' : '#fff',
              }}
            >
              {key}
            </button>
          ))}
        </div>

        {/* İptal */}
        <button
          onClick={cancel}
          className="text-xs text-white/30 hover:text-white/50 transition-colors"
        >
          İptal
        </button>
      </div>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%      { transform: translateX(-8px); }
          40%      { transform: translateX(8px); }
          60%      { transform: translateX(-5px); }
          80%      { transform: translateX(5px); }
        }
      `}</style>
    </div>
  );
}
