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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 ">
      <div className="relative w-full max-w-sm mx-4 bg-[#0b1628] border border-hair rounded-sm shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-hair">
          <div className="flex items-center gap-2">
            <_Link2 className="w-4 h-4 text-copper-ink" />
            <span className="font-semibold text-t1 text-sm">Araç Bağla</span>
          </div>
          <button onClick={onClose} className="text-t3 hover:text-t2 transition-colors">
            <_X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-6">
          {/* Input step */}
          {(step === 'input' || step === 'loading') && (
            <>
              <p className="text-t2 text-xs mb-5 leading-relaxed">
                Araç ekranında görünen <span className="text-t1 font-medium">6 haneli kodu</span> girin.
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
                    className={`w-10 h-12 text-center text-lg font-semibold rounded-sm border bg-bezel text-t1 outline-none transition-all
                      ${d ? 'border-copper' : 'border-hair'}
                      focus:border-copper focus:bg-[var(--cn-copper-bg)]
                      disabled:opacity-40`}
                  />
                ))}
              </div>

              <button
                onClick={submit}
                disabled={!ready || step === 'loading'}
                className={`w-full py-3 rounded-sm text-sm font-semibold transition-all flex items-center justify-center gap-2
                  ${ready && step === 'input'
                    ? 'bg-copper hover:bg-[var(--cn-copper-bg)] text-t1'
                    : 'bg-bezel text-t3 cursor-not-allowed'}`}
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
              <_CheckCircle className="w-12 h-12 text-verified mx-auto mb-3" />
              <p className="text-t1 font-semibold mb-1">Araç Bağlandı!</p>
              <p className="text-t2 text-sm mb-1">{linked.name}</p>
              {linked.plate && (
                <p className="text-xs text-t3 font-mono mb-5">{linked.plate}</p>
              )}
              <button
                onClick={onClose}
                className="w-full py-3 rounded-sm text-sm font-semibold bg-copper hover:bg-[var(--cn-copper-bg)] text-t1 transition-colors"
              >
                Kapat
              </button>
            </div>
          )}

          {/* Error step */}
          {step === 'error' && (
            <div className="text-center">
              <_AlertCircle className="w-12 h-12 text-critical mx-auto mb-3" />
              <p className="text-t1 font-semibold mb-1">Bağlama Başarısız</p>
              <p className="text-t2 text-sm mb-5">{errMsg}</p>
              <div className="flex gap-3">
                <button
                  onClick={retry}
                  className="flex-1 py-3 rounded-sm text-sm font-semibold bg-bezel hover:bg-white/[0.12] text-t1 transition-colors"
                >
                  Tekrar Dene
                </button>
                <button
                  onClick={onClose}
                  className="flex-1 py-3 rounded-sm text-sm font-semibold bg-copper hover:bg-[var(--cn-copper-bg)] text-t1 transition-colors"
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
