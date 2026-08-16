/**
 * themeRuntimeModel — Tema Çalışma Zamanı gözlem MODELİ (SAF).
 *
 * I/O yok · timer yok · Date.now yok · global durum yok · React importu yok.
 * Girdi yalnız `ThemeRuntimeRawSnapshot`; çıktı kart/alan listesi + hüküm.
 *
 * DÜRÜSTLÜK: bilinmeyen alan UNAVAILABLE ve değeri '—'. Sahte 0, sahte tarih,
 * sahte "sağlıklı" ÜRETİLMEZ. "Manifest uygulanmadı" ile "manifest boş" AYRI
 * hükümlerdir — ikisi karıştırılırsa kusur görünmez olur.
 */

import type { ThemeRuntimeRawSnapshot } from './themeRuntimeSources';
import type { InspectorField, Observability } from './sessionInspectorModel';

export interface ThemeRuntimeCard {
  readonly id: string;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

export type ThemeRuntimeVerdict =
  | 'RUNTIME_UNAVAILABLE'
  | 'NEVER_APPLIED'
  | 'REJECTED_LAST'
  | 'APPLIED_EMPTY'
  | 'APPLIED_ACTIVE';

export const THEME_RUNTIME_VERDICT_LABEL: Readonly<Record<ThemeRuntimeVerdict, string>> = {
  RUNTIME_UNAVAILABLE: 'ÇALIŞMA ZAMANI OKUNAMADI',
  NEVER_APPLIED: 'HİÇ MANİFEST UYGULANMADI',
  REJECTED_LAST: 'SON PAKET REDDEDİLDİ (fail-closed)',
  APPLIED_EMPTY: 'MANİFEST UYGULANDI — İÇİ BOŞ (görünüm değişmez)',
  APPLIED_ACTIVE: 'MANİFEST UYGULANDI VE ETKİN',
} as const;

export interface ThemeRuntimeVerdictResult {
  readonly status: ThemeRuntimeVerdict;
  readonly reasons: readonly string[];
}

/* ── Alan üreticileri ─────────────────────────────────────────────── */

function field(
  id: string,
  label: string,
  value: string | null,
  klass: Observability,
  source: string,
  updatedAt: number | null,
  note: string,
): InspectorField {
  return {
    id,
    label,
    value: value === null || value === '' ? '—' : value,
    klass: value === null || value === '' ? 'UNAVAILABLE' : klass,
    source,
    updatedAt,
    note,
  };
}

function numStr(v: number | null | undefined): string | null {
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : null;
}

function isoToMs(iso: string | null): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : null;
}

