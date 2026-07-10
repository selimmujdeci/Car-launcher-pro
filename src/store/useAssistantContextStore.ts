/**
 * useAssistantContextStore — Birleşik Asistan Bağlamı (OfflineAssistantContext).
 *
 * AMAÇ: Voice Assistant · Companion AI · Safety Kernel · Offline Conversation ·
 * Deep Scan · Vehicle Learning · Diagnostic AI · Maintenance AI katmanlarının
 * BUGÜN her biri ayrı ayrı okuduğu kaynakları TEK merkezde toplar ve periyodik,
 * dondurulmuş (immutable) bir snapshot yayınlar. Tüketiciler bu snapshot'ı okur.
 *
 * TASARIM (assistantSafetyKernel deseni — saf çekirdek + fail-soft canlı adaptör):
 *   • `buildSnapshot(sources, now, revision)` = SAF fonksiyon. Enjekte edilen ham
 *     kaynaklar üstünde çalışır, canlı servis OKUMAZ, asla throw ETMEZ, çıktısı
 *     `Object.freeze`'li. → cihazsız, mock'suz, deterministik test.
 *   • `readLiveSources()` = canlı kaynakları okuyan TEK adaptör. Her kaynak KENDİ
 *     try/catch'i içinde okunur → bir servisin hatası diğer bölümleri ÜRETMEYİ
 *     engellemez (fail-soft).
 *   • Lifecycle (`startAssistantContext`) abonelikleri BİR KEZ kurar, dispose'ta
 *     BİR KEZ kapatır — snapshot başına subscribe/unsubscribe döngüsü YOKTUR.
 *
 * PERFORMANS BÜTÇESİ (CLAUDE.md "Performans-Uyarlanabilir Hibrit"):
 *   • Snapshot periyodu: 5 sn · DeviceTier='low' → 10 sn.
 *   • Görev `runtimeManager.scheduleTask` üstünde, criticality='NORMAL' (mod
 *     çarpanına tabi) + `deferIdle:true` (requestIdleCallback) → HOT-PATH'e (3Hz
 *     hız/RPM) ASLA girmez. Güvenlik kararı ÜRETMEZ; bu yüzden SAFETY değildir.
 *   • Dirty-flag: hiçbir kaynak değişmediyse ve snapshot bayat değilse tik
 *     hiçbir şey ayırmaz (park hâlinde sıfır maliyet).
 *   • Ağır soğuk-yol bölümleri (Vehicle Identity · Vehicle Learning) her tikte
 *     DEĞİL, kendi yenileme aralıklarında okunur; arada önbellek döner. Low
 *     tier'da bu aralık iki katına çıkar ve pattern detayı zaten kapalıdır
 *     (vehicleLearningIntegrationService tier-farkında).
 *
 * GİZLİLİK (kesin): snapshot'a VIN · MAC · GPS koordinatı · ham PID/DID/CAN
 * verisi ASLA yazılmaz. Yalnız YORUMLANMIŞ değerler taşınır. Navigasyon hedefi
 * yalnız GÖRÜNEN AD olarak (koordinatsız, kırpılmış) girer.
 *
 * KESİN SINIRLAR: bu modül hiçbir servise YAZMAZ; severity/driveSafe/diagnostic
 * kararlarını DEĞİŞTİRMEZ (yalnız okur); OBD poll / Discovery / Learning / SQL /
 * Native davranışı DEĞİŞMEZ. Additive — mevcut tüketiciler bu store'a bağlanana
 * kadar hiçbir davranış değişmez.
 *
 * BUGÜN KAYNAĞI OLMAYAN ALANLAR (uydurulmaz — dürüstçe `null`):
 *   • `deepScan.*`      — projede genel bir Deep Scan servisi YOK (yalnız
 *                          DTCPanel içinde lokal `isDeepScanning` UI state'i var).
 *   • `driver.fatigueScore` — sürücü yorgunluk skoru üreten bir servis YOK.
 *   • `status.ignition`     — kontak durumu yayan bir sinyal YOK.
 *   • `media.ducking`       — audioService duck durumunu DIŞA AÇMIYOR.
 *   • `network.wifi/mobile` — yalnız `navigator.connection.type` kesin
 *                          söylüyorsa doldurulur; aksi hâlde null.
 * Bu alanlar şema içinde yer tutar; kaynakları eklendiğinde adaptör doldurur.
 */

import { create } from 'zustand';

import { runtimeManager, type ScheduledTask } from '../core/runtime/AdaptiveRuntimeManager';
import { RuntimeMode } from '../core/runtime/runtimeTypes';
import { getDeviceTier, type DeviceTier } from '../platform/deviceCapabilities';

