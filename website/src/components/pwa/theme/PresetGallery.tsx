'use client';
/**
 * PresetGallery — Tema Stüdyo'nun HAZIR RENK ve KART ŞEKLİ taslakları.
 *
 * Seçilen taslak mevcut eylemlerle uygulanır (`patch-tokens` / `patch-screen`):
 * önizleme anında değişir, "Geri Al" tek adımda geri getirir, "Araca Gönder"
 * değişmeden çalışır. Kapsam: TÜM TEMA ya da yalnız SEÇİLİ EKRAN.
 */
import { memo, useMemo, useState } from 'react';
import type { GlobalTokens, ScreenOverride, ThemeBaseId, ThemeManifest } from '../../../lib/theme/themeManifest';
import { colorPresetsFor, SHAPE_PRESETS, screenPatchOf, type ColorPreset, type ShapePreset } from '../../../lib/theme/themePresets';

type Scope = 'theme' | 'screen';

interface Props {
  themeId: ThemeBaseId;
  manifest: ThemeManifest;
  surfaceId: string;
  surfaceLabel: string;
  onPatchTokens: (patch: Partial<GlobalTokens>) => void;
  onPatchScreen: (patch: Partial<ScreenOverride>) => void;
}

const label = 'text-[9px] font-black uppercase tracking-[0.35em] mb-2';

function isColorActive(p: ColorPreset, m: ThemeManifest, scope: Scope, surfaceId: string): boolean {
  if (scope === 'screen') {
    const s = m.screenOverrides[surfaceId];
    return !!s && s.accentPrimary === p.tokens.accentPrimary && s.bg?.from === p.tokens.bgPrimary?.from;
  }
  return m.tokens.accentPrimary === p.tokens.accentPrimary && m.tokens.bgPrimary?.from === p.tokens.bgPrimary?.from;
}

function isShapeActive(p: ShapePreset, m: ThemeManifest, scope: Scope, surfaceId: string): boolean {
  if (scope === 'screen') return m.screenOverrides[surfaceId]?.radiusCard === p.tokens.radiusCard;
  const t = m.tokens;
  return t.radiusCard === p.tokens.radiusCard && t.radiusBtn === p.tokens.radiusBtn
    && t.cardBlurPx === p.tokens.cardBlurPx && t.glowIntensity === p.tokens.glowIntensity;
}

