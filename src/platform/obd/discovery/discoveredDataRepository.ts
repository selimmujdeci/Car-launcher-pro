/**
 * discoveredDataRepository — P0 Deep PID/DID Explorer Faz-1 · KALICI KAYIT (§F).
 *
 * AMAÇ: keşfedilen HER PID/DID'i araç FINGERPRINT'i başına kalıcı izler (doğrulama durumu,
 * güven, başarı/başarısızlık sayaçları, önerilen poll sınıfı). MEVCUT `autoDidDiscovery.ts`
 * cache'iyle (anahtar uzayı: FNV-1a VIN hash) AYNI hash algoritmasını kullanır (o dosya
 * DEĞİŞTİRİLMEDİ — bu modül kendi FNV-1a kopyasını taşır, aynı VIN → aynı hash → aynı
 * anahtar uzayı, ama AYRI bir safeStorage anahtarı altında yazar: `obd:discovery:v1:<hash>`.
 * Böylece autoDidDiscovery'nin `obd:autoDid:<hash>` kaydıyla ÇAKIŞMAZ/bozulmaz — backward
 * compatible, paralel/kopuk bir DB DEĞİL, aynı kimlik uzayını paylaşan AYRI bir şema.
 *
 * SAF ÇEKİRDEK + I/O sınırı: şema/birleştirme mantığı saf fonksiyonlarla test edilir;
 * yalnız `safeStorage` (mevcut atomik/kota-güvenli sarmalayıcı) kullanılır — CLAUDE.md.
 */

import { safeGetRaw, safeSetRaw } from '../../../utils/safeStorage';
import type { ProtocolClass } from '../protocolProfile';
import type { DiscoveryStatus } from './discoveryState';
import type { PollClass } from './pollingAdmissionGate';

export type DiscoverySourceKind =
  | 'standard_pid_bitmap'
  | 'profile_candidate'
  | 'auto_did_cache'
  | 'repository_recall';

export interface DiscoveredDataRecord {
  vehicleFingerprint: string;
  vinHash: string | null;
  protocolClass: ProtocolClass;
  ecuAddress: string;
  kind: 'pid' | 'did';
  identifier: string;
  service: '01' | '22' | '21';
  rawRequestSample: string;
  rawResponseSample: string;
  decoderId: string | null;
  decoderVersion: number;
  validationStatus: DiscoveryStatus;
  confidence: number; // 0..1
  firstSeenAt: number;
  lastSeenAt: number;
  successfulReadCount: number;
  failureCount: number;
  averageLatencyMs: number;
  recommendedPollClass: PollClass;
  discoverySource: DiscoverySourceKind;
}

const KEY_PREFIX = 'obd:discovery:v1:';
const MAX_RECORDS_PER_VEHICLE = 128;
const SCHEMA_VERSION = 1;

interface RepoFile {
  version: number;
  records: DiscoveredDataRecord[];
}

