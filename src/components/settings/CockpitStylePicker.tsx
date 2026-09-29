/**
 * Ayarlar · Ekran · Sürücü ekranı — görünüm (Yol · Sade · Analog · Retro · Dijital)
 * ve vurgu rengi seçimi (kullanıcı isteği 2026-09-27: "isteyen istediği rengi,
 * istediği görüntüyü seçsin").
 *
 * Seçim `settings.cockpitStyle` / `settings.cockpitAccent`e yazılır (tek sahip:
 * ayar deposu). Gündüz/gece ayrı seçilmez — uygulamanın gündüz/gece ayarını izler.
 * Önizleme GERÇEK kokpit verisiyle çizilir (örnek/sahte değer YOK): veri yoksa
 * önizlemede de "—" görünür.
 */
import { memo } from 'react';
import { useStore } from '../../store/useStore';
import { useClock } from '../../hooks/useClock';
import { DigitalCockpitScreen } from '../cockpit/DigitalCockpitScreen';
import { useCockpitData } from '../cockpit/useCockpitData';
import {
  COCKPIT_ACCENT_IDS, COCKPIT_ACCENT_LABELS, COCKPIT_STYLE_IDS, COCKPIT_STYLE_LABELS, cockpitTokensFor,
} from '../cockpit/cockpitLayout';

const STYLE_HINTS: Record<(typeof COCKPIT_STYLE_IDS)[number], string> = {
  road: 'Modern · yol ve araç',
  minimal: 'Az bilgi · hız ortada',
  analog: 'Klasik ibreli kadranlar',
  retro: 'Eski usul krem kadranlar',
  digital: 'Tam dijital · çubuklar',
};

export const CockpitStylePicker = memo(function CockpitStylePicker() {
  const style = useStore((s) => s.settings.cockpitStyle);
  const accent = useStore((s) => s.settings.cockpitAccent);
  const dayNightMode = useStore((s) => s.settings.dayNightMode);
  const use24Hour = useStore((s) => s.settings.use24Hour);
  const updateSettings = useStore((s) => s.updateSettings);
  const data = useCockpitData();
  const { time, date } = useClock(use24Hour, false);
  const mode: 'day' | 'night' = dayNightMode === 'night' ? 'night' : 'day';

  return (
    <div className="flex flex-col gap-3">
      {/* Canlı önizleme — gerçek veri */}
      <div className="w-full rounded-xl overflow-hidden" style={{ aspectRatio: '1024 / 600', border: '1px solid var(--oem-line)' }}
        aria-label="Sürücü ekranı önizlemesi">
        <DigitalCockpitScreen state={data} mode={mode} clock={{ time, date }} styleId={style} accent={accent} />
      </div>

      <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: 'var(--oem-ink-3)' }}>Görünüm</p>
      <div className="grid grid-cols-5 gap-2">
        {COCKPIT_STYLE_IDS.map((id) => {
          const active = style === id;
          return (
            <button key={id} type="button" aria-pressed={active}
              onClick={() => updateSettings({ cockpitStyle: id })}
              className="flex flex-col items-center justify-center gap-1 rounded-xl px-1 active:scale-95"
              style={{
                minHeight: 64,
                background: active ? 'var(--oem-accent-soft, rgba(96,165,250,0.18))' : 'var(--oem-surface-0)',
                border: `1.5px solid ${active ? 'var(--oem-accent)' : 'var(--oem-line)'}`,
                color: 'var(--oem-ink)',
              }}>
              <span className="text-[13px] font-black">{COCKPIT_STYLE_LABELS[id]}</span>
              <span className="text-[9px] leading-tight text-center" style={{ color: 'var(--oem-ink-3)' }}>{STYLE_HINTS[id]}</span>
            </button>
          );
        })}
      </div>

      <p className="text-[11px] font-black uppercase tracking-widest" style={{ color: 'var(--oem-ink-3)' }}>Renk</p>
      <div className="flex flex-wrap gap-3">
        {COCKPIT_ACCENT_IDS.map((id) => {
          const active = accent === id;
          const c = cockpitTokensFor('night', id).accent;
          return (
            <button key={id} type="button" aria-pressed={active} aria-label={COCKPIT_ACCENT_LABELS[id]}
              onClick={() => updateSettings({ cockpitAccent: id })}
              className="flex flex-col items-center gap-1 active:scale-95" style={{ minWidth: 56 }}>
              <span className="rounded-full" style={{
                width: 44, height: 44, background: c,
                border: active ? '3px solid var(--oem-ink)' : '2px solid var(--oem-line)',
                boxShadow: active ? `0 0 0 3px ${c}55` : 'none',
              }} />
              <span className="text-[11px] font-bold" style={{ color: active ? 'var(--oem-ink)' : 'var(--oem-ink-3)' }}>
                {COCKPIT_ACCENT_LABELS[id]}
              </span>
            </button>
          );
        })}
      </div>
      <p className="text-[11px] leading-relaxed" style={{ color: 'var(--oem-ink-3)' }}>
        Gündüz ve gece görünümü, uygulamanın gündüz/gece ayarına göre kendiliğinden değişir.
      </p>
    </div>
  );
});
