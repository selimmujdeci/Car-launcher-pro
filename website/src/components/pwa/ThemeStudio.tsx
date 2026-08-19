'use client';

/**
 * Tema Stüdyo — Arabam Cebimde
 *
 * Akış:  4 GERÇEK tema → ekran seç → önizlemede bileşene DOKUN → TAM EKRAN düzenle
 *        → canlı önizleme → geri al/yinele/seviyeli sıfırla → Araca Gönder.
 *
 * MİMARİ
 *  - Durum: `themeStudioState` (saf reducer, tema başına manifest, undo/redo).
 *  - Sözleşme: `themeManifest` v3 (sürümlü, doğrulanır, fail-closed taşınır;
 *    yerleşim niyeti de manifest'in parçasıdır — çözümü hâlâ layoutSolver yapar).
 *  - Kimlik: `themeComponentRegistry` (kararlı componentId — DOM seçici DEĞİL).
 *  - Önizleme: gerçek araç uygulaması iframe'de; postMessage ile canlı manifest.
 *  - Dokun & Düzenle: araç yalnız GEOMETRİ ÖLÇÜMÜ bildirir; seçim katmanı bu
 *    dosyanın kendi overlay'idir → dokunuş iframe'e ulaşmaz, araç DOM'una yazılmaz.
 *  - Araca Gönder: mevcut `theme_change` komutu (yeni `manifest` alanı + eski
 *    `theme`/`themeVars` alanları geri-uyum için KORUNUR).
 */

import {
  memo, useCallback, useEffect, useMemo, useReducer, useRef, useState,
} from 'react';
import { sendCommand } from '@/lib/commandService';
import {
  manifestToCssVars,
  THEME_BASE_IDS,
  THEME_PRESETS,
  type CardLayout,
  type ComponentStyle,
  type GlobalTokens,
  type ScreenOverride,
  type StateKey,
  type StateStyle,
  type ThemeBaseId,
} from '@/lib/theme/themeManifest';
import {
  componentsForSurface,
  getThemeComponent,
  isLayoutCapableTheme,
  layoutCardIdFor,
  surfacesForTheme,
  type ThemeSurfaceId,
} from '@/lib/theme/themeComponentRegistry';
import { solvePreview, ZONE_LABEL } from '@/lib/theme/themeLayoutBridge';
import { distinctProbeIds, resolveProbeSelection, sanitizeProbeItems, type ProbeItem } from '@/lib/theme/themeProbe';
import {
  canRedo as canRedoOf,
  canRedoScoped,
  canUndo as canUndoOf,
  canUndoScoped,
  cardHasChanges,
  cardLayoutOf,
  cardScope,
  componentStyleOf,
  screenScope,
  tokensScope,
  createStudioState,
  customizationCount,
  deserializeStudio,
  migrateLegacyStudio,
  screenOverrideOf,
  serializeStudio,
  studioReducer,
  STUDIO_LEGACY_KEY,
  STUDIO_STORAGE_KEY,
} from '@/lib/theme/themeStudioState';
import { ComponentEditor, SurfaceEditor, TokensEditor } from './theme/ThemeEditors';

/* ── Önizleme hedefi (gerçek araç uygulaması) ─────────────────────── */

const PREVIEW_URL = 'https://car-launcher-pro.vercel.app/';
const PREVIEW_ORIGIN = 'https://car-launcher-pro.vercel.app';
const PREVIEW_W = 1180;
const PREVIEW_H = 720;

const PERSIST_DEBOUNCE_MS = 1000;

type SyncState = 'idle' | 'sending' | 'ok' | 'fail';
type EditorTarget =
  | { kind: 'none' }
  | { kind: 'tokens' }
  | { kind: 'surface'; surface: ThemeSurfaceId }
  | { kind: 'component'; componentId: string };

interface Props { vehicleId: string | null }

