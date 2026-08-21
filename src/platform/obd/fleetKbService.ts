/**
 * fleetKbService — Filo Bilgi Tabanının KALICILIĞI ve ÜRÜN BAĞLANTISI (V-04/4).
 *
 * NEDEN VAR: `fleetKb` saf öğrenme mantığı olarak yazılmıştı (fingerprint · learn ·
 * diff · suggest) ama **hiçbir yerden çağrılmıyordu** — yani "araçtan öğreniyoruz"
 * iddiası kodda vardı, üründe YOKTU. Bu dosya onu gerçek bir tarama turuna bağlar
 * ve öğrenileni cihazda kalıcı kılar.
 *
 * ── SÖZLEŞME — bu servis NE YAPMAZ ───────────────────────────────────────
 *  · Hafızayı KANIT saymaz: öğrenilen profil yalnız "nereye bakalım" ipucudur;
 *    hiçbir ECU/DTC sonucu hafızadan ÜRETİLMEZ. Canlı kanıt her zaman kazanır.
 *  · Tarama KAPSAMINI DARALTMAZ: ipucu yalnız SIRA belirler (bilinen UDS'li ECU'lar
 *    öne alınır) — hiçbir ECU atlanmaz. Tavan (`MAX_SCAN_ECUS`) zaten vardı; sıra
 *    değişikliğinin tek etkisi, tavana takılırsa doğru ECU'ların içeride kalması.
 *  · Ham VIN'i ASLA saklamaz: fingerprint VIN ise FNV-1a ile hash'lenir
 *    (`autoDidDiscovery.hashVin` ile aynı yaklaşım). Diske ham VIN yazılmaz,
 *    LAB'a hiç taşınmaz (CLAUDE.md gizlilik kuralı).
 *  · Yeni timer/abonelik KURMAZ — yalnız tarama turundan çağrılır.
 *
 * Fail-soft: depolama okunamaz/yazılamazsa öğrenme SESSİZCE atlanır; tarama ve
 * teşhis akışı bundan ETKİLENMEZ (öğrenme bir lüks, teşhis bir zorunluluktur).
 */
import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';
import { logError } from '../crashLogger';
import { getHandshakeVin } from '../safety/vinContext';
import { getSupportedPids } from './extendedPidService';
import type { VehicleTopology } from './ecuDiscovery';
import {
  buildFingerprint, learnProfile, diffProfile, suggestScanTargets, profileConfidence,
  type FleetProfile,
} from './fleetKb';

const STORAGE_KEY = 'caros.fleetkb.v1';

/**
 * Kaç araç profili saklanır. Filo aracı bir dongle ile birden çok araca takılabilir
 * (sahada yaşandı: Doblo→Trafic). Sınırsız büyüme eMMC'yi yorar → en eski görülen düşer.
 */
export const MAX_FLEET_PROFILES = 8;

interface FleetKbFile {
  readonly v: 1;
  readonly profiles: FleetProfile[];
}

/** FNV-1a — ham VIN diske YAZILMAZ, kısa imzası yazılır. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Son okuma/yazma hatası — LAB'da dürüstçe gösterilir, sessizce yutulmaz. */
let _lastError: string | null = null;