export function buildThemeRuntimeCards(s: ThemeRuntimeRawSnapshot): ThemeRuntimeCard[] {
  const rt = s.runtime;
  const appliedMs = isoToMs(rt?.lastAppliedAt ?? null);
  const rejectMs = isoToMs(rt?.lastRejectAt ?? null);

  const applyCard: ThemeRuntimeCard = {
    id: 'apply',
    title: 'SON UYGULAMA',
    fields: [
      field('theme-id', 'Tema', rt?.lastThemeId ?? null, 'OBSERVED',
        'themeRuntime.getThemeRuntimeSnapshot', appliedMs,
        'Manifest hiç uygulanmadıysa KAYNAK YOK — sahte "expedition" yazılmaz.'),
      field('theme-version', 'Tema Sürümü', numStr(rt?.lastThemeVersion), 'OBSERVED',
        'themeRuntime', appliedMs, 'PWA her gönderimde bir artırır.'),
      field('schema-version', 'Şema Sürümü', numStr(rt?.lastSchemaVersion), 'OBSERVED',
        'themeRuntime', appliedMs, '1 = eski themeVars torbası (taşındı), 2 = manifest.'),
      field('source', 'Kaynak', rt?.lastSource ?? null, 'OBSERVED',
        'themeRuntime', appliedMs, 'command = araca gönderildi · preview = iframe önizlemesi · restore = boot.'),
      field('applied-at', 'Uygulama Zamanı', rt?.lastAppliedAt ?? null, 'OBSERVED',
        'themeRuntime', appliedMs, 'Duvar saati; hiç uygulanmadıysa damga YOKTUR.'),
      field('apply-count', 'Uygulama Sayısı', numStr(rt?.applyCount), 'OBSERVED',
        'themeRuntime', null, 'Oturum içi sayaç (kalıcı değil).'),
    ],
  };

  const contentCard: ThemeRuntimeCard = {
    id: 'content',
    title: 'UYGULANAN İÇERİK',
    fields: [
      field('var-count', 'CSS Değişkeni', numStr(rt?.appliedVarCount), 'OBSERVED',
        'themeRuntime.applyThemeManifest', appliedMs,
        '0 = kullanıcı hiçbir global token değiştirmemiş (tema kendi paletinde kalır).'),
      field('component-count', 'Bileşen Override', numStr(rt?.appliedComponentCount), 'OBSERVED',
        'themeRuntime', appliedMs, 'Manifest içindeki componentOverrides adedi.'),
      field('screen-count', 'Ekran Override', numStr(rt?.appliedScreenCount), 'OBSERVED',
        'themeRuntime', appliedMs, 'Manifest içindeki screenOverrides adedi.'),
      field('layout-count', 'Yerleşim Override', numStr(rt?.appliedLayoutCount), 'OBSERVED',
        'themeRuntime → useLayoutStore', appliedMs,
        'Solver kart id\'si başına niyet. İKİNCİ MOTOR YOK: çözümü layoutSolver yapar.'),
      field('layout-capable', 'Tema Solver Kullanıyor',
        rt === null || rt.layoutCapable === null ? null : (rt.layoutCapable ? 'EVET' : 'HAYIR'),
        'OBSERVED', 'themeComponentRegistry.isLayoutCapableTheme', appliedMs,
        'HAYIR → o tema sabit grid ile çizilir (Horizon/Tesla); yerleşim override\'ı YAZILMAZ.'),
      field('layout-themes', 'Yerleşimi Saklı Tema', numStr(s.layoutThemeCount), 'OBSERVED',
        'useLayoutStore.byTheme', null,
        'Tema-başına niyet; paylaşılan kart id\'lerinin (music/vehicle/dock) diğer temayı ezmesini engeller.'),
      field('css-bytes', 'Üretilen CSS (karakter)', numStr(rt?.appliedCssBytes), 'OBSERVED',
        'themeRuntime', appliedMs, 'İçerik GÖSTERİLMEZ — yalnız boyut.'),
      field('style-tag', 'CSS Etiketi DOM\'da', s.styleTagPresent === null ? null : (s.styleTagPresent ? 'VAR' : 'YOK'),
        'OBSERVED', 'document.getElementById', null,
        'Etiket yoksa bileşen stilleri hiç uygulanmamış demektir.'),
      field('style-tag-bytes', 'CSS Etiketi Boyutu', numStr(s.styleTagBytes), 'OBSERVED',
        'DOM', null, 'Çalışma zamanı sayacıyla tutarsızsa dış bir müdahale var demektir.'),
    ],
  };

  const rejectCard: ThemeRuntimeCard = {
    id: 'reject',
    title: 'REDDEDİLEN PAKETLER (fail-closed kanıtı)',
    fields: [
      field('reject-count', 'Red Sayısı', numStr(rt?.rejectCount), 'OBSERVED',
        'themeRuntime.applyIncomingThemeManifest', null,
        'Şema ihlali olan paket UYGULANMAZ ve komut `failed` olur.'),
      field('reject-reason', 'Son Red Sebebi', rt?.lastRejectReason ?? null, 'OBSERVED',
        'parseIncomingManifest', rejectMs, 'Hiç red yoksa KAYNAK YOK — "sorun yok" diye yazılmaz.'),
      field('reject-at', 'Son Red Zamanı', rt?.lastRejectAt ?? null, 'OBSERVED',
        'themeRuntime', rejectMs, 'Duvar saati.'),
    ],
  };

  const coverage = s.registryComponentCount > 0 && s.domRegisteredCount !== null
    ? `${s.domRegisteredCount}/${s.registryComponentCount}`
    : null;

  const registryCard: ThemeRuntimeCard = {
    id: 'registry',
    title: 'KİMLİK KAPSAMI',
    fields: [
      field('registry-count', 'Kayıtlı Bileşen', numStr(s.registryComponentCount), 'OBSERVED',
        'themeComponentRegistry.THEME_COMPONENTS', null,
        'Defterde YALNIZ kodda gerçekten işaretlenmiş bileşenler bulunur.'),
      field('registry-surfaces', 'Kayıtlı Ekran', numStr(s.registrySurfaceCount), 'OBSERVED',
        'themeComponentRegistry.THEME_SURFACES', null, 'Yüzey (surface) sayısı.'),
      field('dom-editable', 'DOM\'da data-editable', numStr(s.domEditableCount), 'OBSERVED',
        'document.querySelectorAll', null,
        'ŞU ANKİ ekranda çizili düğüm sayısı — başka ekrandakiler burada görünmez.'),
      field('dom-coverage', 'Bu Ekranda Eşleşen', coverage, 'DERIVED',
        'DOM ∩ registry', null,
        'Tüm defterin aynı anda ekranda olması BEKLENMEZ; tema ve açık çekmeceye göre değişir.'),
      field('dom-surfaces', 'DOM\'da data-theme-surface', numStr(s.domSurfaceCount), 'OBSERVED',
        'document.querySelectorAll', null, 'Ekran düzeyi override\'ın tutunacağı kök sayısı.'),
      field('bridge-installed', 'Önizleme Köprüsü', s.bridgeInstalled ? 'KURULU' : 'KURULU DEĞİL',
        'OBSERVED', 'themePreviewBridge.getPreviewBridgeStats', null,
        'Köprü yalnız postMessage dinler; dokunuş YAKALAMAZ, DOM\'a yazmaz.'),
      field('bridge-iframe', 'Stüdyo Önizlemesi (iframe)', s.bridgeInIframe ? 'EVET' : 'HAYIR',
        'OBSERVED', 'window.parent !== window', null,
        'HAYIR = gerçek araç ekranı; ölçüm gönderilmez, hiçbir dokunuş etkilenmez.'),
      field('probe-count', 'Geometri Ölçümü', numStr(s.probeCount), 'OBSERVED',
        'themePreviewBridge.probeEditableGeometry', null,
        'Stüdyo overlay\'i bu ÖLÇÜMDEN çizilir — tahmin edilen kutu yoktur.'),
      field('probe-found', 'Son Ölçümde Bulunan', numStr(s.lastProbeFound), 'OBSERVED',
        'getBoundingClientRect', null,
        'Sıfır boyutlu/görünmez düğüm raporlanmaz; hiç ölçüm yoksa KAYNAK YOK.'),
    ],
  };

  const storeCard: ThemeRuntimeCard = {
    id: 'store',
    title: 'KALICI DEPO',
    fields: [
      field('storage-readable', 'Depo Okunabildi', rt === null ? null : (rt.storageReadable ? 'EVET' : 'HAYIR'),
        'OBSERVED', 'safeStorage.safeGetRaw', null,
        'HAYIR → salt-bellek çalışılıyor; yeniden başlatmada özelleştirme geri gelmez.'),
      field('stored-themes', 'Manifest Saklanan Tema',
        rt === null ? null : (rt.storedThemeIds.length > 0 ? rt.storedThemeIds.join(', ') : 'YOK'),
        'OBSERVED', 'themeRuntime.getStoredManifest', null,
        'Tema başına ayrı manifest saklanır — temalar birbirini ezmez.'),
    ],
  };

  return [applyCard, contentCard, rejectCard, registryCard, storeCard];
}

