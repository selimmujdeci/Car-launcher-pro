'use client';
/**
 * PresetGallery — Tema Stüdyo'nun HAZIR RENK ve KART ŞEKLİ taslakları.
 *
 * Seçilen taslak mevcut eylemlerle uygulanır (`patch-tokens` / `patch-screen`):
 * önizleme anında değişir, "Geri Al" tek adımda geri getirir, "Araca Gönder"
 * değişmeden çalışır. Kapsam: TÜM TEMA ya da yalnız SEÇİLİ EKRAN.
 */
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Icon } from '../ui/Icon';
import { SegmentedButton } from '../ui/primitives';
import type { GlobalTokens, ScreenOverride, ThemeBaseId, ThemeManifest } from '../../../lib/theme/themeManifest';
import { colorPresetsFor, PRESET_MODE_LABEL, SHAPE_PRESETS, screenPatchOf, type ColorPreset, type PresetMode, type ShapePreset } from '../../../lib/theme/themePresets';
import { extractPhotoColors, palettesFromColor, readPhotoPixels, type PhotoColor } from '../../../lib/theme/photoPalette';

type Scope = 'theme' | 'screen';

interface Props {
  themeId: ThemeBaseId;
  manifest: ThemeManifest;
  surfaceId: string;
  surfaceLabel: string;
  /** Tüm temaya uygulama — ekran/bileşen düzeyindeki eski renk/köşe ayarları da temizlenir. */
  onApplyPreset: (kind: 'color' | 'shape', tokens: Partial<GlobalTokens>) => void;
  onPatchScreen: (patch: Partial<ScreenOverride>) => void;
}

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
  themeId, manifest, surfaceId, surfaceLabel, onApplyPreset, onPatchScreen,
}: Props) {
  const [scope, setScope] = useState<Scope>('theme');
  const [tab, setTab] = useState<'colors' | 'shapes'>('colors');
  const colors = useMemo(() => colorPresetsFor(themeId), [themeId]);

  const applyColor = (p: ColorPreset) => {
    if (scope === 'theme') onApplyPreset('color', p.tokens);
    else onPatchScreen(screenPatchOf(p));
  };
  /* Google yöntemi: önce fotoğraftaki RENKLER (en fazla 4), kullanıcı rengi seçer, sonra stili. */
  const [photo, setPhoto] = useState<{ url: string; colors: PhotoColor[]; pick: number } | null>(null);
  const photoPresets = useMemo(
    () => (photo ? palettesFromColor(photo.colors[photo.pick]) : []),
    [photo],
  );
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const photoUrl = photo?.url;
  useEffect(() => () => { if (photoUrl) URL.revokeObjectURL(photoUrl); }, [photoUrl]);
  /* Fotoğraf CİHAZDA okunur (küçük tuval) — hiçbir yere yüklenmez. */
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true); setPhotoNote(null);
    const px = await readPhotoPixels(file);
    const found = px ? extractPhotoColors(px) : [];
    setPhotoBusy(false);
    if (found.length === 0) {
      setPhotoNote(px ? 'Bu fotoğrafta belirgin renk bulamadım — başka bir tane dener misin?' : 'Fotoğraf okunamadı.');
      return;
    }
    setPhoto({ url: URL.createObjectURL(file), colors: found, pick: 0 });
  };

  const applyShape = (p: ShapePreset) => {
    if (scope === 'theme') onApplyPreset('shape', p.tokens);
    else onPatchScreen({ radiusCard: p.tokens.radiusCard });
  };

  /* Kapsam çipi (M3 filter chip). */
  const chip = (active: boolean): React.CSSProperties => ({
    minHeight: 32, borderRadius: 'var(--md-shape-sm)',
    background: active ? 'var(--md-secondary-container)' : 'transparent',
    color: active ? 'var(--md-on-secondary-container)' : 'var(--md-on-surface-variant)',
    border: active ? '1px solid transparent' : '1px solid var(--md-outline)',
  });
  const shapeBg = manifest.tokens.bgPrimary?.from ?? '#1B1B1F';
  const shapeCard = manifest.tokens.bgCard?.from ?? '#2A2A30';
  const shapeAccent = manifest.tokens.accentPrimary ?? 'var(--md-primary)';

  return (
    <section className="flex flex-col gap-4" aria-label="Renk ve kart şekli">
      {/* Tür: renk / şekil — M3 segment */}
      <SegmentedButton<'colors' | 'shapes'>
        label="Taslak türü"
        value={tab}
        onChange={setTab}
        options={[
          { id: 'colors', label: 'Renkler', icon: 'palette' },
          { id: 'shapes', label: 'Kart Şekilleri', icon: 'rounded_corner' },
        ]}
      />

      {/* Kapsam: tüm tema / yalnız bu ekran */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="md-label-l md-on-surface-variant mr-1">Uygula:</span>
        <button type="button" onClick={() => setScope('theme')} aria-pressed={scope === 'theme'}
          className="md-state md-label-l inline-flex items-center gap-1.5 px-3" style={chip(scope === 'theme')}>
          {scope === 'theme' && <Icon name="check_circle" size={18} />}Tüm temaya
        </button>
        <button type="button" onClick={() => setScope('screen')} aria-pressed={scope === 'screen'}
          className="md-state md-label-l inline-flex items-center gap-1.5 px-3 max-w-[60%]" style={chip(scope === 'screen')}>
          {scope === 'screen' && <Icon name="check_circle" size={18} />}
          <span className="truncate">Sadece: {surfaceLabel}</span>
        </button>
      </div>
      {scope === 'screen' && tab === 'shapes' && (
        <p className="md-body-s md-on-surface-variant -mt-2">
          Tek ekranda yalnız <b>kart köşesi</b> değişir; düğme, dock ve cam derinliği tüm temada ayarlanır.
        </p>
      )}

      {tab === 'colors' ? (
        <>
          {/* ── Fotoğraftan tema — fotoğraf CİHAZDA okunur, yüklenmez ── */}
          <input ref={fileRef} type="file" accept="image/*" className="hidden" data-testid="photo-input"
            onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
          {!photo && (
            <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}
              className="md-state md-card-filled flex items-center gap-4 px-4 py-3 text-left md-on-surface disabled:opacity-60">
              <span aria-hidden="true" className="w-10 h-10 flex items-center justify-center flex-shrink-0"
                style={{ borderRadius: 'var(--md-shape-full)', background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)' }}>
                <Icon name="add_photo_alternate" size={22} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="block md-title-s md-on-surface">{photoBusy ? 'Renkler çıkarılıyor…' : 'Fotoğraftan tema'}</span>
                <span className="block md-body-s md-on-surface-variant">Aracınızın ya da sevdiğiniz bir fotoğrafın renkleriyle</span>
              </span>
              <Icon name="chevron_right" className="md-on-surface-variant flex-shrink-0" />
            </button>
          )}
          {photoNote && <p className="md-body-s" style={{ color: 'var(--md-warning)' }}>{photoNote}</p>}
          {photo && (
            <div className="md-card-filled p-3 flex flex-col gap-3">
              <div className="flex items-center gap-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={photo.url} alt="Seçilen fotoğraf" className="object-cover flex-shrink-0"
                  style={{ width: 64, height: 64, borderRadius: 'var(--md-shape-md)' }} />
                <div className="flex-1 min-w-0">
                  <p className="md-title-s md-on-surface">Fotoğraftaki renkler · birini seçin</p>
                  <div className="flex gap-2 mt-2">
                    {photo.colors.map((c, i) => (
                      <button key={c.hex} type="button" aria-label={`Renk ${c.hex}`} aria-pressed={i === photo.pick}
                        onClick={() => setPhoto((ph) => (ph ? { ...ph, pick: i } : ph))}
                        className="rounded-full flex items-center justify-center"
                        style={{ width: 40, height: 40, background: c.hex,
                          outline: i === photo.pick ? '2px solid var(--md-on-surface)' : 'none', outlineOffset: 2 }}>
                        {i === photo.pick && <Icon name="check_circle" size={18} style={{ color: '#fff', filter: 'drop-shadow(0 0 2px rgba(0,0,0,.6))' }} />}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <PaletteGrid
                presets={photoPresets}
                isActive={(p) => isColorActive(p, manifest, scope, surfaceId)}
                onApply={applyColor}
              />
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setPhoto(null)} className="md-btn-text md-state min-h-12">Kapat</button>
                <button type="button" onClick={() => fileRef.current?.click()} className="md-btn-tonal md-state min-h-12">Başka fotoğraf</button>
              </div>
            </div>
          )}

          {/* ── Hazır renkler — gruplu ızgara (karşılaştırmak kolay) ── */}
          {(['night', 'day', 'sun'] as PresetMode[]).map((mode) => {
            const group = colors.filter((p) => p.mode === mode);
            if (group.length === 0) return null;
            return (
              <div key={mode} className="flex flex-col gap-2">
                <p className="md-title-s md-on-surface px-1 inline-flex items-center gap-1.5">
                  <Icon name={mode === 'night' ? 'dark_mode' : mode === 'day' ? 'light_mode' : 'wb_sunny'} size={18} />
                  {PRESET_MODE_LABEL[mode]}
                  {mode === 'sun' && <span className="md-body-s md-on-surface-variant">· parlak güneşte en okunur</span>}
                </p>
                <PaletteGrid
                  presets={group}
                  isActive={(p) => isColorActive(p, manifest, scope, surfaceId)}
                  onApply={applyColor}
                />
              </div>
            );
          })}
        </>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {SHAPE_PRESETS.map((p) => {
            const active = isShapeActive(p, manifest, scope, surfaceId);
            const t = p.tokens;
            return (
              <button
                key={p.id} type="button" onClick={() => applyShape(p)}
                aria-pressed={active}
                className="md-state relative flex flex-col gap-2 p-2 text-left"
                style={{ borderRadius: 'var(--md-shape-lg)', background: 'var(--md-surface-container-low)',
                  outline: active ? '2px solid var(--md-primary)' : '1px solid var(--md-outline-variant)', outlineOffset: active ? 0 : -1 }}
              >
                {/* Gerçek geometri, bu temanın RENKLERİYLE: kart köşesi, düğme köşesi, ışıma. */}
                <div style={{ background: shapeBg, borderRadius: 10, padding: 8, display: 'flex', gap: 6, alignItems: 'flex-end' }}>
                  <span style={{
                    flex: 1, height: 34, display: 'inline-block',
                    borderRadius: Math.round((t.radiusCard ?? 0) * 0.6),
                    background: shapeCard,
                    boxShadow: (t.glowIntensity ?? 0) > 0 ? `0 0 ${Math.round((t.glowIntensity ?? 0) / 6)}px ${shapeAccent}` : 'none',
                  }} />
                  <span style={{ width: 32, height: 16, display: 'inline-block', borderRadius: Math.round((t.radiusBtn ?? 0) * 0.6), background: shapeAccent }} />
                </div>
                <span className="px-1 pb-1">
                  <span className="block md-title-s md-on-surface truncate">{p.name}</span>
                  <span className="block md-body-s md-on-surface-variant">{p.mood}</span>
                </span>
                {active && (
                  <span className="absolute top-3 right-3 flex" style={{ color: 'var(--md-primary)' }}>
                    <Icon name="check_circle_fill" size={22} />
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
});

/**
 * Palet ızgarası — her kart gerçek bir mini gösterge paneli çizer (zemin,
 * kart, vurgu ibresi, yazı). Dokunmak uygular; kaydırmak HİÇBİR ŞEY uygulamaz
 * (eski şerit kaydırılınca kendiliğinden tema değiştiriyordu — şaşırtıcıydı).
 */
const PaletteGrid = memo(function PaletteGrid({ presets, isActive, onApply }: {
  presets: readonly ColorPreset[];
  isActive: (p: ColorPreset) => boolean;
  onApply: (p: ColorPreset) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {presets.map((p) => {
        const active = isActive(p);
        const [bg, card, accent, ink] = p.swatch;
        const ink2 = p.tokens.textSecondary ?? ink;
        return (
          <button
            key={p.id} type="button" onClick={() => onApply(p)}
            aria-pressed={active}
            className="md-state relative flex flex-col gap-2 p-2 text-left"
            style={{ borderRadius: 'var(--md-shape-lg)', background: 'var(--md-surface-container-low)',
              outline: active ? '2px solid var(--md-primary)' : '1px solid var(--md-outline-variant)', outlineOffset: active ? 0 : -1 }}
          >
            {/* Mini kabin ekranı */}
            <div aria-hidden="true" style={{ background: bg, borderRadius: 10, padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 6 }}>
                <div style={{ flex: 1, background: card, borderRadius: 6, padding: '6px 7px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span style={{ height: 5, width: '70%', background: ink, borderRadius: 2 }} />
                  <span style={{ height: 4, width: '45%', background: ink2, borderRadius: 2, opacity: 0.9 }} />
                </div>
                <div style={{ width: 34, background: card, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  <span style={{ width: 18, height: 18, borderRadius: 9, border: `3px solid ${accent}`, borderRightColor: 'transparent' }} />
                </div>
              </div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <span style={{ flex: 1, height: 4, background: card, borderRadius: 2, overflow: 'hidden', display: 'flex' }}>
                  <span style={{ width: '62%', background: accent }} />
                </span>
                <span style={{ width: 26, height: 12, background: accent, borderRadius: 6 }} />
              </div>
            </div>
            <span className="px-1 pb-1">
              <span className="block md-title-s md-on-surface truncate">{p.name}</span>
              <span className="block md-body-s md-on-surface-variant">{p.mood}</span>
            </span>
            {active && (
              <span className="absolute top-3 right-3 flex rounded-full" style={{ color: 'var(--md-primary)', background: 'var(--md-surface-container-low)' }}>
                <Icon name="check_circle_fill" size={22} />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
});
