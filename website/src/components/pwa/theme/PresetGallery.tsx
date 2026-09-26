'use client';
/**
 * PresetGallery — Tema Stüdyo'nun HAZIR RENK ve KART ŞEKLİ taslakları.
 *
 * Seçilen taslak mevcut eylemlerle uygulanır (`patch-tokens` / `patch-screen`):
 * önizleme anında değişir, "Geri Al" tek adımda geri getirir, "Araca Gönder"
 * değişmeden çalışır. Kapsam: TÜM TEMA ya da yalnız SEÇİLİ EKRAN.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { GlobalTokens, ScreenOverride, ThemeBaseId, ThemeManifest } from '../../../lib/theme/themeManifest';
import { colorPresetsFor, SHAPE_PRESETS, screenPatchOf, type ColorPreset, type ShapePreset } from '../../../lib/theme/themePresets';
import { extractPhotoColors, palettesFromPhoto, readPhotoPixels } from '../../../lib/theme/photoPalette';

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
  themeId, manifest, surfaceId, surfaceLabel, onApplyPreset, onPatchScreen,
}: Props) {
  const [scope, setScope] = useState<Scope>('theme');
  const [tab, setTab] = useState<'colors' | 'shapes'>('colors');
  const colors = useMemo(() => colorPresetsFor(themeId), [themeId]);

  const applyColor = (p: ColorPreset) => {
    if (scope === 'theme') onApplyPreset('color', p.tokens);
    else onPatchScreen(screenPatchOf(p));
  };
  const [photo, setPhoto] = useState<{ url: string; presets: ColorPreset[] } | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoNote, setPhotoNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => () => { if (photo) URL.revokeObjectURL(photo.url); }, [photo]);
  /* Fotoğraf CİHAZDA okunur (küçük tuval) — hiçbir yere yüklenmez. */
  const onPhoto = async (file: File | undefined) => {
    if (!file) return;
    setPhotoBusy(true); setPhotoNote(null);
    const px = await readPhotoPixels(file);
    const presets = px ? palettesFromPhoto(extractPhotoColors(px)) : [];
    setPhotoBusy(false);
    if (presets.length === 0) {
      setPhotoNote(px ? 'Bu fotoğrafta belirgin renk bulamadım — başka bir tane dener misin?' : 'Fotoğraf okunamadı.');
      return;
    }
    setPhoto({ url: URL.createObjectURL(file), presets });
  };

  const applyShape = (p: ShapePreset) => {
    if (scope === 'theme') onApplyPreset('shape', p.tokens);
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
        <span className="text-[9px] font-bold" style={{ color: 'var(--pwa-text-3)' }}>Kaydır ya da dokun · Geri Al ile dön</span>
      </div>

      {/* ── Fotoğraftan tema (Samsung Theme Park deseni) ── */}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" data-testid="photo-input"
        onChange={(e) => { void onPhoto(e.target.files?.[0]); e.target.value = ''; }} />
      {!photo && (
        <button type="button" onClick={() => fileRef.current?.click()} disabled={photoBusy}
          className="rounded-xl text-[12px] font-black active:scale-[0.98]"
          style={{ minHeight: 46, background: 'rgba(96,165,250,0.14)', border: '1.5px solid rgba(96,165,250,0.4)', color: '#60a5fa' }}>
          {photoBusy ? 'Renkler çıkarılıyor…' : '📷 Fotoğraftan tema'}
        </button>
      )}
      {photoNote && <p className="text-[11px] leading-snug" style={{ color: '#fbbf24' }}>{photoNote}</p>}
      {photo && (
        <div className="rounded-2xl p-2.5 flex flex-col gap-2.5" style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)' }}>
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo.url} alt="Seçilen fotoğraf" className="rounded-xl object-cover flex-shrink-0" style={{ width: 64, height: 64 }} />
            <div className="flex-1 min-w-0">
              <p className="text-[12px] font-black" style={{ color: 'var(--pwa-text)' }}>Fotoğraftan {photo.presets.length} palet</p>
              <div className="flex gap-1 mt-1">
                {photo.presets.map((p) => (
                  <span key={p.id} className="rounded-full" style={{ width: 14, height: 14, background: p.tokens.accentPrimary ?? undefined, border: '1px solid rgba(255,255,255,0.25)' }} />
                ))}
              </div>
            </div>
          </div>
          <PaletteRail
            presets={photo.presets}
            resetKey={photo.url}
            isActive={(p) => isColorActive(p, manifest, scope, surfaceId)}
            onApply={applyColor}
          />
          <div className="grid grid-cols-2 gap-1.5">
            <button type="button" onClick={() => fileRef.current?.click()} className="rounded-xl text-[11px] font-bold active:scale-95" style={pill(false)}>Başka fotoğraf</button>
            <button type="button" onClick={() => setPhoto(null)} className="rounded-xl text-[11px] font-bold active:scale-95" style={pill(false)}>Kapat</button>
          </div>
        </div>
      )}

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
        <PaletteRail
          presets={colors}
          resetKey={`${themeId}:${scope}`}
          isActive={(p) => isColorActive(p, manifest, scope, surfaceId)}
          onApply={applyColor}
        />
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