import { onOBDData } from '../platform/obdService';
import { onDTCState } from '../platform/dtcService';
import { onTripState } from '../platform/tripLogService';
import { diagnoseDtc } from '../platform/diagnosticKnowledgeEngine';
import { getBrainState } from '../platform/diagnostic/maintenanceBrain';
import { getNavigationState } from '../platform/navigationService';
import { getMediaState } from '../platform/mediaService';
import { getThermalLevel } from '../platform/thermalWatchdog';
import { vehicleKnowledgeBaseStore } from '../platform/vehicleKnowledgeBase';
import { resolveManufacturer } from '../platform/manufacturerIntelligenceEngine';
import { vehicleLearningEvidenceStore } from '../platform/vehicleLearningEvidenceStore';
import { vehicleLearningIntegrationService } from '../platform/vehicleLearningIntegrationService';

import { useCognitiveStore, type CognitiveMode } from './useCognitiveStore';
import { useStore } from './useStore';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler (performans bütçesi)
 * ════════════════════════════════════════════════════════════════════════ */

/** Snapshot periyodu (mid/high tier). */
export const SNAPSHOT_PERIOD_MS = 5_000;
/** Snapshot periyodu (DeviceTier='low'). */
export const LOW_TIER_SNAPSHOT_PERIOD_MS = 10_000;

/** Soğuk-yol bölümleri (identity/learning) bu süreden eski ise yeniden okunur. */
const COLD_REFRESH_MS = 30_000;
/** Low tier'da soğuk-yol yenileme iki kat seyrek. */
const COLD_REFRESH_MS_LOW = 60_000;

/**
 * Hiçbir kaynak değişmese bile snapshot bu süreden eskiyse yeniden kurulur
 * (soğuk-yol bölümlerinin bayatlamaması için üst sınır).
 */
const MAX_SNAPSHOT_AGE_MS = 60_000;

/** Tanı için değerlendirilecek maksimum aktif DTC (bounded — CLAUDE.md). */
const MAX_DTC_EVAL = 12;
/** Öğrenme kanıtı okuma tavanı (bounded). */
const MAX_EVIDENCE_SCAN = 512;
/** Navigasyon hedef adı üst sınırı (gizlilik + bellek). */
const MAX_DEST_NAME_CHARS = 64;

/** Scheduler görev kimliği (idempotent kayıt). */
export const SNAPSHOT_TASK_ID = 'assistant-context-snapshot';

/* ══════════════════════════════════════════════════════════════════════════
 * Snapshot şeması (yalnız YORUMLANMIŞ veri — ham/gizli alan YOK)
 * ════════════════════════════════════════════════════════════════════════ */

/** Araç kimliği — VIN taşımaz (yalnız türetilmiş fingerprint hash'i). */
export interface AssistantIdentitySection {
  readonly fingerprintHash: string | null;
  readonly manufacturer:    string | null;
  readonly profileHint:     string | null;
  readonly protocol:        string | null;
}

/** Bakım özeti — maintenanceBrain'in senkron okunabilen türev değerleri. */
export interface AssistantMaintenanceSummary {
  readonly oilLifePercent: number | null;
  readonly wearRate:       number | null;
}

/** Tanı severity — dtcDataSource.DTCSeverity ile hizalı (yalnız okunur). */
export type AssistantSeverity = 'critical' | 'warning' | 'info';

/** Araç sağlığı — severity/driveSafe DEĞİŞTİRİLMEZ, aktif tanı motorundan OKUNUR. */
export interface AssistantHealthSection {
  readonly healthScore:  number | null;
  readonly severity:     AssistantSeverity | null;
  readonly driveSafe:    boolean | null;
  readonly maintenance:  AssistantMaintenanceSummary;
}

/** Araç öğrenme özeti (P2-1→P2-5 salt-okunur türevleri). */
export interface AssistantLearningSection {
  readonly evidenceCount:       number | null;
  readonly patternCount:        number | null;
  /** En yüksek decay uygulanmış güven (0–1). */
  readonly strongestConfidence: number | null;
  /** Kanıtlara katkı veren tekil araç (fingerprint) sayısı. */
  readonly learnedVehicleCount: number | null;
}

/** Deep Scan — bugün besleyen servis YOK; şema yer tutar (tümü null). */
export interface AssistantDeepScanSection {
  readonly completed:           boolean | null;
  readonly progress:            number | null;
  readonly newDiscoveriesCount: number | null;
  readonly changedFirmware:     boolean | null;
  readonly changedECU:          boolean | null;
}

