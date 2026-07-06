/**
 * GlobalDiagnosticButton — her ekrandan erişilebilen tek "Tanı Gönder" tetiği.
 *
 * AMAÇ (geliştirme/saha veri toplama fazı): bir sorun UYGULAMANIN NERESİNDE
 * olursa olsun, kullanıcı tek dokunuşla anlık tanı raporu gönderebilsin —
 * sahadan veri gelsin, ona göre düzeltme yapılsın. Ayarlar → Tanı Raporu
 * kartıyla AYNI aksiyonu (triggerSupportSnapshot) kullanır; içerik
 * remoteLogService'te sanitize edilir (konum/VIN/plaka/MAC yok).
 *
 * Tasarım: diskret — köşede yarı saydam küçük daire; dokununca sonuç etiketi
 * 3sn görünür. Geri vites aktifken App.tsx render'lamaz (kamera temiz kalır).
 *
 * NOT (ticari): bu, saha fazı için bilinçli olarak HER ZAMAN görünür bir
 * geliştirici/pilot aracıdır. Satış build'inde gizlemek/kaldırmak için tek
 * mount satırı (App.tsx) yeterli — bkz. DEVICE_VALIDATION_LEDGER.
 */
import { useEffect, useRef, useState } from 'react';
import { Stethoscope, Check, Loader2 } from 'lucide-react';
import {
  triggerSelfTestSnapshot,
  type SnapshotTriggerResult,
} from '../../platform/remoteLogService';

type BtnState = 'idle' | 'sending' | SnapshotTriggerResult;

const LABEL: Record<Exclude<BtnState, 'idle'>, string> = {
  sending:        'Taranıyor…',
  sent:           'Tarama gönderildi ✓',
  queued_offline: 'İnternet gelince gönderilecek',
  cooldown:       'Az önce gönderildi — bekleyin',
  error:          'Gönderilemedi — tekrar deneyin',
  not_paired:     'Cihaz eşleşiyor — birazdan tekrar deneyin',
};

const COLOR: Record<Exclude<BtnState, 'idle'>, string> = {
  sending:        '#93c5fd',
  sent:           '#34d399',
  queued_offline: '#fbbf24',
  cooldown:       '#fbbf24',
  error:          '#f87171',
  not_paired:     '#fbbf24',
};

export function GlobalDiagnosticButton() {
  const [state, setState] = useState<BtnState>('idle');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);

  async function handleSend(): Promise<void> {
    if (state === 'sending') return;               // çift dokunma koruması
    setState('sending');
    const result = await triggerSelfTestSnapshot();
    setState(result);
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setState('idle'), 3000);
  }

  const showLabel = state !== 'idle';
  const labelText = state === 'idle' ? '' : LABEL[state];
  const labelColor = state === 'idle' ? '#93c5fd' : COLOR[state];

  return (
    <div
      data-selftest-ignore="1"                     // zamansız-modal avcısı bu butonu saymasın
      style={{
        position: 'fixed',
        left: 8,
        bottom: 8,
        zIndex: 9000,                              // reverse(100000)/portrait(99999) altında
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        pointerEvents: 'auto',
      }}
    >
      <button
        onClick={() => { void handleSend(); }}
        disabled={state === 'sending'}
        aria-label="Tanı Gönder"
        style={{
          width: 34, height: 34,
          borderRadius: 9999,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          flexShrink: 0,
          background: 'rgba(8,14,26,0.62)',
          border: `1px solid ${showLabel ? labelColor : 'rgba(147,197,253,0.35)'}`,
          color: showLabel ? labelColor : 'rgba(147,197,253,0.75)',
          opacity: showLabel ? 1 : 0.5,
          transition: 'opacity 0.25s, border-color 0.25s, color 0.25s',
          backdropFilter: 'blur(6px)',
          WebkitBackdropFilter: 'blur(6px)',
        }}
      >
        {state === 'sending'
          ? <Loader2 size={16} className="animate-spin" />
          : state === 'sent'
            ? <Check size={16} />
            : <Stethoscope size={16} />}
      </button>

      {showLabel && (
        <span
          className="font-bold"
          style={{
            fontSize: 11,
            padding: '4px 9px',
            borderRadius: 9999,
            whiteSpace: 'nowrap',
            background: 'rgba(8,14,26,0.72)',
            border: `1px solid ${labelColor}`,
            color: labelColor,
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
          }}
        >
          {labelText}
        </span>
      )}
    </div>
  );
}
