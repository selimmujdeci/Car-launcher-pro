'use client';

import { useState } from 'react';
import { pairVehicle } from '@/lib/pairingService';

interface Props {
  onPaired: () => void;
}

export default function PairingScreen({ onPaired }: Props) {
  const [code, setCode]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const [success, setSuccess] = useState(false);

  const handlePair = async () => {
    const trimmed = code.trim();
    if (trimmed.length < 4) {
      setError('En az 4 karakter girin.');
      return;
    }
    setLoading(true);
    setError('');

    const res = await pairVehicle(trimmed);
    setLoading(false);

    if (res.success) {
      setSuccess(true);
      try { navigator.vibrate?.(50); } catch {}
      setTimeout(() => onPaired(), 1500);
    } else {
      setError(res.message);
      try { navigator.vibrate?.([100, 50, 100]); } catch {}
    }
  };

  return (
    <div className="flex flex-col items-center justify-center gap-6 py-8 px-2 text-center">

      {/* Vehicle icon */}
      <div
        className="w-20 h-20 rounded-3xl flex items-center justify-center"
        style={{
          background: 'rgba(59,130,246,0.08)',
          border: '1px solid rgba(59,130,246,0.2)',
          boxShadow: '0 0 32px rgba(59,130,246,0.12)',
        }}
      >
        <svg width="38" height="38" viewBox="0 0 38 38" fill="none">
          <path
            d="M5 23V18L9 11Q10.5 8 13 8H25Q27.5 8 29 11L33 18V23"
            stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          />
          <path d="M4 23h30v4.5A1.5 1.5 0 0132.5 29h-27A1.5 1.5 0 014 27.5V23z" stroke="#3b82f6" strokeWidth="2"/>
          <circle cx="10" cy="23" r="2.5" stroke="#3b82f6" strokeWidth="2"/>
          <circle cx="28" cy="23" r="2.5" stroke="#3b82f6" strokeWidth="2"/>
          {/* Phone link icon overlay */}
          <circle cx="29" cy="10" r="7" fill="#0c1a2e" stroke="rgba(59,130,246,0.3)" strokeWidth="1"/>
          <rect x="26" y="7.5" width="6" height="5" rx="1" stroke="#60a5fa" strokeWidth="1.2"/>
          <path d="M28 12.5v1.5M29 12.5v1.5M30 12.5v1.5" stroke="#60a5fa" strokeWidth="1" strokeLinecap="round"/>
        </svg>
      </div>

      <div>
        <h2 className="text-white font-bold text-lg leading-tight">Araç Eşleştir</h2>
        <p className="text-white/40 text-sm mt-1.5 max-w-[220px] leading-relaxed">
          Araç ekranındaki eşleşme kodunu girin
        </p>
      </div>

      {/* Code input */}
      <div className="w-full max-w-[280px]">
        <input
          type="text"
          inputMode="text"
          autoCapitalize="characters"
          maxLength={8}
          value={code}
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(''); }}
          onKeyDown={(e) => e.key === 'Enter' && void handlePair()}
          placeholder="X X X X X X"
          disabled={loading || success}
          className="w-full text-center text-2xl font-mono font-bold tracking-[0.4em] py-4 rounded-2xl transition-all focus:outline-none disabled:opacity-60"
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: error
              ? '1.5px solid rgba(239,68,68,0.5)'
              : success
              ? '1.5px solid rgba(52,211,153,0.5)'
              : '1.5px solid rgba(255,255,255,0.1)',
            color: '#fff',
          }}
        />

        {error && (
          <p className="text-red-400/90 text-xs mt-2 text-center">{error}</p>
        )}
        {success && (
          <p className="text-emerald-400 text-sm mt-2 text-center font-semibold">Araç eşleştirildi!</p>
        )}
      </div>

      {/* Pair button */}
      <button
        onClick={() => void handlePair()}
        disabled={loading || success || code.trim().length < 4}
        className="w-full max-w-[280px] py-4 rounded-2xl font-bold text-white text-sm tracking-wide transition-all duration-150 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
        style={{
          background: success
            ? 'linear-gradient(135deg, #34d399, #10b981)'
            : 'linear-gradient(135deg, #3b82f6, #2563eb)',
          boxShadow: success
            ? '0 8px 24px rgba(52,211,153,0.3)'
            : '0 8px 24px rgba(59,130,246,0.25)',
        }}
      >
        {loading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 16 16" fill="none">
              <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="28" strokeDashoffset="10" opacity="0.4"/>
              <path d="M8 2a6 6 0 016 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
            </svg>
            Eşleştiriliyor…
          </span>
        ) : success ? (
          'Başarılı!'
        ) : (
          'Eşleştir'
        )}
      </button>

      <p className="text-white/20 text-xs max-w-[240px] leading-relaxed">
        Kodu almak için araç ekranında <span className="text-white/35">Ayarlar → Telefonumu Bağla</span> seçeneğini açın.
      </p>
    </div>
  );
}