/** Araç durumu — imkânsız/desteklenmeyen değerler (-1 sentinel dahil) null'a düşer. */
export interface AssistantStatusSection {
  readonly speed:          number | null;
  readonly rpm:            number | null;
  readonly coolantTemp:    number | null;
  readonly fuelLevel:      number | null;
  readonly batteryVoltage: number | null;
  /** Kontak sinyali yayan kaynak yok → daima null. */
  readonly ignition:       boolean | null;
}

/** Sürücü durumu. */
export interface AssistantDriverSection {
  /** Yorgunluk skoru üreten servis yok → daima null. */
  readonly fatigueScore:  number | null;
  /** Aktif yolculuk süresi (dakika); yolculuk yoksa null. */
  readonly tripDuration:  number | null;
  readonly cognitiveMode: CognitiveMode | null;
}

/** Navigasyon — hedef yalnız GÖRÜNEN AD (koordinat YOK). */
export interface AssistantNavigationSection {
  readonly isNavigating:  boolean | null;
  readonly destination:   string | null;
  readonly remainingKm:   number | null;
  /** Kalan süre (saniye). */
  readonly remainingTime: number | null;
}

/** Medya. */
export interface AssistantMediaSection {
  readonly playing: boolean | null;
  readonly volume:  number | null;
  /** audioService duck durumunu dışa açmıyor → daima null. */
  readonly ducking: boolean | null;
}

/** Ağ. */
export interface AssistantNetworkSection {
  readonly online: boolean | null;
  readonly wifi:   boolean | null;
  readonly mobile: boolean | null;
}

/** Cihaz. */
export type AssistantThermalStatus = 'normal' | 'warm' | 'hot' | 'critical';

export interface AssistantDeviceSection {
  readonly tier:          DeviceTier | null;
  readonly thermalStatus: AssistantThermalStatus | null;
  readonly powerSaver:    boolean | null;
}

