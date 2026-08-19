/**
 * themeStudioState — Tema Stüdyo'nun SAF durum çekirdeği.
 *
 * Neden ayrı dosya: reducer SAFtır (I/O yok, Date.now yok, React yok) → geri
 * al / yinele / seviyeli sıfırlama davranışı testle kilitlenebilir. React
 * bileşeni yalnız bu reducer'ı sürer; kalıcılık ayrı ve açık fonksiyonlardadır.
 *
 * TASARIM
 *  - Özelleştirme TEMA BAŞINA tutulur → "Tema 2'yi düzenledim, Tema 1'e geçtim,
 *    geri döndüm" senaryosunda hiçbir şey kaybolmaz ve temalar birbirini EZMEZ.
 *  - Hazır tema tanımının kendisi ASLA yazılmaz; kullanıcı override'ı ayrı katmandır
 *    (manifest null-tabanlıdır: dokunulmayan alan null → araçta tema kendi değerini
 *    kullanır).
 *  - Geri al/yinele yalnız MANİFEST kümesini kapsar; seçim/gezinme geçmişe girmez
 *    (kullanıcı "geri al" derken rengi geri almak ister, sekmeyi değil).
 *  - Sıfırlama SEVİYELİDİR: bileşen → ekran → tema. "Tümünü sıfırla" tek dokunuşla
 *    ulaşılamaz (yanlışlıkla tüm temayı silmek mümkün olmamalı — çağıran onay ister).
 */

import {
  coerceThemeManifest,
  createThemeManifest,
  EMPTY_CARD_LAYOUT,
  EMPTY_COMPONENT_STYLE,
  EMPTY_SCREEN_OVERRIDE,
  EMPTY_STATE_STYLE,
  isEmptyCardLayout,
  isEmptyComponentStyle,
  isEmptyScreenOverride,
  THEME_BASE_IDS,
  THEME_PRESETS,
  type CardLayout,
  type ScalableZoneId,
  type ComponentStyle,
  type GlobalTokens,
  type ScreenOverride,
  type StateKey,
  type StateStyle,
  type ThemeBaseId,
  type ThemeManifest,
} from './themeManifest';
import type { ThemeSurfaceId } from './themeComponentRegistry';

export const STUDIO_STORAGE_KEY = 'caros-theme-studio-v2';
/** v1 Tema Stüdyo anahtarı (tek düz token seti) — taşınır, silinmez. */
export const STUDIO_LEGACY_KEY = 'caros-theme-studio';

const MAX_HISTORY = 200;

export type ManifestSet = Record<ThemeBaseId, ThemeManifest>;

/* ══ GEÇMİŞ — DİLİM (slice) TABANLI ═══════════════════════════════════
   Önceki sürüm her adımda TÜM manifest kümesinin kopyasını yığına atıyordu.
   Bu, "geri al"ı zorunlu olarak GLOBAL yapıyordu: A kartını geri almak
   B kartını da o anki hâline döndürürdü.

   Yeni model AYNI yığını kullanır, ama her adım artık bir SNAPSHOT değil,
   tek bir DİLİMİN önce/sonra değeridir. Dilimler birbirinden bağımsızdır
   (`componentOverrides[x]`, `layoutOverrides[y]`, `screenOverrides[z]`,
   `tokens`) → bir dilimin son adımını geri almak diğer dilimlere DOKUNMAZ.
   Böylece kart-bazlı geri al, ikinci bir motor açmadan aynı yığından çıkar.  */

export type HistoryTarget =
  | { kind: 'tokens' }
  | { kind: 'component'; componentId: string }
  | { kind: 'layout'; cardId: string }
  /** Kart = bileşen stili + (varsa) yerleşim kartı — TEK işlem olarak. */
  | { kind: 'card'; componentId: string; layoutCardId: string | null }
  | { kind: 'screen'; surface: string }
  /** Tüm manifest (tema sıfırlama · kopyalama · toplu yerleşim sıfırlama). */
  | { kind: 'theme' };

