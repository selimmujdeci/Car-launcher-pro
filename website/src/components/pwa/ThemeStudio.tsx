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
import { sendCommand, subscribeCommandStatus, fetchCommandStatus, COMMAND_TTL_MINUTES, type CommandStatus } from '@/lib/commandService';
import {
  manifestToCssVars,
  resolveManifestForMode,
  THEME_BASE_IDS,
  THEME_PRESETS,
  type CardLayout,
  type ComponentStyle,
  type GlobalTokens,
  type ScreenOverride,
  type StateKey,
  type StateStyle,
  type ThemeBaseId,
  SCALABLE_ZONES,
  ZONE_SCALE_MIN,
  ZONE_SCALE_MAX,
}
from '@/lib/theme/themeManifest';
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
  type EditMode,
} from '@/lib/theme/themeStudioState';
import { ComponentEditor, SurfaceEditor, TokensEditor } from './theme/ThemeEditors';
import { ZoneReorder } from './theme/ZoneReorder';
import { PresetGallery } from './theme/PresetGallery';
import { Icon } from './ui/Icon';
import { SegmentedButton, StatusPill, type Tone } from './ui/primitives';


/* ── Önizleme hedefi (gerçek araç uygulaması) ─────────────────────── */

const PREVIEW_URL = 'https://car-launcher-pro.vercel.app/';
const PREVIEW_ORIGIN = 'https://car-launcher-pro.vercel.app';
const PREVIEW_W = 1180;
const PREVIEW_H = 720;

const PERSIST_DEBOUNCE_MS = 1000;

/** `waiting` = sıraya yazıldı, araç henüz UYGULAMADI · `applied` = araç "uyguladım" dedi. */
type SyncState = 'idle' | 'sending' | 'waiting' | 'applied' | 'fail';
type EditorTarget =
  | { kind: 'none' }
  | { kind: 'tokens' }
  | { kind: 'surface'; surface: ThemeSurfaceId }
  | { kind: 'component'; componentId: string };

interface Props { vehicleId: string | null }

