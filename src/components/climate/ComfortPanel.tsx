/**
 * ComfortPanel — koltuk masajı + iç ambiyans (klima ekranında, Apple CarPlay düzeni).
 *
 * · Gösterilen durum ARACIN bildirdiğidir (store canMassage / canAmbient) — yerel sahte durum yok.
 * · Dokunuş Mavi ile AYNI yürütücüden geçer (`executeComfortCommands`): "yapıldı" yalnız
 *   aracın yankısıyla; sonucun dürüst cümlesi panelin altında kısa süre görünür.
 * · Bölüm YALNIZ araç o özelliği bildirdiyse görünür (yetenek keşfi); kurulum yoksa not.
 */
import { memo, useEffect, useState } from 'react';
import { useUnifiedVehicleStore } from '../../platform/vehicleDataLayer/UnifiedVehicleStore';
import { executeComfortCommands } from '../../platform/vehicleDataLayer/canComfortControl';
import {
  AMBIENT_COLOR_NAMES, MASSAGE_MODE_NAMES, MASSAGE_STRENGTH_MAX,
} from '../../platform/vehicleDataLayer/raiseRenaultFrames';
import type { VehicleAccessState } from '../../platform/vehicleDataLayer/vehicleAccess';
import type { ComfortCommand } from '../../platform/vehicleComfortIntents';

/** Kutunun renk numarası → ekranda gösterilen nokta rengi (ad listesiyle aynı sıra). */
const AMBIENT_DOT: readonly string[] = [
  '#f1f1f1', '#22c55e', '#ef4444', '#3b82f6', '#a855f7', '#f97316', '#06b6d4', '#facc15',
];
const ACCENT = '#E0A23C';
const MSG_MS = 4_000;

function Pill({ label, active, onClick, disabled }: {
  label: string; active: boolean; onClick: () => void; disabled: boolean;
}) {
  return (
    <button
      onClick={onClick} disabled={disabled}
      className="px-3 py-2 rounded-xl text-[11px] font-extrabold tracking-wider uppercase active:scale-95"
      style={{
        background: active ? `${ACCENT}1e` : 'var(--oem-surface-2)',
        border: `1px solid ${active ? ACCENT + '55' : 'var(--oem-line)'}`,
        color: active ? ACCENT : 'var(--oem-ink-3)',
        opacity: disabled ? 0.5 : 1,
      }}
    >
      {label}
    </button>
  );
}

function Stepper({ value, onDec, onInc, disabled }: {
  value: string; onDec: () => void; onInc: () => void; disabled: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Pill label="−" active={false} onClick={onDec} disabled={disabled} />
      <span className="text-[13px] font-bold tabular-nums w-12 text-center">{value}</span>
      <Pill label="+" active={false} onClick={onInc} disabled={disabled} />
    </div>
  );
}

export const ComfortPanel = memo(function ComfortPanel({ access }: { access: VehicleAccessState | null }) {
  const massage = useUnifiedVehicleStore((s) => s.canMassage);
  const ambient = useUnifiedVehicleStore((s) => s.canAmbient);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), MSG_MS);
    return () => clearTimeout(id);
  }, [msg]);

  const showMassage = access?.features.massage === 'AVAILABLE' && massage !== null;
  const showAmbient = access?.features.ambient === 'AVAILABLE' && ambient !== null;
  const locked = access?.features.massage === 'LOCKED' || access?.features.ambient === 'LOCKED';
  if (!showMassage && !showAmbient && !locked) return null;

  const run = (c: ComfortCommand): void => {
    if (busy) return;
    setBusy(true);
    void executeComfortCommands([c])
      .then((o) => setMsg(o.text))
      .catch(() => setMsg('Komutun sonucunu doğrulayamadım.'))
      .finally(() => setBusy(false));
  };

  return (
    <div
      data-editable="climate.comfort-controls" data-editable-type="panel"
      className="rounded-2xl p-4 flex flex-col gap-3"
      style={{ background: 'var(--oem-surface-2)', border: '1px solid var(--oem-surface-2)' }}
    >
      {showMassage && massage && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] font-extrabold tracking-[0.2em] uppercase text-[color:var(--oem-ink-3)] w-28">Koltuk masajı</span>
          <Pill label={massage.driverOn ? 'Açık' : 'Kapalı'} active={massage.driverOn === true} disabled={busy}
            onClick={() => run({ target: 'massage', power: massage.driverOn ? 'off' : 'on' })} />
          {MASSAGE_MODE_NAMES.map((name, i) => (
            <Pill key={name} label={name} active={massage.driverOn === true && massage.mode === i} disabled={busy}
              onClick={() => run({ target: 'massage', mode: i })} />
          ))}
          <Stepper
            value={massage.strength === null ? '—' : `${massage.strength + 1}/${MASSAGE_STRENGTH_MAX + 1}`}
            disabled={busy}
            onDec={() => run({ target: 'massage', level: '-' })}
            onInc={() => run({ target: 'massage', level: '+' })}
          />
        </div>
      )}

      {showAmbient && ambient && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[11px] font-extrabold tracking-[0.2em] uppercase text-[color:var(--oem-ink-3)] w-28">İç ambiyans</span>
          <Pill label={ambient.on ? 'Açık' : 'Kapalı'} active={ambient.on} disabled={busy}
            onClick={() => run({ target: 'ambient', power: ambient.on ? 'off' : 'on' })} />
          <div className="flex gap-1.5">
            {AMBIENT_COLOR_NAMES.map((name, i) => (
              <button
                key={name} aria-label={name} disabled={busy}
                onClick={() => run({ target: 'ambient', color: i })}
                className="rounded-full active:scale-90"
                style={{
                  width: 26, height: 26, background: AMBIENT_DOT[i],
                  border: ambient.on && ambient.colorIndex === i ? `3px solid ${ACCENT}` : '2px solid var(--oem-line)',
                  opacity: busy ? 0.5 : 1,
                }}
              />
            ))}
          </div>
          <Stepper
            value={`%${ambient.brightness}`}
            disabled={busy}
            onDec={() => run({ target: 'ambient', level: '-' })}
            onInc={() => run({ target: 'ambient', level: '+' })}
          />
        </div>
      )}

      {locked && !showMassage && !showAmbient && (
        <div className="text-[11px] text-[color:var(--oem-ink-4)]">
          Masaj ve ambiyans kontrolü için bir kerelik araç bağlantısı kurulumu gerekiyor (Ayarlar › Bakım › Araç Bağlantısı).
        </div>
      )}

      {(busy || msg) && (
        <div className="text-[11px] font-semibold" style={{ color: busy ? 'var(--oem-ink-3)' : ACCENT }}>
          {busy ? 'Araca iletiliyor…' : msg}
        </div>
      )}
    </div>
  );
});