export interface HistoryEntry {
  themeId: ThemeBaseId;
  target: HistoryTarget;
  /** Değişiklikten ÖNCEKİ dilim değeri (yoksa null). */
  before: unknown;
  /** Değişiklikten SONRAKİ dilim değeri (yoksa null). */
  after: unknown;
  /**
   * Aynı UI etkileşiminin (ör. slider sürükleme) tek adıma indirgenmesi için
   * birleştirme anahtarı. `null` → asla birleşme.
   */
  mergeKey: string | null;
  /** Teşhis/UI etiketi. */
  label: string;
}

/** Bir geri-al düğmesinin kapsamı. `null` = global (her şey). */
export interface HistoryScope {
  themeId: ThemeBaseId;
  /** Bu kapsamın dokunduğu dilim anahtarları. */
  keys: string[];
}

export interface StudioState {
  themeId: ThemeBaseId;
  manifests: ManifestSet;
  surface: ThemeSurfaceId;
  /** Tam ekran editörün hedefi; null → editör kapalı. */
  editingComponentId: string | null;
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** Son adımın birleştirme anahtarı — gezinme/editör açılışı bunu SIFIRLAR. */
  lastMergeKey: string | null;
}

export type StudioAction =
  | { type: 'hydrate'; manifests: ManifestSet; themeId: ThemeBaseId }
  | { type: 'select-theme'; themeId: ThemeBaseId }
  | { type: 'select-surface'; surface: ThemeSurfaceId }
  | { type: 'open-editor'; componentId: string }
  | { type: 'close-editor' }
  | { type: 'patch-tokens'; patch: Partial<GlobalTokens> }
  | { type: 'patch-component'; componentId: string; patch: Partial<ComponentStyle> }
  | { type: 'patch-component-state'; componentId: string; stateKey: StateKey; patch: Partial<StateStyle> }
  | { type: 'patch-screen'; surface: ThemeSurfaceId; patch: Partial<ScreenOverride> }
  | { type: 'patch-layout'; cardId: string; patch: Partial<CardLayout> }
  | { type: 'reset-layout'; cardId: string }
  /** Bölge (sütun) genişlik çarpanı — `null` = tema varsayılanına dön. */
  | { type: 'patch-zone-width'; zone: ScalableZoneId; scale: number | null }
  | { type: 'reset-all-layout' }
  | { type: 'reset-component'; componentId: string }
  /** Kartı BAŞLANGIÇ hâline döndür — stil + yerleşim TEK transaction. */
  | { type: 'reset-card'; componentId: string; layoutCardId: string | null }
  | { type: 'reset-surface'; surface: ThemeSurfaceId }
  | { type: 'reset-theme' }
  | { type: 'copy-from'; sourceThemeId: ThemeBaseId }
  | { type: 'rename'; name: string }
  | { type: 'mark-sent'; at: string }
  /** `scope` verilmezse GLOBAL geri al; verilirse yalnız o kapsamın son adımı. */
  | { type: 'undo'; scope?: HistoryScope | null }
  | { type: 'redo'; scope?: HistoryScope | null };

export function emptyManifestSet(): ManifestSet {
  const out = {} as ManifestSet;
  for (const id of THEME_BASE_IDS) out[id] = createThemeManifest(id);
  return out;
}

export function createStudioState(): StudioState {
  return {
    themeId: 'expedition',
    manifests: emptyManifestSet(),
    surface: 'home',
    editingComponentId: null,
    past: [],
    future: [],
    lastMergeKey: null,
  };
}

/* ══ Dilim erişimi ═══════════════════════════════════════════════════ */

/** Bir hedefin dokunduğu dilim anahtarları (çakışma hesabı için). */
export function targetKeys(t: HistoryTarget): string[] {
  switch (t.kind) {
    case 'tokens': return ['tokens'];
    case 'component': return [`c:${t.componentId}`];
    case 'layout': return [`l:${t.cardId}`];
    case 'card': return t.layoutCardId ? [`c:${t.componentId}`, `l:${t.layoutCardId}`] : [`c:${t.componentId}`];
    case 'screen': return [`s:${t.surface}`];
    case 'theme': return ['*'];
  }
}

