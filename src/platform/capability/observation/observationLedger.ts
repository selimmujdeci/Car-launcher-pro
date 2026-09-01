/**
 * observationLedger.ts — **MAVİ F7 · BEKLEYEN GÖZLEM DEFTERİ + BOUNDED TANI.**
 *
 * ── NE YAPAR ────────────────────────────────────────────────────────────────
 * İki iş yapar, ikisi de SALT KAYIT:
 *  1. Kanıtı gecikmeli gelen alanlar (navigasyon) için **bounded bekleyen
 *     kayıt** tutar ve süresi dolanı `UNKNOWN` kapatır.
 *  2. Uzlaştırma sonuçlarının **bounded** dağılımını sayar (CAROS LAB).
 *
 * ── SERT SINIRLAR ───────────────────────────────────────────────────────────
 *  · **TIMER YOK · ABONELİK YOK · `Date.now` YOK.** Zaman dışarıdan girer;
 *    süre dolumu TEMBEL süpürmeyle (`sweep`) yakalanır → sıfır sızıntı.
 *  · **KUYRUK BOUNDED** (`MAX_PENDING`): taşarsa en eski kayıt `EVICTED`
 *    olarak DÜŞÜRÜLÜR — bellek büyümez, kayıt kaybı da gizlenmez.
 *  · **SÖYLENMİŞ CÜMLEYİ DEĞİŞTİRMEZ.** Bekleyen gözlem yalnız KAYDI
 *    dürüstleştirir; geç gelen kanıt yeni turun cevabına KARIŞMAZ.
 *  · **F6 YUVASINA DOKUNMAZ.** `recordCapabilityObservation` tek-atışlık plan
 *    yuvasını besler; bu defter oraya YAZMAZ (yazsaydı bir plan adımı başka
 *    bir turun gecikmiş kanıtını okurdu).
 *  · **PII YOK:** yalnız katalog kimliği, bounded enum, ADET ve zaman farkı.
 */

import type { FabricDomain } from '../fabric/capabilityContract';
import { readNavigationEvidence, type ObservationBaseline } from './observationAdapters';
import {
  settleWithoutEvidence,
  type ObservationSource, type PendingObservation, type PendingSettlement,
  type ReconciledObservation,
} from './observationContract';

/* ══════════════════════════════════════════════════════════════════════════
 * Sınırlar
 * ════════════════════════════════════════════════════════════════════════ */

/** Aynı anda beklenebilecek azami gözlem — bounded kuyruk. */
export const MAX_PENDING_OBSERVATIONS = 8;

/**
 * Kanıt bekleme penceresi (ms). Rota isteği geocode + rota hesabı içerir;
 * bu süre içinde hedef defterine kayıt DÜŞMEDİYSE kanıt YOK sayılır ve
 * kayıt `UNKNOWN` kapanır — **süre dolumu ASLA başarı üretmez.**
 */
export const OBSERVATION_WINDOW_MS = 20_000;

const MAX_COUNTER = 1_000_000;
const bump = (v: number): number => (v >= MAX_COUNTER ? MAX_COUNTER : v + 1);

/* ══════════════════════════════════════════════════════════════════════════
 * Durum
 * ════════════════════════════════════════════════════════════════════════ */

interface PendingEntry {
  readonly pending: PendingObservation;
  readonly baseline: ObservationBaseline;
}

const _pending: PendingEntry[] = [];

let _opened = 0;
let _downgrades = 0;
let _upgrades = 0;
const _sources: Record<string, number> = {};
const _settlements: Record<string, number> = {};
const _deferredLevels: Record<string, number> = {};

/* ══════════════════════════════════════════════════════════════════════════
 * Uzlaştırma kaydı (anlık yol)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir uzlaştırma sonucunu sayar.
 *
 * `downgraded` en değerli ölçüdür: **bağımsız kanıt bir başarı iddiasını kaç
 * kez düşürdü** — yani F7 olmasaydı kaç kez yalan söylenecekti.
 */
