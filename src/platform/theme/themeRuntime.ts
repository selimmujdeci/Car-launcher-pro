/**
 * themeRuntime — Tema Manifesti'nin ARAÇ tarafındaki tek uygulayıcısı.
 *
 * Zincir:  Arabam Cebimde (Tema Stüdyo) → `theme_change` komutu → parseIncomingManifest
 *          (fail-CLOSED) → applyThemeManifest → CSS değişkenleri + bileşen CSS'i.
 *
 * TASARIM KARARLARI
 *  - Uygulama YENİDEN KURULUM İSTEMEZ: tek `<style>` etiketi + `documentElement`
 *    üzerinde CSS custom property'leri. React ağacı yeniden monte EDİLMEZ.
 *  - Manifest TEMA BAŞINA saklanır. Araçta kullanıcı temayı değiştirirse o temanın
 *    kendi özelleştirmesi uygulanır; başka temanın renkleri sızmaz.
 *  - Boot'ta baz tema ZORLANMAZ (kullanıcının araçtaki seçimi otoritedir); yalnız
 *    o temaya ait tokenlar geri yüklenir. Baz tema YALNIZ komut anında değişir.
 *  - Zero-leak: tek style etiketi tekrar kullanılır, tek abonelik kurulur.
 *  - Kanıtsız durum üretilmez: hiç manifest uygulanmadıysa alanlar `null` kalır
 *    (sahte 0 / sahte tarih YOK) — CAROS LAB bunu UNAVAILABLE olarak gösterir.
 */

import {
  ALL_MANAGED_CSS_VARS,
  coerceThemeManifest,
  createThemeManifest,
  layoutOverrideCount,
  manifestToCss,
  manifestToCssVars,
  manifestToLayoutIntent,
  parseIncomingManifest,
  THEME_BASE_IDS,
  type ThemeBaseId,
  type ThemeManifest,
} from './themeManifest';
import { isLayoutCapableTheme } from './themeComponentRegistry';
import { useCarTheme, baseOf, type CarTheme } from '../../store/useCarTheme';
import { useLayoutStore } from '../../store/useLayoutStore';
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';

const STORE_KEY = 'caros-theme-manifests-v2';
const STYLE_TAG_ID = 'caros-theme-manifest-css';

export type ThemeApplySource = 'command' | 'preview' | 'restore' | 'local';

/* ── Gözlemlenebilir durum (CAROS LAB okur) ───────────────────────── */

export interface ThemeRuntimeSnapshot {
  /** Son uygulanan manifest'in temasi — hiç uygulanmadıysa null. */
  lastThemeId: ThemeBaseId | null;
  lastThemeVersion: number | null;
  lastSchemaVersion: number | null;
  lastAppliedAt: string | null;
  lastSource: ThemeApplySource | null;
  appliedVarCount: number | null;
  appliedComponentCount: number | null;
  appliedScreenCount: number | null;
  /** Uygulanan yerleşim (solver kart) override adedi. */
  appliedLayoutCount: number | null;
  /** Aktif tema yerleşim motorunu (layoutSolver) kullanıyor mu. */
  layoutCapable: boolean | null;
  appliedCssBytes: number | null;
  applyCount: number;
  rejectCount: number;
  /** Son reddin sebebi (fail-closed kanıtı) — hiç red yoksa null. */
  lastRejectReason: string | null;
  lastRejectAt: string | null;
  /** Depoda manifest'i olan temalar. */
  storedThemeIds: ThemeBaseId[];
  /** Kalıcı depo okunabildi mi (false → salt-bellek çalışıyoruz). */
  storageReadable: boolean;
}