function keysOverlap(a: string[], b: string[]): boolean {
  if (a.includes('*') || b.includes('*')) return true;
  return a.some((k) => b.includes(k));
}

/** Kapsam yardımcıları — UI bunları kullanır, elle anahtar üretmez. */
export function cardScope(themeId: ThemeBaseId, componentId: string, layoutCardId: string | null): HistoryScope {
  return { themeId, keys: targetKeys({ kind: 'card', componentId, layoutCardId }) };
}
export function screenScope(themeId: ThemeBaseId, surface: string): HistoryScope {
  return { themeId, keys: targetKeys({ kind: 'screen', surface }) };
}
export function tokensScope(themeId: ThemeBaseId): HistoryScope {
  return { themeId, keys: targetKeys({ kind: 'tokens' }) };
}

/** Hedefin manifestteki değeri (yoksa null). */
function readSlice(m: ThemeManifest, t: HistoryTarget): unknown {
  switch (t.kind) {
    case 'tokens': return { ...m.tokens };
    case 'component': return m.componentOverrides[t.componentId] ?? null;
    case 'layout': return m.layoutOverrides[t.cardId] ?? null;
    case 'card': return {
      style: m.componentOverrides[t.componentId] ?? null,
      layout: t.layoutCardId ? (m.layoutOverrides[t.layoutCardId] ?? null) : null,
    };
    case 'screen': return m.screenOverrides[t.surface] ?? null;
    case 'theme': return cloneManifest(m);
  }
}

/** Hedefin değerini manifeste yaz (null → dilimi kaldır). */
function writeSlice(m: ThemeManifest, t: HistoryTarget, v: unknown): ThemeManifest {
  const next = cloneManifest(m);
  switch (t.kind) {
    case 'tokens':
      next.tokens = { ...(v as GlobalTokens) };
      return next;
    case 'component': {
      const o = { ...next.componentOverrides };
      if (v === null || v === undefined) delete o[t.componentId];
      else o[t.componentId] = v as ComponentStyle;
      next.componentOverrides = o;
      return next;
    }
    case 'layout': {
      const o = { ...next.layoutOverrides };
      if (v === null || v === undefined) delete o[t.cardId];
      else o[t.cardId] = v as CardLayout;
      next.layoutOverrides = o;
      return next;
    }
    case 'card': {
      const pack = (v ?? { style: null, layout: null }) as { style: ComponentStyle | null; layout: CardLayout | null };
      const co = { ...next.componentOverrides };
      if (pack.style === null || pack.style === undefined) delete co[t.componentId];
      else co[t.componentId] = pack.style;
      next.componentOverrides = co;
      if (t.layoutCardId) {
        const lo = { ...next.layoutOverrides };
        if (pack.layout === null || pack.layout === undefined) delete lo[t.layoutCardId];
        else lo[t.layoutCardId] = pack.layout;
        next.layoutOverrides = lo;
      }
      return next;
    }
    case 'screen': {
      const o = { ...next.screenOverrides };
      if (v === null || v === undefined) delete o[t.surface];
      else o[t.surface] = v as ScreenOverride;
      next.screenOverrides = o;
      return next;
    }
    case 'theme':
      return cloneManifest(v as ThemeManifest);
  }
}