/* ── Hüküm ────────────────────────────────────────────────────────── */

export function deriveThemeRuntimeVerdict(s: ThemeRuntimeRawSnapshot): ThemeRuntimeVerdictResult {
  const rt = s.runtime;
  if (rt === null) {
    return {
      status: 'RUNTIME_UNAVAILABLE',
      reasons: ['themeRuntime anlık görüntüsü okunamadı — modül yüklenmemiş veya hata attı.'],
    };
  }
  if (rt.rejectCount > 0 && rt.applyCount === 0) {
    return {
      status: 'REJECTED_LAST',
      reasons: [
        `Gelen ${rt.rejectCount} paket şema kapısında REDDEDİLDİ; hiçbiri uygulanmadı.`,
        rt.lastRejectReason ? `Son sebep: ${rt.lastRejectReason}` : 'Sebep kaydı yok.',
      ],
    };
  }
  if (rt.applyCount === 0 || rt.lastThemeId === null) {
    return {
      status: 'NEVER_APPLIED',
      reasons: [
        'Bu oturumda hiç tema manifesti uygulanmadı.',
        rt.storedThemeIds.length > 0
          ? `Depoda ${rt.storedThemeIds.length} tema manifesti var — boot geri yüklemesi çalışmamış olabilir.`
          : 'Depoda saklı manifest de yok — araca hiç tema gönderilmemiş.',
      ],
    };
  }
  const empty = (rt.appliedVarCount ?? 0) === 0
    && (rt.appliedComponentCount ?? 0) === 0
    && (rt.appliedScreenCount ?? 0) === 0
    && (rt.appliedLayoutCount ?? 0) === 0;
  if (empty) {
    return {
      status: 'APPLIED_EMPTY',
      reasons: [
        'Manifest uygulandı ama içinde hiç override yok → araç görünümü DEĞİŞMEZ.',
        'Bu bir hata değildir: kullanıcı hiçbir alana dokunmamışsa beklenen davranış budur.',
      ],
    };
  }
  return {
    status: 'APPLIED_ACTIVE',
    reasons: [
      `Tema ${rt.lastThemeId} · sürüm ${rt.lastThemeVersion ?? '—'} etkin.`,
      `${rt.appliedVarCount ?? 0} CSS değişkeni · ${rt.appliedComponentCount ?? 0} bileşen · ${rt.appliedScreenCount ?? 0} ekran · ${rt.appliedLayoutCount ?? 0} yerleşim override.`,
      rt.rejectCount > 0 ? `Ayrıca ${rt.rejectCount} paket reddedilmiş (fail-closed çalışıyor).` : 'Reddedilen paket yok.',
    ],
  };
}

/** Kartlardaki alanların gözlemlenebilirlik sınıf dağılımı (başlık sayacı). */
export function countByThemeClass(cards: readonly ThemeRuntimeCard[]): Record<Observability, number> {
  const acc: Record<Observability, number> = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  for (const c of cards) for (const f of c.fields) acc[f.klass]++;
  return acc;
}