const STATE: {
  lastThemeId: ThemeBaseId | null;
  lastThemeVersion: number | null;
  lastSchemaVersion: number | null;
  lastAppliedAt: string | null;
  lastSource: ThemeApplySource | null;
  appliedVarCount: number | null;
  appliedComponentCount: number | null;
  appliedScreenCount: number | null;
  appliedLayoutCount: number | null;
  layoutCapable: boolean | null;
  appliedCssBytes: number | null;
  applyCount: number;
  rejectCount: number;
  lastRejectReason: string | null;
  lastRejectAt: string | null;
  storageReadable: boolean;
} = {
  lastThemeId: null,
  lastThemeVersion: null,
  lastSchemaVersion: null,
  lastAppliedAt: null,
  lastSource: null,
  appliedVarCount: null,
  appliedComponentCount: null,
  appliedScreenCount: null,
  appliedLayoutCount: null,
  layoutCapable: null,
  appliedCssBytes: null,
  applyCount: 0,
  rejectCount: 0,
  lastRejectReason: null,
  lastRejectAt: null,
  storageReadable: false,
};

/** Bir önceki uygulamada set edilen değişkenler — bayat var bırakmamak için. */
let appliedVarNames: string[] = [];

/* ── Kalıcı depo ──────────────────────────────────────────────────── */

let memoryStore: Record<string, ThemeManifest> | null = null;

function readStore(): Record<string, ThemeManifest> {
  if (memoryStore) return memoryStore;
  const out: Record<string, ThemeManifest> = {};
  try {
    const raw = safeGetRaw(STORE_KEY);
    STATE.storageReadable = true;
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
          if (!(THEME_BASE_IDS as readonly string[]).includes(k)) continue;
          out[k] = coerceThemeManifest(v, k as ThemeBaseId);
        }
      }
    }
  } catch {
    STATE.storageReadable = false;
  }
  memoryStore = out;
  return out;
}

function writeStore(store: Record<string, ThemeManifest>): void {
  memoryStore = store;
  try {
    safeSetRaw(STORE_KEY, JSON.stringify(store));
  } catch { /* fail-soft: bellekte kalır */ }
}

/** Bir tema için saklanmış manifest (yoksa null). */
export function getStoredManifest(themeId: ThemeBaseId): ThemeManifest | null {
  return readStore()[themeId] ?? null;
}

export function storeManifest(m: ThemeManifest): void {
  const store = { ...readStore(), [m.themeId]: m };
  writeStore(store);
}

/** Bir temanın özelleştirmesini sil (araç tarafı "fabrika ayarı"). */
export function clearStoredManifest(themeId: ThemeBaseId): void {
  const store = { ...readStore() };
  delete store[themeId];
  writeStore(store);
}

/* ── DOM uygulaması ───────────────────────────────────────────────── */

function styleTag(): HTMLStyleElement | null {
  if (typeof document === 'undefined') return null;
  let tag = document.getElementById(STYLE_TAG_ID) as HTMLStyleElement | null;
  if (!tag) {
    tag = document.createElement('style');
    tag.id = STYLE_TAG_ID;
    /* #597: En sona eklenir → aynı özgüllükteki tema CSS'inin ÜSTÜNDE kalır,
       ama `!important` savaşı AÇMAZ. Eskiden burada araç içi uzun-bas editörün
       stil motoruyla bir sıra yarışı vardı; o motor kendi style etiketine
       `!important` yazdığı için Tema Stüdyo manifestini EZİYORDU. Motor
       söküldü → artık araçta tek stil otoritesi bu etikettir. */
    document.head.appendChild(tag);
  }
  return tag;
}

/**
 * Manifest'i DOM'a uygular. Baz temayı YALNIZ `setBaseTheme` true iken değiştirir.
 * Hiçbir girdide throw etmez (fail-soft) — kısmi uygulama bile ekranı kırmaz.
 */