/** Saf karşılaştırma — dilimler yalnız düz veri taşır (sabit alan sırası). */
function sameSlice(a: unknown, b: unknown): boolean {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

/* ── Yardımcılar ──────────────────────────────────────────────────── */

function cloneManifest(m: ThemeManifest): ThemeManifest {
  return {
    schemaVersion: m.schemaVersion,
    themeId: m.themeId,
    themeVersion: m.themeVersion,
    tokens: { ...m.tokens },
    componentOverrides: { ...m.componentOverrides },
    screenOverrides: { ...m.screenOverrides },
    layoutOverrides: { ...m.layoutOverrides },
    zoneWidths: { ...m.zoneWidths },
    metadata: { ...m.metadata },
  };
}

function cloneSet(set: ManifestSet): ManifestSet {
  const out = {} as ManifestSet;
  for (const id of THEME_BASE_IDS) out[id] = cloneManifest(set[id]);
  return out;
}

/**
 * Aktif temanın manifestini değiştirir ve GEÇMİŞE TEK ADIM yazar.
 *
 *  - Değer değişmediyse geçmişe HİÇBİR ŞEY yazılmaz (boş adım yok).
 *  - `mergeKey` aynıysa ve son adım da aynı dilime aitse ADIMLAR BİRLEŞİR
 *    (slider sürüklemesi tek "geri al" olur — görev §5 atomiklik).
 *  - Yalnız AYNI dilime ait yinele (redo) adımları temizlenir → başka kartın
 *    yinele geçmişi bozulmaz (görev §4 kart-bazlılık).
 */
function commit(
  s: StudioState,
  target: HistoryTarget,
  mutate: (m: ThemeManifest) => ThemeManifest,
  mergeKey: string | null,
  label: string,
): StudioState {
  const cur = s.manifests[s.themeId];
  const before = readSlice(cur, target);
  const nextManifest = mutate(cloneManifest(cur));
  const after = readSlice(nextManifest, target);
  if (sameSlice(before, after)) return s;

  const keys = targetKeys(target);
  const last = s.past.length > 0 ? s.past[s.past.length - 1] : null;
  const canMerge = mergeKey !== null
    && s.lastMergeKey === mergeKey
    && last !== null
    && last.themeId === s.themeId
    && last.mergeKey === mergeKey
    && sameSlice(targetKeys(last.target), keys);

  const entry: HistoryEntry = {
    themeId: s.themeId,
    target,
    before: canMerge ? (last as HistoryEntry).before : before,
    after,
    mergeKey,
    label,
  };

  const past = canMerge
    ? [...s.past.slice(0, -1), entry]
    : [...s.past, entry].slice(-MAX_HISTORY);

  // Yalnız çakışan yinele adımlarını at (diğer kartların redo'su korunur).
  const future = s.future.filter(
    (e) => !(e.themeId === s.themeId && keysOverlap(targetKeys(e.target), keys)),
  );

  return {
    ...s,
    manifests: { ...cloneSet(s.manifests), [s.themeId]: nextManifest },
    past,
    future,
    lastMergeKey: mergeKey,
  };
}

/** Gezinme/editör açılışı birleştirmeyi KIRAR (iki ayrı düzenleme birleşmesin). */
function breakMerge(s: StudioState): StudioState {
  return s.lastMergeKey === null ? s : { ...s, lastMergeKey: null };
}

/** Bir yamanın hangi alanlara dokunduğu — birleştirme anahtarının parçası. */
function patchKey(patch: object): string {
  return Object.keys(patch).sort().join(',');
}

export function componentStyleOf(m: ThemeManifest, componentId: string): ComponentStyle {
  return m.componentOverrides[componentId] ?? { ...EMPTY_COMPONENT_STYLE };
}

export function screenOverrideOf(m: ThemeManifest, surface: string): ScreenOverride {
  return m.screenOverrides[surface] ?? { ...EMPTY_SCREEN_OVERRIDE };
}

export function stateStyleOf(style: ComponentStyle, key: StateKey): StateStyle {
  return style.states?.[key] ?? { ...EMPTY_STATE_STYLE };
}

/** Solver kart id'si için yerleşim override'ı (yoksa 'dokunma' hâli). */
export function cardLayoutOf(m: ThemeManifest, cardId: string): CardLayout {
  return m.layoutOverrides[cardId] ?? { ...EMPTY_CARD_LAYOUT };
}

/* ── Reducer (SAF) ────────────────────────────────────────────────── */

export function studioReducer(s: StudioState, a: StudioAction): StudioState {
  switch (a.type) {
    case 'hydrate':
      return { ...s, manifests: a.manifests, themeId: a.themeId, past: [], future: [], lastMergeKey: null };

    case 'select-theme':
      if (!THEME_BASE_IDS.includes(a.themeId) || a.themeId === s.themeId) return s;
      return { ...breakMerge(s), themeId: a.themeId, editingComponentId: null };

    case 'select-surface':
      return { ...breakMerge(s), surface: a.surface, editingComponentId: null };

    case 'open-editor':
      return { ...breakMerge(s), editingComponentId: a.componentId };

    case 'close-editor':
      return { ...breakMerge(s), editingComponentId: null };

    case 'patch-tokens':
      return commit(s, { kind: 'tokens' }, (m) => {
        m.tokens = { ...m.tokens, ...a.patch };
        return m;
      }, `tokens:${patchKey(a.patch)}`, 'Tema tokenı');

    case 'patch-component':
      return commit(s, { kind: 'component', componentId: a.componentId }, (m) => {
        const cur = componentStyleOf(m, a.componentId);
        const next: ComponentStyle = { ...cur, ...a.patch };
        const overrides = { ...m.componentOverrides };
        if (isEmptyComponentStyle(next)) delete overrides[a.componentId];
        else overrides[a.componentId] = next;
        m.componentOverrides = overrides;
        return m;
      }, `c:${a.componentId}:${patchKey(a.patch)}`, 'Bileşen stili');

    case 'patch-component-state':
      return commit(s, { kind: 'component', componentId: a.componentId }, (m) => {
        const cur = componentStyleOf(m, a.componentId);
        const curState = stateStyleOf(cur, a.stateKey);
        const nextState: StateStyle = { ...curState, ...a.patch };
        const states = { ...(cur.states ?? {}) };
        const empty = !nextState.bg && !nextState.borderColor && !nextState.textColor
          && !nextState.accentColor && nextState.opacity === null;
        if (empty) delete states[a.stateKey];
        else states[a.stateKey] = nextState;
        const next: ComponentStyle = {
          ...cur,
          states: Object.keys(states).length > 0 ? states : null,
        };
        const overrides = { ...m.componentOverrides };
        if (isEmptyComponentStyle(next)) delete overrides[a.componentId];
        else overrides[a.componentId] = next;
        m.componentOverrides = overrides;
        return m;
      }, `c:${a.componentId}:state:${a.stateKey}:${patchKey(a.patch)}`, 'Bileşen durumu');

    case 'patch-screen':
      return commit(s, { kind: 'screen', surface: a.surface }, (m) => {
        const cur = screenOverrideOf(m, a.surface);
        const next: ScreenOverride = { ...cur, ...a.patch };
        const screens = { ...m.screenOverrides };
        if (isEmptyScreenOverride(next)) delete screens[a.surface];
        else screens[a.surface] = next;
        m.screenOverrides = screens;
        return m;
      }, `s:${a.surface}:${patchKey(a.patch)}`, 'Ekran ayarı');

    /* Yerleşim — solver kart id'si başına. İKİNCİ MOTOR YOK: bu alanlar
     * layoutSolver'ın `CardIntent`inin null-tabanlı hâlidir. */
    case 'patch-layout':
      return commit(s, { kind: 'layout', cardId: a.cardId }, (m) => {
        const cur = cardLayoutOf(m, a.cardId);
        const next: CardLayout = { ...cur, ...a.patch };
        const layouts = { ...m.layoutOverrides };
        if (isEmptyCardLayout(next)) delete layouts[a.cardId];
        else layouts[a.cardId] = next;
        m.layoutOverrides = layouts;
        return m;
      }, `l:${a.cardId}:${patchKey(a.patch)}`, 'Yerleşim');

    case 'patch-zone-width':
      /* Hedef `layout` kovasıdır: geri-al/ileri-al ve "yerleşimi sıfırla"
         akışları bölge genişliğini de kapsasın (ayrı kova = ayrı geçmiş =
         kullanıcının "geri al" beklentisinin bozulması). */
      return commit(s, { kind: 'layout', cardId: `zone:${a.zone}` }, (m) => {
        const z = { ...m.zoneWidths };
        if (a.scale === null) delete z[a.zone];
        else z[a.zone] = a.scale;
        m.zoneWidths = z;
        return m;
      }, `z:${a.zone}`, 'Sütun genişliği');

    case 'reset-layout':
      return commit(s, { kind: 'layout', cardId: a.cardId }, (m) => {
        const layouts = { ...m.layoutOverrides };
        delete layouts[a.cardId];
        m.layoutOverrides = layouts;
        return m;
      }, null, 'Yerleşim sıfırlama');

    case 'reset-all-layout':
      return commit(s, { kind: 'theme' }, (m) => {
        m.layoutOverrides = {};
        return m;
      }, null, 'Tüm yerleşimi sıfırlama');

    case 'reset-component':
      return commit(s, { kind: 'component', componentId: a.componentId }, (m) => {
        const overrides = { ...m.componentOverrides };
        delete overrides[a.componentId];
        m.componentOverrides = overrides;
        return m;
      }, null, 'Bileşen sıfırlama');

    /**
     * KARTI BAŞLANGIÇ HÂLİNE DÖNDÜR — stil + yerleşim TEK transaction.
     * Yalnız bu kart etkilenir: diğer kartların override'ı, geçmişi ve
     * yerleşimi ile diğer ekranlar AYNEN kalır.
     */
    case 'reset-card':
      return commit(s, { kind: 'card', componentId: a.componentId, layoutCardId: a.layoutCardId }, (m) => {
        const overrides = { ...m.componentOverrides };
        delete overrides[a.componentId];
        m.componentOverrides = overrides;
        if (a.layoutCardId) {
          const layouts = { ...m.layoutOverrides };
          delete layouts[a.layoutCardId];
          m.layoutOverrides = layouts;
        }
        return m;
      }, null, 'Kartı başlangıca döndür');

    /** Ekran sıfırlama: o ekranın override'ı + o ekrana ait bileşen override'ları. */
    case 'reset-surface':
      return commit(s, { kind: 'screen', surface: a.surface }, (m) => {
        const screens = { ...m.screenOverrides };
        delete screens[a.surface];
        m.screenOverrides = screens;
        return m;
      }, null, 'Ekran sıfırlama');

    /**
     * TÜM DEĞİŞİKLİKLERİ GERİ AL — seçili temanın tokens + componentOverrides +
     * screenOverrides + layoutOverrides'ının TAMAMI başlangıca döner.
     * TEK transaction'dır (tek "geri al" ile tamamı iade edilir) ve
     * BAŞKA TEMAYA DOKUNMAZ.
     */
    case 'reset-theme':
      return commit(s, { kind: 'theme' }, () => createThemeManifest(s.themeId), null, 'Tüm değişiklikleri geri al');

    case 'copy-from': {
      if (!THEME_BASE_IDS.includes(a.sourceThemeId) || a.sourceThemeId === s.themeId) return s;
      const src = s.manifests[a.sourceThemeId];
      return commit(s, { kind: 'theme' }, (m) => {
        // Yalnız KULLANICI katmanı kopyalanır; hedef temanın kendi kimliği (themeId,
        // sürüm, ad) korunur → "Tema 3'ün ayarlarını Tema 1'e uygula" güvenli.
        m.tokens = { ...src.tokens };
        m.componentOverrides = { ...src.componentOverrides };
        m.screenOverrides = { ...src.screenOverrides };
        // Yerleşim yalnız kart id'leri ÖRTÜŞTÜĞÜ ölçüde taşınır; hedef temada
        // olmayan kart id'si solver tarafından zaten elenir (normalizeIntent).
        m.layoutOverrides = { ...src.layoutOverrides };
        return m;
      }, null, 'Başka temadan kopyala');
    }

    case 'rename': {
      const name = a.name.trim().slice(0, 48);
      if (name.length === 0) return s;
      return commit(s, { kind: 'theme' }, (m) => {
        m.metadata = { ...m.metadata, name };
        return m;
      }, null, 'Yeniden adlandır');
    }

    /** Araca gönderildi → sürüm artar ve damga düşer (geçmişe GİRMEZ). */
    case 'mark-sent': {
      const cur = cloneManifest(s.manifests[s.themeId]);
      cur.themeVersion = cur.themeVersion + 1;
      cur.metadata = { ...cur.metadata, updatedAt: a.at, origin: 'pwa-studio' };
      return { ...s, manifests: { ...cloneSet(s.manifests), [s.themeId]: cur } };
    }

    case 'undo':
      return step(s, 'past', a.scope ?? null);

    case 'redo':
      return step(s, 'future', a.scope ?? null);

    default:
      return s;
  }
}

/* ══ Geri al / ileri al — TEK mekanizma, kapsamlı ═══════════════════ */

/**
 * Kapsama uyan SON adımı bulur.
 *
 * KRİTİK GÜVENLİK KURALI: geriye tararken tema düzeyi (`*`) bir adıma
 * rastlanırsa DURULUR. Aksi hâlde "tüm değişiklikleri geri al"dan sonra
 * kart-bazlı geri al, silinmiş bir override'ı geri diriltirdi.
 */
function findScoped(list: HistoryEntry[], scope: HistoryScope | null): number {
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (scope === null) return i;
    if (e.themeId !== scope.themeId) continue;
    const keys = targetKeys(e.target);
    if (keysOverlap(keys, scope.keys)) {
      // Tema düzeyi adım kapsamla "örtüşür" ama kart geri alması değildir.
      return keys.includes('*') && !scope.keys.includes('*') ? -1 : i;
    }
  }
  return -1;
}

