/**
 * vehicleClassRuntime.ts — araç yasal sınıfının TEK çalışma zamanı otoritesi.
 *
 * Sorumluluk:
 *   1. Aktif araç kimliğini (VID store) izler ve KİMLİK DEĞİŞİNCE anahtar üretir.
 *   2. O anahtara ait kalıcı kanıtları (kullanıcı beyanı + araştırma önbelleği) okur.
 *   3. Gerekiyorsa backend proxy üzerinden BİR KEZ araştırma tetikler (bounded).
 *   4. `resolveVehicleClass` ile tek profile indirger ve abonelere yayınlar.
 *
 * ── PAZARLIKSIZ ─────────────────────────────────────────────────────────────
 *  · Navigasyon tick'inde ağ çağrısı YOK — yalnız kimlik imzası değişince.
 *  · Araç değişince ESKİ ARACIN kanıtı TAŞINMAZ (anahtar bazlı depo).
 *  · Tam VIN ne depoya ne loga ne LAB'a yazılır — yalnız 9 haneli araştırma
 *    öneki (seri numarası yok) ve maskeli gösterim.
 *  · FAIL-SOFT: her yol kendi try/catch'inde; sınıf çözümlemesi navigasyonu
 *    ASLA bozamaz.
 *  · Zero-leak: `start()` bir temizleyici döndürür; abonelik ve zamanlayıcı
 *    `stop()` ile kapanır.
 */

import { useEffect, useState } from 'react';
import { useVidStore, type VidStore } from '../../store/useVidStore';
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';
import { maskVinStrict } from '../privacy/vinMask';
import {
  resolveVehicleClass, claimFromUserChoice, vinResearchPrefix, maskVin,
  EMPTY_VEHICLE_CLASS_PROFILE,
  type VehicleClassClaim, type VehicleClassProfile, type VehicleClassUserChoice,
} from './legalVehicleClass';
import {
  researchVehicleClass, type ResearchOutcome, type VehicleClassResearchResult,
} from './vehicleClassResearch';

/* ══════════════════════════════════════════════════════════════════════════
 * Araç anahtarı — kanıtın KAPSAMI
 * ════════════════════════════════════════════════════════════════════════ */

export interface VehicleIdentityInput {
  readonly vin: string | null;
  readonly make: string | null;
  readonly model: string | null;
  readonly modelYear: number | null;
}

/**
 * Kanıt deposunun anahtarı.
 *
 * VIN varsa ilk 9 hane (WMI+VDS) kullanılır — aynı tip/varyantın tüm araçları
 * aynı SINIFTA olduğu için bu doğru kapsamdır ve seri numarası taşımaz.
 * VIN yoksa marka|model|yıl. Hiçbiri yoksa `null` → kanıt SAKLANMAZ ve
 * araştırma YAPILMAZ (kimliksiz araca sınıf atanamaz).
 */
export function vehicleClassKey(id: VehicleIdentityInput): string | null {
  const prefix = vinResearchPrefix(id.vin);
  if (prefix) return `vin9:${prefix}`;
  const make = (id.make ?? '').trim().toUpperCase();
  const model = (id.model ?? '').trim().toUpperCase();
  if (!make || !model) return null;
  const year = typeof id.modelYear === 'number' && Number.isFinite(id.modelYear)
    ? String(id.modelYear) : '?';
  return `mmy:${make}|${model}|${year}`;
}

/**
 * Depo anahtarının LAB'da gösterilebilir MASKELİ hâli.
 *
 * `vin9:VF1BM0A0H` → `vin9:VF1******` · `mmy:FIAT|DOBLO|2016` değişmez
 * (marka/model/yıl zaten LAB'da ayrıca gösteriliyor, gizli veri değil).
 *
 * VIN dalı tek otoriteye (`platform/privacy/vinMask`) bağlıdır: eski biçim son
 * iki haneyi de açıyordu; hane sayısı maskeye göre değişmesin diye VIN türevi
 * her değer aynı kuraldan geçer.
 */
