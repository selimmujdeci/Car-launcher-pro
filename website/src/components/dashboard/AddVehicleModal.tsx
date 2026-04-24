'use client';

import React, { useRef, useState, useEffect, KeyboardEvent } from 'react';
import { X, Link2, CheckCircle, Loader2, AlertCircle } from 'lucide-react';
type SvgFC = React.FC<{ className?: string; style?: React.CSSProperties }>;
const _X           = X           as unknown as SvgFC;
const _Link2       = Link2       as unknown as SvgFC;
const _CheckCircle = CheckCircle as unknown as SvgFC;
const _Loader2     = Loader2     as unknown as SvgFC;
const _AlertCircle = AlertCircle as unknown as SvgFC;
import { linkVehicle, toLiveVehicle, type LinkedVehicle } from '@/lib/deviceLinkClient';
import { useVehicleStore } from '@/store/vehicleStore';

interface Props {
  onClose: () => void;
}

type Step = 'input' | 'loading' | 'success' | 'error';

export default function AddVehicleModal({ onClose }: Props) {
  const [digits, setDigits] = useState<string[]>(['', '', '', '', '', '']);
  const [step, setStep]     = useState<Step>('input');
  const [errMsg, setErrMsg] = useState('');
  const [linked, setLinked] = useState<LinkedVehicle | null>(null);

  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const addVehicle = useVehicleStore((s) => s.addVehicle);

  useEffect(() => { refs.current[0]?.focus(); }, []);

  const code = digits.join('');
  const ready = code.length === 6 && /^\d{6}$/.test(code);

  function handleDigit(i: number, val: string) {
    const ch = val.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[i] = ch;
    setDigits(next);
    if (ch && i < 5) refs.current[i + 1]?.focus();
  }

  function handleKey(i: number, e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      refs.current[i - 1]?.focus();
    }
    if (e.key === 'Enter' && ready) submit();
  }

  function handlePaste(e: React.ClipboardEvent) {
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    e.preventDefault();
    const next = [...digits];
    for (let i = 0; i < 6; i++) next[i] = pasted[i] ?? '';
    setDigits(next);
    refs.current[Math.min(pasted.length, 5)]?.focus();
  }

  async function submit() {
    if (!ready) return;
    setStep('loading');
    try {
      const vehicle = await linkVehicle(code);
      setLinked(vehicle);
      addVehicle(toLiveVehicle(vehicle));
      setStep('success');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Bir hata oluştu.');
      setStep('error');
    }
  }

  function retry() {
    setDigits(['', '', '', '', '', '']);
    setErrMsg('');
    setStep('input');
    setTimeout(() => refs.current[0]?.focus(), 50);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-full max-w-sm mx-4 bg-[#0b1628] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/[0.07]">
          <div className="flex items-center gap-2">
            <_Link2 className="w-4 h-4 text-accent" />
            <span className="font-semibold text-white text-sm">Araç Bağla</span>
          </div>
          <button onClick={onClose} className="text-white/30 hover:text-white/60 transition-colors">
            <_X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-6">
          {/* Input step */}
          {(step === 'input' || step === 'loading') && (
            <>
              <p className="text-white/50 text-xs mb-5 leading-relaxed">
                Araç ekranında görünen <span className="text-white/70 font-medium">6 haneli kodu</span> girin.
                Kod 60 saniye geçerlidir.
              </p>

              {/* Digit boxes */}
              <div className="flex gap-2 justify-center mb-6" onPaste={handlePaste}>
                {digits.map((d, i) => (
                  <input
                    key={i}
                    ref={(el) => { refs.current[i] = el; }}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={d}
                    onChange={(e) => handleDigit(i, e.target.value)}
                    onKeyDown={(e) => handleKey(i, e)}
                    disabled={step === 'loading'}
                    className={`w-10 h-12 text-center text-lg font-semibold rounded-xl border bg-white/[0.04] text-white outline-none transition-all
                      ${d ? 'border-accent/60' : 'border-white/10'}
                      focus:border-accent/80 focus:bg-accent/5
                      disabled:opacity-40`}
                  />
                ))}
              </div>

              <button
                onClick={submit}
                disabled={!ready || step === 'loading'}
                className={`w-full py-3 rounded-xl text-sm font-semibold transition-all flex items-center justify-center gap-2
                  ${ready && step === 'input'
                    ? 'bg-accent hover:bg-accent/90 text-white'
                    : 'bg-white/[0.05] text-white/25 cursor-not-allowed'}`}
              >
                {step === 'loading' ? (
                  <><_Loader2 className="w-4 h-4 animate-spin" /> Bağlanıyor…</>
                ) : 'Bağla'}
              </button>
            </>
          )}

          {/* Success step */}
          {step === 'success' && linked && (
            <div className="text-center">
              <_CheckCircle className="w-12 h-12 text-green-400 mx-auto mb-3" />
              <p className="text-white font-semibold mb-1">Araç Bağlandı!</p>
              <p className="text-white/50 text-sm mb-1">{linked.name}</p>
              {linked.plate && (
                <p className="text-xs text-white/30 font-mono mb-5">{linked.plate}</p>
              )}
              <button
                onClick={onClose}
                className="w-full py-3 rounded-xl text-sm font-semibold bg-accent hover:bg-accent/90 text-white transition-colors"
              >
                Kapat
              </button>
            </div>
          )}

          {/* Error step */}
          {step === 'error' && (
            <div className="text-center">
              <_AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
              <p className="text-white font-semibold mb-1">Bağlama Başarısız</p>
              <p className="text-white/50 text-sm mb-5">{errMsg}</p>
              <div className="flex gap-3">
                <button
                  onClick={retry}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold bg-white/[0.07] hover:bg-white/[0.12] text-white transition-colors"
                >
                  Tekrar Dene
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-xl text-sm font-semibold bg-accent hover:bg-accent/90 text-white transition-colors"
                >
                  Kapat
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