export const ThemeStudio = memo(function ThemeStudio({ vehicleId }: Props) {
  /* Varsayılan düzenleme katmanı GÜNDÜZ (kullanıcı isteği 2026-09-28: "gündüz
     ayrı gece ayrı") — düzenleme gece görünümünü kendiliğinden değiştirmez. */
  const [state, dispatch] = useReducer(studioReducer, undefined, () => ({ ...createStudioState(), editMode: 'day' as EditMode }));
  const [editor, setEditor] = useState<EditorTarget>({ kind: 'none' });
  const [sync, setSync] = useState<SyncState>('idle');
  const [syncNote, setSyncNote] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [previewReady, setPreviewReady] = useState(false);
  const [probe, setProbe] = useState<ProbeItem[] | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  /* Gelişmiş ayarlar katlaması — kullanıcı başına kolaylık (tarayıcıda hatırlanır). */
  const [advancedOpen, setAdvancedOpenState] = useState(false);
  useEffect(() => {
    try { if (localStorage.getItem('caros_studio_advanced') === '1') setAdvancedOpenState(true); } catch { /* fail-soft */ }
  }, []);
  const setAdvancedOpen = useCallback((fn: (v: boolean) => boolean) => {
    setAdvancedOpenState((v) => {
      const next = fn(v);
      try { localStorage.setItem('caros_studio_advanced', next ? '1' : '0'); } catch { /* fail-soft */ }
      return next;
    });
  }, []);

  /** Ölçümden gelen kimlikler = o an araçta GERÇEKTEN çizili bileşenler. */
  const inventory = useMemo(() => (probe === null ? null : probe.map((p) => p.id)), [probe]);


  const iframeRef = useRef<HTMLIFrameElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(true);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statusUnsub = useRef<(() => void) | null>(null);
  /** Beklenen komut — realtime olayı kaçarsa durum doğrudan sorulur. */
  const pendingCmd = useRef<{ id: string; until: number } | null>(null);
  const [scale, setScale] = useState(0.3);

  const manifest = state.manifests[state.themeId];
  /** Düzenleyicilerin GÖSTERDİĞİ değer: seçili modda o an geçerli olan (ortak + mod
   *  katmanı). Yazım reducer'da seçili katmana gider; araçla AYNI birleştirme kuralı. */
  const shown = state.editMode === 'both' ? manifest : resolveManifestForMode(manifest, state.editMode);
  const preset = THEME_PRESETS[state.themeId];
  const surfaces = useMemo(() => surfacesForTheme(state.themeId), [state.themeId]);
  const components = useMemo(
    () => componentsForSurface(state.themeId, state.surface),
    [state.themeId, state.surface],
  );

  /**
   * ÖNİZLEME BU EKRANI GÖSTEREBİLİYOR MU? — ÖLÇÜLEN gerçek, sabit liste DEĞİL.
   *
   * Bazı yüzeyler önizlemede AÇILAMAZ ve bu bilerek böyledir: geri görüş
   * kamerası vitese, Sinema/Bölünmüş ekran kullanıcı eylemine bağlıdır —
   * onları Stüdyo'dan taklit etmek bir güvenlik yüzeyini YALANLAMAK olurdu.
   * Bu durumda kullanıcı ana ekranı görür ve farkında olmadan KÖRLEMESİNE
   * düzenler. Uyarı, sabit bir "gösterilemeyenler" listesinden değil, ÖLÇÜMDEN
   * türetilir: seçili ekranın hiçbir bileşeni ölçümde görünmüyorsa gösterim
   * yok demektir. Böylece ileride eklenip gezinmesi unutulan her yüzey de
   * kendiliğinden yakalanır (sabit liste bayatlar, ölçüm bayatlamaz).
   *
   * `null` = henüz ölçüm yok → HİÇBİR ŞEY iddia edilmez.
   */
  const surfaceShown = useMemo<boolean | null>(() => {
    if (probe === null) return null;
    if (components.length === 0) return null;
    const olculen = new Set(probe.map((p) => p.id));
    return components.some((c) => olculen.has(c.id));
  }, [probe, components]);

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
      statusUnsub.current?.();
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

  /* Önizleme, düzenlenen modda gösterilir (araç manifesti o modun katmanıyla
     uygular). 'İkisi' seçiliyken önizleme kendi saatine bırakılır. */
  useEffect(() => {
    if (!previewReady || state.editMode === 'both') return;
    try {
      iframeRef.current?.contentWindow?.postMessage(
        { type: 'caros-preview-mode', mode: state.editMode }, PREVIEW_ORIGIN,
      );
    } catch { /* ignore */ }
  }, [state.editMode, previewReady]);

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
  /** Aracın komut sonucu — realtime ya da doğrudan sorgu, hangisi önce gelirse. */
  const settleCommand = useCallback((commandId: string, status: CommandStatus) => {
    if (!mountedRef.current || pendingCmd.current?.id !== commandId) return;
    if (status === 'completed') {
      pendingCmd.current = null;
      statusUnsub.current?.(); statusUnsub.current = null;
      setSync('applied');
      setSyncNote(null);
      if (syncTimer.current) clearTimeout(syncTimer.current);
      syncTimer.current = setTimeout(() => { if (mountedRef.current) setSync('idle'); }, 5000);
    } else if (status === 'failed' || status === 'rejected') {
      pendingCmd.current = null;
      statusUnsub.current?.(); statusUnsub.current = null;
      setSync('fail');
      setSyncNote('Araç temayı uygulayamadı');
    } else if (status === 'expired') {
      pendingCmd.current = null;
      setSync('fail');
      setSyncNote('Araç süre içinde almadı — tekrar gönderebilirsin');
    }
  }, []);

  /* Realtime olayı KAÇABİLİR (saha 2026-09-26: telefon arka plandayken tema araçta
     uygulandı, stüdyo "Araç bekleniyor" kaldı). Beklerken durum doğrudan sorulur:
     sayfaya dönünce hemen, görünürken birkaç saniyede bir; TTL dolunca durur. */
  useEffect(() => {
    if (sync !== 'waiting') return;
    const check = () => {
      const p = pendingCmd.current;
      if (!p || document.visibilityState !== 'visible') return;
      if (Date.now() > p.until) { settleCommand(p.id, 'expired'); return; }
      void fetchCommandStatus(p.id).then((st) => { if (st) settleCommand(p.id, st); });
    };
    const t = setInterval(check, 4000);
    const onVis = () => { if (document.visibilityState === 'visible') check(); };
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    return () => {
      clearInterval(t);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onVis);
    };
  }, [sync, settleCommand]);

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
    if (syncTimer.current) clearTimeout(syncTimer.current);
    statusUnsub.current?.();
    statusUnsub.current = null;
    if (!r.ok) {
      setSync('fail');
      setSyncNote(r.error ?? 'Gönderilemedi');
      syncTimer.current = setTimeout(() => { if (mountedRef.current) setSync('idle'); }, 3500);
      return;
    }
    dispatch({ type: 'mark-sent', at });
    /* "Gönderildi" ≠ "uygulandı": aracın kendi cevabı beklenir (komut satırı durumu).
       Yerel zaman aşımı araç HATASI DEĞİLDİR — komut sunucuda TTL boyunca bekler,
       araç açılınca uygular; bu yüzden "bekleniyor" kalır, "başarısız" denmez. */
    setSync('waiting');
    setSyncNote(r.queued ? 'Araç çevrimdışı — açılınca uygulanacak' : 'Araç bekleniyor…');
    if (!r.commandId) return;
    pendingCmd.current = { id: r.commandId, until: Date.now() + COMMAND_TTL_MINUTES * 60_000 };
    statusUnsub.current = subscribeCommandStatus(r.commandId, (ev) => {
      if (ev.status === 'expired') {
        // Yerel zaman aşımı: araç henüz cevap vermedi — sorgu devam eder (aşağıdaki efekt).
        if (mountedRef.current) setSyncNote(`Araç henüz almadı — açılınca uygulanacak (${COMMAND_TTL_MINUTES} dk içinde)`);
        return;
      }
      settleCommand(r.commandId!, ev.status);
    }, 20_000);
  }, [vehicleId, manifest, settleCommand]);

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
  const syncColor = sync === 'applied' ? 'var(--md-success)' : sync === 'fail' ? 'var(--md-error)' : sync === 'sending' || sync === 'waiting' ? 'var(--md-primary)' : 'var(--pwa-text-3)';
  const syncTone: Tone = !vehicleId ? 'warning' : sync === 'applied' ? 'success' : sync === 'fail' ? 'error' : sync === 'sending' || sync === 'waiting' ? 'primary' : 'neutral';
  const syncIcon = !vehicleId ? 'warning' as const : sync === 'applied' ? 'check_circle' as const : sync === 'fail' ? 'error' as const : sync === 'waiting' ? 'schedule' as const : sync === 'sending' ? 'sync' as const : 'cloud_done' as const;

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
        tokens={shown.tokens}
        onPatch={patchTokens}
        onResetTheme={() => { dispatch({ type: 'reset-theme' }); setEditor({ kind: 'none' }); }}
        onClose={() => setEditor({ kind: 'none' })}
        onUndo={() => undoScoped(tokensScope(state.themeId, state.editMode))}
        onRedo={() => redoScoped(tokensScope(state.themeId, state.editMode))}
        canUndo={canUndoScoped(state, tokensScope(state.themeId, state.editMode))}
        canRedo={canRedoScoped(state, tokensScope(state.themeId, state.editMode))}
      />
    );
  }
  if (editor.kind === 'surface') {
    const info = surfaces.find((s) => s.id === editor.surface);
    return (
      <SurfaceEditor
        surfaceLabel={info?.label ?? editor.surface}
        surfaceId={editor.surface}
        override={screenOverrideOf(shown, editor.surface)}
        onPatch={(p) => patchScreen(editor.surface, p)}
        onResetSurface={() => { dispatch({ type: 'reset-surface', surface: editor.surface }); setEditor({ kind: 'none' }); }}
        onClose={() => setEditor({ kind: 'none' })}
        onUndo={() => undoScoped(screenScope(state.themeId, editor.surface, state.editMode))}
        onRedo={() => redoScoped(screenScope(state.themeId, editor.surface, state.editMode))}
        canUndo={canUndoScoped(state, screenScope(state.themeId, editor.surface, state.editMode))}
        canRedo={canRedoScoped(state, screenScope(state.themeId, editor.surface, state.editMode))}
      />
    );
  }
  if (editor.kind === 'component') {
    const info = getThemeComponent(editor.componentId);
    if (info) {
      // Kartın kapsamı = bileşen stili + (varsa) solver yerleşim kartı.
      const lcId = layoutCardIdFor(info, state.themeId);
      const scope = cardScope(state.themeId, info.id, lcId, state.editMode);
      return (
        <ComponentEditor
          info={info}
          themeId={state.themeId}
          style={componentStyleOf(shown, info.id)}
          layout={cardLayoutOf(manifest, lcId ?? '')}
          hasChanges={cardHasChanges(manifest, info.id, lcId, state.editMode)}
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
          paddingTop: 8, paddingBottom: 12, marginBottom: 4,
          background: 'var(--md-surface)',
          borderBottom: '1px solid var(--md-outline-variant)',
        }}
      >
        <div className="flex items-start justify-between mb-3 gap-2">
          <div className="min-w-0 flex-1">
            <h1 className="md-headline-s md-on-surface">Tema Stüdyo</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <span className="md-body-s md-on-surface-variant truncate">
                {preset.label} · {touched === 0 ? 'özelleştirme yok' : `${touched} özelleştirme`}
              </span>
              <StatusPill tone={syncTone} icon={syncIcon}>
                {!vehicleId ? 'Araç bağlı değil'
                  : sync === 'applied' ? 'Araçta uygulandı'
                  : sync === 'fail' ? 'Hata'
                  : sync === 'waiting' ? 'Araç bekleniyor'
                  : sync === 'sending' ? 'Gönderiliyor…'
                  : 'Hazır'}
              </StatusPill>
            </div>
          </div>
          {/* Geri al / Yinele — GLOBAL kapsam. Düzenleyici açıkken GİZLENİR:
              panelin kendi başlığında KART KAPSAMLI geri al/yinele vardır ve iki
              farklı kapsamı yan yana göstermek "hangisi neyi geri alıyor"
              belirsizliği üretir. */}
          {!editing && (
            <div className="flex flex-shrink-0 -mr-2">
              <button type="button" onClick={undo} disabled={!canUndo} aria-label="Geri Al" title="Geri Al"
                className="md-icon-btn md-state disabled:opacity-30"><Icon name="undo" /></button>
              <button type="button" onClick={redo} disabled={!canRedo} aria-label="Yinele" title="Yinele"
                className="md-icon-btn md-state disabled:opacity-30"><Icon name="redo" /></button>
            </div>
          )}
        </div>

        {/* Düzenlenen mod — gündüz ve gece ayrı düzenlenir (kullanıcı isteği
            2026-09-28). Renk/stil seçili moda yazılır; yerleşim iki modda ortak. */}
        <div className="mb-3 flex flex-col gap-1.5">
          <SegmentedButton<EditMode>
            label="Düzenlenen mod"
            value={state.editMode}
            onChange={(mode) => dispatch({ type: 'select-mode', mode })}
            options={[
              { id: 'day', label: 'Gündüz', icon: 'light_mode' },
              { id: 'night', label: 'Gece', icon: 'dark_mode' },
              { id: 'both', label: 'İkisi', icon: 'palette' },
            ]}
          />
          <div className="flex flex-wrap items-center justify-between gap-2 px-1">
            <span className="md-body-s md-on-surface-variant">
              {state.editMode === 'day' ? 'Renkler yalnız gündüz geçerli · yerleşim ortak'
                : state.editMode === 'night' ? 'Renkler yalnız gece geçerli · yerleşim ortak'
                : 'Değişiklik gündüz ve gece ortak'}
            </span>
            {state.editMode !== 'both' && (
              <button type="button" className="md-state md-label-l px-2" style={{ color: 'var(--md-primary)', minHeight: 32 }}
                onClick={() => dispatch({ type: 'copy-mode', from: state.editMode as 'day' | 'night', to: state.editMode === 'day' ? 'night' : 'day' })}>
                {state.editMode === 'day' ? 'Gündüzü geceye kopyala' : 'Geceyi gündüze kopyala'}
              </button>
            )}
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
                        ? 'color-mix(in srgb, var(--md-primary) 28%, transparent)'
                        : hot ? 'color-mix(in srgb, var(--md-primary) 16%, transparent)' : 'color-mix(in srgb, var(--md-primary) 8%, transparent)',
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
                  style={{ background: 'var(--md-surface-container-high)', color: 'var(--md-warning)', fontSize: 9, padding: '4px 6px' }}
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
              color: 'var(--md-on-surface-variant)', background: 'var(--md-surface-container-high)', borderRadius: 5,
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

        {/* Dokun&Düzenle + Araca Gönder — birincil eylem dolgulu, tek bakışta */}
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onClick={() => setSelectMode((v) => !v)}
            aria-pressed={selectMode}
            className="md-btn-tonal md-state flex-shrink-0"
            style={{ minHeight: 48, padding: '0 16px',
              ...(selectMode ? { background: 'var(--md-primary-container)', color: 'var(--md-on-primary-container)' } : {}) }}
          >
            <Icon name={selectMode ? 'check_circle' : 'touch_app'} size={20} />
            {selectMode ? 'Seçim Açık' : 'Dokun & Düzenle'}
          </button>
          {selectMode && (
            <button type="button" onClick={requestProbe} aria-label="Ölçümü yenile" className="md-icon-btn md-state flex-shrink-0">
              <Icon name="refresh" />
            </button>
          )}
          <button
            type="button"
            onClick={sendToVehicle}
            disabled={!vehicleId || sync === 'sending'}
            className="md-btn-filled md-state flex-1 disabled:opacity-40"
            style={{ minHeight: 48, padding: '0 16px',
              ...(sync === 'applied' ? { background: 'var(--md-success)', color: 'var(--md-on-success)' } : {}) }}
          >
            <Icon name={sync === 'applied' ? 'check_circle' : sync === 'waiting' ? 'schedule' : 'send'} size={20} />
            {!vehicleId ? 'Araç Bağlı Değil' : sync === 'applied' ? 'Araçta Uygulandı' : sync === 'waiting' ? 'Araç Bekleniyor' : 'Araca Gönder'}
          </button>
        </div>
        {syncNote && (
          <p className="md-body-s mt-2 px-1" style={{ color: syncColor }}>{syncNote}</p>
        )}
      </div>

      {/* ═══ KAYAN İÇERİK — düzenleyici açıkken ONUN YERİNE panel gelir ═══ */}
      {editorNode ?? (
      <div className="flex flex-col gap-4 pt-4 pb-6">

        {/* ── TEMA SEÇİMİ — ince çip satırı: taslaklar İLK içerik kalır (kullanıcı
            isteği), ama hangi temaya ait oldukları hemen üstte görünür. ── */}
        <div>
          <p className="md-title-s md-on-surface px-1 mb-2">Tema</p>
          <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1" style={{ scrollbarWidth: 'none' }} role="radiogroup" aria-label="Tema">
            {THEME_BASE_IDS.map((id) => {
              const p = THEME_PRESETS[id];
              const m = state.manifests[id];
              const n = customizationCount(m);
              const active = state.themeId === id;
              const accent = m.tokens.accentPrimary ?? p.base.accentPrimary;
              const bg = m.tokens.bgPrimary?.from ?? p.base.bgPrimary;
              return (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => dispatch({ type: 'select-theme', themeId: id })}
                  className="md-state md-label-l inline-flex items-center gap-2 pl-1.5 pr-3 flex-shrink-0"
                  style={{
                    minHeight: 40, borderRadius: 'var(--md-shape-full)',
                    background: active ? 'var(--md-secondary-container)' : 'transparent',
                    color: active ? 'var(--md-on-secondary-container)' : 'var(--md-on-surface)',
                    border: active ? '1px solid transparent' : '1px solid var(--md-outline)',
                  }}
                >
                  {/* temanın gerçek zemin + vurgu rengi */}
                  <span aria-hidden="true" className="flex items-center justify-center flex-shrink-0"
                    style={{ width: 28, height: 28, borderRadius: 14, background: bg, border: '1px solid var(--md-outline-variant)' }}>
                    <span style={{ width: 10, height: 10, borderRadius: 5, background: accent }} />
                  </span>
                  {p.label}
                  {n > 0 && <span className="md-label-m md-on-surface-variant">· {n}</span>}
                </button>
              );
            })}
          </div>
        </div>

        <p className="md-title-s md-on-surface px-1 -mb-2">Hazır taslaklar</p>
        {/* ── Hazır renk / kart şekli taslakları — İLK görünen içerik (kullanıcı:
            "Geri Al/Yinele'nin hemen altında görünmeli"). Kapsam: tüm tema | seçili ekran. ── */}
        <PresetGallery
          themeId={state.themeId}
          manifest={shown}
          surfaceId={state.surface}
          surfaceLabel={surfaces.find((x) => x.id === state.surface)?.label ?? 'Bu ekran'}
          onApplyPreset={(kind, tokens) => dispatch({ type: 'apply-preset', kind, tokens })}
          onPatchScreen={(p) => patchScreen(state.surface, p)}
        />

        {/* ── GELİŞMİŞ AYARLAR (Samsung Good Lock deseni) — ince ayarlar silinmedi,
             yalnız varsayılan görünümden çekildi. Önizlemede Dokun&Düzenle yine
             doğrudan kartın editörünü açar (bu katlamadan bağımsız). ── */}
        <button
          type="button"
          onClick={() => setAdvancedOpen((v) => !v)}
          aria-expanded={advancedOpen}
          className="md-state md-card-elevated flex items-center gap-4 px-4 text-left md-on-surface"
          style={{ minHeight: 64 }}
        >
          <span className="md-on-surface-variant flex-shrink-0"><Icon name="settings" /></span>
          <span className="flex-1 min-w-0">
            <span className="block md-title-s md-on-surface">Gelişmiş ayarlar</span>
            <span className="block md-body-s md-on-surface-variant truncate">
              Renkler tek tek · yazı tipi · kenarlık · ekranlar · bileşenler · yerleşim
            </span>
          </span>
          <Icon name="expand_more" className="md-on-surface-variant flex-shrink-0"
            style={{ transform: advancedOpen ? 'rotate(180deg)' : 'none', transition: 'transform var(--md-dur-short) var(--md-ease-standard)' }} />
        </button>
        {advancedOpen && (
        <div className="flex flex-col gap-4">
          {/* ── Aktif tema eylemleri ── */}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEditor({ kind: 'tokens' })}
              className="text-[11px] font-bold rounded-xl active:scale-95"
              style={{ minHeight: 46, background: 'color-mix(in srgb, var(--md-primary) 14%, transparent)', border: '1.5px solid color-mix(in srgb, var(--md-primary) 40%, transparent)', color: 'var(--md-primary)' }}
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
            <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--pwa-text-3)' }}>
              Ekranlar
            </p>
            <div className="flex gap-1.5 overflow-x-auto pb-1">
              {surfaces.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => dispatch({ type: 'select-surface', surface: s.id })}
                  className="flex-shrink-0 px-3 rounded-xl text-xs font-semibold active:scale-95"
                  style={{
                    minHeight: 40,
                    background: state.surface === s.id ? 'color-mix(in srgb, var(--md-primary) 18%, transparent)' : 'var(--pwa-surface)',
                    color: state.surface === s.id ? 'var(--md-primary)' : 'var(--pwa-text-3)',
                    border: `1px solid ${state.surface === s.id ? 'color-mix(in srgb, var(--md-primary) 42%, transparent)' : 'var(--pwa-border-soft)'}`,
                  }}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {surfaceShown === false && (
              <p
                className="mt-2 text-xs leading-snug font-semibold rounded-lg px-2.5 py-2"
                style={{ background: 'color-mix(in srgb, var(--md-warning) 10%, transparent)', border: '1px solid color-mix(in srgb, var(--md-warning) 30%, transparent)', color: 'var(--md-warning)' }}
              >
                Bu ekran önizlemede gösterilemiyor — araçta kullanıcı eylemiyle açılır
                (geri vites, uzun basma). Değişiklikler yine de kaydedilir ve araca gider;
                ama burada <b>sonucu göremezsin</b>.
              </p>
            )}
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
                  <p className="text-xs font-semibold" style={{ color: 'var(--pwa-text-3)' }}>
                    Yerleşim (çözülmüş)
                  </p>
                  <button
                    type="button"
                    onClick={() => dispatch({ type: 'reset-all-layout' })}
                    className="text-[11px] font-bold px-2 py-1.5 rounded-lg active:scale-95"
                    style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-3)' }}
                  >
                    Yerleşimi Sıfırla
                  </button>
                </div>
                <p className="text-xs" style={{ color: 'var(--pwa-text-3)' }}>
                  Aşağıdaki sıra <b>araçtaki yerleşim motorunun</b> (layoutSolver) bu manifestle
                  ürettiği gerçek sonuçtur. Bir kartın sırasını/boyutunu değiştirmek için
                  kartın kendi editörünü açın.
                </p>

                {/* ── SÜTUN GENİŞLİĞİ (PR-5) ─────────────────────────────────
                    Kullanıcı isteği: "sütun genişliği". Bugüne dek raylar SABİT
                    clamp() değerleriyle çiziliyordu ve hiçbir ayarla değişmiyordu.
                    MUTLAK PİKSEL DEĞİL ÇARPAN: temanın kendi duyarlı sınırları
                    ölçeklenir, böylece farklı ekran boyutlarında taşma/ezilme
                    olmaz. Orta sahne (harita) listede YOKTUR — o esnektir ve
                    kalan alanı alır; ölçeklemek anlamsız olurdu. */}
                <div className="flex flex-col gap-1.5 pt-1"
                  style={{ borderTop: '1px solid var(--pwa-border-soft)' }}>
                  <p className="text-[11px] font-bold" style={{ color: 'var(--pwa-text-3)' }}>
                    Sütun Genişliği
                  </p>
                  {SCALABLE_ZONES.map((z) => {
                    const deger = manifest.zoneWidths[z] ?? null;
                    return (
                      <div key={z} className="flex items-center gap-2">
                        <span className="text-xs font-bold flex-1" style={{ color: 'var(--pwa-text-2)' }}>
                          {ZONE_LABEL[z]}
                        </span>
                        <input
                          type="range"
                          min={ZONE_SCALE_MIN}
                          max={ZONE_SCALE_MAX}
                          step={0.05}
                          value={deger ?? 1}
                          onChange={(e) => dispatch({
                            type: 'patch-zone-width', zone: z, scale: Number(e.target.value),
                          })}
                          style={{ flex: 2, minWidth: 0 }}
                        />
                        <span className="text-xs font-semibold tabular-nums w-10 text-right"
                          style={{ color: deger === null ? 'var(--pwa-text-3)' : 'var(--md-primary)' }}>
                          {deger === null ? 'oto' : `${deger.toFixed(2)}×`}
                        </span>
                        {deger !== null && (
                          <button
                            type="button"
                            aria-label="Sütun genişliğini sıfırla"
                            onClick={() => dispatch({ type: 'patch-zone-width', zone: z, scale: null })}
                            className="text-[11px] font-bold px-1.5 py-1 rounded-md active:scale-95"
                            style={{ background: 'var(--pwa-surface)', border: '1px solid var(--pwa-border)', color: 'var(--pwa-text-3)' }}
                          >
                            ↺
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
                {solved.zones.filter((z) => z.items.length > 0 || z.overflow.length > 0).map((z) => (
                  <div key={z.zone} className="flex flex-col gap-1">
                    <p className="text-[11px] font-bold" style={{ color: 'var(--pwa-text-3)' }}>
                      {ZONE_LABEL[z.zone]}
                    </p>
                    {/* SÜRÜKLE-BIRAK (#658): sıra artık sayı girerek değil,
                        taşıyarak değiştirilir. Liste `solved`dan gelir — yani
                        ARAÇTAKİ çözücünün gerçek sonucudur, ayrı bir sıra
                        kopyası tutulmaz. */}
                    <ZoneReorder
                      items={z.items.map((it) => ({ id: it.id, label: it.label, locked: it.locked }))}
                      onCommit={(ids) => dispatch({ type: 'reorder-zone', zone: z.zone, orderedCardIds: ids })}
                    />
                    <div className="flex flex-wrap gap-1.5">
                      {z.overflow.map((id) => (
                        <span key={id}
                          className="text-xs font-semibold px-2 py-1 rounded-lg"
                          style={{ background: 'color-mix(in srgb, var(--md-warning) 12%, transparent)', border: '1px solid color-mix(in srgb, var(--md-warning) 35%, transparent)', color: 'var(--md-warning)' }}>
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
                <p className="text-xs" style={{ color: 'var(--pwa-text-3)' }}>
                  <b>{preset.label}</b> sabit yerleşimle çizilir (araçta yerleşim motoruna
                  bağlı değildir) → bu temada kart sırası/boyutu <b>düzenlenemez</b>.
                  Renk, tipografi ve efekt düzenlemeleri tam çalışır.
                </p>
              </div>
            )
          )}

          {/* ── Bileşen listesi ── */}
          <div>
            <p className="text-[11px] font-semibold mb-2" style={{ color: 'var(--pwa-text-3)' }}>
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
                      background: edited ? 'color-mix(in srgb, var(--md-success) 8%, transparent)' : 'var(--pwa-surface)',
                      border: `1px solid ${edited ? 'color-mix(in srgb, var(--md-success) 30%, transparent)' : 'var(--pwa-border)'}`,
                    }}
                  >
                    <div className="min-w-0">
                      <p className="text-[12px] font-bold truncate" style={{ color: 'var(--pwa-text-2)' }}>{c.label}</p>
                      <p className="text-[11px] truncate" style={{ color: 'var(--pwa-text-3)' }}>
                        {c.id} · {c.type}{c.locked ? ' · kilitli' : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {present === false && (
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--md-warning) 14%, transparent)', color: 'var(--md-warning)' }}>
                          EKRANDA YOK
                        </span>
                      )}
                      {edited && (
                        <span className="text-[11px] font-bold px-1.5 py-0.5 rounded" style={{ background: 'color-mix(in srgb, var(--md-success) 16%, transparent)', color: 'var(--md-success)' }}>
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
              <p className="text-[11px] mt-2 px-1" style={{ color: 'var(--pwa-text-3)' }}>
                Önizleme ölçümünde bulunan bileşen: {inventory.length}. &quot;EKRANDA YOK&quot; = o bileşen
                önizlemenin şu anki görünümünde çizilmiyor (ör. çekmece kapalı) — stil yine kaydedilir.
              </p>
            )}
          </div>

          {/* ── Seviyeli sıfırlama ── */}
          <div className="rounded-2xl p-3 flex flex-col gap-2"
            style={{ background: 'var(--pwa-surface-3)', border: '1px solid var(--pwa-border-soft)' }}>
            <p className="text-xs font-semibold" style={{ color: 'var(--pwa-text-3)' }}>
              Sıfırlama
            </p>
            <p className="text-xs" style={{ color: 'var(--pwa-text-3)' }}>
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
                  style={{ background: 'color-mix(in srgb, var(--md-error) 8%, transparent)', border: '1px solid color-mix(in srgb, var(--md-error) 32%, transparent)' }}>
                  <p className="text-[11px] font-bold" style={{ color: 'var(--md-error)' }}>
                    Bu temadaki tüm Studio değişiklikleri geri alınacak.
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--pwa-text-3)' }}>
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
                    className="flex-1 text-[11px] font-semibold rounded-xl active:scale-95"
                    style={{ minHeight: 44, background: 'color-mix(in srgb, var(--md-error) 14%, transparent)', border: '1.5px solid color-mix(in srgb, var(--md-error) 42%, transparent)', color: 'var(--md-error)' }}
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
      <p className="text-xs px-1" style={{ color: 'var(--pwa-text-3)' }}>
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
        className="text-xs font-bold rounded-xl"
        style={{ minHeight: 38, background: 'transparent', color: 'var(--pwa-text-3)' }}
      >
        Vazgeç
      </button>
    </div>
  );
});
