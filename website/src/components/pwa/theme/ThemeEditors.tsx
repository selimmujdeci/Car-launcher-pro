'use client';

/**
 * ThemeEditors — TAM EKRAN düzenleyiciler (bileşen + tema geneli).
 *
 * Görev §4/§10: kullanıcı önizlemede bir bileşene dokunduğunda küçük bir panelde
 * sıkışmaz — düzenleme TAM EKRAN açılır, geri dönünce değişiklik KAYBOLMAZ
 * (durum reducer'da, editör yalnız görüntüler).
 *
 * Hangi alanların görüneceği bileşenin TİPİNDEN gelir (propsForComponent):
 * harita kartında yazı ölçeği yoktur, kilitli bileşen gizlenemez.
 */

import { memo, useMemo, useState } from 'react';
import {
  FONT_STACKS,
  LAYOUT_GROW_MAX,
  LAYOUT_GROW_MIN,
  LAYOUT_ORD_MAX,
  THEME_PRESETS,
  type CardLayout,
  type ComponentStyle,
  type FontId,
  type GlobalTokens,
  type LayoutSizeClass,
  type ScreenOverride,
  type StateKey,
  type StateStyle,
  type TextAlign,
  type ThemeBaseId,
} from '@/lib/theme/themeManifest';
import {
  layoutCardIdFor,
  propsForComponent,
  type EditableProp,
  type ThemeComponentInfo,
} from '@/lib/theme/themeComponentRegistry';
import { solverEntry, ZONE_LABEL } from '@/lib/theme/themeLayoutBridge';
import {
  ChoiceField,
  ColorField,
  NumberField,
  PaintField,
  SectionTitle,
  TEXT_SWATCHES,
  ToggleField,
} from './ThemeControls';

/* ── Düzenleyici kabuğu ───────────────────────────────────────────────
 * ARTIK TAM EKRAN DEĞİL (2026-08-18). Eskiden `fixed inset-0 · zIndex 60` ile
 * tüm ekranı kaplıyordu; Tema Stüdyo da editör açılınca erken `return`
 * ettiğinden canlı önizleme hem GÖRÜNMÜYOR hem de DOM'dan kalkıyordu (iframe
 * remount → araç uygulaması baştan boot). Kullanıcı bunu şöyle tarif etti:
 * *"ekran sabit kalsın ki yaptığım düzenlemeleri görebileyim."*
 *
 * Kabuk artık sayfa akışında bir PANELDİR: kendi kaydırma kabı YOKTUR — sayfa
 * kaydırılır, önizleme `sticky` olduğu için üstte SABİT kalır. İç scroll
 * bırakmak sticky'yi yapısal olarak öldürürdü.
 *
 * Adı geriye uyum için korunur (dış tüketiciler değişmez); davranışı gömülüdür.
 */

