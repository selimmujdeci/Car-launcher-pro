/**
 * DriverAccentPicker — etkin sürücünün vurgu rengi (etkin tema için).
 *
 * Renk Tema Stüdyo ile AYNI manifest kapısından yazılır (`setLocalAccent`);
 * sürücü hafızası onu profille birlikte saklar. Arka plana karşı 3:1 altında
 * kalan renk seçilemez; arka plan okunamazsa bu açıkça yazılır.
 */
import { memo, useState } from 'react';
import { Check } from 'lucide-react';
import { useCarTheme, baseOf } from '../../store/useCarTheme';
import { THEME_BASE_IDS, type ThemeBaseId } from '../../platform/theme/themeManifest';
import { getStoredManifest, setLocalAccent } from '../../platform/theme/themeRuntime';
import { DRIVER_ACCENTS, accentVerdict, MIN_ACCENT_CONTRAST } from '../../platform/theme/accentContrast';

function readBackground(): string | null {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue('--oem-bg').trim();
    return v || null;
  } catch { return null; }
}

export const DriverAccentPicker = memo(function DriverAccentPicker() {
  const theme = useCarTheme((s) => s.theme);
  const base = baseOf(theme) as ThemeBaseId;
  const supported = (THEME_BASE_IDS as readonly string[]).includes(base);
  const [, bump] = useState(0);
  if (!supported) return null;

  const current = getStoredManifest(base)?.tokens.accentPrimary ?? null;
  const bg = readBackground();
  const pick = (c: string | null) => { setLocalAccent(base, c); bump((n) => n + 1); };
  const anyUnknown = DRIVER_ACCENTS.some((c) => accentVerdict(c, bg) === 'UNKNOWN_BACKGROUND');

  return (
    <div className="mt-4">
      <div className="text-[10px] font-black uppercase tracking-[0.2em] mb-2" style={{ color: 'var(--oem-ink-3)' }}>
        Vurgu rengi · bu tema
      </div>
      <div className="flex flex-wrap gap-2 items-center">
        <button type="button" onClick={() => pick(null)} aria-pressed={current === null}
          className="rounded-xl px-3 text-[11px] font-bold active:scale-95"
          style={{ minHeight: 38, background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${current === null ? 'var(--oem-ink-2)' : 'var(--oem-line)'}`, color: 'var(--oem-ink-2)' }}>
          Tema rengi
        </button>
        {DRIVER_ACCENTS.map((c) => {
          const v = accentVerdict(c, bg);
          const blocked = v === 'LOW_CONTRAST';
          const on = current?.toLowerCase() === c.toLowerCase();
          return (
            <button key={c} type="button" onClick={() => pick(c)} disabled={blocked}
              aria-label={blocked ? `${c} — bu zeminde okunmuyor` : `Vurgu rengi ${c}`} aria-pressed={on}
              className="grid place-items-center rounded-full active:scale-95 disabled:opacity-25"
              style={{ width: 38, height: 38, background: c, border: on ? '3px solid var(--oem-ink)' : '2px solid rgba(0,0,0,0.25)' }}>
              {on && <Check className="w-4 h-4" style={{ color: '#fff', filter: 'drop-shadow(0 1px 1px rgba(0,0,0,.6))' }} />}
            </button>
          );
        })}
      </div>
      <div className="text-[11px] mt-2" style={{ color: 'var(--oem-ink-3)' }}>
        {anyUnknown
          ? 'Zemin rengi okunamadı — okunabilirlik denetlenemedi.'
          : `Soluk görünen renkler bu zeminde okunmaz (kontrast ${MIN_ACCENT_CONTRAST}:1 altı).`}
      </div>
    </div>
  );
});