function readFile(): FleetProfile[] {
  try {
    const raw = safeGetRaw(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as FleetKbFile;
    if (!parsed || parsed.v !== 1 || !Array.isArray(parsed.profiles)) return [];
    /* Bozuk kayıt tüm dosyayı çöpe atmaz: yalnız geçerli satırlar alınır. */
    return parsed.profiles.filter((p) =>
      p && typeof p.fingerprint === 'string' && Array.isArray(p.ecus));
  } catch (e) {
    _lastError = e instanceof Error ? e.message : String(e);
    return [];
  }
}

function writeFile(profiles: FleetProfile[]): void {
  try {
    /* En son görülen kalır — LRU. Yazma throttle'ı safeStorage'ın işidir. */
    const kept = [...profiles]
      .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
      .slice(0, MAX_FLEET_PROFILES);
    safeSetRaw(STORAGE_KEY, JSON.stringify({ v: 1, profiles: kept } satisfies FleetKbFile));
    _lastError = null;
  } catch (e) {
    _lastError = e instanceof Error ? e.message : String(e);
    logError('OBD:FleetKbWrite', e);
  }
}

/**
 * Şu anki aracın kimliği. VIN varsa hash'lenmiş VIN, yoksa ECU+PID imzası.
 * `null` = kanıt yok → öğrenme YAPILMAZ (kimliksiz öğrenme yanlış araca yanlış
 * profil yükler; hiç yüklememekten KÖTÜDÜR).
 */
export function currentFingerprint(topology: VehicleTopology): {
  fingerprint: string; source: 'vin' | 'signature';
} | null {
  let vin: string | null = null;
  try { vin = getHandshakeVin(); } catch { vin = null; }

  let pidCount = 0;
  try { pidCount = getSupportedPids()?.size ?? 0; } catch { pidCount = 0; }

  const fp = buildFingerprint(vin, topology.ecus, pidCount);
  if (!fp) return null;
  /* Ham VIN diske/ekrana ÇIKMAZ: kimlik hash'e indirgenir. İmza yolunda zaten
     kimlik bilgisi yoktur (ECU adresleri + PID sayısı). */
  return fp.source === 'vin'
    ? { fingerprint: `vin:${fnv1a(fp.fingerprint)}`, source: 'vin' }
    : fp;
}

/** Kimliğe göre kayıtlı profil (yoksa null). */
export function loadProfile(fingerprint: string): FleetProfile | null {
  return readFile().find((p) => p.fingerprint === fingerprint) ?? null;
}

export interface FleetObservation {
  readonly profile: FleetProfile;
  readonly confidence: number;
  /** Profilde olup araçta OLMAYAN ECU'lar (söküldü / araç değişti). */
  readonly missing: readonly string[];
  /** Araçta olup profilde olmayan — yeni öğrenilen. */
  readonly added: readonly string[];
  /** Hiç ortak ECU yok → BAŞKA ARAÇ (dongle taşınmış). */
  readonly vehicleChanged: boolean;
  /** İlk kez görülen araç mı. */
  readonly firstSeen: boolean;
}

/**
 * Bir tarama turunun sonucunu öğrenir ve kalıcılaştırır.
 *
 * `null` döner: kimlik üretilemediyse (kanıt yok) — bu bir HATA DEĞİL, dürüst
 * "öğrenmedim" yanıtıdır.
 */
export function recordVehicleObservation(
  topology: VehicleTopology,
  udsCapableEcus: readonly string[],
  nowMs: number = Date.now(),
): FleetObservation | null {
  try {
    const fp = currentFingerprint(topology);
    if (!fp) return null;

    const profiles = readFile();
    const existing = profiles.find((p) => p.fingerprint === fp.fingerprint) ?? null;
    const diff = existing
      ? diffProfile(existing, topology)
      : { missing: [], added: topology.ecus.map((e) => e.txHeader), vehicleChanged: false };

    const profile = learnProfile(existing, fp, topology, [...udsCapableEcus], nowMs);
    writeFile([...profiles.filter((p) => p.fingerprint !== fp.fingerprint), profile]);

    return {
      profile,
      confidence: profileConfidence(profile),
      missing: diff.missing,
      added: diff.added,
      vehicleChanged: diff.vehicleChanged,
      firstSeen: existing === null,
    };
  } catch (e) {
    _lastError = e instanceof Error ? e.message : String(e);
    logError('OBD:FleetKbLearn', e);      // fail-soft — tarama ETKİLENMEZ
    return null;
  }
}

/**
 * Tarama ipucu: bu araç daha önce görüldüyse hangi ECU'ların UDS'i desteklediği.
 * KANIT DEĞİL — yalnız sıra belirler; her aday yine canlı doğrulanır.
 */
export function scanHintsFor(topology: VehicleTopology): {
  udsFirst: readonly string[];
  hint: string;
} {
  try {
    const fp = currentFingerprint(topology);
    const profile = fp ? loadProfile(fp.fingerprint) : null;
    const s = suggestScanTargets(profile);
    return { udsFirst: s.udsFirst, hint: s.hint };
  } catch {
    return { udsFirst: [], hint: 'Öğrenme kaydı okunamadı — tam keşif yapılacak.' };
  }
}

/* ── Gözlem yüzeyi (CAROS LAB) — hüküm YOK, ham sayılar ─────────────────── */

export interface FleetKbProfileRow {
  /** Kısaltılmış kimlik — ham VIN ASLA (zaten hash/imza, yine de kırpılır). */
  readonly fingerprint: string;
  readonly source: 'vin' | 'signature';
  readonly observationCount: number;
  readonly confidence: number;
  readonly ecuCount: number;
  readonly udsCount: number;
  readonly lastSeenAt: number;
}

export interface FleetKbSnapshot {
  readonly readAt: number;
  readonly profileCount: number;
  readonly maxProfiles: number;
  /** En son görülenden eskiye — hüküm yok, ham kayıtlar. */
  readonly profiles: readonly FleetKbProfileRow[];
  /** Depolama hatası varsa ham mesaj (sessiz yutma yok). */
  readonly error: string | null;
}

export function getFleetKbSnapshot(): FleetKbSnapshot {
  const profiles = readFile();
  const rows: FleetKbProfileRow[] = [...profiles]
    .sort((a, b) => b.lastSeenAt - a.lastSeenAt)
    .map((p) => ({
      fingerprint: p.fingerprint.slice(0, 20),
      source: p.fingerprintSource,
      observationCount: p.observationCount,
      confidence: profileConfidence(p),
      ecuCount: p.ecus.length,
      udsCount: p.udsCapableEcus.length,
      lastSeenAt: p.lastSeenAt,
    }));
  return {
    readAt: Date.now(),
    profileCount: profiles.length,
    maxProfiles: MAX_FLEET_PROFILES,
    profiles: rows,
    error: _lastError,
  };
}

/** @internal — testler arası izolasyon. */
export function _resetFleetKbForTest(): void {
  _lastError = null;
}