/**
 * Kaydırmalı palet şeridi (Apple kilit ekranı deseni). Kullanıcı kaydırıp
 * bırakınca ORTADAKİ palet uygulanır — yalnız kullanıcı kaydırdıysa; açılışta ya
 * da programatik ortalamada hiçbir şey kendiliğinden uygulanmaz. Dokunmak da uygular.
 */
const PaletteRail = memo(function PaletteRail({ presets, resetKey, isActive, onApply }: {
  presets: readonly ColorPreset[];
  /** Değişince seçili palet yeniden ortalanır (tema/kapsam/fotoğraf). */
  resetKey: string;
  isActive: (p: ColorPreset) => boolean;
  onApply: (p: ColorPreset) => void;
}) {
  const railRef = useRef<HTMLDivElement | null>(null);
  const userScroll = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [centerIdx, setCenterIdx] = useState(-1);
  const latest = useRef({ presets, isActive, onApply });
  latest.current = { presets, isActive, onApply };
  useEffect(() => () => { if (settleTimer.current) clearTimeout(settleTimer.current); }, []);
  const onScroll = useCallback(() => {
    if (settleTimer.current) clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => {
      const rail = railRef.current;
      if (!rail) return;
      const mid = rail.scrollLeft + rail.clientWidth / 2;
      let best = -1; let bestD = Infinity;
      rail.querySelectorAll<HTMLElement>('[data-idx]').forEach((e) => {
        const d = Math.abs(e.offsetLeft + e.offsetWidth / 2 - mid);
        if (d < bestD) { bestD = d; best = Number(e.dataset.idx); }
      });
      setCenterIdx(best);
      if (!userScroll.current || best < 0) return;
      userScroll.current = false;
      const { presets: ps, isActive: act, onApply: apply } = latest.current;
      const p = ps[best];
      if (p && !act(p)) apply(p);
    }, 280);
  }, []);
  const markUser = () => { userScroll.current = true; };
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;
    const { presets: ps, isActive: act } = latest.current;
    const idx = Math.max(0, ps.findIndex((p) => act(p)));
    const el = rail.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    if (el) rail.scrollLeft = el.offsetLeft + el.offsetWidth / 2 - rail.clientWidth / 2;
    setCenterIdx(idx);
  }, [resetKey]);

  return (
    <>
      <div
        ref={railRef}
        onScroll={onScroll}
        onPointerDown={markUser}
        onTouchStart={markUser}
        onWheel={markUser}
        className="flex gap-2 overflow-x-auto snap-x snap-mandatory -mx-3"
        style={{ scrollbarWidth: 'none' }}
        data-testid="preset-rail"
      >
        {/* Kenar tutucular: ilk/son kart da ORTAYA oturabilsin. */}
        <span aria-hidden className="flex-shrink-0" style={{ width: '24%' }} />
        {presets.map((p, i) => {
          const active = isActive(p);
          const [bg, card, accent, ink] = p.swatch;
          return (
            <button
              key={p.id} type="button" onClick={() => onApply(p)}
              aria-pressed={active}
              data-idx={i}
              className="snap-center flex-shrink-0 flex flex-col gap-1.5 p-2 rounded-2xl text-left active:scale-[0.98] transition-transform"
              style={{
                width: '48%',
                transform: i === centerIdx ? 'scale(1)' : 'scale(0.94)',
                background: active ? `${accent}1f` : 'var(--pwa-surface)', border: `1.5px solid ${active ? accent : 'var(--pwa-border)'}`,
              }}
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
                {p.mode === 'sun' && (
                  <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(249,115,22,0.16)', color: '#f97316' }}>☀ GÜNEŞ</span>
                )}
              </div>
              <span className="text-[9px] leading-tight" style={{ color: 'var(--pwa-text-3)' }}>{p.mood}</span>
            </button>
          );
        })}
        <span aria-hidden className="flex-shrink-0" style={{ width: '24%' }} />
      </div>
      <div className="flex justify-center gap-1" aria-hidden>
        {presets.map((p, i) => (
          <span key={p.id} className="rounded-full" style={{
            width: i === centerIdx ? 14 : 5, height: 5,
            background: i === centerIdx ? '#60a5fa' : 'var(--pwa-border)', transition: 'width 160ms',
          }} />
        ))}
      </div>
    </>
  );
});