export const PresetGallery = memo(function PresetGallery({
  themeId, manifest, surfaceId, surfaceLabel, onPatchTokens, onPatchScreen,
}: Props) {
  const [scope, setScope] = useState<Scope>('theme');
  const [tab, setTab] = useState<'colors' | 'shapes'>('colors');
  const colors = useMemo(() => colorPresetsFor(themeId), [themeId]);

  const applyColor = (p: ColorPreset) => {
    if (scope === 'theme') onPatchTokens(p.tokens);
    else onPatchScreen(screenPatchOf(p));
  };
  const applyShape = (p: ShapePreset) => {
    if (scope === 'theme') onPatchTokens(p.tokens);
    else onPatchScreen({ radiusCard: p.tokens.radiusCard });
  };

  const pill = (active: boolean) => ({
    minHeight: 38,
    background: active ? 'rgba(96,165,250,0.18)' : 'var(--pwa-surface)',
    color: active ? '#60a5fa' : 'var(--pwa-text-3)',
    border: `1px solid ${active ? 'rgba(96,165,250,0.42)' : 'var(--pwa-border-soft)'}`,
  });

  return (
    <div className="rounded-2xl p-3 flex flex-col gap-3" style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
      <div className="flex items-center justify-between gap-2">
        <p className={label} style={{ color: 'var(--pwa-text-3)', marginBottom: 0 }}>Hazır Taslaklar</p>
        <span className="text-[9px] font-bold" style={{ color: 'var(--pwa-text-3)' }}>Dokun → uygula · Geri Al ile dön</span>
      </div>

      {/* Tür: renk / şekil */}
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" onClick={() => setTab('colors')} className="rounded-xl text-[10px] font-black uppercase tracking-wider active:scale-95" style={pill(tab === 'colors')}>
          Renkler · {colors.length}
        </button>
        <button type="button" onClick={() => setTab('shapes')} className="rounded-xl text-[10px] font-black uppercase tracking-wider active:scale-95" style={pill(tab === 'shapes')}>
          Kart Şekilleri · {SHAPE_PRESETS.length}
        </button>
      </div>

      {/* Kapsam: tüm tema / yalnız bu ekran */}
      <div className="grid grid-cols-2 gap-1.5">
        <button type="button" onClick={() => setScope('theme')} className="rounded-xl text-[10px] font-bold active:scale-95" style={pill(scope === 'theme')}>
          Tüm temaya
        </button>
        <button type="button" onClick={() => setScope('screen')} className="rounded-xl text-[10px] font-bold active:scale-95 truncate px-2" style={pill(scope === 'screen')}>
          Sadece: {surfaceLabel}
        </button>
      </div>
      {scope === 'screen' && tab === 'shapes' && (
        <p className="text-[10px] leading-snug" style={{ color: 'var(--pwa-text-3)' }}>
          Tek ekranda yalnız <b>kart köşesi</b> değişir; düğme, dock ve cam derinliği tüm temada ayarlanır.
        </p>
      )}

      {tab === 'colors' ? (
        <div className="grid grid-cols-2 gap-2">
          {colors.map((p) => {
            const active = isColorActive(p, manifest, scope, surfaceId);
            const [bg, card, accent, ink] = p.swatch;
            return (
              <button
                key={p.id} type="button" onClick={() => applyColor(p)}
                aria-pressed={active}
                className="flex flex-col gap-1.5 p-2 rounded-2xl text-left active:scale-[0.98]"
                style={{ background: active ? `${accent}1f` : 'var(--pwa-surface)', border: `1.5px solid ${active ? accent : 'var(--pwa-border)'}` }}
              >
                <div style={{ background: bg, borderRadius: 10, padding: 6, display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <div style={{ background: card, borderRadius: 6, height: 18, display: 'flex', alignItems: 'center', paddingLeft: 6, gap: 5 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 4, background: accent, display: 'inline-block' }} />
                    <span style={{ height: 4, width: '55%', background: ink, opacity: 0.85, borderRadius: 2, display: 'inline-block' }} />
                  </div>
                  <div style={{ display: 'flex', gap: 4 }}>
                    <span style={{ flex: 1, height: 11, background: card, borderRadius: 4, display: 'inline-block' }} />
                    <span style={{ width: 24, height: 11, background: accent, borderRadius: 4, display: 'inline-block' }} />
                  </div>
                </div>
                <div className="flex items-center justify-between gap-1">
                  <span className="text-[10px] font-black truncate" style={{ color: active ? accent : 'var(--pwa-text-2)' }}>{p.name}</span>
                  {p.mode === 'day' && (
                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(251,191,36,0.14)', color: '#fbbf24' }}>GÜNDÜZ</span>
                  )}
                </div>
                <span className="text-[9px] leading-tight" style={{ color: 'var(--pwa-text-3)' }}>{p.mood}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          {SHAPE_PRESETS.map((p) => {
            const active = isShapeActive(p, manifest, scope, surfaceId);
            const t = p.tokens;
            const accent = manifest.tokens.accentPrimary ?? '#60a5fa';
            return (
              <button
                key={p.id} type="button" onClick={() => applyShape(p)}
                aria-pressed={active}
                className="flex flex-col gap-1.5 p-2 rounded-2xl text-left active:scale-[0.98]"
                style={{ background: active ? 'rgba(96,165,250,0.12)' : 'var(--pwa-surface)', border: `1.5px solid ${active ? '#60a5fa' : 'var(--pwa-border)'}` }}
              >
                {/* Gerçek geometri: kart köşesi, düğme köşesi ve ışıma ölçekli çizilir. */}
                <div style={{ background: 'rgba(0,0,0,0.35)', borderRadius: 10, padding: 7, display: 'flex', gap: 5, alignItems: 'flex-end' }}>
                  <span style={{
                    flex: 1, height: 30, display: 'inline-block',
                    borderRadius: Math.round((t.radiusCard ?? 0) * 0.6),
                    background: 'rgba(255,255,255,0.10)', border: '1px solid rgba(255,255,255,0.14)',
                    boxShadow: (t.glowIntensity ?? 0) > 0 ? `0 0 ${Math.round((t.glowIntensity ?? 0) / 8)}px ${accent}88` : 'none',
                    backdropFilter: (t.cardBlurPx ?? 0) > 0 ? 'blur(4px)' : undefined,
                  }} />
                  <span style={{ width: 30, height: 14, display: 'inline-block', borderRadius: Math.round((t.radiusBtn ?? 0) * 0.6), background: accent }} />
                </div>
                <span className="text-[10px] font-black truncate" style={{ color: active ? '#60a5fa' : 'var(--pwa-text-2)' }}>{p.name}</span>
                <span className="text-[9px] leading-tight" style={{ color: 'var(--pwa-text-3)' }}>{p.mood}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
});