function step(s: StudioState, from: 'past' | 'future', scope: HistoryScope | null): StudioState {
  const src = from === 'past' ? s.past : s.future;
  const i = findScoped(src, scope);
  if (i < 0) return s;

  const entry = src[i];
  const value = from === 'past' ? entry.before : entry.after;
  const target = s.manifests[entry.themeId];
  const nextManifest = writeSlice(target, entry.target, value);

  const nextSrc = [...src.slice(0, i), ...src.slice(i + 1)];
  const dst = from === 'past' ? s.future : s.past;
  const nextDst = [...dst, entry].slice(-MAX_HISTORY);

  return {
    ...s,
    manifests: { ...cloneSet(s.manifests), [entry.themeId]: nextManifest },
    past: from === 'past' ? nextSrc : nextDst,
    future: from === 'past' ? nextDst : nextSrc,
    lastMergeKey: null,
  };
}

export function canUndo(s: StudioState): boolean {
  return s.past.length > 0;
}
export function canRedo(s: StudioState): boolean {
  return s.future.length > 0;
}

/** Kapsamlı (ör. kart bazlı) geri al/ileri al mümkün mü — UI düğmeyi buna göre kapatır. */
export function canUndoScoped(s: StudioState, scope: HistoryScope | null): boolean {
  return findScoped(s.past, scope) >= 0;
}
export function canRedoScoped(s: StudioState, scope: HistoryScope | null): boolean {
  return findScoped(s.future, scope) >= 0;
}

