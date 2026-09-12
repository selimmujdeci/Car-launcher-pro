/**
 * nativeCapabilityNegotiation.ts — ARCH-04/F6 · KRİTİK NATIVE METOT PAZARLIĞI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── ÇÖZDÜĞÜ RİSK: ESKİ APK ───────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Web varlığı (`dist/`) ve native APK **AYRI** sürümlenir: kullanıcı yeni web
 * katmanını eski bir APK üstünde çalıştırabilir. O durumda `CarLauncher.X`
 * metodu YOKTUR. İki yanlış davranış vardır ve ikisi de yasaktır:
 *   · çağırıp ÇÖKMEK,
 *   · metot yokken "başarılı" varsaymak (SAHTE BAŞARI).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ─────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **SÜRÜM ÇERÇEVESİ DEĞİLDİR.** Sürüm numarası okumaz, uyumluluk matrisi
 *     kurmaz, feature-flag dağıtmaz. Yalnız "metot VAR MI" ölçer.
 * (2) **YÖNLENDİRİCİ DEĞİLDİR.** Hiçbir çağrıyı proxy'lemez; global bridge
 *     router KURMAZ. Sahipler kendi köprülerini çağırmaya devam eder.
 * (3) **HÜKÜM VERMEZ.** `methodAvailable: true` işlemin BAŞARILI olacağını
 *     söylemez — `operationProven` alanı bunu ayrı ve açıkça taşır.
 */

import { CarLauncher } from '../nativePlugin';
import { PhoneHubLink } from '../phoneHub/phoneHubLink';
import type { NativeAvailability } from './nativeBoundaryContract';

/* ══════════════════════════════════════════════════════════════════════════
 * 0) ÖLÇÜLMÜŞ GERÇEK — `typeof` BU KÖPRÜDE KANIT DEĞİLDİR
 * ══════════════════════════════════════════════════════════════════════════
 * Capacitor `registerPlugin()` bir **Proxy** döner ve ERİŞİLEN HER ÖZELLİK
 * için bir fonksiyon UYDURUR. Ölçüm (ARCH-04/F6 kanıtı):
 *
 *   typeof CarLauncher.__method_that_does_not_exist__  →  "function"
 *   '__method_that_does_not_exist__' in CarLauncher     →  false
 *   Object.keys(CarLauncher)                            →  []
 *
 * Yani `typeof fn === 'function'` / `if (!fn)` deseni eksik bir native metodu
 * ASLA yakalayamaz: köprü metodu uydurur ve çağrı sırasında "not implemented"
 * ile REDDEDER. Bu kalıp repoda yaygındır ve FAIL-CLOSED'dır (reddi yakalanır),
 * ama bir YETENEK ÖLÇÜMÜ DEĞİLDİR.
 *
 * Bu modül bu yüzden iki şeyi ayırır:
 *   (1) **Varlık iddiası** — köprü uyduruyorsa `null`/`UNKNOWN`. Sahte
 *       `AVAILABLE` ÜRETİLMEZ.
 *   (2) **Gözlenmiş sonuç** — ürün yolunda gerçekten çağrılmış bir metodun
 *       sonucu. "not implemented" reddi = kanıtlanmış `NOT_SUPPORTED`;
 *       karşılanan çağrı = kanıtlanmış `AVAILABLE`.
 */

/** Kesinlikle var olmayan ad — köprü buna da fonksiyon derse UYDURUYOR demektir. */
const CANARY_METHOD = '__caros_arch04_canary_absent_method__';

/** Köprü, olmayan özellikler için fonksiyon uyduruyor mu (ÖLÇÜLÜR). */
export function bridgeFabricatesMethods(target: Record<string, unknown> | null): boolean {
  if (target === null) return false;
  try { return typeof target[CANARY_METHOD] === 'function'; } catch { return false; }
}

/** Ürün yolunda GÖZLENMİŞ çağrı sonucu — iddia değil, ölçüm. */
export type NativeMethodObservedOutcome = 'SUCCESS' | 'NOT_IMPLEMENTED' | 'ERROR';

const _observed = new Map<string, NativeMethodObservedOutcome>();

/**
 * Bir kritik metodun GERÇEK çağrı sonucunu kaydeder.
 *
 * Yalnız ZATEN var olan `catch`/`then` dallarından çağrılır: bu fonksiyon
 * hiçbir native çağrı BAŞLATMAZ ve hiçbir hatayı yutmaz/üretmez.
 */
export function recordNativeMethodOutcome(
  id: string, outcome: NativeMethodObservedOutcome,
): void {
  if (!CRITICAL_NATIVE_METHODS.some((m) => m.id === id)) return;
  /* `ERROR` bir yetenek hükmü DEĞİLDİR: metot var olabilir ama iş düşmüştür.
     Kanıtlanmış NOT_IMPLEMENTED/SUCCESS hükmünü EZMEZ. */
  if (outcome === 'ERROR' && _observed.has(id)) return;
  _observed.set(id, outcome);
}