export const ThemeStudio = memo(function ThemeStudio({ vehicleId }: Props) {
  const [state, dispatch] = useReducer(studioReducer, undefined, createStudioState);
  const [editor, setEditor] = useState<EditorTarget>({ kind: 'none' });
  const [sync, setSync] = useState<SyncState>('idle');
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [probe, setProbe] = useState<ProbeItem[] | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  /** Ölçümden gelen kimlikler = o an araçta GERÇEKTEN çizili bileşenler. */
  const inventory = useMemo(() => (probe === null ? null : probe.map((p) => p.id)), [probe]);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [scale, setScale] = useState(0.3);

  const manifest = state.manifests[state.themeId];
  const preset = THEME_PRESETS[state.themeId];
  const surfaces = useMemo(() => surfacesForTheme(state.themeId), [state.themeId]);
  const components = useMemo(
    () => componentsForSurface(state.themeId, state.surface),
    [state.themeId, state.surface],
  );

  /* ── Kalıcılık: yükle (bir kez) ─────────────────────────────────── */
  useEffect(() => {
    mountedRef.current = true;
    try {
      const raw = localStorage.getItem(STUDIO_STORAGE_KEY);
      if (raw) {
        const p = deserializeStudio(raw);
        dispatch({ type: 'hydrate', manifests: p.manifests, themeId: p.themeId });
      } else {
        // v1 Tema Stüdyo emeği çöpe atılmaz — tanınırsa taşınır.
        const legacy = migrateLegacyStudio(localStorage.getItem(STUDIO_LEGACY_KEY));
        if (legacy) dispatch({ type: 'hydrate', manifests: legacy.manifests, themeId: legacy.themeId });
      }
    } catch { /* fail-soft: varsayılan durumla devam */ }
    return () => {
      mountedRef.current = false;
      if (persistTimer.current) clearTimeout(persistTimer.current);
      if (syncTimer.current) clearTimeout(syncTimer.current);
    };
  }, []);

  /* ── Kalıcılık: yaz (kısıtlanmış — slider sürüklerken her karede yazma) ── */
  useEffect(() => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => {
      try { localStorage.setItem(STUDIO_STORAGE_KEY, serializeStudio(state)); } catch { /* kota/gizli mod */ }
    }, PERSIST_DEBOUNCE_MS);
    return () => { if (persistTimer.current) clearTimeout(persistTimer.current); };
  }, [state]);

  /* ── Önizleme: manifest yayını ──────────────────────────────────── */
  const postPreview = useCallback((m = manifest) => {
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'caros-theme-manifest', manifest: m }, PREVIEW_ORIGIN,
      );
    } catch { /* ignore */ }
  }, [manifest]);

  useEffect(() => {
    if (previewReady) postPreview(manifest);
  }, [manifest, previewReady, postPreview]);

  /** Araçtan güncel geometri iste (araç DOM'una hiçbir şey yazmaz). */
  const requestProbe = useCallback(() => {
    try {
      iframeRef.current?.contentWindow?.postMessage({ type: 'caros-preview-probe' }, PREVIEW_ORIGIN);
    } catch { /* ignore */ }
  }, []);

  /* ── ÖNİZLEME GEZİNMESİ ──────────────────────────────────────────────
   * KAPATILAN BOŞLUK: ekran seçilince önizleme O EKRANA GİTMİYORDU — iframe
   * ana ekranda kalıyordu. Kullanıcı Ayarlar/Bildirim/İklim düzenlerken
   * sonucu GÖREMİYOR, körlemesine renk seçiyordu. Bu, yeni eklenen ekranlara
   * özgü DEĞİLDİ: mevcut on çekmece ekranı da aynı durumdaydı.
   *
   * Hedef eşlemesi ARAÇ tarafında yaşar (`themePreviewBridge.SURFACE_DRAWER`);
   * burada yalnız kayıt defterindeki yüzey kimliği yollanır — çekmece kavramı
   * PWA'ya sızdırılmaz ve ikinci bir eşleme tablosu KURULMAZ. */
  useEffect(() => {
    if (!previewReady) return;
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'caros-preview-surface', surface: state.surface }, PREVIEW_ORIGIN,
      );
    } catch { /* ignore */ }
    /* Ekran değişince kutular tamamen değişir → taze ölçüm şart. */
    requestProbe();
  }, [state.surface, previewReady, requestProbe]);

  /* ── Önizleme: araçtan gelen mesajlar ───────────────────────────── */
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.origin !== PREVIEW_ORIGIN) return;
      const d = e.data as { type?: string; items?: unknown } | null;
      if (!d || typeof d.type !== 'string') return;
      if (d.type === 'caros-preview-ready') {
        setPreviewReady(true);
      } else if (d.type === 'caros-preview-probe-result') {
        // Zero-trust: kayıt defterinde olmayan kimlik / bozuk kutu DÜŞÜRÜLÜR.
        setProbe(sanitizeProbeItems(d.items));
      }
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  /* Seçim modu açılınca taze ölçüm iste (kutular kaymış olabilir). */
  useEffect(() => {
    if (selectMode && previewReady) requestProbe();
  }, [selectMode, previewReady, requestProbe]);

  /** Overlay'den bileşen seçimi — bileşen listesiyle AYNI yolu kullanır. */
  const openComponent = useCallback((componentId: string) => {
    const info = resolveProbeSelection(componentId);
    if (!info) return;
    dispatch({ type: 'select-surface', surface: info.surface });
    dispatch({ type: 'open-editor', componentId: info.id });
    setEditor({ kind: 'component', componentId: info.id });
  }, []);

  /* ── Önizleme ölçekleme ─────────────────────────────────────────── */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const compute = () => setScale(el.clientWidth / PREVIEW_W);
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  /* Editörden çıkınca ölçümü tazele: stil değişikliği kutuyu büyütmüş olabilir. */
  useEffect(() => {
    if (editor.kind === 'none' && selectMode && previewReady) requestProbe();
  }, [editor, selectMode, previewReady, requestProbe]);

  /* ── Araca Gönder ───────────────────────────────────────────────── */
  const sendToVehicle = useCallback(async () => {
    if (!vehicleId) return;
    setSync('sending');
    setSyncNote(null);
    const at = new Date().toISOString();
    const outgoing = {
      ...manifest,
      themeVersion: manifest.themeVersion + 1,
      metadata: { ...manifest.metadata, updatedAt: at, origin: 'pwa-studio' as const },
    };
    const r = await sendCommand(vehicleId, 'theme_change', {
      // Yeni sözleşme (v2)
      manifest: outgoing,
      // Geri-uyum: manifest'i tanımayan eski araç sürümü bu ikisini kullanır.
      theme: outgoing.themeId,
      themeVars: manifestToCssVars(outgoing),
    });
    if (!mountedRef.current) return;
    if (r.ok) {
      dispatch({ type: 'mark-sent', at });
      setSync('ok');
      setSyncNote(r.queued ? 'Araç çevrimdışı — sıraya alındı' : null);
    } else {
      setSync('fail');
      setSyncNote(r.error ?? 'Gönderilemedi');
    }
    if (syncTimer.current) clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(() => { if (mountedRef.current) setSync('idle'); }, 3500);
  }, [vehicleId, manifest]);

  /* ── Kısayollar ─────────────────────────────────────────────────── */
  /* Geri al / ileri al — TEK mekanizma, kapsam parametresiyle.
   * `scope` yoksa global; kart editöründe KART kapsamı verilir → bir kartın
   * geri alması başka kartın geçmişine DOKUNMAZ. */
  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);
  const canUndo = canUndoOf(state);
  const canRedo = canRedoOf(state);
  const undoScoped = useCallback(
    (scope: ReturnType<typeof cardScope>) => dispatch({ type: 'undo', scope }), [],
  );
  const redoScoped = useCallback(
    (scope: ReturnType<typeof cardScope>) => dispatch({ type: 'redo', scope }), [],
  );

  const patchTokens = useCallback((patch: Partial<GlobalTokens>) => dispatch({ type: 'patch-tokens', patch }), []);
  const patchComponent = useCallback(
    (componentId: string, patch: Partial<ComponentStyle>) => dispatch({ type: 'patch-component', componentId, patch }),
    [],
  );
  const patchComponentState = useCallback(
    (componentId: string, stateKey: StateKey, patch: Partial<StateStyle>) =>
      dispatch({ type: 'patch-component-state', componentId, stateKey, patch }),
    [],
  );
  const patchScreen = useCallback(
    (surface: ThemeSurfaceId, patch: Partial<ScreenOverride>) => dispatch({ type: 'patch-screen', surface, patch }),
    [],
  );
  const patchLayout = useCallback(
    (cardId: string, patch: Partial<CardLayout>) => dispatch({ type: 'patch-layout', cardId, patch }),
    [],
  );
  const resetLayout = useCallback((cardId: string) => dispatch({ type: 'reset-layout', cardId }), []);

  /** Yerleşim önizlemesi GERÇEK solver'dan gelir (ikinci motor yok). */
  const solved = useMemo(
    () => (state.surface === 'home' ? solvePreview(state.themeId, manifest) : null),
    [state.surface, state.themeId, manifest],
  );

  const touched = customizationCount(manifest);
  const syncColor = sync === 'ok' ? '#34d399' : sync === 'fail' ? '#f87171' : sync === 'sending' ? '#60a5fa' : 'var(--pwa-text-3)';

  /* ── DÜZENLEYİCİ PANELİ — ÖNİZLEMEYİ KAPATMADAN ───────────────────
   * KULLANICI ŞİKÂYETİ (2026-08-18): *"yaptığım düzenlemeleri göremiyorum,
   * ekran sabit kalsın ki yaptığım düzenlemeleri görebileyim."*
   *
   * ÖLÇÜLEN KUSUR: bu blok eskiden `return <ComponentEditor/>` ile ERKEN
   * DÖNÜYORDU. Sonuç iki katmanlıydı:
   *   1. Önizleme DOM'dan tamamen kalkıyordu → düzenleme yapılırken canlı
   *      önizlemeyi görmek YAPISAL OLARAK imkânsızdı ("canlı önizleme"
   *      vaadi yalnız hiçbir şey düzenlemezken geçerliydi).
   *   2. iframe UNMOUNT oluyordu → her editör açılış/kapanışında araç
   *      uygulaması BAŞTAN boot ediyor, `previewReady` sıfırlanıyor ve
   *      manifest yeniden gönderiliyordu.
   * Panel artık ana ağaçta, sticky önizlemenin ALTINDA render edilir;
   * iframe hiç taşınmaz → remount YOK, geri bildirim ANLIK. */
  const editorNode = (() => {
  if (editor.kind === 'tokens') {
    return (
      <TokensEditor
        themeId={state.themeId}
        tokens={manifest.tokens}
        onPatch={patchTokens}
        onResetTheme={() => { dispatch({ type: 'reset-theme' }); setEditor({ kind: 'none' }); }}
        onClose={() => setEditor({ kind: 'none' })}
        onUndo={() => undoScoped(tokensScope(state.themeId))}
        onRedo={() => redoScoped(tokensScope(state.themeId))}
        canUndo={canUndoScoped(state, tokensScope(state.themeId))}
        canRedo={canRedoScoped(state, tokensScope(state.themeId))}
      />
    );
  }
  if (editor.kind === 'surface') {
    const info = surfaces.find((s) => s.id === editor.surface);
    return (
      <SurfaceEditor
        surfaceLabel={info?.label ?? editor.surface}
        surfaceId={editor.surface}
        override={screenOverrideOf(manifest, editor.surface)}
        onPatch={(p) => patchScreen(editor.surface, p)}
        onResetSurface={() => { dispatch({ type: 'reset-surface', surface: editor.surface }); setEditor({ kind: 'none' }); }}
        onClose={() => setEditor({ kind: 'none' })}
        onUndo={() => undoScoped(screenScope(state.themeId, editor.surface))}
        onRedo={() => redoScoped(screenScope(state.themeId, editor.surface))}
        canUndo={canUndoScoped(state, screenScope(state.themeId, editor.surface))}
        canRedo={canRedoScoped(state, screenScope(state.themeId, editor.surface))}
      />
    );
  }
  if (editor.kind === 'component') {
    const info = getThemeComponent(editor.componentId);
    if (info) {
      // Kartın kapsamı = bileşen stili + (varsa) solver yerleşim kartı.
      const lcId = layoutCardIdFor(info, state.themeId);
      const scope = cardScope(state.themeId, info.id, lcId);
      return (
        <ComponentEditor
          info={info}
          themeId={state.themeId}
          style={componentStyleOf(manifest, info.id)}
          layout={cardLayoutOf(manifest, lcId ?? '')}
          hasChanges={cardHasChanges(manifest, info.id, lcId)}
          onPatch={(p) => patchComponent(info.id, p)}
          onPatchState={(k, p) => patchComponentState(info.id, k, p)}
          onPatchLayout={patchLayout}
          onResetLayout={resetLayout}
          onResetCard={() => dispatch({ type: 'reset-card', componentId: info.id, layoutCardId: lcId })}
          onClose={() => { setEditor({ kind: 'none' }); dispatch({ type: 'close-editor' }); }}
          onUndo={() => undoScoped(scope)}
          onRedo={() => redoScoped(scope)}
          canUndo={canUndoScoped(state, scope)}
          canRedo={canRedoScoped(state, scope)}
        />
      );
    }
  }

  return null;
  })();
  /** Düzenleyici açıkken önizleme KOMPAKT olur — panel için yer açar ama
   *  ekrandan KAYBOLMAZ (kullanıcının istediği "ekran sabit kalsın"). */
  const editing = editorNode !== null;

  /* ── Ana görünüm ────────────────────────────────────────────────── */
  return (
    <div className="flex flex-col">

      {/* ═══ SABİT ÜST: başlık + canlı önizleme + gönder ═══ */}
      <div
        style={{
          position: 'sticky', top: 0, zIndex: 20,
          marginTop: -20, paddingTop: 16, paddingBottom: 12, marginBottom: 4,
          background: 'var(--pwa-panel)',
          borderBottom: '1px solid var(--pwa-border-soft)',
          boxShadow: '0 14px 22px -12px rgba(0,0,0,0.6)',
        }}
      >
        <div className="flex items-center justify-between mb-3 gap-2">
          <div className="min-w-0">
            <p className="text-sm font-black pwa-text">Tema Stüdyo</p>
            <p className="text-[10px] mt-0.5 truncate" style={{ color: 'var(--pwa-text-3)' }}>
              {preset.label} · {touched === 0 ? 'özelleştirme yok' : `${touched} özelleştirme`}
            </p>
          </div>
          <div
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[9px] font-bold flex-shrink-0"
            style={{
              background: sync !== 'idle' ? `${syncColor}15` : 'var(--pwa-surface)',
              border: `1px solid ${syncColor}40`,
              color: syncColor,
            }}
          >
            {!vehicleId ? '⚠ Araç Bağlı Değil'
              : sync === 'ok' ? '✓ Gönderildi'
              : sync === 'fail' ? '✗ Hata'
              : sync === 'sending' ? '● Gönderiliyor…'
              : '● Hazır'}
          </div>
        </div>

        {/* Canlı önizleme — gerçek araç uygulaması */}
        <div
          ref={wrapRef}
          style={{
            position: 'relative',
            /* Genişlik daralınca `ResizeObserver` ölçeği kendiliğinden yeniden
               hesaplar (scale = clientWidth / PREVIEW_W) — ayrı bir ölçek
               otoritesi kurulmaz. */
            width: editing ? '62%' : '100%',
            marginLeft: 'auto', marginRight: 'auto',
            aspectRatio: `${PREVIEW_W} / ${PREVIEW_H}`,
            overflow: 'hidden', borderRadius: 14,
            border: selectMode ? '2px solid #60a5fa' : '1px solid var(--pwa-border)',
            background: '#000',
          }}
        >
          <iframe
            ref={iframeRef}
            src={PREVIEW_URL}
            title="Araç ekranı canlı önizleme"
            onLoad={() => setTimeout(() => postPreview(), 400)}
            style={{
              position: 'absolute', top: 0, left: 0, width: PREVIEW_W, height: PREVIEW_H,
              border: 0, transformOrigin: 'top left', transform: `scale(${scale})`, colorScheme: 'normal',
            }}
          />
          {/* ── STÜDYO OVERLAY'İ ──
              Kutular araçtan gelen ÖLÇÜME göre çizilir. Dokunuş bu katmanda
              biter — iframe'e HİÇ ULAŞMAZ → araç uygulamasının kendi davranışı
              bozulmaz ve araç DOM'una hiçbir şey yazılmaz. */}
          {selectMode && (
            <div
              className="absolute inset-0"
              style={{ pointerEvents: 'auto' }}
              onPointerLeave={() => setHoverId(null)}
            >
              {(probe ?? []).map((it) => {
                const active = editor.kind === 'component' && editor.componentId === it.id;
                const hot = hoverId === it.id;
                const info = getThemeComponent(it.id);
                return (
                  <button
                    /* Aynı kimlik ekranda birden çok düğüme inebilir (ayar
                       kartları, kategori menüsü, dock butonları) → anahtar
                       kimlik + örnek sırasıdır; yoksa React kutuları birbirine
                       karıştırır ve yalnız biri çizilir. */
                    key={`${it.id}#${it.index}`}
                    type="button"
                    aria-label={info?.label ?? it.id}
                    onPointerEnter={() => setHoverId(it.id)}
                    onClick={() => openComponent(it.id)}
                    style={{
                      position: 'absolute',
                      left: it.x * scale,
                      top: it.y * scale,
                      width: it.w * scale,
                      height: it.h * scale,
                      padding: 0,
                      borderRadius: 6,
                      background: active
                        ? 'rgba(96,165,250,0.28)'
                        : hot ? 'rgba(96,165,250,0.16)' : 'rgba(96,165,250,0.05)',
                      border: `${active ? 2 : 1}px ${active ? 'solid' : 'dashed'} rgba(96,165,250,${active ? 0.95 : hot ? 0.8 : 0.45})`,
                      cursor: 'pointer',
                      transition: 'background 120ms ease',
                    }}
                  />
                );
              })}
              {probe !== null && probe.length === 0 && (
                <div
                  className="absolute inset-x-0 bottom-0 text-center"
                  style={{ background: 'rgba(0,0,0,0.55)', color: '#fbbf24', fontSize: 9, padding: '4px 6px' }}
                >
                  Ölçüm boş — bu araç sürümü Stüdyo ölçümünü desteklemiyor olabilir.
                  Bileşen listesinden düzenleyebilirsiniz.
                </div>
              )}
            </div>
          )}

          <span
            style={{
              position: 'absolute', top: 6, left: 8, fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
              color: 'rgba(255,255,255,0.65)', background: 'rgba(0,0,0,0.45)', borderRadius: 5,
              padding: '2px 6px', pointerEvents: 'none',
            }}
          >
            {selectMode
              ? `DOKUN & DÜZENLE${probe === null
                  ? ' · ölçülüyor…'
                  : ` · ${distinctProbeIds(probe)} bileşen · ${probe.length} alan`}`
              : 'CANLI ÖNİZLEME'}
          </span>
        </div>

        {/* Dokun&Düzenle + Araca Gönder */}
        <div className="flex gap-2 mt-2.5">
          <button
            type="button"
            onClick={() => setSelectMode((v) => !v)}
            className="text-[11px] font-bold px-3 rounded-xl active:scale-95"
            style={{
              minHeight: 46,
              background: selectMode ? 'rgba(96,165,250,0.18)' : 'var(--pwa-surface)',
              border: `1.5px solid ${selectMode ? 'rgba(96,165,250,0.5)' : 'var(--pwa-border)'}`,
              color: selectMode ? '#60a5fa' : 'var(--pwa-text-2)',
            }}
          >
            {selectMode ? '✓ Seçim Açık' : 'Dokun & Düzenle'}
          </button>
          {selectMode && (
            <button
              type="button"
              onClick={requestProbe}
              aria-label="Ölçümü yenile"
              className="text-[11px] font-bold px-3 rounded-xl active:scale-95"
              style={{ minHeight: 46, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}
            >
              ↻
            </button>
          )}
          <button
            type="button"
            onClick={sendToVehicle}
            disabled={!vehicleId || sync === 'sending'}
            className="flex-1 text-[12px] font-black uppercase tracking-wider px-3 rounded-xl active:scale-[0.98]"
            style={{
              minHeight: 46,
              background: `${syncColor}18`,
              border: `1.5px solid ${syncColor}55`,
              color: syncColor,
              opacity: vehicleId ? 1 : 0.5,
            }}
          >
            {!vehicleId ? '⚠ Araç Bağlı Değil' : sync === 'ok' ? '✓ Araca Gönderildi' : 'Araca Gönder'}
          </button>
        </div>
        {syncNote && (
          <p className="text-[10px] mt-1.5 px-1" style={{ color: syncColor }}>{syncNote}</p>
        )}

        {/* Geri al / Yinele — GLOBAL kapsam. Düzenleyici açıkken GİZLENİR:
            panelin kendi başlığında KART KAPSAMLI geri al/yinele vardır ve iki
            farklı kapsamı yan yana göstermek "hangisi neyi geri alıyor"
            belirsizliği üretir. Ayrıca sticky başlık kısalır → panele yer açılır. */}
        {!editing && (
        <div className="flex gap-2 mt-2">
          <button
            type="button" onClick={undo} disabled={!canUndo}
            className="flex-1 text-[11px] font-bold rounded-xl active:scale-95"
            style={{ minHeight: 42, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)', opacity: canUndo ? 1 : 0.35 }}
          >
            ↶ Geri Al
          </button>
          <button
            type="button" onClick={redo} disabled={!canRedo}
            className="flex-1 text-[11px] font-bold rounded-xl active:scale-95"
            style={{ minHeight: 42, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)', opacity: canRedo ? 1 : 0.35 }}
          >
            ↷ Yinele
          </button>
        </div>
        )}
      </div>

      {/* ═══ KAYAN İÇERİK — düzenleyici açıkken ONUN YERİNE panel gelir ═══ */}
      {editorNode ?? (
      <div className="flex flex-col gap-4 pt-4 pb-6">

        {/* ── 4 tema galerisi ── */}
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.35em] mb-2" style={{ color: 'var(--pwa-text-3)' }}>
            Temalar
          </p>
          <div className="grid grid-cols-2 gap-2">
            {THEME_BASE_IDS.map((id) => {
              const p = THEME_PRESETS[id];
              const m = state.manifests[id];
              const n = customizationCount(m);
              const active = state.themeId === id;
              const accent = m.tokens.accentPrimary ?? p.base.accentPrimary;
              const bg = m.tokens.bgPrimary?.from ?? p.base.bgPrimary;
              const card = m.tokens.bgCard?.from ?? p.base.bgCard;
              const ink = m.tokens.textPrimary ?? p.base.textPrimary;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => dispatch({ type: 'select-theme', themeId: id })}
                  className="flex flex-col gap-2 p-2 rounded-2xl text-left active:scale-[0.98]"
                  style={{
                    background: active ? `${accent}14` : 'var(--pwa-surface)',
                    border: `1.5px solid ${active ? accent : 'var(--pwa-border)'}`,
                  }}
                >
                  {/* gerçek tema örneği */}
                  <div style={{ background: bg, borderRadius: 10, padding: 7, display: 'flex', flexDirection: 'column', gap: 5 }}>
                    <div style={{ background: card, borderRadius: 6, height: 20, display: 'flex', alignItems: 'center', paddingLeft: 6, gap: 5 }}>
                      <span style={{ width: 7, height: 7, borderRadius: 4, background: accent, display: 'inline-block' }} />
                      <span style={{ height: 4, width: '52%', background: ink, opacity: 0.7, borderRadius: 2, display: 'inline-block' }} />
                    </div>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <span style={{ flex: 1, height: 13, background: card, borderRadius: 5, display: 'inline-block' }} />
                      <span style={{ width: 26, height: 13, background: accent, borderRadius: 5, display: 'inline-block' }} />
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[10px] font-black truncate" style={{ color: active ? accent : 'var(--pwa-text-2)' }}>
                      {p.label}
                    </span>
                    {n > 0 && (
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'var(--pwa-surface-3)', color: 'var(--pwa-text-3)' }}>
                        {n}
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* ── Aktif tema eylemleri ── */}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setEditor({ kind: 'tokens' })}
            className="text-[11px] font-bold rounded-xl active:scale-95"
            style={{ minHeight: 46, background: 'rgba(96,165,250,0.14)', border: '1.5px solid rgba(96,165,250,0.4)', color: '#60a5fa' }}
          >
            Tema Geneli Düzenle
          </button>
          <CopyFromMenu
            themeId={state.themeId}
            onCopy={(src) => dispatch({ type: 'copy-from', sourceThemeId: src })}
          />
        </div>

        {/* ── Ekran seçimi ── */}
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.35em] mb-2" style={{ color: 'var(--pwa-text-3)' }}>
            Ekranlar
          </p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {surfaces.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => dispatch({ type: 'select-surface', surface: s.id })}
                className="flex-shrink-0 px-3 rounded-xl text-[10px] font-black uppercase tracking-wider active:scale-95"
                style={{
                  minHeight: 40,
                  background: state.surface === s.id ? 'rgba(96,165,250,0.18)' : 'var(--pwa-surface)',
                  color: state.surface === s.id ? '#60a5fa' : 'var(--pwa-text-3)',
                  border: `1px solid ${state.surface === s.id ? 'rgba(96,165,250,0.42)' : 'var(--pwa-border-soft)'}`,
                }}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>

        {/* ── Ekran ayarı ── */}
        <button
          type="button"
          onClick={() => setEditor({ kind: 'surface', surface: state.surface })}
          className="text-[11px] font-bold rounded-xl active:scale-95"
          style={{ minHeight: 46, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}
        >
          Bu Ekranın Genel Ayarı
        </button>

        {/* ── Yerleşim (yalnız solver kullanan temada, yalnız ana ekranda) ── */}
        {state.surface === 'home' && (
          isLayoutCapableTheme(state.themeId) && solved ? (
            <div className="rounded-2xl p-3 flex flex-col gap-2"
              style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: 'var(--pwa-text-3)' }}>
                  Yerleşim (çözülmüş)
                </p>
                <button
                  type="button"
                  onClick={() => dispatch({ type: 'reset-all-layout' })}
                  className="text-[9px] font-bold px-2 py-1.5 rounded-lg active:scale-95"
                  style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-3)' }}
                >
                  Yerleşimi Sıfırla
                </button>
              </div>
              <p className="text-[10px]" style={{ color: 'var(--pwa-text-3)' }}>
                Aşağıdaki sıra <b>araçtaki yerleşim motorunun</b> (layoutSolver) bu manifestle
                ürettiği gerçek sonuçtur. Bir kartın sırasını/boyutunu değiştirmek için
                kartın kendi editörünü açın.
              </p>
              {solved.zones.filter((z) => z.items.length > 0 || z.overflow.length > 0).map((z) => (
                <div key={z.zone} className="flex flex-col gap-1">
                  <p className="text-[9px] font-bold uppercase tracking-wider" style={{ color: 'var(--pwa-text-3)' }}>
                    {ZONE_LABEL[z.zone]}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {z.items.map((it, i) => (
                      <span key={it.id}
                        className="text-[10px] font-semibold px-2 py-1 rounded-lg"
                        style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}>
                        {i + 1}. {it.label} · {it.size} · {it.grow}×{it.locked ? ' 🔒' : ''}
                      </span>
                    ))}
                    {z.overflow.map((id) => (
                      <span key={id}
                        className="text-[10px] font-semibold px-2 py-1 rounded-lg"
                        style={{ background: 'rgba(251,191,36,0.12)', border: '1px solid rgba(251,191,36,0.35)', color: '#fbbf24' }}>
                        {id} · TAŞTI
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl p-3"
              style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
              <p className="text-[10px]" style={{ color: 'var(--pwa-text-3)' }}>
                <b>{preset.label}</b> sabit yerleşimle çizilir (araçta yerleşim motoruna
                bağlı değildir) → bu temada kart sırası/boyutu <b>düzenlenemez</b>.
                Renk, tipografi ve efekt düzenlemeleri tam çalışır.
              </p>
            </div>
          )
        )}

        {/* ── Bileşen listesi ── */}
        <div>
          <p className="text-[9px] font-black uppercase tracking-[0.35em] mb-2" style={{ color: 'var(--pwa-text-3)' }}>
            Düzenlenebilir Bileşenler
          </p>
          <div className="flex flex-col gap-1.5">
            {components.map((c) => {
              const s = manifest.componentOverrides[c.id];
              const edited = s !== undefined;
              const present = inventory === null ? null : inventory.includes(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setEditor({ kind: 'component', componentId: c.id })}
                  className="flex items-center justify-between gap-2 px-3 rounded-xl text-left active:scale-[0.99]"
                  style={{
                    minHeight: 52,
                    background: edited ? 'rgba(52,211,153,0.08)' : 'var(--pwa-surface)',
                    border: `1px solid ${edited ? 'rgba(52,211,153,0.3)' : 'var(--pwa-border)'}`,
                  }}
                >
                  <div className="min-w-0">
                    <p className="text-[12px] font-bold truncate" style={{ color: 'var(--pwa-text-2)' }}>{c.label}</p>
                    <p className="text-[9px] font-mono truncate" style={{ color: 'var(--pwa-text-3)' }}>
                      {c.id} · {c.type}{c.locked ? ' · kilitli' : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {present === false && (
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(251,191,36,0.14)', color: '#fbbf24' }}>
                        EKRANDA YOK
                      </span>
                    )}
                    {edited && (
                      <span className="text-[8px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'rgba(52,211,153,0.16)', color: '#34d399' }}>
                        DÜZENLENDİ
                      </span>
                    )}
                    <span style={{ color: 'var(--pwa-text-3)' }}>›</span>
                  </div>
                </button>
              );
            })}
            {components.length === 0 && (
              <p className="text-[11px] px-1" style={{ color: 'var(--pwa-text-3)' }}>
                Bu ekranda bu temaya ait düzenlenebilir bileşen yok.
              </p>
            )}
          </div>
          {inventory !== null && (
            <p className="text-[9px] mt-2 px-1" style={{ color: 'var(--pwa-text-3)' }}>
              Önizleme ölçümünde bulunan bileşen: {inventory.length}. &quot;EKRANDA YOK&quot; = o bileşen
              önizlemenin şu anki görünümünde çizilmiyor (ör. çekmece kapalı) — stil yine kaydedilir.
            </p>
          )}
        </div>

        {/* ── Seviyeli sıfırlama ── */}
        <div className="rounded-2xl p-3 flex flex-col gap-2"
          style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
          <p className="text-[10px] font-black uppercase tracking-[0.3em]" style={{ color: 'var(--pwa-text-3)' }}>
            Sıfırlama
          </p>
          <p className="text-[10px]" style={{ color: 'var(--pwa-text-3)' }}>
            <b>Kartı Sıfırla</b> kartın editöründe, <b>Ekranı Sıfırla</b> ekran
            ayarındadır. Aşağıdaki işlem <b>seçili temanın tamamını</b> kapsar ve
            iki adım ister. Tek bir <b>Geri Al</b> ile iade edilebilir.
          </p>
          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              disabled={touched === 0}
              className="text-[11px] font-bold rounded-xl active:scale-95"
              style={{
                minHeight: 44, background: 'var(--pwa-surface)',
                border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)',
                opacity: touched === 0 ? 0.4 : 1,
              }}
            >
              ↺ Tüm Değişiklikleri Geri Al
            </button>
          ) : (
            <>
              <div className="rounded-xl p-2.5"
                style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.32)' }}>
                <p className="text-[11px] font-bold" style={{ color: '#f87171' }}>
                  Bu temadaki tüm Studio değişiklikleri geri alınacak.
                </p>
                <p className="text-[10px] mt-1" style={{ color: 'var(--pwa-text-3)' }}>
                  <b>{preset.label}</b> başlangıç hâline döner (renk · yazı · bileşen ·
                  ekran · yerleşim). Diğer temalara <b>dokunulmaz</b>.
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmReset(false)}
                  className="flex-1 text-[11px] font-bold rounded-xl active:scale-95"
                  style={{ minHeight: 44, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}
                >
                  Vazgeç
                </button>
                <button
                  type="button"
                  onClick={() => { dispatch({ type: 'reset-theme' }); setConfirmReset(false); }}
                  className="flex-1 text-[11px] font-black rounded-xl active:scale-95"
                  style={{ minHeight: 44, background: 'rgba(248,113,113,0.14)', border: '1.5px solid rgba(248,113,113,0.42)', color: '#f87171' }}
                >
                  Evet, {preset.label} sıfırlansın
                </button>
              </div>
            </>
          )}
        </div>

      </div>
      )}
    </div>
  );
});

