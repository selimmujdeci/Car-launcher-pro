/**
 * contextCollector — araç bağlamını SALT-OKUNUR toplayan saf çekirdek.
 *
 * ── KESİN SINIRLAR ──────────────────────────────────────────────────────────
 *  - YALNIZ verilen anlık görüntüleri (snapshot) okur. Ağ çağrısı YOK, OBD/ECU
 *    komutu YOK, polling YOK, abonelik YOK, store yazma YOK.
 *  - Tek kaynağın hatası TÜM bağlamı iptal ETMEZ; o alan atlanır.
 *  - ASLA throw etmez.
 *  - Eksik veri `0`/`false`/tahminle DOLDURULMAZ — alan hiç eklenmez.
 *  - Fizik dışı, NaN/Infinity, sentinel (`-1`) ve GELECEK zaman damgalı değerler
 *    REDDEDİLİR.
 *
 * Zaman DI ile gelir (`nowMs`); `Date.now` gömülü değildir.
 */

import type {
  ContextFreshness,
  ContextSource,
  ContextSourceHealth,
  ContextValue,
  MaviVehicleContext,
} from './contextTypes';
import type { ContextLiveField, MaviTaskFieldPolicy } from './contextPolicyTypes';
import {
  CLOCK_SKEW_TOLERANCE_MS,
  DTC_FRESH_WINDOW_MS,
  PHYSICAL_LIMITS,
  STALE_WINDOW_MULTIPLIER,
  TASK_CONTEXT_POLICY,
} from './contextPolicy';
import type { MaviTaskType } from '../orchestrator/orchestratorTypes';

/* ── Kaynak portları (hepsi DI — collector somut modül import ETMEZ) ──────── */

/** OBD anlık görüntüsü — `obdService.getOBDDataSnapshot()` şekline uyar. */
export interface ObdContextSnapshot {
  readonly connected?:      boolean;
  readonly source?:         string;
  readonly vehicleType?:    string;
  /** Unix ms — son GEÇERLİ ECU frame'i. Canlı değerlerin güncellik otoritesi. */
  readonly lastSeenMs?:     number;
  readonly rpm?:            number;
  readonly speed?:          number;
  readonly engineTemp?:     number;
  readonly fuelLevel?:      number;
  readonly batteryVoltage?: number;
}

export interface ObdSessionSnapshot {
  readonly protocolClass?:        string;
  readonly sourceHealth?:         ContextSourceHealth;
  readonly lastDisconnectReason?: string;
}

export interface DtcContextSnapshot {
  readonly codes?:      readonly string[];
  readonly lastReadAt?: number | null;
  readonly isStale?:    boolean;
}

export interface ContextSources {
  /** Her okuma FAIL-SOFT: throw ederse o bölüm atlanır. */
  readonly readObd?:     () => ObdContextSnapshot | undefined;
  readonly readSession?: () => ObdSessionSnapshot | undefined;
  readonly readDtc?:     () => DtcContextSnapshot | undefined;
  /** Uygulamanın KENDİ tazelik penceresi (ms) — sabit uydurulmaz. */
  readonly freshWindowMs?: () => number;
}