/** Bir hata "native metot yok" reddi mi — Capacitor'ın kendi metni. */
export function isNotImplementedRejection(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  const lower = msg.toLowerCase();
  return lower.includes('not implemented') || lower.includes('unimplemented');
}

/** @internal — testler arası izolasyon. */
export function _resetNativeMethodOutcomesForTest(): void { _observed.clear(); }

/* ══════════════════════════════════════════════════════════════════════════
 * 1) Kritik metot künyesi
 * ════════════════════════════════════════════════════════════════════════ */

export type NativeMethodStatus = 'AVAILABLE' | 'NOT_SUPPORTED' | 'UNKNOWN';

export interface CriticalNativeMethod {
  readonly id: string;
  readonly domain: string;
  readonly bridge: 'CarLauncher' | 'PhoneHubLink' | 'Capacitor.Filesystem';
  readonly method: string;
  /** Sonuç sözlüğü TS tarafında tanımlı mı (çeviri var mı). */
  readonly resultSemanticsKnown: boolean;
  /** Metot yoksa devreye giren ölçülmüş yedek yol; yoksa `null`. */
  readonly fallback: string | null;
}

/**
 * Görev §6'nın saydığı kritik köprüler. Liste GENİŞLETİLEBİLİR ama
 * KISALTILAMAZ: bir satırın silinmesi o köprünün pazarlıksız çağrıldığı
 * anlamına gelir.
 */
export const CRITICAL_NATIVE_METHODS: readonly CriticalNativeMethod[] = Object.freeze([
  { id: 'foreground.start', domain: 'RUNTIME', bridge: 'CarLauncher', method: 'startBackgroundService', resultSemanticsKnown: false, fallback: null },
  { id: 'foreground.stop', domain: 'RUNTIME', bridge: 'CarLauncher', method: 'stopBackgroundService', resultSemanticsKnown: false, fallback: null },
  { id: 'gps.generation_binding', domain: 'GPS', bridge: 'CarLauncher', method: 'setBackgroundGpsGeneration', resultSemanticsKnown: false, fallback: 'web_geolocation_limited' },
  { id: 'media.authority_connect', domain: 'MEDIA', bridge: 'CarLauncher', method: 'mediaAuthorityConnect', resultSemanticsKnown: false, fallback: null },
  { id: 'media.authority_snapshot', domain: 'MEDIA', bridge: 'CarLauncher', method: 'mediaAuthoritySnapshot', resultSemanticsKnown: true, fallback: null },
  { id: 'media.authority_command', domain: 'MEDIA', bridge: 'CarLauncher', method: 'mediaAuthorityCommand', resultSemanticsKnown: true, fallback: null },
  { id: 'phone.session_snapshot', domain: 'PHONE_LINK', bridge: 'PhoneHubLink', method: 'getSnapshot', resultSemanticsKnown: true, fallback: null },
  { id: 'phone.session_control', domain: 'PHONE_LINK', bridge: 'PhoneHubLink', method: 'startServer', resultSemanticsKnown: true, fallback: null },
  { id: 'obd.generic_pdu', domain: 'OBD', bridge: 'CarLauncher', method: 'sendDiagnosticPdu', resultSemanticsKnown: true, fallback: 'servise-özel legacy metotlar' },
  { id: 'can.start', domain: 'CAN', bridge: 'CarLauncher', method: 'startCanBus', resultSemanticsKnown: false, fallback: null },
  { id: 'can.stop', domain: 'CAN', bridge: 'CarLauncher', method: 'stopCanBus', resultSemanticsKnown: false, fallback: null },
  { id: 'storage.persist_odometer', domain: 'STORAGE', bridge: 'CarLauncher', method: 'persistOdometer', resultSemanticsKnown: false, fallback: 'safeStorage localStorage backup' },
  { id: 'hardware_media.probe', domain: 'MEDIA', bridge: 'CarLauncher', method: 'getPhoneHubHardwareProbe', resultSemanticsKnown: true, fallback: null },
]);

/* ══════════════════════════════════════════════════════════════════════════
 * 2) Ölçüm
 * ════════════════════════════════════════════════════════════════════════ */

