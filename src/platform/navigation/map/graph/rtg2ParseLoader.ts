/**
 * rtg2ParseLoader — RTG AĞIR KATMANININ tembel yükleme sınırı (#1218).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * `rtg2Parse` ve `regionalGraphMerge` BigInt SÖZDİZİMİ taşır; BigInt polyfill EDİLEMEZ. Chrome 52-79
 * WebView'lı head unit, bu sözdizimini içeren bir chunk'ı çalıştırmadan önce
 * PARSE aşamasında reddeder → boot ölümü. Statik import, kodu `plugin-legacy`
 * startup chunk'ına sokar; ölçülen kusur (#1218) tam olarak buydu.
 *
 * Bu dosyanın KENDİSİ BigInt'siz kalır ve `import()` sınırını tek bir yerde
 * tutar: ayrıştırıcı GERÇEKTEN bir graf okunacağı anda, ayrı bir chunk olarak
 * indirilir. Eski cihaz o yola hiç girmezse chunk ne fetch ne parse edilir.
 *
 * ── YENİ OTORİTE DEĞİLDİR ────────────────────────────────────────────────
 * Ayrıştırma otoritesi `rtg2Parse.parseRoutingGraph`ta KALIR. Burada karar,
 * doğrulama veya önbellek semantiği YOKTUR — yalnız modül bağlama ve tek
 * seferlik memoizasyon vardır.
 */

/* Sonuç tipi BigInt TAŞIMAZ ve okuyucunun sözleşmesine aittir. Tipi buradan
   almak, bu dosyadan `rtg2Parse`a giden TEK kenarın `import()` olmasını
   YAPISAL olarak garanti eder (type-only import derlemede silinse de). */
import type { RoutingGraphParseResult } from './rtg2Reader';

export type RoutingGraphParser =
  (buffer: ArrayBuffer | null | undefined) => RoutingGraphParseResult;

/** Tek uçuş: eşzamanlı çağrılar aynı `import()` sözüne katılır. */
let _pending: Promise<RoutingGraphParser> | null = null;

/**
 * Ayrıştırıcıyı yükler (ilk çağrıda indirir, sonrakilerde aynı modülü verir).
 *
 * Yükleme başarısız olursa HATA YUTULMAZ: çağıran fail-closed davranmalıdır —
 * "ayrıştırıcı yok" sessizce "graf geçerli" anlamına GELEMEZ.
 */
export function loadRoutingGraphParser(): Promise<RoutingGraphParser> {
  _pending ??= import('./rtg2Parse')
    .then((m) => m.parseRoutingGraph)
    .catch((e) => { _pending = null; throw e; });
  return _pending;
}

/** @internal — testler arası izolasyon. */
export function _resetRoutingGraphParserForTest(): void { _pending = null; _mergePending = null; }

/* ── Bölgesel birleştirici ─────────────────────────────────────────────────
   Aynı gerekçe, aynı desen: `regionalGraphMerge` de BigInt sözdizimi taşır.
   `import()` sınırı BU DOSYADA toplanır — grafın nerede koptuğu tek yerden
   okunabilsin diye. Burada da karar/otorite YOKTUR. */

export type RegionalGraphMergeModule = typeof import('./regionalGraphMerge');

let _mergePending: Promise<RegionalGraphMergeModule> | null = null;

/** Bölgesel graf birleştiricisini yükler; hata YUTULMAZ (fail-closed çağıran). */
export function loadRegionalGraphMerge(): Promise<RegionalGraphMergeModule> {
  _mergePending ??= import('./regionalGraphMerge')
    .catch((e) => { _mergePending = null; throw e; });
  return _mergePending;
}