/* ── "Başka temadan kopyala" ──────────────────────────────────────── */

const CopyFromMenu = memo(function CopyFromMenu({
  themeId, onCopy,
}: {
  themeId: ThemeBaseId;
  onCopy: (src: ThemeBaseId) => void;
}) {
  const [open, setOpen] = useState(false);
  const others = THEME_BASE_IDS.filter((id) => id !== themeId);
  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[11px] font-bold rounded-xl active:scale-95"
        style={{ minHeight: 46, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}
      >
        Başka Temadan Kopyala
      </button>
    );
  }
  return (
    <div className="col-span-2 rounded-2xl p-2 flex flex-col gap-1.5"
      style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
      <p className="text-[10px] px-1" style={{ color: 'var(--pwa-text-3)' }}>
        Seçilen temanın ÖZELLEŞTİRMELERİ bu temaya kopyalanır (temanın kendi kimliği korunur).
      </p>
      {others.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => { onCopy(id); setOpen(false); }}
          className="text-[11px] font-bold rounded-xl active:scale-95"
          style={{ minHeight: 42, background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-2)' }}
        >
          {THEME_PRESETS[id].label}
        </button>
      ))}
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="text-[10px] font-bold rounded-xl"
        style={{ minHeight: 38, background: 'transparent', color: 'var(--pwa-text-3)' }}
      >
        Vazgeç
      </button>
    </div>
  );
});