export interface CollectContextInput {
  readonly taskType: MaviTaskType;
  readonly nowMs:    number;
  readonly sources:  ContextSources;
  /** Politika ezmesi (test/uzaktan yapılandırma). */
  readonly policy?:  MaviTaskFieldPolicy;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────────── */

/** OBDData sözleşmesi: `-1` = desteklenmiyor/yok. Gerçek veri gibi TAŞINMAZ. */
const SENTINEL_UNAVAILABLE = -1;
const DEFAULT_FRESH_WINDOW_MS = 5_000;

function safeRead<T>(read: (() => T | undefined) | undefined): T | undefined {
  if (typeof read !== 'function') return undefined;
  try {
    const value = read();
    return (typeof value === 'object' && value !== null) ? value : undefined;
  } catch {
    return undefined;                     // tek kaynak hatası bağlamı iptal ETMEZ
  }
}

/** Sayı kullanılabilir mi: finite · sentinel değil · fiziksel sınırlar içinde. */
function isUsableNumber(v: unknown, limits: { min: number; max: number }): v is number {
  return typeof v === 'number'
    && Number.isFinite(v)
    && v !== SENTINEL_UNAVAILABLE
    && v >= limits.min
    && v <= limits.max;
}

/**
 * Güncellik sınıfı. Zaman damgası yok/0 → `unknown`. GELECEK damga (saat
 * sapması payını aşan) → `unknown` (uydurma tazelik YOK). Stale penceresinin
 * ötesi `null` → alan HİÇ taşınmaz.
 */
function freshnessOf(observedAt: number | undefined, nowMs: number, freshWindowMs: number): ContextFreshness | null {
  if (typeof observedAt !== 'number' || !Number.isFinite(observedAt) || observedAt <= 0) return 'unknown';
  const age = nowMs - observedAt;
  if (age < -CLOCK_SKEW_TOLERANCE_MS) return 'unknown';      // gelecek damga → güvenilmez
  if (age <= freshWindowMs) return 'fresh';
  if (age <= freshWindowMs * STALE_WINDOW_MULTIPLIER) return 'stale';
  return null;                                               // çok eski → taşınmaz
}

function makeValue<T>(
  value: T,
  observedAt: number,
  freshness: ContextFreshness,
  source: ContextSource,
): ContextValue<T> {
  return { value, observedAt, freshness, source };
}

/** DTC kodu biçim doğrulaması — serbest metin/açıklama KABUL EDİLMEZ. */
const DTC_CODE_RE = /^[PBCU][0-3][0-9A-F]{3}$/;

/** Protokol/kopma nedeni gibi alanlar için güvenli jeton biçimi (allowlist). */
const SAFE_TOKEN_RE = /^[A-Za-z0-9_.-]{1,32}$/;

function safeToken(v: unknown): string | undefined {
  return typeof v === 'string' && SAFE_TOKEN_RE.test(v) ? v : undefined;
}

const HEALTH_VALUES: readonly ContextSourceHealth[] = ['healthy', 'degraded', 'unavailable'];

/* ── Toplama ───────────────────────────────────────────────────────────────── */

/**
 * Göreve uygun, güncellik-bilgili, sınırlı araç bağlamı üretir.
 * Hiç kullanılabilir alan yoksa `undefined` döner (boş blok enjekte edilmez).
 */
export function collectMaviContext(input: CollectContextInput): MaviVehicleContext | undefined {
  const policy = input.policy ?? TASK_CONTEXT_POLICY[input.taskType];
  if (!policy) return undefined;

  const nowMs = Number.isFinite(input.nowMs) ? input.nowMs : 0;
  const sources = input.sources ?? {};

  /* Kod analizi gibi görevlerde HİÇBİR araç verisi taşınmaz. */
  if (!policy.includeConnection && policy.liveFields.length === 0
      && !policy.includeDiagnostics && !policy.includeIdentity && !policy.includeSession) {
    return undefined;
  }

  const obd = safeRead(sources.readObd);
  if (!obd) return undefined;                    // araç otoritesi okunamadı → bağlam yok

  let freshWindowMs = DEFAULT_FRESH_WINDOW_MS;
  try {
    const w = sources.freshWindowMs?.();
    if (typeof w === 'number' && Number.isFinite(w) && w > 0) freshWindowMs = w;
  } catch { /* varsayılan pencere */ }

  const connected = obd.connected === true;
  const vehicle: Record<string, unknown> = { connected };

  /* Veri kökeni: `mock` ise serializer bunu AÇIKÇA yazar (gerçek sanılmasın). */
  if (obd.source === 'real' || obd.source === 'mock') vehicle['dataOrigin'] = obd.source;

  /* ── Kimlik (yalnız kapalı enum) ── */
  if (policy.includeIdentity) {
    const vehicleType = safeToken(obd.vehicleType);
    if (vehicleType) vehicle['identity'] = { vehicleType };
  }

  /* ── Oturum ── */
  if (policy.includeSession) {
    const session = safeRead(sources.readSession);
    if (session) {
      const out: Record<string, unknown> = {};
      const protocolClass = safeToken(session.protocolClass);
      if (protocolClass) out['protocolClass'] = protocolClass;
      if (typeof session.sourceHealth === 'string' && HEALTH_VALUES.includes(session.sourceHealth)) {
        out['sourceHealth'] = session.sourceHealth;
      }
      const reason = safeToken(session.lastDisconnectReason);
      if (reason) out['lastDisconnectReason'] = reason;
      if (Object.keys(out).length > 0) vehicle['session'] = out;
    }
  }

  /* ── Canlı değerler (yalnız politikanın izin verdiği alanlar) ── */
  const liveAllow = new Set<ContextLiveField>(policy.liveFields);
  const live: Record<string, ContextValue<number>> = {};
  const observedAt = obd.lastSeenMs;
  const liveFreshness = freshnessOf(observedAt, nowMs, freshWindowMs);

  if (connected && liveFreshness !== null) {
    const stamp = typeof observedAt === 'number' && observedAt > 0 ? observedAt : 0;
    const add = (field: ContextLiveField, raw: unknown, limits: { min: number; max: number }): void => {
      if (!liveAllow.has(field)) return;
      if (!isUsableNumber(raw, limits)) return;
      live[field] = makeValue(raw, stamp, liveFreshness, 'obd');
    };
    add('rpm',            obd.rpm,            PHYSICAL_LIMITS.rpm);
    add('speedKph',       obd.speed,          PHYSICAL_LIMITS.speedKph);
    add('coolantC',       obd.engineTemp,     PHYSICAL_LIMITS.coolantC);
    add('fuelPercent',    obd.fuelLevel,      PHYSICAL_LIMITS.fuelPercent);
    add('batteryVoltage', obd.batteryVoltage, PHYSICAL_LIMITS.batteryVoltage);
  }
  if (Object.keys(live).length > 0) vehicle['live'] = live;

  /* ── Tanı (bounded, biçim doğrulamalı) ── */
  if (policy.includeDiagnostics) {
    const dtc = safeRead(sources.readDtc);
    if (dtc) {
      const diagnostics: Record<string, unknown> = {};
      const readAt = typeof dtc.lastReadAt === 'number' ? dtc.lastReadAt : undefined;
      const dtcFreshness = freshnessOf(readAt, nowMs, DTC_FRESH_WINDOW_MS);

      if (dtcFreshness !== null && Array.isArray(dtc.codes)) {
        const codes = dtc.codes
          .filter((c): c is string => typeof c === 'string')
          .map((c) => c.trim().toUpperCase())
          .filter((c) => DTC_CODE_RE.test(c));     // biçimi geçersiz kod ATILIR

        const count = codes.length;
        if (isUsableNumber(count, PHYSICAL_LIMITS.dtcCount)) {
          // Son okuma başarısızsa (isStale) taze sayılmaz.
          const effective: ContextFreshness = dtc.isStale === true ? 'stale' : dtcFreshness;
          diagnostics['dtcCount'] = makeValue(count, readAt ?? 0, effective, 'dtc');
        }
        if (codes.length > 0) diagnostics['boundedCodes'] = codes;
      }
      if (Object.keys(diagnostics).length > 0) vehicle['diagnostics'] = diagnostics;
    }
  }

  return {
    schemaVersion: 1,
    generatedAt:   nowMs,
    vehicle:       vehicle as MaviVehicleContext['vehicle'],
  };
}