export function recordReconciliation(r: ReconciledObservation): void {
  try {
    _sources[r.source] = bump(_sources[r.source] ?? 0);
    if (r.downgraded) _downgrades = bump(_downgrades);
    if (r.upgraded) _upgrades = bump(_upgrades);
  } catch { /* fail-soft */ }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Bekleyen gözlem
 * ════════════════════════════════════════════════════════════════════════ */

function _settle(entry: PendingEntry, how: PendingSettlement, level: string): void {
  _settlements[how] = bump(_settlements[how] ?? 0);
  _deferredLevels[level] = bump(_deferredLevels[level] ?? 0);
  void entry;
}

/**
 * Bekleyen kayıtları süpürür: kanıt geldiyse bağlar, süresi dolduysa
 * `UNKNOWN` kapatır. **Zamanı çağıran verir** (bu modül saat okumaz).
 *
 * Süpürme İDEMPOTENTtir ve yan etkisi yalnız bounded sayaçlardır.
 */
export function sweepPendingObservations(nowMs: number): void {
  try {
    for (let i = _pending.length - 1; i >= 0; i -= 1) {
      const entry = _pending[i];
      if (!entry) { _pending.splice(i, 1); continue; }
      const p = entry.pending;

      const ev = p.domain === 'navigation'
        ? readNavigationEvidence(entry.baseline, p.requestedAtMs)
        : null;

      if (ev && ev.level !== null && ev.freshness === 'FRESH') {
        _pending.splice(i, 1);
        _settle(entry, 'EVIDENCE', ev.level);
        _sources[ev.source] = bump(_sources[ev.source] ?? 0);
        continue;
      }
      if (Number.isFinite(nowMs) && nowMs >= p.deadlineMs) {
        _pending.splice(i, 1);
        _settle(entry, 'EXPIRED', settleWithoutEvidence(p).level);
      }
    }
  } catch { /* fail-soft: süpürme yürütmeyi ETKİLEMEZ */ }
}

/**
 * Bekleyen gözlem açar. Kuyruk doluysa **en eski** kayıt `EVICTED` olarak
 * düşürülür (bellek büyümez; düşen kayıt sayaçta görünür).
 *
 * Her açılışta önce süpürme yapılır → bekleyen kayıtların ömrü, timer olmadan
 * da SINIRLI kalır.
 */
export function openPendingObservation(
  pending: PendingObservation, baseline: ObservationBaseline,
): void {
  try {
    sweepPendingObservations(pending.requestedAtMs);
    while (_pending.length >= MAX_PENDING_OBSERVATIONS) {
      const dropped = _pending.shift();
      if (dropped) _settle(dropped, 'EVICTED', settleWithoutEvidence(dropped.pending).level);
    }
    _pending.push({ pending, baseline });
    _opened = bump(_opened);
  } catch { /* fail-soft */ }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tanı — CAROS LAB · **PII YOK**
 * ════════════════════════════════════════════════════════════════════════ */

export interface ObservationDiagnostics {
  /** Şu an kanıt bekleyen kayıt adedi. */
  readonly pendingCount: number;
  readonly pendingCapacity: number;
  readonly windowMs: number;
  /** Toplam açılan bekleyen gözlem adedi. */
  readonly opened: number;
  /** Bağımsız kanıt bir BAŞARI iddiasını kaç kez DÜŞÜRDÜ. */
  readonly downgrades: number;
  /** Bağımsız kanıt seviyeyi kaç kez YÜKSELTTİ. */
  readonly upgrades: number;
  /** Nihai seviyeyi belirleyen kaynak dağılımı — bounded enum. */
  readonly sources: Readonly<Record<string, number>>;
  /** Bekleyen kayıtların kapanış sınıfı dağılımı. */
  readonly settlements: Readonly<Record<string, number>>;
  /** Bekleyen kayıtların kapanış SEVİYESİ dağılımı. */
  readonly deferredLevels: Readonly<Record<string, number>>;
  /** Halen bekleyen kayıtların alanları — bounded, sıralı, PII YOK. */
  readonly pendingDomains: readonly string[];
}

/**
 * Anlık tanı. **Okuma da süpürür**: LAB ekranı açıldığında süresi dolmuş
 * kayıtlar `UNKNOWN` kapanır ve ekranda sonsuza dek "bekliyor" görünmez.
 */
export function readObservationDiagnostics(nowMs: number): ObservationDiagnostics {
  sweepPendingObservations(nowMs);
  const domains: string[] = [];
  for (const e of _pending) domains.push(e.pending.domain as string);
  return Object.freeze({
    pendingCount: _pending.length,
    pendingCapacity: MAX_PENDING_OBSERVATIONS,
    windowMs: OBSERVATION_WINDOW_MS,
    opened: _opened,
    downgrades: _downgrades,
    upgrades: _upgrades,
    sources: Object.freeze({ ..._sources }),
    settlements: Object.freeze({ ..._settlements }),
    deferredLevels: Object.freeze({ ..._deferredLevels }),
    pendingDomains: Object.freeze(domains.sort()),
  });
}

/** Alan adının bounded olduğunu doğrular (uydurma alan defterine giremez). */
export function isObservableDomain(d: string): d is FabricDomain {
  return d === 'navigation' || d === 'media' || d === 'settings' || d === 'vehicle'
    || d === 'diagnostics' || d === 'phone' || d === 'surface';
}

/** Kaynak adının bounded olduğunu doğrular. */
export function isObservationSource(s: string): s is ObservationSource {
  return s === 'EXECUTOR_RESULT' || s === 'NAV_DESTINATION' || s === 'PLAYBACK_TRUTH'
    || s === 'SETTINGS_STORE' || s === 'NONE';
}

/** @internal — testler arası izolasyon. */
export function _resetObservationLedgerForTest(): void {
  _pending.length = 0;
  _opened = 0; _downgrades = 0; _upgrades = 0;
  for (const k of Object.keys(_sources)) delete _sources[k];
  for (const k of Object.keys(_settlements)) delete _settlements[k];
  for (const k of Object.keys(_deferredLevels)) delete _deferredLevels[k];
}