export function applyThemeManifest(
  m: ThemeManifest,
  source: ThemeApplySource,
  opts: { setBaseTheme?: boolean; persist?: boolean } = {},
): void {
  const setBase = opts.setBaseTheme === true;
  const persist = opts.persist === true;

  try {
    if (setBase) {
      // Baz tema GERÇEK kanaldan değişir (store → React layout yeniden seçilir).
      // Salt `data-theme` setAttribute layout'u DEĞİŞTİRMEZ (saha kusuru).
      const current = useCarTheme.getState().theme;
      const dayVariant = current.endsWith('-day');
      const next = (dayVariant ? `${m.themeId}-day` : m.themeId) as CarTheme;
      useCarTheme.getState().setTheme(next);
    }
  } catch { /* fail-soft */ }

  let varCount = 0;
  try {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      const vars = manifestToCssVars(m);
      // Önce bu manifest'in DOKUNMADIĞI ama önceden set edilmiş var'ları temizle.
      for (const name of appliedVarNames) {
        if (!(name in vars)) root.style.removeProperty(name);
      }
      for (const [k, v] of Object.entries(vars)) {
        root.style.setProperty(k, v);
        varCount++;
      }
      appliedVarNames = Object.keys(vars);
    }
  } catch { /* fail-soft */ }

  let cssBytes = 0;
  try {
    const tag = styleTag();
    if (tag) {
      const css = manifestToCss(m);
      tag.textContent = css;
      cssBytes = css.length;
    }
  } catch { /* fail-soft */ }

  /* Yerleşim — İKİNCİ MOTOR YOK: manifest yalnız solver'ın HAM niyet blob'unu
   * taşır, çözümü `layoutSolver` yapar. Yalnız solver kullanan temalarda yazılır
   * (Horizon/Tesla sabit grid → yazmak sessiz ölü veri olurdu). Tema BAŞINA
   * yazılır ki paylaşılan kart id'leri (music/vehicle/dock) diğer temayı ezmesin. */
  let layoutCount: number | null = null;
  const capable = isLayoutCapableTheme(m.themeId);
  if (capable) {
    try {
      useLayoutStore.getState().applyIntent(manifestToLayoutIntent(m), m.themeId);
      /* Bölge genişlikleri AYNI kapıdan geçer (PR-5): ikinci bir uygulama yolu
         kurulmaz ve solver kullanmayan temalara ölü veri yazılmaz. */
      useLayoutStore.getState().applyZoneWidths(m.zoneWidths, m.themeId);
      layoutCount = layoutOverrideCount(m);
    } catch { /* fail-soft */ }
  }

  if (persist) {
    try { storeManifest(m); } catch { /* fail-soft */ }
  }

  STATE.appliedLayoutCount = layoutCount;
  STATE.layoutCapable = capable;
  STATE.lastThemeId = m.themeId;
  STATE.lastThemeVersion = m.themeVersion;
  STATE.lastSchemaVersion = m.schemaVersion;
  STATE.lastAppliedAt = nowIso();
  STATE.lastSource = source;
  STATE.appliedVarCount = varCount;
  STATE.appliedComponentCount = Object.keys(m.componentOverrides).length;
  STATE.appliedScreenCount = Object.keys(m.screenOverrides).length;
  STATE.appliedCssBytes = cssBytes;
  STATE.applyCount++;
}

function nowIso(): string | null {
  try { return new Date().toISOString(); } catch { return null; }
}

/* ── Gelen paket kapısı (fail-CLOSED) ─────────────────────────────── */

export interface ApplyIncomingResult {
  ok: boolean;
  reason?: string;
  themeId?: ThemeBaseId;
  themeVersion?: number;
}

/**
 * Uzaktan gelen manifest'i doğrula ve uygula. Şema ihlalinde UYGULAMAZ ve
 * sebebi döner — çağıran komutu `failed` işaretler (sessiz "uygulandı" YOK).
 */
export function applyIncomingThemeManifest(raw: unknown, source: ThemeApplySource = 'command'): ApplyIncomingResult {
  const parsed = parseIncomingManifest(raw);
  if (!parsed.ok) {
    STATE.rejectCount++;
    STATE.lastRejectReason = parsed.reason;
    STATE.lastRejectAt = nowIso();
    return { ok: false, reason: parsed.reason };
  }
  const m = parsed.manifest;
  applyThemeManifest(m, source, { setBaseTheme: source === 'command', persist: source === 'command' });
  return { ok: true, themeId: m.themeId, themeVersion: m.themeVersion };
}

/* ── Boot geri yükleme + tema değişimi takibi ─────────────────────── */

let installed = false;

/**
 * Boot'ta çağrılır. Mevcut araç temasına ait saklanmış manifest'i uygular
 * (baz temayı ZORLAMAZ) ve tema değişimlerini izleyip eşleşen manifest'e geçer.
 */