/** Tüm asistan katmanlarının ortak, dondurulmuş bağlamı. */
export interface AssistantContextSnapshot {
  /** Üretim zamanı (ms). */
  readonly builtAt:    number;
  /** Monoton artan sürüm — değişiklik tespiti için (referans eşitliği yerine). */
  readonly revision:   number;
  readonly identity:   AssistantIdentitySection;
  readonly health:     AssistantHealthSection;
  readonly learning:   AssistantLearningSection;
  readonly deepScan:   AssistantDeepScanSection;
  readonly status:     AssistantStatusSection;
  readonly driver:     AssistantDriverSection;
  readonly navigation: AssistantNavigationSection;
  readonly media:      AssistantMediaSection;
  readonly network:    AssistantNetworkSection;
  readonly device:     AssistantDeviceSection;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Ham kaynak girdisi (SAF kurucunun tek girdisi — tüm alanlar opsiyonel)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Adaptörün topladığı ham okumalar. Her alan opsiyonel: okunamayan kaynak
 * `undefined` bırakılır → ilgili snapshot alanı `null` olur (uydurma YOK).
 * Ham hot-path verisi TAŞIMAZ; yalnız kurucunun sanitize edeceği skaler değerler.
 */
export interface AssistantContextSources {
  identity?: {
    fingerprintHash?: string;
    manufacturer?:    string;
    profileHint?:     string;
    protocol?:        string;
  };
  health?: {
    healthScore?:     number;
    severity?:        AssistantSeverity;
    driveSafe?:       boolean;
    oilLifePercent?:  number;
    wearRate?:        number;
  };
  learning?: {
    evidenceCount?:       number;
    patternCount?:        number;
    strongestConfidence?: number;
    learnedVehicleCount?: number;
  };
  status?: {
    speed?:          number;
    rpm?:            number;
    coolantTemp?:    number;
    fuelLevel?:      number;
    batteryVoltage?: number;
  };
  driver?: {
    tripDuration?:  number;
    cognitiveMode?: CognitiveMode;
  };
  navigation?: {
    isNavigating?:  boolean;
    destination?:   string;
    remainingKm?:   number;
    remainingTime?: number;
  };
  media?: {
    playing?: boolean;
    volume?:  number;
  };
  network?: {
    online?: boolean;
    wifi?:   boolean;
    mobile?: boolean;
  };
  device?: {
    tier?:          DeviceTier;
    thermalStatus?: AssistantThermalStatus;
    powerSaver?:    boolean;
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sanitizasyon (Sensor Resiliency — CLAUDE.md §2: imkânsız değer reddedilir)
 * ════════════════════════════════════════════════════════════════════════ */

/** Sayı [min,max] aralığındaysa döner; değilse null (NaN/Infinity/-1 sentinel dahil). */
function num(v: unknown, min: number, max: number): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max ? v : null;
}

function bool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

/** Boş olmayan, kırpılmış metin; aksi hâlde null. `max` karakterde kesilir. */
function text(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  if (!t) return null;
  return t.length > max ? t.slice(0, max) : t;
}

function severity(v: unknown): AssistantSeverity | null {
  return v === 'critical' || v === 'warning' || v === 'info' ? v : null;
}

function thermal(v: unknown): AssistantThermalStatus | null {
  return v === 'normal' || v === 'warm' || v === 'hot' || v === 'critical' ? v : null;
}

function tierOf(v: unknown): DeviceTier | null {
  return v === 'low' || v === 'mid' || v === 'high' ? v : null;
}

function cognitive(v: unknown): CognitiveMode | null {
  return v === 'IMMERSIVE' || v === 'AWARE' || v === 'FOCUSED' ||
         v === 'PROTECTION' || v === 'CRITICAL' || v === 'LIMP_HOME' ? v : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SAF kurucu — asla throw etmez, çıktısı derin dondurulmuş
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Ham kaynaklardan dondurulmuş snapshot üretir. SAF: canlı servis okumaz, girdiyi
 * MUTASYONA UĞRATMAZ, hata fırlatmaz. Eksik/bozuk her alan `null`'a düşer.
 *
 * Gizlilik: girdide VIN/MAC/koordinat/ham PID beklenmez; kurucu yalnız bilinen
 * skaler alanları ALIR (whitelist) — girdiye fazladan alan eklense bile snapshot'a
 * SIZAMAZ (yapısal garanti).
 */
export function buildSnapshot(
  sources: AssistantContextSources | null | undefined,
  now: number,
  revision: number,
): AssistantContextSnapshot {
  const s = sources ?? {};
  const builtAt = Number.isFinite(now) ? now : 0;

  const identity: AssistantIdentitySection = Object.freeze({
    fingerprintHash: text(s.identity?.fingerprintHash, 64),
    manufacturer:    text(s.identity?.manufacturer, 64),
    profileHint:     text(s.identity?.profileHint, 64),
    protocol:        text(s.identity?.protocol, 32),
  });

  const maintenance: AssistantMaintenanceSummary = Object.freeze({
    oilLifePercent: num(s.health?.oilLifePercent, 0, 100),
    wearRate:       num(s.health?.wearRate, 0, 1),
  });

  const health: AssistantHealthSection = Object.freeze({
    healthScore: num(s.health?.healthScore, 0, 100),
    severity:    severity(s.health?.severity),
    driveSafe:   bool(s.health?.driveSafe),
    maintenance,
  });

  const learning: AssistantLearningSection = Object.freeze({
    evidenceCount:       num(s.learning?.evidenceCount, 0, MAX_EVIDENCE_SCAN),
    patternCount:        num(s.learning?.patternCount, 0, MAX_EVIDENCE_SCAN),
    strongestConfidence: num(s.learning?.strongestConfidence, 0, 1),
    learnedVehicleCount: num(s.learning?.learnedVehicleCount, 0, MAX_EVIDENCE_SCAN),
  });

  // Deep Scan: besleyen servis yok → şema yer tutar, tüm alanlar null (uydurma YOK).
  const deepScan: AssistantDeepScanSection = Object.freeze({
    completed: null, progress: null, newDiscoveriesCount: null,
    changedFirmware: null, changedECU: null,
  });

  const status: AssistantStatusSection = Object.freeze({
    speed:          num(s.status?.speed, 0, 300),
    rpm:            num(s.status?.rpm, 0, 10_000),
    coolantTemp:    num(s.status?.coolantTemp, -40, 200),
    fuelLevel:      num(s.status?.fuelLevel, 0, 100),
    batteryVoltage: num(s.status?.batteryVoltage, 0, 20),
    ignition:       null, // kaynak yok
  });

  const driver: AssistantDriverSection = Object.freeze({
    fatigueScore:  null, // kaynak yok
    tripDuration:  num(s.driver?.tripDuration, 0, 48 * 60),
    cognitiveMode: cognitive(s.driver?.cognitiveMode),
  });

  const navigation: AssistantNavigationSection = Object.freeze({
    isNavigating:  bool(s.navigation?.isNavigating),
    destination:   text(s.navigation?.destination, MAX_DEST_NAME_CHARS),
    remainingKm:   num(s.navigation?.remainingKm, 0, 5_000),
    remainingTime: num(s.navigation?.remainingTime, 0, 24 * 3600),
  });

  const media: AssistantMediaSection = Object.freeze({
    playing: bool(s.media?.playing),
    volume:  num(s.media?.volume, 0, 100),
    ducking: null, // kaynak yok
  });

  const network: AssistantNetworkSection = Object.freeze({
    online: bool(s.network?.online),
    wifi:   bool(s.network?.wifi),
    mobile: bool(s.network?.mobile),
  });

  const device: AssistantDeviceSection = Object.freeze({
    tier:          tierOf(s.device?.tier),
    thermalStatus: thermal(s.device?.thermalStatus),
    powerSaver:    bool(s.device?.powerSaver),
  });

  return Object.freeze({
    builtAt,
    revision: Number.isFinite(revision) ? revision : 0,
    identity, health, learning, deepScan, status, driver, navigation, media, network, device,
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Canlı kaynak adaptörü — her kaynak İZOLE try/catch (fail-soft)
 * ════════════════════════════════════════════════════════════════════════ */

/** Abonelik önbelleği: tik içinde SENKRON okunur (snapshot başına abone olunmaz). */
interface SourceCache {
  speed?: number; rpm?: number; coolantTemp?: number; fuelLevel?: number; batteryVoltage?: number;
  dtcCodes: string[];
  tripActive: boolean;
  tripDurationMin: number;
}

function emptyCache(): SourceCache {
  return { dtcCodes: [], tripActive: false, tripDurationMin: 0 };
}

let _cache: SourceCache = emptyCache();

/** Soğuk-yol önbellekleri (identity/learning) — kendi aralıklarında yenilenir. */
let _identityCache: AssistantContextSources['identity'];
let _identityAt = 0;
let _learningCache: AssistantContextSources['learning'];
let _learningAt = 0;

/** DTC → severity/driveSafe türevinin önbelleği (kod listesi değişmedikçe yeniden hesaplanmaz). */
let _dtcKey = '';
let _dtcDerived: { severity?: AssistantSeverity; driveSafe?: boolean } = {};

/** OBD -1 sentinel'i "desteklenmiyor" demektir → sanitizasyona `undefined` gider. */
function fromSentinel(v: number | undefined): number | undefined {
  return typeof v === 'number' && v >= 0 ? v : undefined;
}

/** Aktif DTC listesinden en kötü severity + driveSafe türetir (tanı motorunu OKUR, değiştirmez). */
function deriveDtcHealth(codes: readonly string[]): { severity?: AssistantSeverity; driveSafe?: boolean } {
  if (codes.length === 0) return {};
  let worst: AssistantSeverity | undefined;
  let driveSafe = true;
  for (const code of codes.slice(0, MAX_DTC_EVAL)) {
    try {
      const insight = diagnoseDtc(code);
      if (insight.driveSafe === false) driveSafe = false;
      if (insight.severity === 'critical') worst = 'critical';
      else if (insight.severity === 'warning' && worst !== 'critical') worst = 'warning';
      else if (insight.severity === 'info' && worst === undefined) worst = 'info';
    } catch { /* tek kod hatası diğerlerini etkilemez */ }
  }
  return { severity: worst, driveSafe };
}

/** `navigator.connection.type` KESİN söylüyorsa wifi/mobile; aksi hâlde undefined. */
function readConnectionType(): { wifi?: boolean; mobile?: boolean } {
  try {
    const conn = (navigator as unknown as { connection?: { type?: string } }).connection;
    const t = conn?.type;
    if (t === 'wifi')     return { wifi: true, mobile: false };
    if (t === 'cellular') return { wifi: false, mobile: true };
  } catch { /* API yok */ }
  return {};
}

function thermalStatusFromLevel(level: number): AssistantThermalStatus | undefined {
  if (level === 0) return 'normal';
  if (level === 1) return 'warm';
  if (level === 2) return 'hot';
  if (level === 3) return 'critical';
  return undefined;
}

/** Soğuk-yol: araç kimliği (en son görülen bilgi tabanı kaydı). VIN TAŞIMAZ. */
function readIdentity(): AssistantContextSources['identity'] {
  try {
    const record = vehicleKnowledgeBaseStore.list()[0];
    if (!record) return undefined;
    let manufacturer: string | undefined;
    let profileHint: string | undefined;
    try {
      const resolved = resolveManufacturer(record);
      manufacturer = resolved.manufacturer;
      profileHint = resolved.profileHint;
    } catch { /* çözümleyici hatası kimliği tamamen düşürmesin */ }
    return {
      fingerprintHash: record.fingerprintHash,
      manufacturer,
      profileHint: profileHint || record.profileHint,
      protocol: record.protocol,
    };
  } catch { return undefined; }
}

/** Soğuk-yol: öğrenme özeti (salt-okunur, memoized entegrasyon servisi + kanıt deposu). */
function readLearning(): AssistantContextSources['learning'] {
  try {
    const summary = vehicleLearningIntegrationService.getExpertSummary();

    // En güçlü decay'li güven — entegrasyon servisinin (memoized) anotasyonlarından.
    let strongest = 0;
    try {
      for (const ann of vehicleLearningIntegrationService.getAnnotationMap().values()) {
        if (ann.decayedConfidence > strongest) strongest = ann.decayedConfidence;
      }
    } catch { /* anotasyon hatası özeti düşürmesin */ }

    // Kanıtlara katkı veren TEKİL araç sayısı (bounded tarama).
    let learnedVehicleCount: number | undefined;
    try {
      const hashes = new Set<string>();
      const list = vehicleLearningEvidenceStore.list();
      const bounded = list.length > MAX_EVIDENCE_SCAN ? list.slice(0, MAX_EVIDENCE_SCAN) : list;
      for (const e of bounded) for (const h of e.supportingVehicleHashes ?? []) if (h) hashes.add(h);
      learnedVehicleCount = hashes.size;
    } catch { /* depo hatası → sayı bilinmiyor */ }

    return {
      evidenceCount: summary.totalEvidence,
      patternCount: summary.patternCount,
      strongestConfidence: strongest,
      learnedVehicleCount,
    };
  } catch { return undefined; }
}

/**
 * Canlı kaynakları okur. Her bölüm KENDİ try/catch'i içinde — bir servisin hatası
 * diğer bölümlerin üretilmesini ENGELLEMEZ. Asla throw etmez.
 *
 * `coldRefreshMs`: identity/learning bölümleri bu süreden eski değilse önbellekten
 * döner (soğuk-yol bütçesi).
 */
export function readLiveSources(now: number, coldRefreshMs: number): AssistantContextSources {
  const out: AssistantContextSources = {};

  // ── Araç durumu (abonelik önbelleğinden — senkron, ek okuma yok) ──
  try {
    out.status = {
      speed:          fromSentinel(_cache.speed),
      rpm:            fromSentinel(_cache.rpm),
      coolantTemp:    fromSentinel(_cache.coolantTemp),
      fuelLevel:      fromSentinel(_cache.fuelLevel),
      batteryVoltage: fromSentinel(_cache.batteryVoltage),
    };
  } catch { /* fail-soft */ }

  // ── Sağlık: healthScore/bakım (maintenanceBrain) + severity/driveSafe (tanı motoru) ──
  try {
    const brain = getBrainState();
    const key = _cache.dtcCodes.join(',');
    if (key !== _dtcKey) {
      _dtcKey = key;
      _dtcDerived = deriveDtcHealth(_cache.dtcCodes);
    }
    out.health = {
      healthScore:    brain.healthScore,
      severity:       _dtcDerived.severity,
      driveSafe:      _dtcDerived.driveSafe,
      oilLifePercent: brain.oilLife,
      wearRate:       brain.wearRate,
    };
  } catch { /* bakım beyni yok → sağlık bölümü boş */ }

  // ── Sürücü ──
  try {
    out.driver = {
      tripDuration:  _cache.tripActive ? _cache.tripDurationMin : undefined,
      cognitiveMode: useCognitiveStore.getState().currentMode,
    };
  } catch { /* store yok */ }

  // ── Navigasyon (hedef yalnız AD — koordinat ASLA) ──
  try {
    const nav = getNavigationState();
    out.navigation = {
      isNavigating:  nav.isNavigating,
      destination:   nav.destination?.name,
      remainingKm:   typeof nav.distanceMeters === 'number' ? nav.distanceMeters / 1000 : undefined,
      remainingTime: nav.etaSeconds,
    };
  } catch { /* navigasyon yok */ }

  // ── Medya ──
  try {
    out.media = { playing: getMediaState().playing };
  } catch { /* medya servisi yok */ }
  try {
    const v = useStore.getState().settings.volume;
    out.media = { ...(out.media ?? {}), volume: v };
  } catch { /* ayar store'u yok */ }

  // ── Ağ ──
  try {
    out.network = {
      online: typeof navigator !== 'undefined' ? navigator.onLine !== false : undefined,
      ...readConnectionType(),
    };
  } catch { /* navigator yok (SSR/test) */ }

  // ── Cihaz ──
  try {
    const device: NonNullable<AssistantContextSources['device']> = {};
    try { device.tier = getDeviceTier(); } catch { /* tespit yok */ }
    try { device.thermalStatus = thermalStatusFromLevel(getThermalLevel()); } catch { /* watchdog yok */ }
    try { device.powerSaver = runtimeManager.getMode() === RuntimeMode.POWER_SAVE; } catch { /* runtime yok */ }
    out.device = device;
  } catch { /* fail-soft */ }

  // ── Soğuk-yol bölümleri (identity/learning) — kendi aralıklarında ──
  if (_identityAt === 0 || now - _identityAt >= coldRefreshMs) {
    _identityCache = readIdentity();
    _identityAt = now;
  }
  if (_identityCache) out.identity = _identityCache;

  if (_learningAt === 0 || now - _learningAt >= coldRefreshMs) {
    _learningCache = readLearning();
    _learningAt = now;
  }
  if (_learningCache) out.learning = _learningCache;

  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Zustand store — yalnız dondurulmuş snapshot yayınlar
 * ════════════════════════════════════════════════════════════════════════ */

interface AssistantContextState {
  /** Son dondurulmuş snapshot; henüz üretilmediyse null. */
  snapshot: AssistantContextSnapshot | null;
  /** Snapshot yayınla (yalnız lifecycle çağırır). */
  _publish: (snap: AssistantContextSnapshot | null) => void;
}

export const useAssistantContextStore = create<AssistantContextState>()((set) => ({
  snapshot: null,
  _publish: (snapshot) => set({ snapshot }),
}));

/** Anlık snapshot (React dışı tüketiciler için). Henüz üretilmediyse null. */
export function getAssistantContextSnapshot(): AssistantContextSnapshot | null {
  return useAssistantContextStore.getState().snapshot;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Lifecycle — abonelikler BİR KEZ kurulur, dispose'ta BİR KEZ kapatılır
 * ════════════════════════════════════════════════════════════════════════ */

/** Enjekte edilebilir bağımlılıklar (test için; prod varsayılanları canlı servisler). */
export interface AssistantContextDeps {
  now: () => number;
  tier: () => DeviceTier;
  schedule: (task: ScheduledTask) => () => void;
  /** Ham kaynakları okur (soğuk-yol aralığı parametreyle gelir). */
  readSources: (now: number, coldRefreshMs: number) => AssistantContextSources;
  /** Kaynak aboneliklerini kurar; her değişimde `onChange` çağrılır. Cleanup listesi döner. */
  subscribeSources: (onChange: () => void) => Array<() => void>;
}

/** Canlı abonelikler — her biri izole; biri kurulamazsa diğerleri çalışmaya devam eder. */
function liveSubscriptions(onChange: () => void): Array<() => void> {
  const unsubs: Array<() => void> = [];

  try {
    unsubs.push(onOBDData((d) => {
      _cache.speed = d.speed;
      _cache.rpm = d.rpm;
      _cache.coolantTemp = d.engineTemp;
      _cache.fuelLevel = d.fuelLevel;
      _cache.batteryVoltage = d.batteryVoltage;
      onChange();
    }));
  } catch { /* OBD servisi yok */ }

  try {
    unsubs.push(onDTCState((s) => {
      const codes: string[] = [];
      for (const c of s.codes ?? []) {
        if (typeof c?.code === 'string' && c.code) codes.push(c.code);
        if (codes.length >= MAX_DTC_EVAL) break;
      }
      _cache.dtcCodes = codes;
      onChange();
    }));
  } catch { /* DTC servisi yok */ }

  try {
    unsubs.push(onTripState((s) => {
      _cache.tripActive = s.active === true;
      _cache.tripDurationMin = s.current?.liveDurationMin ?? 0;
      onChange();
    }));
  } catch { /* yolculuk servisi yok */ }

  try { unsubs.push(useCognitiveStore.subscribe(onChange)); } catch { /* store yok */ }
  try { unsubs.push(runtimeManager.subscribe(onChange)); } catch { /* runtime yok */ }

  try {
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
      window.addEventListener('online', onChange);
      window.addEventListener('offline', onChange);
      unsubs.push(() => {
        window.removeEventListener('online', onChange);
        window.removeEventListener('offline', onChange);
      });
    }
  } catch { /* window yok */ }

  return unsubs;
}

const LIVE_DEPS: AssistantContextDeps = {
  now: () => Date.now(),
  tier: () => getDeviceTier(),
  schedule: (task) => runtimeManager.scheduleTask(task),
  readSources: readLiveSources,
  subscribeSources: liveSubscriptions,
};

let _started = false;
let _deps: AssistantContextDeps = LIVE_DEPS;
let _unsubs: Array<() => void> = [];
let _unschedule: (() => void) | null = null;
let _dirty = true;
let _revision = 0;
let _lastBuiltAt = 0;

/** DeviceTier'a göre snapshot periyodu (low → 10 sn, aksi → 5 sn). */
export function snapshotPeriodMs(tier: DeviceTier): number {
  return tier === 'low' ? LOW_TIER_SNAPSHOT_PERIOD_MS : SNAPSHOT_PERIOD_MS;
}

/** DeviceTier'a göre soğuk-yol yenileme aralığı (low → 60 sn, aksi → 30 sn). */
function coldRefreshMs(tier: DeviceTier): number {
  return tier === 'low' ? COLD_REFRESH_MS_LOW : COLD_REFRESH_MS;
}

function markDirty(): void { _dirty = true; }

/** Snapshot'ı yeniden kurar ve yayınlar. Asla throw etmez. */
function rebuild(): AssistantContextSnapshot {
  let tier: DeviceTier = 'mid';
  try { tier = _deps.tier(); } catch { /* tespit yok → mid varsayımı */ }

  let now = 0;
  try { now = _deps.now(); } catch { /* saat yok */ }

  let sources: AssistantContextSources = {};
  try { sources = _deps.readSources(now, coldRefreshMs(tier)) ?? {}; } catch { sources = {}; }

  const snap = buildSnapshot(sources, now, ++_revision);
  _lastBuiltAt = now;
  _dirty = false;
  try { useAssistantContextStore.getState()._publish(snap); } catch { /* store yayını hatası akışı kırmasın */ }
  return snap;
}

/**
 * Periyodik tik gövdesi. Hiçbir kaynak değişmediyse VE snapshot bayat değilse
 * hiçbir şey ayırmaz (park hâlinde sıfır maliyet).
 */
function tick(): void {
  try {
    // Dispose sonrası elde kalmış bir görev referansı tetiklenirse: sessizce çık
    // (dangling görev snapshot yayınlayamaz).
    if (!_started) return;
    if (!_dirty) {
      let now = 0;
      try { now = _deps.now(); } catch { /* saat yok */ }
      if (now - _lastBuiltAt < MAX_SNAPSHOT_AGE_MS) return;
    }
    rebuild();
  } catch { /* tik hiçbir koşulda uygulamayı çökertmez */ }
}

/**
 * Store'u devreye alır: abonelikleri kurar, snapshot görevini scheduler'a kaydeder
 * ve ilk snapshot'ı üretir. İDEMPOTENT — ikinci çağrı yeni abonelik/timer kurmaz.
 *
 * @returns cleanup thunk (= `stopAssistantContext`)
 */
export function startAssistantContext(deps?: Partial<AssistantContextDeps>): () => void {
  if (_started) return stopAssistantContext;
  _started = true;
  _deps = { ...LIVE_DEPS, ...(deps ?? {}) };

  _cache = emptyCache();
  _identityCache = undefined; _identityAt = 0;
  _learningCache = undefined; _learningAt = 0;
  _dtcKey = ''; _dtcDerived = {};
  _dirty = true;

  try { _unsubs = _deps.subscribeSources(markDirty) ?? []; } catch { _unsubs = []; }

  let tier: DeviceTier = 'mid';
  try { tier = _deps.tier(); } catch { /* tespit yok */ }

  try {
    _unschedule = _deps.schedule({
      id: SNAPSHOT_TASK_ID,
      periodMs: snapshotPeriodMs(tier),
      // NORMAL: güvenlik kararı üretmez → düşük tier'da yavaşlaması İSTENİR.
      criticality: 'NORMAL',
      // Hot-path'e girmez: tetiklenince requestIdleCallback'e ötelenir.
      deferIdle: true,
      fn: tick,
    });
  } catch { _unschedule = null; }

  rebuild(); // ilk snapshot — tüketiciler boot'ta null görmesin
  return stopAssistantContext;
}

/** Tam temizlik (zero-leak): abonelikler, scheduler görevi, önbellekler, yayınlanan snapshot. */
export function stopAssistantContext(): void {
  if (!_started) return;
  _started = false;

  if (_unschedule) { try { _unschedule(); } catch { /* yoksay */ } _unschedule = null; }
  for (const u of _unsubs) { try { u(); } catch { /* abone kapanışı temizliği kırmasın */ } }
  _unsubs = [];

  // Eski referanslar tutulmaz.
  _cache = emptyCache();
  _identityCache = undefined; _identityAt = 0;
  _learningCache = undefined; _learningAt = 0;
  _dtcKey = ''; _dtcDerived = {};
  _dirty = true;
  _lastBuiltAt = 0;
  _deps = LIVE_DEPS;

  try { useAssistantContextStore.getState()._publish(null); } catch { /* yoksay */ }
}

/** Manuel yenileme — dirty flag'i atlayıp anında yeni snapshot üretir ve döner. */
export function refreshAssistantContext(): AssistantContextSnapshot {
  return rebuild();
}

/** Bir sonraki tikte yeniden kurulmayı zorlar (kaynak değişimi bildirimi). */
export function invalidateAssistantContext(): void {
  markDirty();
}

/** @internal — testler arası tam izolasyon. */
export function _resetAssistantContextForTest(): void {
  stopAssistantContext();
  _revision = 0;
}