export interface NativeMethodNegotiation {
  readonly id: string;
  readonly domain: string;
  readonly bridge: string;
  readonly method: string;
  /** Metodun sözleşmede TANIMLI olduğunu biliyor muyuz (statik künye). */
  readonly methodKnown: boolean;
  /** Bu çalışma zamanında GERÇEKTEN var mı; ölçülemediyse `null`. */
  readonly methodAvailable: boolean | null;
  readonly nativeCapabilityKnown: NativeAvailability;
  readonly resultSemanticsKnown: boolean;
  readonly fallbackAvailable: boolean;
  /**
   * Metodun VARLIĞI işlem başarısı DEĞİLDİR. Bu alan bir işlemin gerçekten
   * başarıyla tamamlandığının kanıtlanıp kanıtlanmadığını taşır ve bu modül
   * onu ASLA `true` yapmaz (işlem çalıştırmaz).
   */
  readonly operationProven: false;
  readonly status: NativeMethodStatus;
  readonly reason: string;
}

function _bridgeObject(bridge: CriticalNativeMethod['bridge']): Record<string, unknown> | null {
  try {
    if (bridge === 'CarLauncher') return CarLauncher as unknown as Record<string, unknown>;
    if (bridge === 'PhoneHubLink') return PhoneHubLink as unknown as Record<string, unknown>;
    return null;
  } catch { return null; }
}

/** Tek metodun pazarlığı — çağırmaz, yalnız varlığını ölçer. */
export function negotiateNativeMethod(spec: CriticalNativeMethod): NativeMethodNegotiation {
  const target = _bridgeObject(spec.bridge);
  let methodAvailable: boolean | null = null;
  const knownSpec = CRITICAL_NATIVE_METHODS.some((m) => m.id === spec.id && m.method === spec.method);
  if (!knownSpec) {
    /* A caller asking for a method outside the declared capability surface is
       fail-closed even when Capacitor's Proxy fabricates a callable function. */
    methodAvailable = false;
  } else if (target !== null && !bridgeFabricatesMethods(target)) {
    try { methodAvailable = typeof target[spec.method] === 'function'; } catch { methodAvailable = null; }
  }
  const status: NativeMethodStatus = methodAvailable === true
    ? 'AVAILABLE'
    : methodAvailable === false ? 'NOT_SUPPORTED' : 'UNKNOWN';
  const capability: NativeAvailability = methodAvailable === true
    ? 'AVAILABLE'
    : methodAvailable === false ? 'UNAVAILABLE' : 'UNKNOWN';
  return Object.freeze({
    id: spec.id,
    domain: spec.domain,
    bridge: spec.bridge,
    method: spec.method,
    methodKnown: knownSpec,
    methodAvailable,
    nativeCapabilityKnown: capability,
    resultSemanticsKnown: spec.resultSemanticsKnown,
    fallbackAvailable: spec.fallback !== null,
    operationProven: false,
    status,
    reason: methodAvailable === true
      ? 'metot VAR — işlem başarısı BU DEĞİLDİR (operationProven=false)'
      : methodAvailable === false
        ? `metot YOK (eski APK) — ${spec.fallback === null ? 'yedek YOK, fail-closed' : `yedek: ${spec.fallback}`}`
        : 'köprü nesnesi okunamadı — UNKNOWN (sahte NOT_SUPPORTED üretilmedi)',
  });
}

/** Tüm kritik metotların pazarlığı. Senkron · yan etkisiz · çağrı yapmaz. */
export function negotiateNativeCapabilities(): readonly NativeMethodNegotiation[] {
  return Object.freeze(CRITICAL_NATIVE_METHODS.map(negotiateNativeMethod));
}

export interface NativeNegotiationSummary {
  readonly total: number;
  readonly available: number;
  readonly notSupported: number;
  readonly unknown: number;
  /** Yedeksiz ve YOK olan kritik metotlar — gerçek eski-APK riski. */
  readonly unsupportedWithoutFallback: readonly string[];
  readonly rows: readonly NativeMethodNegotiation[];
}

export function summarizeNativeNegotiation(
  rows: readonly NativeMethodNegotiation[] = negotiateNativeCapabilities(),
): NativeNegotiationSummary {
  const unsupportedWithoutFallback = rows
    .filter((r) => r.status === 'NOT_SUPPORTED' && !r.fallbackAvailable)
    .map((r) => r.id);
  return Object.freeze({
    total: rows.length,
    available: rows.filter((r) => r.status === 'AVAILABLE').length,
    notSupported: rows.filter((r) => r.status === 'NOT_SUPPORTED').length,
    unknown: rows.filter((r) => r.status === 'UNKNOWN').length,
    unsupportedWithoutFallback: Object.freeze(unsupportedWithoutFallback),
    rows,
  });
}

/**
 * Belirli bir kritik metot için yetenek okuması — sahiplerin `if (!fn)`
 * kontrolünü DEĞİŞTİRMEZ, yalnız aynı ölçümü kanıt yüzeyine taşır.
 */
export function nativeMethodAvailability(id: string): NativeAvailability {
  const spec = CRITICAL_NATIVE_METHODS.find((m) => m.id === id);
  if (spec === undefined) return 'UNKNOWN';
  return negotiateNativeMethod(spec).nativeCapabilityKnown;
}