export function initThemeRuntime(): void {
  if (installed) return;
  installed = true;

  const applyForTheme = (theme: CarTheme) => {
    const base = baseOf(theme);
    if (!(THEME_BASE_IDS as readonly string[]).includes(base)) {
      // Bu temada manifest desteği yok (ör. legacy 'oled'/'sunlight') → temizle.
      clearAppliedDom();
      return;
    }
    const m = getStoredManifest(base as ThemeBaseId);
    if (m) {
      applyThemeManifest(m, 'restore', { setBaseTheme: false, persist: false });
    } else {
      // KALINTI YOK: bu temanın manifesti yoksa hem CSS hem tema-başına yerleşim
      // temizlenir → önceki temanın renkleri/kart sırası sızmaz.
      clearAppliedDom();
      try { useLayoutStore.getState().reset(base); } catch { /* fail-soft */ }
    }
  };

  try {
    applyForTheme(useCarTheme.getState().theme);
  } catch { /* fail-soft */ }

  try {
    useCarTheme.subscribe((s, prev) => {
      if (s.theme === prev?.theme) return;
      applyForTheme(s.theme);
    });
  } catch { /* fail-soft */ }
}

/** Uygulanmış tüm tema özelleştirmesini DOM'dan kaldırır (fabrika görünümü). */
export function clearAppliedDom(): void {
  try {
    if (typeof document !== 'undefined') {
      const root = document.documentElement;
      for (const name of ALL_MANAGED_CSS_VARS) root.style.removeProperty(name);
      appliedVarNames = [];
      const tag = document.getElementById(STYLE_TAG_ID);
      if (tag) tag.textContent = '';
    }
  } catch { /* fail-soft */ }
  STATE.appliedVarCount = 0;
  STATE.appliedComponentCount = 0;
  STATE.appliedScreenCount = 0;
  STATE.appliedCssBytes = 0;
}

/* ── Gözlem ───────────────────────────────────────────────────────── */

export function getThemeRuntimeSnapshot(): ThemeRuntimeSnapshot {
  const stored = readStore();
  return {
    lastThemeId: STATE.lastThemeId,
    lastThemeVersion: STATE.lastThemeVersion,
    lastSchemaVersion: STATE.lastSchemaVersion,
    lastAppliedAt: STATE.lastAppliedAt,
    lastSource: STATE.lastSource,
    appliedVarCount: STATE.appliedVarCount,
    appliedComponentCount: STATE.appliedComponentCount,
    appliedScreenCount: STATE.appliedScreenCount,
    appliedLayoutCount: STATE.appliedLayoutCount,
    layoutCapable: STATE.layoutCapable,
    appliedCssBytes: STATE.appliedCssBytes,
    applyCount: STATE.applyCount,
    rejectCount: STATE.rejectCount,
    lastRejectReason: STATE.lastRejectReason,
    lastRejectAt: STATE.lastRejectAt,
    storedThemeIds: Object.keys(stored) as ThemeBaseId[],
    storageReadable: STATE.storageReadable,
  };
}

/** Yalnız testler için — modül durumunu sıfırlar. */
export function __resetThemeRuntimeForTest(): void {
  installed = false;
  memoryStore = null;
  appliedVarNames = [];
  STATE.lastThemeId = null;
  STATE.lastThemeVersion = null;
  STATE.lastSchemaVersion = null;
  STATE.lastAppliedAt = null;
  STATE.lastSource = null;
  STATE.appliedVarCount = null;
  STATE.appliedComponentCount = null;
  STATE.appliedScreenCount = null;
  STATE.appliedLayoutCount = null;
  STATE.layoutCapable = null;
  STATE.appliedCssBytes = null;
  STATE.applyCount = 0;
  STATE.rejectCount = 0;
  STATE.lastRejectReason = null;
  STATE.lastRejectAt = null;
  STATE.storageReadable = false;
}

/** Boş manifest üretici — araç tarafı "sıfırla" akışı için. */
export function emptyManifestFor(themeId: ThemeBaseId): ThemeManifest {
  return createThemeManifest(themeId);
}