/** Kartta Studio değişikliği var mı — "Kartı Başlangıç Hâline Döndür" düğmesi için. */
export function cardHasChanges(m: ThemeManifest, componentId: string, layoutCardId: string | null): boolean {
  if (m.componentOverrides[componentId] !== undefined) return true;
  if (layoutCardId && m.layoutOverrides[layoutCardId] !== undefined) return true;
  return false;
}

/** Aktif temada kullanıcının kaç dokunuşu var (rozet/uyarı için). */
export function customizationCount(m: ThemeManifest): number {
  let n = 0;
  for (const v of Object.values(m.tokens)) if (v !== null) n++;
  n += Object.keys(m.componentOverrides).length;
  n += Object.keys(m.screenOverrides).length;
  n += Object.keys(m.layoutOverrides).length;
  return n;
}

/* ── Kalıcılık (I/O — reducer'ın DIŞINDA) ─────────────────────────── */

export interface PersistedStudio {
  themeId: ThemeBaseId;
  manifests: ManifestSet;
}

export function serializeStudio(s: StudioState): string {
  return JSON.stringify({ themeId: s.themeId, manifests: s.manifests } satisfies PersistedStudio);
}

/** Zero-trust okuma: bozuk/eksik depo tam varsayılana düşer, THROW ETMEZ. */
export function deserializeStudio(raw: string | null): PersistedStudio {
  const fallback: PersistedStudio = { themeId: 'expedition', manifests: emptyManifestSet() };
  if (!raw) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fallback;
  }
  if (!parsed || typeof parsed !== 'object') return fallback;
  const o = parsed as Record<string, unknown>;
  const themeId = THEME_BASE_IDS.includes(o.themeId as ThemeBaseId)
    ? (o.themeId as ThemeBaseId)
    : 'expedition';
  const manifests = emptyManifestSet();
  if (o.manifests && typeof o.manifests === 'object') {
    for (const id of THEME_BASE_IDS) {
      const m = (o.manifests as Record<string, unknown>)[id];
      if (m !== undefined) manifests[id] = coerceThemeManifest(m, id);
    }
  }
  return { themeId, manifests };
}