export function FullScreenSheet({
  title, subtitle, onClose, onUndo, onRedo, canUndo, canRedo, footer, children,
}: {
  title: string;
  subtitle: string;
  onClose: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  footer?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-label={title}
      data-theme-editor
      className="flex flex-col pt-3 pb-6"
      style={{ color: 'var(--pwa-text)' }}
    >
      <header
        className="flex items-center gap-2 flex-shrink-0"
        style={{
          paddingTop: 2,
          paddingBottom: 10,
          borderBottom: '1px solid var(--pwa-border-soft)',
        }}
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Geri"
          className="flex items-center justify-center rounded-xl flex-shrink-0 active:scale-95"
          style={{ width: 44, height: 44, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)' }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-black truncate">{title}</p>
          <p className="text-[10px] truncate" style={{ color: 'var(--pwa-text-3)' }}>{subtitle}</p>
        </div>
        {onUndo && (
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            aria-label="Geri al"
            className="flex items-center justify-center rounded-xl flex-shrink-0 active:scale-95"
            style={{ width: 44, height: 44, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', opacity: canUndo ? 1 : 0.35 }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M7 4L3 8l4 4M3 8h9a5 5 0 010 10H8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
        {onRedo && (
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            aria-label="Yinele"
            className="flex items-center justify-center rounded-xl flex-shrink-0 active:scale-95"
            style={{ width: 44, height: 44, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', opacity: canRedo ? 1 : 0.35 }}
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M13 4l4 4-4 4M17 8H8a5 5 0 000 10h4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        )}
      </header>

      {/* Kendi kaydırma kabı YOK — sayfa kaydırılır, önizleme sticky kalır. */}
      <div className="overflow-x-hidden py-3 flex flex-col gap-2.5">
        {children}
      </div>

      {footer && (
        <div
          className="flex gap-2 pt-2.5"
          style={{
            paddingBottom: 'max(4px, env(safe-area-inset-bottom))',
            borderTop: '1px solid var(--pwa-border-soft)',
          }}
        >
          {footer}
        </div>
      )}
    </section>
  );
}

/* ── Bileşen editörü ──────────────────────────────────────────────── */

const FONT_OPTIONS: { id: FontId; label: string }[] = [
  { id: 'system', label: 'Sistem' },
  { id: 'orbitron', label: 'Orbitron' },
  { id: 'rajdhani', label: 'Rajdhani' },
  { id: 'exo2', label: 'Exo 2' },
  { id: 'sharetech', label: 'Share Tech' },
];

const ALIGN_OPTIONS: { id: TextAlign; label: string }[] = [
  { id: 'left', label: 'Sola' },
  { id: 'center', label: 'Ortala' },
  { id: 'right', label: 'Sağa' },
];

const STATE_LABEL: Record<StateKey, string> = {
  active: 'Basılı (active)',
  selected: 'Seçili (aria-selected)',
  disabled: 'Devre dışı (disabled)',
  loading: 'Yükleniyor (aria-busy)',
  error: 'Hata (aria-invalid)',
};

const SIZE_OPTIONS: { id: LayoutSizeClass; label: string }[] = [
  { id: 'S', label: 'Küçük (S)' },
  { id: 'M', label: 'Orta (M)' },
  { id: 'L', label: 'Büyük (L)' },
];

/**
 * Yerleşim bölümü — YALNIZ solver'ı kullanan temada ve solver kart karşılığı
 * olan bileşende çizilir. Alanlar `layoutSolver.CardIntent`in birebir
 * karşılığıdır; burada ikinci bir motor YOKTUR.
 */
const LayoutSection = memo(function LayoutSection({
  themeId, cardId, locked, layout, onPatch, onReset,
}: {
  themeId: ThemeBaseId;
  cardId: string;
  locked: boolean;
  layout: CardLayout;
  onPatch: (patch: Partial<CardLayout>) => void;
  onReset: () => void;
}) {
  const entry = solverEntry(themeId, cardId);
  const touched = layout.visible !== null || layout.size !== null || layout.ord !== null || layout.grow !== null;
  return (
    <>
      <SectionTitle>Yerleşim</SectionTitle>
      <div className="rounded-2xl p-2.5 flex flex-col gap-1"
        style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border-soft)' }}>
        <p className="text-[10px]" style={{ color: 'var(--pwa-text-3)' }}>
          Bölge: <b>{entry ? ZONE_LABEL[entry.zone] : '—'}</b> · solver kartı <code>{cardId}</code>
          {entry?.locked ? ' · kilitli (gizlenemez)' : ''}
        </p>
        <p className="text-[10px]" style={{ color: 'var(--pwa-text-3)' }}>
          Bölge değiştirme ve hizalama <b>desteklenmiyor</b> — mevcut yerleşim motorunda
          (layoutSolver) böyle bir kavram yok; sahte alan gösterilmez.
        </p>
      </div>

      {!locked && (
        <ToggleField
          label="Yerleşimde Görünürlük"
          hint="Gizlenen kart bölgeden çıkar; diğer kartlar yerini alır."
          value={layout.visible}
          onChange={(v) => onPatch({ visible: v })}
        />
      )}
      <ChoiceField
        label="Boyut Sınıfı"
        hint={entry ? `Tema varsayılanı: ${entry.size}` : undefined}
        value={layout.size}
        options={SIZE_OPTIONS}
        onChange={(v) => onPatch({ size: v })}
      />
      <NumberField
        label="Bölge İçi Sıra"
        hint="Küçük sayı önce gelir."
        value={layout.ord}
        min={0}
        max={LAYOUT_ORD_MAX}
        unit=""
        fallback={0}
        onChange={(v) => onPatch({ ord: v })}
      />
      <NumberField
        label="Elle Boyut (ağırlık)"
        hint="Boyut sınıfını ezer; solver sınırı 0,5–5."
        value={layout.grow}
        min={LAYOUT_GROW_MIN}
        max={LAYOUT_GROW_MAX}
        step={0.1}
        unit="×"
        fallback={2}
        onChange={(v) => onPatch({ grow: v })}
      />
      {touched && (
        <button
          type="button"
          onClick={onReset}
          className="text-[11px] font-bold rounded-xl active:scale-95"
          style={{ minHeight: 44, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}
        >
          Yerleşimi Sıfırla
        </button>
      )}
    </>
  );
});

export const ComponentEditor = memo(function ComponentEditor({
  info, style, themeId, layout, hasChanges, onPatch, onPatchState, onPatchLayout, onResetLayout,
  onResetCard, onClose, onUndo, onRedo, canUndo, canRedo,
}: {
  info: ThemeComponentInfo;
  style: ComponentStyle;
  themeId: ThemeBaseId;
  layout: CardLayout;
  /** Kartta Studio değişikliği var mı — sıfırlama düğmesi buna göre açılır. */
  hasChanges: boolean;
  onPatch: (patch: Partial<ComponentStyle>) => void;
  onPatchState: (key: StateKey, patch: Partial<StateStyle>) => void;
  onPatchLayout: (cardId: string, patch: Partial<CardLayout>) => void;
  onResetLayout: (cardId: string) => void;
  /** Kartı başlangıç hâline döndür (stil + yerleşim, TEK adım). */
  onResetCard: () => void;
  onClose: () => void;
  /** KART BAZLI geri al — başka kartın geçmişine dokunmaz. */
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const allowed = useMemo(() => new Set<EditableProp>(propsForComponent(info)), [info]);
  const has = (p: EditableProp) => allowed.has(p);
  const preset = THEME_PRESETS[themeId].base;
  const layoutCardId = layoutCardIdFor(info, themeId);
  const [confirmReset, setConfirmReset] = useState(false);

  return (
    <FullScreenSheet
      title={info.label}
      subtitle={`${info.id} · ${info.type}${info.locked ? ' · kilitli' : ''}`}
      onClose={onClose}
      onUndo={onUndo}
      onRedo={onRedo}
      canUndo={canUndo}
      canRedo={canRedo}
      footer={
        confirmReset ? (
          <>
            <button
              type="button"
              onClick={() => setConfirmReset(false)}
              className="flex-1 text-[12px] font-bold rounded-xl active:scale-95"
              style={{ minHeight: 48, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}
            >
              Vazgeç
            </button>
            <button
              type="button"
              onClick={() => { setConfirmReset(false); onResetCard(); }}
              className="flex-1 text-[12px] font-black rounded-xl active:scale-95"
              style={{ minHeight: 48, background: 'rgba(248,113,113,0.14)', border: '1.5px solid rgba(248,113,113,0.42)', color: '#f87171' }}
            >
              Evet, kartı sıfırla
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              disabled={!hasChanges}
              aria-label="Kartı başlangıç hâline döndür"
              className="text-[12px] font-bold px-3 rounded-xl active:scale-95"
              style={{
                minHeight: 48,
                background: 'var(--pwa-surface)',
                border: '1px solid var(--pwa-border)',
                color: 'var(--pwa-text-2)',
                opacity: hasChanges ? 1 : 0.35,
              }}
            >
              ↺ Kartı Sıfırla
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex-1 text-[13px] font-black rounded-xl active:scale-[0.98]"
              style={{ minHeight: 48, background: 'rgba(96,165,250,0.16)', border: '1.5px solid rgba(96,165,250,0.45)', color: '#60a5fa' }}
            >
              Bitti
            </button>
          </>
        )
      }
    >
      {confirmReset && (
        <div className="rounded-2xl p-3"
          style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.32)' }}>
          <p className="text-[12px] font-bold" style={{ color: '#f87171' }}>
            Bu karttaki tüm Studio değişiklikleri geri alınacak.
          </p>
          <p className="text-[10px] mt-1" style={{ color: 'var(--pwa-text-3)' }}>
            Yalnız <b>{info.label}</b> etkilenir — diğer kartlar, ekranlar ve temalar
            olduğu gibi kalır. Bu işlem tek adımdır ve <b>Geri Al</b> ile iade edilebilir.
          </p>
        </div>
      )}
      {has('visible') && (
        <ToggleField
          label="Görünürlük"
          hint="Gizlenen bileşen araçta hiç çizilmez."
          value={style.visible}
          onChange={(v) => onPatch({ visible: v })}
          disabled={info.locked === true}
          disabledNote="Güvenlik/çerçeve bileşeni — gizlenemez."
        />
      )}

      <SectionTitle>Yüzey</SectionTitle>
      {has('bg') && (
        <PaintField label="Arka Plan" hint="Tek renk veya gradient" value={style.bg} onChange={(v) => onPatch({ bg: v })} />
      )}
      {has('borderColor') && (
        <ColorField label="Kenarlık Rengi" value={style.borderColor} onChange={(v) => onPatch({ borderColor: v })} />
      )}
      {has('borderWidth') && (
        <NumberField label="Kenarlık Kalınlığı" value={style.borderWidth} min={0} max={6} unit="px" fallback={1}
          onChange={(v) => onPatch({ borderWidth: v })} />
      )}
      {has('radius') && (
        <NumberField label="Köşe Yuvarlaklığı" value={style.radius} min={0} max={48} unit="px" fallback={18}
          onChange={(v) => onPatch({ radius: v })} />
      )}
      {has('opacity') && (
        <NumberField label="Saydamlık" value={style.opacity} min={20} max={100} unit="%" fallback={100}
          onChange={(v) => onPatch({ opacity: v })} />
      )}
      {has('glowLevel') && (
        <NumberField label="Parıltı (glow)" value={style.glowLevel} min={0} max={3} unit="" fallback={0}
          hint="Vurgu renginden türetilir" onChange={(v) => onPatch({ glowLevel: v })} />
      )}
      {has('shadowLevel') && (
        <NumberField label="Gölge / Yükseklik" value={style.shadowLevel} min={0} max={3} unit="" fallback={1}
          onChange={(v) => onPatch({ shadowLevel: v })} />
      )}

      {(has('textColor') || has('fontWeight')) && <SectionTitle>Yazı</SectionTitle>}
      {has('textColor') && (
        <ColorField label="Ana Metin" value={style.textColor} onChange={(v) => onPatch({ textColor: v })}
          swatches={['#FFFFFF', preset.textPrimary, '#F5F0E8', '#E2E8F3', '#0C1420']} />
      )}
      {has('textSecondaryColor') && (
        <ColorField label="İkincil Metin" value={style.textSecondaryColor} onChange={(v) => onPatch({ textSecondaryColor: v })}
          swatches={['#94A0B8', preset.textSecondary, '#A89678', '#9A9082', '#606060']} />
      )}
      {has('fontWeight') && (
        <NumberField label="Yazı Kalınlığı" value={style.fontWeight} min={300} max={900} step={100} unit="" fallback={600}
          onChange={(v) => onPatch({ fontWeight: v })} />
      )}
      {has('fontScale') && (
        <NumberField label="Yazı Ölçeği" value={style.fontScale} min={0.8} max={1.5} step={0.05} unit="×" fallback={1}
          onChange={(v) => onPatch({ fontScale: v })} />
      )}
      {has('letterSpacing') && (
        <NumberField label="Harf Aralığı" value={style.letterSpacing} min={-1} max={6} step={0.5} unit="px" fallback={0}
          onChange={(v) => onPatch({ letterSpacing: v })} />
      )}
      {has('lineHeight') && (
        <NumberField label="Satır Yüksekliği" value={style.lineHeight} min={1} max={2.2} step={0.05} unit="" fallback={1.4}
          onChange={(v) => onPatch({ lineHeight: v })} />
      )}
      {has('textAlign') && (
        <ChoiceField label="Hizalama" value={style.textAlign} options={ALIGN_OPTIONS}
          onChange={(v) => onPatch({ textAlign: v })} />
      )}

      {(has('iconColor') || has('accentColor')) && <SectionTitle>İkon & Vurgu</SectionTitle>}
      {has('accentColor') && (
        <ColorField label="Vurgu Rengi" value={style.accentColor} onChange={(v) => onPatch({ accentColor: v })} />
      )}
      {has('iconColor') && (
        <ColorField label="İkon Rengi" value={style.iconColor} onChange={(v) => onPatch({ iconColor: v })} />
      )}
      {has('iconSize') && (
        <NumberField label="İkon Boyutu" value={style.iconSize} min={12} max={48} unit="px" fallback={20}
          onChange={(v) => onPatch({ iconSize: v })} />
      )}

      {(has('padding') || has('gap')) && <SectionTitle>Yerleşim</SectionTitle>}
      {has('padding') && (
        <NumberField label="İç Boşluk (padding)" value={style.padding} min={0} max={40} unit="px" fallback={14}
          onChange={(v) => onPatch({ padding: v })} />
      )}
      {has('gap') && (
        <NumberField label="Öğe Arası (gap)" value={style.gap} min={0} max={32} unit="px" fallback={8}
          onChange={(v) => onPatch({ gap: v })} />
      )}

      {layoutCardId && (
        <LayoutSection
          themeId={themeId}
          cardId={layoutCardId}
          locked={info.locked === true}
          layout={layout}
          onPatch={(p) => onPatchLayout(layoutCardId, p)}
          onReset={() => onResetLayout(layoutCardId)}
        />
      )}

      {has('states') && (
        <>
          <SectionTitle>Durumlar</SectionTitle>
          <p className="text-[10px] px-1 -mt-1" style={{ color: 'var(--pwa-text-3)' }}>
            Durum stilleri GERÇEK DOM kancalarına bağlanır (`:active`, `aria-selected`,
            `disabled`, `aria-busy`, `aria-invalid`). İlgili bileşen o kancayı
            kullanmıyorsa stil uygulanmaz — uydurma bir durum sözleşmesi kurulmaz.
          </p>
          {(Object.keys(STATE_LABEL) as StateKey[]).map((key) => {
            const st = style.states?.[key] ?? null;
            return (
              <div key={key} className="rounded-2xl p-2.5 flex flex-col gap-2"
                style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border-soft)' }}>
                <p className="text-[11px] font-bold" style={{ color: 'var(--pwa-text-2)' }}>{STATE_LABEL[key]}</p>
                <ColorField label="Metin" value={st?.textColor ?? null} onChange={(v) => onPatchState(key, { textColor: v })} swatches={TEXT_SWATCHES} swatchLabel="Yazı Renkleri" />
                <ColorField label="Kenarlık" value={st?.borderColor ?? null} onChange={(v) => onPatchState(key, { borderColor: v })} />
                <PaintField label="Arka Plan" value={st?.bg ?? null} onChange={(v) => onPatchState(key, { bg: v })} />
                <NumberField label="Saydamlık" value={st?.opacity ?? null} min={0} max={100} unit="%" fallback={100}
                  onChange={(v) => onPatchState(key, { opacity: v })} />
              </div>
            );
          })}
        </>
      )}
    </FullScreenSheet>
  );
});

/* ── Tema geneli (global token) editörü ───────────────────────────── */

export const TokensEditor = memo(function TokensEditor({
  themeId, tokens, onPatch, onResetTheme, onClose, onUndo, onRedo, canUndo, canRedo,
}: {
  themeId: ThemeBaseId;
  tokens: GlobalTokens;
  onPatch: (patch: Partial<GlobalTokens>) => void;
  onResetTheme: () => void;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  const preset = THEME_PRESETS[themeId];
  return (
    <FullScreenSheet
      title="Tema Geneli"
      subtitle={`${preset.label} · tüm ekranlarda geçerli tokenlar`}
      onClose={onClose}
      onUndo={onUndo}
      onRedo={onRedo}
      canUndo={canUndo}
      canRedo={canRedo}
      footer={
        <>
          <button
            type="button"
            onClick={onResetTheme}
            className="text-[12px] font-bold px-4 rounded-xl active:scale-95"
            style={{ minHeight: 48, background: 'rgba(248,113,113,0.10)', border: '1px solid rgba(248,113,113,0.32)', color: '#f87171' }}
          >
            Temayı Sıfırla
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 text-[13px] font-black rounded-xl active:scale-[0.98]"
            style={{ minHeight: 48, background: 'rgba(96,165,250,0.16)', border: '1.5px solid rgba(96,165,250,0.45)', color: '#60a5fa' }}
          >
            Bitti
          </button>
        </>
      }
    >
      <SectionTitle>Renkler</SectionTitle>
      <ColorField label="Ana Vurgu" hint={`Tema varsayılanı: ${preset.base.accentPrimary}`}
        value={tokens.accentPrimary} onChange={(v) => onPatch({ accentPrimary: v })} />
      <ColorField label="İkincil Vurgu" hint={`Tema varsayılanı: ${preset.base.accentSecondary}`}
        value={tokens.accentSecondary} onChange={(v) => onPatch({ accentSecondary: v })} />
      <ColorField label="Ana Metin" hint={`Tema varsayılanı: ${preset.base.textPrimary}`}
        value={tokens.textPrimary} onChange={(v) => onPatch({ textPrimary: v })} swatches={TEXT_SWATCHES} swatchLabel="Yazı Renkleri" />
      <ColorField label="İkincil Metin" hint={`Tema varsayılanı: ${preset.base.textSecondary}`}
        value={tokens.textSecondary} onChange={(v) => onPatch({ textSecondary: v })} swatches={TEXT_SWATCHES} swatchLabel="Yazı Renkleri" />
      <ColorField label="Kenarlık" value={tokens.borderColor} onChange={(v) => onPatch({ borderColor: v })} />
      <ColorField label="Parıltı Rengi" value={tokens.glowColor} onChange={(v) => onPatch({ glowColor: v })} />
      <ColorField label="Başarı" value={tokens.successColor} onChange={(v) => onPatch({ successColor: v })} />
      <ColorField label="Uyarı" value={tokens.warningColor} onChange={(v) => onPatch({ warningColor: v })} />
      <ColorField label="Hata" value={tokens.errorColor} onChange={(v) => onPatch({ errorColor: v })} />

      <SectionTitle>Arka Plan</SectionTitle>
      <PaintField label="Ekran Zemini" hint={`Tema varsayılanı: ${preset.base.bgPrimary}`}
        value={tokens.bgPrimary} onChange={(v) => onPatch({ bgPrimary: v })} />
      <PaintField label="Kart Zemini" hint={`Tema varsayılanı: ${preset.base.bgCard}`}
        value={tokens.bgCard} onChange={(v) => onPatch({ bgCard: v })} />

      <SectionTitle>Şekil</SectionTitle>
      <NumberField label="Kart Köşesi" value={tokens.radiusCard} min={0} max={48} unit="px" fallback={18}
        onChange={(v) => onPatch({ radiusCard: v })} />
      <NumberField label="Buton Köşesi" value={tokens.radiusBtn} min={0} max={32} unit="px" fallback={10}
        onChange={(v) => onPatch({ radiusBtn: v })} />
      <NumberField label="Kutucuk Köşesi" value={tokens.radiusTile} min={0} max={36} unit="px" fallback={12}
        onChange={(v) => onPatch({ radiusTile: v })} />
      <NumberField label="Dock Köşesi" value={tokens.radiusDock} min={0} max={32} unit="px" fallback={17}
        onChange={(v) => onPatch({ radiusDock: v })} />

      <SectionTitle>Efekt</SectionTitle>
      <NumberField label="Cam Bulanıklığı" value={tokens.cardBlurPx} min={0} max={40} unit="px" fallback={0}
        hint="Düşük uçlu head unit'te 0 px önerilir (GPU yükü)."
        onChange={(v) => onPatch({ cardBlurPx: v })} />
      <NumberField label="Parıltı Yoğunluğu" value={tokens.glowIntensity} min={0} max={100} unit="%" fallback={40}
        onChange={(v) => onPatch({ glowIntensity: v })} />

      <SectionTitle>Tipografi</SectionTitle>
      <ChoiceField label="Yazı Tipi" value={tokens.fontFamily}
        options={FONT_OPTIONS.map((f) => ({ id: f.id, label: f.label, preview: { fontFamily: FONT_STACKS[f.id] } }))}
        onChange={(v) => onPatch({ fontFamily: v })} />
      <NumberField label="Yazı Kalınlığı" value={tokens.fontWeight} min={300} max={900} step={100} unit="" fallback={600}
        onChange={(v) => onPatch({ fontWeight: v })} />
      <NumberField label="Harf Aralığı" value={tokens.letterSpacing} min={-1} max={6} step={0.5} unit="px" fallback={0}
        onChange={(v) => onPatch({ letterSpacing: v })} />
      <NumberField label="Satır Yüksekliği" value={tokens.lineHeight} min={1} max={2.2} step={0.05} unit="" fallback={1.4}
        onChange={(v) => onPatch({ lineHeight: v })} />
    </FullScreenSheet>
  );
});

/* ── Ekran (surface) editörü ──────────────────────────────────────── */

export const SurfaceEditor = memo(function SurfaceEditor({
  surfaceLabel, surfaceId, override, onPatch, onResetSurface, onClose, onUndo, onRedo, canUndo, canRedo,
}: {
  surfaceLabel: string;
  surfaceId: string;
  override: ScreenOverride;
  onPatch: (patch: Partial<ScreenOverride>) => void;
  onResetSurface: () => void;
  onClose: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}) {
  return (
    <FullScreenSheet
      title={`${surfaceLabel} — Ekran Ayarı`}
      subtitle={`${surfaceId} · yalnız bu ekranda geçerli`}
      onClose={onClose}
      onUndo={onUndo}
      onRedo={onRedo}
      canUndo={canUndo}
      canRedo={canRedo}
      footer={
        <>
          <button
            type="button"
            onClick={onResetSurface}
            className="text-[12px] font-bold px-4 rounded-xl active:scale-95"
            style={{ minHeight: 48, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}
          >
            Ekranı Sıfırla
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 text-[13px] font-black rounded-xl active:scale-[0.98]"
            style={{ minHeight: 48, background: 'rgba(96,165,250,0.16)', border: '1.5px solid rgba(96,165,250,0.45)', color: '#60a5fa' }}
          >
            Bitti
          </button>
        </>
      }
    >
      <ColorField label="Ekran Vurgusu" value={override.accentPrimary} onChange={(v) => onPatch({ accentPrimary: v })} />
      <ColorField label="Ana Metin" value={override.textPrimary} onChange={(v) => onPatch({ textPrimary: v })} swatches={TEXT_SWATCHES} swatchLabel="Yazı Renkleri" />
      <ColorField label="İkincil Metin" value={override.textSecondary} onChange={(v) => onPatch({ textSecondary: v })} swatches={TEXT_SWATCHES} swatchLabel="Yazı Renkleri" />
      <PaintField label="Ekran Zemini" value={override.bg} onChange={(v) => onPatch({ bg: v })} />
      <NumberField label="Kart Köşesi" value={override.radiusCard} min={0} max={48} unit="px" fallback={18}
        onChange={(v) => onPatch({ radiusCard: v })} />
    </FullScreenSheet>
  );
});