export function maskVehicleClassKey(key: string | null): string | null {
  if (!key) return null;
  if (key.startsWith('vin9:')) {
    return `vin9:${maskVinStrict(key.slice(5)) ?? '…'}`;
  }
  return key;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kalıcı depo (bounded, anahtar bazlı)
 * ════════════════════════════════════════════════════════════════════════ */

const STORE_KEY = 'cl_vehicle_class_v1';
/** En fazla kaç aracın kanıtı saklanır (LRU). */
const MAX_RECORDS = 8;

export interface VehicleClassRecord {
  /** Kullanıcının ruhsat beyanı. */
  userClaim: VehicleClassClaim | null;
  /** Backend araştırmasının önbelleklenmiş kanıtları. */
  researchClaims: VehicleClassClaim[];
  /** Son araştırma denemesi (Unix ms). */
  researchAttemptedAt: number | null;
  researchOutcome: ResearchOutcome;
  researchFailureReason: string | null;
  /** Kullanıcı sorulmayı reddetti (Unix ms) — bir daha rahatsız edilmez. */
  promptDismissedAt: number | null;
  /** LRU için son görülme. */
  lastSeenAt: number;
}

type RecordMap = Record<string, VehicleClassRecord>;

function _emptyRecord(nowMs: number): VehicleClassRecord {
  return {
    userClaim: null, researchClaims: [], researchAttemptedAt: null,
    researchOutcome: 'IDLE', researchFailureReason: null,
    promptDismissedAt: null, lastSeenAt: nowMs,
  };
}

function _loadAll(): RecordMap {
  try {
    const raw = safeGetRaw(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
    return parsed as RecordMap;
  } catch { return {}; }
}

function _saveAll(map: RecordMap): void {
  try {
    const entries = Object.entries(map)
      .sort((a, b) => (b[1]?.lastSeenAt ?? 0) - (a[1]?.lastSeenAt ?? 0))
      .slice(0, MAX_RECORDS);
    safeSetRaw(STORE_KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch { /* fail-soft — kota/bozulma navigasyonu bozmaz */ }
}

/** Test/ayarlar için: bir aracın kaydını okur (kopya). */
export function getVehicleClassRecord(key: string): VehicleClassRecord | null {
  const all = _loadAll();
  const r = all[key];
  return r ? { ...r, researchClaims: [...(r.researchClaims ?? [])] } : null;
}

function _mutate(key: string, fn: (r: VehicleClassRecord) => void, nowMs: number): VehicleClassRecord {
  const all = _loadAll();
  const rec = all[key] ? { ...all[key] } : _emptyRecord(nowMs);
  rec.researchClaims = [...(rec.researchClaims ?? [])];
  fn(rec);
  rec.lastSeenAt = nowMs;
  all[key] = rec;
  _saveAll(all);
  return rec;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yayınlanan anlık görüntü
 * ════════════════════════════════════════════════════════════════════════ */

export interface VehicleClassSnapshot {
  readonly key: string | null;
  readonly profile: VehicleClassProfile;
  readonly researchOutcome: ResearchOutcome;
  readonly researchAttemptedAt: number | null;
  readonly researchFailureReason: string | null;
  readonly promptDismissedAt: number | null;
  /** Maskeli VIN — tam VIN ASLA. */
  readonly vinMasked: string | null;
  readonly hasVin: boolean;
}

const EMPTY_SNAPSHOT: VehicleClassSnapshot = {
  key: null, profile: EMPTY_VEHICLE_CLASS_PROFILE, researchOutcome: 'IDLE',
  researchAttemptedAt: null, researchFailureReason: null, promptDismissedAt: null,
  vinMasked: null, hasVin: false,
};

let _snapshot: VehicleClassSnapshot = EMPTY_SNAPSHOT;
const _listeners = new Set<(s: VehicleClassSnapshot) => void>();

function _publish(next: VehicleClassSnapshot): void {
  _snapshot = next;
  for (const fn of [..._listeners]) { try { fn(next); } catch { /* fail-soft */ } }
}

/** Senkron okuma — CAROS LAB ve saf hesaplar için. */
export function getVehicleClassSnapshot(): VehicleClassSnapshot { return _snapshot; }

/** React aboneliği — sorgu döngüsü AÇMAZ. */
export function useVehicleClassSnapshot(): VehicleClassSnapshot {
  const [s, setS] = useState<VehicleClassSnapshot>(_snapshot);
  useEffect(() => {
    setS(_snapshot);
    const fn = (n: VehicleClassSnapshot) => setS(n);
    _listeners.add(fn);
    return () => { _listeners.delete(fn); };
  }, []);
  return s;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Çözümleme
 * ════════════════════════════════════════════════════════════════════════ */

let _identity: VehicleIdentityInput = { vin: null, make: null, model: null, modelYear: null };

function _recompute(nowMs: number): void {
  const key = vehicleClassKey(_identity);
  if (!key) {
    _publish({
      ...EMPTY_SNAPSHOT,
      vinMasked: maskVin(_identity.vin),
      hasVin: !!vinResearchPrefix(_identity.vin),
    });
    return;
  }
  const rec = getVehicleClassRecord(key) ?? _emptyRecord(nowMs);
  const claims: VehicleClassClaim[] = [
    ...(rec.userClaim ? [rec.userClaim] : []),
    ...(rec.researchClaims ?? []),
  ];
  const profile = resolveVehicleClass({
    claims,
    nowMs,
    make: _identity.make,
    model: _identity.model,
    modelYear: _identity.modelYear,
    vin: _identity.vin,
  });
  _publish({
    key,
    profile,
    researchOutcome: rec.researchOutcome ?? 'IDLE',
    researchAttemptedAt: rec.researchAttemptedAt ?? null,
    researchFailureReason: rec.researchFailureReason ?? null,
    promptDismissedAt: rec.promptDismissedAt ?? null,
    vinMasked: maskVin(_identity.vin),
    hasVin: !!vinResearchPrefix(_identity.vin),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kullanıcı beyanı
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kullanıcının ruhsat sınıfı seçimini kaydeder. `DONT_KNOW` seçilirse sınıf
 * UNKNOWN kalır ama bir daha sorulmaması için soru KAPATILIR.
 */
export function setUserVehicleClass(choice: VehicleClassUserChoice, nowMs = Date.now()): void {
  try {
    const key = vehicleClassKey(_identity);
    if (!key) return;
    const claim = claimFromUserChoice(choice, nowMs);
    _mutate(key, (r) => {
      r.userClaim = claim;
      if (!claim) r.promptDismissedAt = nowMs;   // "bilmiyorum" → bir daha sorma
    }, nowMs);
    _recompute(nowMs);
  } catch { /* fail-soft */ }
}

/** Kullanıcı beyanını siler (ayarlardan "sıfırla"). */
export function clearUserVehicleClass(nowMs = Date.now()): void {
  try {
    const key = vehicleClassKey(_identity);
    if (!key) return;
    _mutate(key, (r) => { r.userClaim = null; r.promptDismissedAt = null; }, nowMs);
    _recompute(nowMs);
  } catch { /* fail-soft */ }
}

/** Soru bir daha gösterilmesin (kullanıcı kapattı). */
export function dismissVehicleClassPrompt(nowMs = Date.now()): void {
  try {
    const key = vehicleClassKey(_identity);
    if (!key) return;
    _mutate(key, (r) => { r.promptDismissedAt = nowMs; }, nowMs);
    _recompute(nowMs);
  } catch { /* fail-soft */ }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Soru kapısı (SAF) — sürüşte ASLA
 * ════════════════════════════════════════════════════════════════════════ */

/** Bu hızın altında araç "duruyor" sayılır (soru yalnız burada sorulabilir). */
export const PROMPT_MAX_SPEED_KMH = 3;

export interface PromptGateInput {
  readonly snapshot: VehicleClassSnapshot;
  /** Aracın anlık hızı (km/sa). `null` = bilinmiyor → SORULMAZ (fail-closed). */
  readonly speedKmh: number | null;
}

/**
 * Kullanıcıya ruhsat sınıfı sorulmalı mı.
 *
 * FAIL-CLOSED: hız bilinmiyorsa, araç hareket hâlindeyse, kimlik yoksa,
 * kullanıcı daha önce cevapladıysa/kapattıysa veya sınıf zaten DOĞRULANDIYSA
 * soru GÖSTERİLMEZ. Sürüş sırasında modal/onay AÇILMAZ (görev §0).
 */
export function shouldPromptVehicleClass(input: PromptGateInput): boolean {
  const { snapshot, speedKmh } = input;
  if (!snapshot.key) return false;
  if (snapshot.promptDismissedAt !== null) return false;
  if (speedKmh === null || !Number.isFinite(speedKmh)) return false;
  if (speedKmh > PROMPT_MAX_SPEED_KMH) return false;
  const st = snapshot.profile.resolutionState;
  // Kullanıcı zaten beyan ettiyse (VERIFIED + USER_CONFIRMED) sorma.
  if (st === 'VERIFIED' && snapshot.profile.source === 'USER_CONFIRMED') return false;
  // Resmî VIN sorgusu kesin sonuç verdiyse sorma.
  if (st === 'VERIFIED' && snapshot.profile.source === 'OFFICIAL_VIN_LOOKUP') return false;
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Araştırma zamanlaması (bounded)
 * ════════════════════════════════════════════════════════════════════════ */

/** Aynı araç için art arda en fazla kaç deneme (oturum başına). */
const MAX_ATTEMPTS_PER_KEY = 2;
/** Denemeler arası gecikme. */
const RETRY_DELAY_MS = 30_000;
/** Başarısız denemeden sonra aynı anahtar için yeniden deneme penceresi. */
const REATTEMPT_AFTER_MS = 24 * 60 * 60 * 1000;

const _attempts = new Map<string, number>();
let _timer: ReturnType<typeof setTimeout> | null = null;
let _inFlight = false;

/** Backend proxy tabanı — anahtar GÖMÜLMEZ; yoksa araştırma yapılmaz. */
function _backendBase(): string | null {
  try {
    const v = (import.meta.env?.VITE_VEHICLE_API_BASE as string | undefined) ?? '';
    return v.trim() || null;
  } catch { return null; }
}

/** Bu anahtar için araştırmaya gerek var mı (kanıt zaten kesinse hayır). */
function _needsResearch(key: string, nowMs: number): boolean {
  const rec = getVehicleClassRecord(key);
  if (!rec) return true;
  if (rec.userClaim) return false;                       // kullanıcı beyanı yeterli
  const fresh = (rec.researchClaims ?? []).some(
    (c) => c.expiresAt === null || c.expiresAt > nowMs);
  if (fresh) return false;                                // taze önbellek var
  if (rec.researchAttemptedAt !== null
    && nowMs - rec.researchAttemptedAt < REATTEMPT_AFTER_MS
    && rec.researchOutcome !== 'BLOCKED_NETWORK') return false;
  return true;
}

function _applyResearch(key: string, result: VehicleClassResearchResult, nowMs: number): void {
  _mutate(key, (r) => {
    r.researchAttemptedAt = result.attemptedAt;
    r.researchOutcome = result.outcome;
    r.researchFailureReason = result.failureReason;
    if (result.claims.length > 0) r.researchClaims = [...result.claims];
  }, nowMs);
  _recompute(nowMs);
}

function _scheduleResearch(key: string): void {
  if (_timer !== null || _inFlight) return;
  const attempts = _attempts.get(key) ?? 0;
  if (attempts >= MAX_ATTEMPTS_PER_KEY) return;
  const delay = attempts === 0 ? 1_500 : RETRY_DELAY_MS;

  _timer = setTimeout(() => {
    _timer = null;
    const now = Date.now();
    if (vehicleClassKey(_identity) !== key) return;   // araç değişti → iptal
    if (!_needsResearch(key, now)) return;
    _attempts.set(key, (_attempts.get(key) ?? 0) + 1);
    _inFlight = true;

    void researchVehicleClass(
      {
        vinPrefix: vinResearchPrefix(_identity.vin),
        make: _identity.make,
        model: _identity.model,
        modelYear: _identity.modelYear,
        countryCode: 'TR',
      },
      {
        fetchFn: (...a: Parameters<typeof fetch>) => fetch(...a),
        nowMs: now,
        online: typeof navigator !== 'undefined' ? navigator.onLine : null,
        backendBase: _backendBase(),
      },
    ).then((result) => {
      _inFlight = false;
      if (vehicleClassKey(_identity) !== key) return;  // araç değişti → sonucu YAZMA
      _applyResearch(key, result, Date.now());
      // Geçici hata ise sınırlı bir kez daha dene; kalıcı engelse DENEME.
      if (result.outcome === 'FAILED') _scheduleResearch(key);
    }).catch(() => { _inFlight = false; });
  }, delay);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

let _unsub: (() => void) | null = null;
let _lastIdentitySig = '';

function _identitySig(v: VidStore['vehicle']): string {
  return [v.vin ?? '', v.make ?? '', v.model ?? '', v.modelYear ?? ''].join('|');
}

function _onVidChange(): void {
  try {
    const v = useVidStore.getState().vehicle;
    const sig = _identitySig(v);
    if (sig === _lastIdentitySig) return;     // hot-path/telemetri tik'i → iş yok
    _lastIdentitySig = sig;
    _identity = {
      vin: v.vin, make: v.make, model: v.model, modelYear: v.modelYear,
    };
    const now = Date.now();
    _recompute(now);
    const key = vehicleClassKey(_identity);
    if (key && _needsResearch(key, now)) _scheduleResearch(key);
  } catch { /* fail-soft */ }
}

/** Başlatır (idempotent); temizleyici döndürür. */
export function startVehicleClassRuntime(): () => void {
  if (_unsub) return () => stopVehicleClassRuntime();
  _unsub = useVidStore.subscribe(() => _onVidChange());
  _onVidChange();
  return () => stopVehicleClassRuntime();
}

export function stopVehicleClassRuntime(): void {
  _unsub?.();
  _unsub = null;
  if (_timer !== null) { clearTimeout(_timer); _timer = null; }
  _lastIdentitySig = '';
}

/** @internal — testler arası izolasyon. */
export function _resetVehicleClassRuntimeForTest(): void {
  stopVehicleClassRuntime();
  _attempts.clear();
  _inFlight = false;
  _identity = { vin: null, make: null, model: null, modelYear: null };
  _publish(EMPTY_SNAPSHOT);
}

/** @internal — testler için kimliği doğrudan kurar (VID store'suz). */
export function _setIdentityForTest(id: VehicleIdentityInput, nowMs = Date.now()): void {
  _identity = id;
  _lastIdentitySig = _identitySig({
    vin: id.vin, make: id.make, model: id.model, modelYear: id.modelYear,
    vehicleType: 'ice',
  });
  _recompute(nowMs);
}