/** FNV-1a — autoDidDiscovery.ts'teki ile BİREBİR AYNI algoritma (aynı VIN → aynı hash). */
export function hashVin(vin: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < vin.length; i++) {
    h ^= vin.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

function storageKey(fingerprint: string): string {
  return KEY_PREFIX + fingerprint;
}

/** Bu araç (fingerprint) için kalıcı kayıtlar — bozuk/eksik veri fail-soft boş dizi. */
export function loadRecords(fingerprint: string): DiscoveredDataRecord[] {
  if (typeof fingerprint !== 'string' || fingerprint.length === 0) return [];
  try {
    const raw = safeGetRaw(storageKey(fingerprint));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RepoFile;
    if (!parsed || !Array.isArray(parsed.records)) return [];
    return parsed.records;
  } catch {
    return []; // bozuk JSON → dürüstçe boş başla (persist eski profilleri BOZMAZ — ayrı anahtar)
  }
}

function saveRecords(fingerprint: string, records: DiscoveredDataRecord[]): void {
  try {
    const bounded = records.length > MAX_RECORDS_PER_VEHICLE
      ? records.slice(records.length - MAX_RECORDS_PER_VEHICLE)
      : records;
    const file: RepoFile = { version: SCHEMA_VERSION, records: bounded };
    safeSetRaw(storageKey(fingerprint), JSON.stringify(file));
  } catch {
    /* kota/serileştirme hatası — bellek durumu korunur, fail-soft */
  }
}

/** Tek bir kaydı (kind+identifier+ecuAddress) getirir — yoksa null. */
export function getRecord(
  fingerprint: string,
  kind: 'pid' | 'did',
  identifier: string,
  ecuAddress: string,
): DiscoveredDataRecord | null {
  const records = loadRecords(fingerprint);
  return records.find((r) => r.kind === kind && r.identifier === identifier && r.ecuAddress === ecuAddress) ?? null;
}

export interface UpsertDiscoveredInput {
  kind: 'pid' | 'did';
  identifier: string;
  ecuAddress: string;
  service: '01' | '22' | '21';
  protocolClass: ProtocolClass;
  vinHash: string | null;
  rawRequestSample: string;
  rawResponseSample: string;
  decoderId: string | null;
  decoderVersion?: number;
  validationStatus: DiscoveryStatus;
  confidence: number;
  latencyMs: number;
  success: boolean;
  recommendedPollClass: PollClass;
  discoverySource: DiscoverySourceKind;
}

/**
 * Yeni gözlemi mevcut kayda BİRLEŞTİRİR (counters/timestamps) veya yeni kayıt oluşturur.
 * `firstSeenAt` yalnız ilk oluşturmada yazılır; `lastSeenAt`/sayaçlar HER çağrıda güncellenir.
 * Ortalama gecikme kayan-ortalama (basit) ile güncellenir (ekstra dizi tutmaz — bounded).
 */
export function upsertDiscoveredRecord(
  fingerprint: string,
  input: UpsertDiscoveredInput,
): DiscoveredDataRecord {
  const now = Date.now();
  const records = loadRecords(fingerprint);
  const idx = records.findIndex(
    (r) => r.kind === input.kind && r.identifier === input.identifier && r.ecuAddress === input.ecuAddress,
  );

  if (idx === -1) {
    const created: DiscoveredDataRecord = {
      vehicleFingerprint: fingerprint,
      vinHash: input.vinHash,
      protocolClass: input.protocolClass,
      ecuAddress: input.ecuAddress,
      kind: input.kind,
      identifier: input.identifier,
      service: input.service,
      rawRequestSample: input.rawRequestSample,
      rawResponseSample: input.rawResponseSample,
      decoderId: input.decoderId,
      decoderVersion: input.decoderVersion ?? 1,
      validationStatus: input.validationStatus,
      confidence: input.confidence,
      firstSeenAt: now,
      lastSeenAt: now,
      successfulReadCount: input.success ? 1 : 0,
      failureCount: input.success ? 0 : 1,
      averageLatencyMs: input.latencyMs,
      recommendedPollClass: input.recommendedPollClass,
      discoverySource: input.discoverySource,
    };
    records.push(created);
    saveRecords(fingerprint, records);
    return created;
  }

  const prev = records[idx]!;
  const totalReads = prev.successfulReadCount + prev.failureCount + 1;
  const updated: DiscoveredDataRecord = {
    ...prev,
    protocolClass: input.protocolClass,
    rawRequestSample: input.rawRequestSample,
    rawResponseSample: input.rawResponseSample,
    decoderId: input.decoderId ?? prev.decoderId,
    validationStatus: input.validationStatus,
    confidence: input.confidence,
    lastSeenAt: now,
    successfulReadCount: prev.successfulReadCount + (input.success ? 1 : 0),
    failureCount: prev.failureCount + (input.success ? 0 : 1),
    averageLatencyMs: prev.averageLatencyMs + (input.latencyMs - prev.averageLatencyMs) / totalReads,
    recommendedPollClass: input.recommendedPollClass,
    discoverySource: input.discoverySource,
  };
  records[idx] = updated;
  saveRecords(fingerprint, records);
  return updated;
}