/**
 * v1 Tema Stüdyo taşıması — eski depo tek düz token seti tutuyordu
 * (`{accentPrimary, bgPrimary, radiusCard, …}` + `baseTheme`).
 * Kullanıcının emeği ÇÖPE ATILMAZ: tanınan alanlar o temanın manifest'ine taşınır.
 */
export function migrateLegacyStudio(raw: string | null): PersistedStudio | null {
  if (!raw) return null;
  let o: Record<string, unknown>;
  try {
    const p = JSON.parse(raw) as unknown;
    if (!p || typeof p !== 'object') return null;
    o = p as Record<string, unknown>;
  } catch {
    return null;
  }
  const legacyBase = typeof o.baseTheme === 'string' ? o.baseTheme : 'pro';
  const themeId: ThemeBaseId = THEME_BASE_IDS.includes(legacyBase as ThemeBaseId)
    ? (legacyBase as ThemeBaseId)
    : 'pro';
  const manifests = emptyManifestSet();
  const m = manifests[themeId];
  const str = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
  const nbr = (k: string): number | null => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? (o[k] as number) : null);
  const raw2 = {
    accentPrimary: str('accentPrimary'),
    accentSecondary: str('accentSecondary'),
    textPrimary: str('textPrimary'),
    textSecondary: str('textSecondary'),
    borderColor: str('borderColor'),
    glowColor: str('glowColor'),
    iconNav: str('iconNav'),
    iconMedia: str('iconMedia'),
    iconDock: str('iconDock'),
    radiusCard: nbr('radiusCard'),
    radiusBtn: nbr('radiusBtn'),
    radiusTile: nbr('radiusTile'),
    radiusDock: nbr('radiusDock'),
    cardBlurPx: nbr('cardBlurPx'),
    glowIntensity: nbr('glowIntensity'),
    fontFamily: str('fontFamily'),
    fontWeight: nbr('fontWeight'),
    letterSpacing: nbr('letterSpacing'),
    bgPrimary: str('bgPrimary') ? { kind: 'solid', from: str('bgPrimary') } : null,
    bgCard: str('bgCard') ? { kind: 'solid', from: str('bgCard') } : null,
  };
  const migrated = coerceThemeManifest({ themeId, tokens: raw2, metadata: { name: THEME_PRESETS[themeId].label, origin: 'pwa-studio' } }, themeId);
  manifests[themeId] = migrated;
  void m;
  return { themeId, manifests };
}
