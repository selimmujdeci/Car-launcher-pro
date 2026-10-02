/**
 * ScreenOrientationPanel — Ayarlar › Ekran › Ekran yönü.
 *
 * Yalnız TERCİHİ yazar (`settings.screenOrientation`); uygulayan tek yer
 * `navigationOrientation` (App bağlar, native saklar ve açılışta uygular).
 * Varsayılan 'landscape' = eski davranış.
 */
import { memo } from 'react';
import { useStore } from '../../store/useStore';
import { isNative } from '../../platform/bridge';
import type { ScreenOrientationPreference } from '../../platform/navigation/navigationOrientation';

const SCREEN_ORIENTATION_OPTIONS: ReadonlyArray<{
  readonly id: ScreenOrientationPreference;
  readonly label: string;
  readonly hint: string;
}> = [
  { id: 'landscape', label: 'Yatay', hint: 'Yatay araç ekranı (varsayılan)' },
  { id: 'portrait', label: 'Dikey', hint: 'Dikey araç ekranı (Tesla tipi)' },
  { id: 'auto', label: 'Otomatik', hint: 'Cihazın kendi yönünü izler' },
];

export const ScreenOrientationPanel = memo(function ScreenOrientationPanel() {
  const current = useStore((s) => s.settings.screenOrientation ?? 'landscape');
  const updateSettings = useStore((s) => s.updateSettings);

  return (
    <div className="flex flex-col gap-3">
      <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Ekran yönü">
        {SCREEN_ORIENTATION_OPTIONS.map((o) => {
          const active = current === o.id;
          return (
            <button
              key={o.id}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => { if (!active) updateSettings({ screenOrientation: o.id }); }}
              className="py-3 px-2 rounded-xl flex flex-col items-center gap-1 active:scale-[0.98]"
              style={active
                ? { background: 'var(--oem-accent)', color: 'var(--oem-accent-ink, #0b1020)' }
                : { background: 'rgba(148,163,184,0.12)', color: 'var(--oem-ink-2)', border: '1px solid rgba(148,163,184,0.22)' }}
            >
              <span className="text-sm font-bold">{o.label}</span>
              <span className="text-[10px] font-semibold text-center leading-tight" style={{ opacity: 0.8 }}>{o.hint}</span>
            </button>
          );
        })}
      </div>
      <span className="text-xs leading-relaxed" style={{ color: 'var(--oem-ink-3)' }}>
        {isNative
          ? 'Dikey panelde arayüz yan görünüyorsa "Dikey"i seçin. Değişiklik hemen uygulanır ve sonraki açılışlarda da geçerlidir. Tam ekran navigasyon her yönde çalışır.'
          : 'Tarayıcıda yalnız "Telefonu Yatay Tutun" uyarısını etkiler; ekran yönü Android uygulamasında uygulanır.'}
      </span>
    </div>
  );
});
