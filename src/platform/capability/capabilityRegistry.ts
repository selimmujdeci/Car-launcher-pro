/**
 * capabilityRegistry — CarOS Pro Yetenek (Capability) Kayıt Defteri — FOUNDATION.
 *
 * AMAÇ: Cihaz · araç · yazılım · servis yeteneklerini TEK merkezden, KANITA DAYALI,
 * confidence içeren, DeviceTier-uyumlu ve güvenli biçimde yönetir. İleride Deep Scan ·
 * Vehicle HAL · Navigation · Eagle Eye · Companion AI · Assistant Context · Health/
 * Remote/Fleet/Vision/Media OS · OEM/White-label · Plugin Runtime bunu ORTAK KAYNAK
 * olarak kullanacak.
 *
 * NE YAPMAZ (bilinçli — bu PR yalnız FOUNDATION'dır):
 *  - Gerçek donanım TARAMASI başlatmaz · native davranış DEĞİŞTİRMEZ · SystemBoot/
 *    Assistant/UI WIRING yapmaz · SQL/Cloud KULLANMAZ · mevcut modülleri BAĞLAMAZ.
 *  - Kalıcı depolama EKLEMEZ (runtime-memory). Persistence · OEM config · hardware
 *    provider wiring AYRI PR'lardır.
 *  - Import edilmesi YAN ETKİSİZDİR: timer/abonelik/native çağrı/donanım probu YOK.
 *    Yalnız `DeviceTier` TİPİ (type-only) import edilir → runtime coupling yok.
 *
 * KARAR İLKESİ (zero-trust / fail-closed): `available` YALNIZ yeterli KANIT varsa true.
 * `unknown` ≠ available. Config tek başına FİZİKSEL donanımı kesinleştirmez. UI varlığı
 * kanıt DEĞİLDİR. Stale kanıt capability'yi available tutamaz. Çelişkili kaynak → unknown.
 * Authoritative kaynak yardımcıdan üstündür. DeviceTier minimumu karşılanmazsa restricted.
 * Safety-critical writable yalnız authoritative + yüksek confidence ile açılır.
 *
 * ZERO-LEAK: `dispose()` dinleyicileri bırakır (timer/abonelik açılmadığı için başka
 * kaynak yok). FAIL-SOFT: bozuk kayıt/provider hatası registry'yi çökertmez; hiçbir
 * public API throw ETMEZ. Bounded (256 capability · 32 listener). Immutable çıktı.
 */

import type { DeviceTier } from '../deviceCapabilities';

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type CapabilityDomain =
  | 'device' | 'vehicle' | 'connectivity' | 'navigation' | 'ai' | 'vision'
  | 'media' | 'remote' | 'fleet' | 'security' | 'health' | 'platform' | 'oem';

export type CapabilityStatus =
  | 'available' | 'unavailable' | 'unknown' | 'degraded' | 'restricted' | 'unsupported';

export type CapabilitySource =
  | 'native' | 'can' | 'obd' | 'deep_scan' | 'config' | 'license'
  | 'runtime' | 'network' | 'user' | 'oem' | 'inferred' | 'none';

export type CapabilityQuality = 'low' | 'medium' | 'high' | 'unknown';

export interface CapabilityRecord {
  readonly id: string;
  readonly domain: CapabilityDomain;
  readonly status: CapabilityStatus;
  readonly available: boolean;
  readonly quality: CapabilityQuality;
  readonly confidence: number;
  readonly source: CapabilitySource;
  readonly provider: string | null;
  readonly version: string | null;
  readonly details: Readonly<Record<string, string>>;
  readonly limitations: readonly string[];
  readonly firstSeen: number;
  readonly lastSeen: number;
  readonly updatedAt: number;
  readonly stale: boolean;
  readonly reason: string | null;
  readonly deviceTierMinimum: DeviceTier;
  readonly safetyCritical: boolean;
  readonly writable: boolean;
  readonly experimental: boolean;
}

export interface CapabilitySnapshot {
  readonly revision: number;
  readonly generatedAt: number;
  readonly deviceTier: DeviceTier;
  readonly capabilities: readonly CapabilityRecord[];
  readonly availableCount: number;
  readonly unavailableCount: number;
  readonly unknownCount: number;
  readonly degradedCount: number;
}

/** Bir capability için kanıt (resolveCapability girdisi). */
export interface CapabilityEvidence {
  readonly source: CapabilitySource;
  readonly available?: boolean;
  readonly quality?: CapabilityQuality;
  readonly confidence?: number;
  readonly observedAt?: number;
  readonly provider?: string;
  readonly version?: string;
  readonly details?: Record<string, unknown>;
  readonly limitations?: readonly string[];
  readonly reason?: string;
  readonly authoritative?: boolean;
}

/** Katalog tanımı (statik metadata — kanıt YOK, başlangıç `unknown`). */
export interface CapabilityDefinition {
  readonly id: string;
  readonly domain: CapabilityDomain;
  readonly deviceTierMinimum?: DeviceTier;
  readonly safetyCritical?: boolean;
  readonly writable?: boolean;
  readonly experimental?: boolean;
}

/** register/update girdisi (kısmi kabul edilir, normalize edilir). */
export type CapabilityInput =
  Partial<Omit<CapabilityRecord, 'firstSeen' | 'lastSeen' | 'updatedAt' | 'available'>> &
  { readonly id: string; readonly domain: CapabilityDomain };

export interface CapabilityRequirement {
  readonly id: string;
  /** true ise `available` (status==='available') şart; degraded yetmez. */
  readonly mustBeAvailable?: boolean;
  readonly minConfidence?: number;
}

export interface RequirementResult {
  readonly satisfied: boolean;
  readonly missing: readonly string[];
}

export type CapabilityChangeType = 'registered' | 'updated' | 'removed' | 'reset';

export interface CapabilityChangeEvent {
  readonly type: CapabilityChangeType;
  readonly id: string | null;
  readonly revision: number;
  readonly at: number;
}

export type CapabilityListener = (event: CapabilityChangeEvent) => void;

export interface CapabilityRegistryDeps {
  readonly now?: () => number;
  /** Anlık DeviceTier. Provider'a BAĞLANMAZ (type-only) → dışarıdan enjekte edilir. */
  readonly deviceTier?: DeviceTier | (() => DeviceTier);
  /** Kanıt bundan eski (ms) ise stale. */
  readonly staleMs?: number;
  /** Başlangıç kataloğu tohumlansın mı (varsayılan: DEFAULT_CAPABILITY_CATALOG). */
  readonly seedCatalog?: readonly CapabilityDefinition[] | false;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler (politika — fizik magic number değil)
 * ════════════════════════════════════════════════════════════════════════ */

export const MAX_CAPABILITIES = 256;
export const MAX_CAPABILITY_LISTENERS = 32;
export const CAPABILITY_STALE_MS_DEFAULT = 60_000;
const MAX_DETAIL_KEYS = 16;
const MAX_LIMITATIONS = 8;
const MAX_TEXT_CHARS = 96;

/** available için minimum confidence; altı → degraded. */
export const MIN_AVAILABLE_CONFIDENCE = 0.5;
/** safety-critical writable kapısı. */
export const HIGH_CONFIDENCE = 0.85;

/** Authoritative kaynaklar (yardımcıdan üstün; safety-critical açabilir). */
const AUTHORITATIVE_SOURCES: ReadonlySet<CapabilitySource> = new Set([
  'native', 'can', 'obd', 'deep_scan', 'license', 'oem',
]);
/** Fiziksel donanım domain'leri — config TEK BAŞINA bunları açamaz. */
const HARDWARE_DOMAINS: ReadonlySet<CapabilityDomain> = new Set(['device', 'vehicle', 'vision']);

/** Kaynak temel confidence'ı (explicit confidence yoksa). */
const SOURCE_BASE_CONFIDENCE: Readonly<Record<CapabilitySource, number>> = {
  native: 0.98, deep_scan: 0.9, can: 0.9, obd: 0.85, license: 0.85, oem: 0.85,
  user: 0.6, network: 0.6, runtime: 0.6, inferred: 0.4, config: 0.3, none: 0,
};

const TIER_RANK: Readonly<Record<DeviceTier, number>> = { low: 0, mid: 1, high: 2 };

const VALID_DOMAINS: ReadonlySet<string> = new Set<CapabilityDomain>([
  'device', 'vehicle', 'connectivity', 'navigation', 'ai', 'vision',
  'media', 'remote', 'fleet', 'security', 'health', 'platform', 'oem',
]);
const VALID_STATUSES: ReadonlySet<string> = new Set<CapabilityStatus>([
  'available', 'unavailable', 'unknown', 'degraded', 'restricted', 'unsupported',
]);
const VALID_SOURCES: ReadonlySet<string> = new Set<CapabilitySource>([
  'native', 'can', 'obd', 'deep_scan', 'config', 'license',
  'runtime', 'network', 'user', 'oem', 'inferred', 'none',
]);
const VALID_QUALITIES: ReadonlySet<string> = new Set<CapabilityQuality>(['low', 'medium', 'high', 'unknown']);

/* ══════════════════════════════════════════════════════════════════════════
 * İlk katalog (statik tanımlar — kanıt yok → başlangıç `unknown`)
 * ════════════════════════════════════════════════════════════════════════ */

export const DEFAULT_CAPABILITY_CATALOG: readonly CapabilityDefinition[] = Object.freeze([
  // Device
  { id: 'device.gps', domain: 'device' },
  { id: 'device.microphone', domain: 'device' },
  { id: 'device.speaker', domain: 'device' },
  { id: 'device.bluetooth', domain: 'device' },
  { id: 'device.wifi', domain: 'device' },
  { id: 'device.cellular', domain: 'device' },
  { id: 'device.usb', domain: 'device' },
  { id: 'device.camera.front', domain: 'device' },
  { id: 'device.camera.rear', domain: 'device' },
  { id: 'device.npu', domain: 'device', deviceTierMinimum: 'high' },
  { id: 'device.gpu.advanced', domain: 'device', deviceTierMinimum: 'mid' },
  { id: 'device.storage.secure', domain: 'device' },
  // Vehicle
  { id: 'vehicle.obd', domain: 'vehicle' },
  { id: 'vehicle.can', domain: 'vehicle' },
  { id: 'vehicle.can_fd', domain: 'vehicle' },
  { id: 'vehicle.k_line', domain: 'vehicle' },
  { id: 'vehicle.uds', domain: 'vehicle' },
  { id: 'vehicle.j1939', domain: 'vehicle' },
  { id: 'vehicle.vin_read', domain: 'vehicle' },
  { id: 'vehicle.firmware_read', domain: 'vehicle' },
  { id: 'vehicle.live_pid', domain: 'vehicle' },
  { id: 'vehicle.did_discovery', domain: 'vehicle' },
  { id: 'vehicle.tpms', domain: 'vehicle' },
  { id: 'vehicle.ignition', domain: 'vehicle', safetyCritical: true },
  { id: 'vehicle.bidirectional', domain: 'vehicle', safetyCritical: true, writable: true, experimental: true },
  { id: 'vehicle.coding', domain: 'vehicle', safetyCritical: true, writable: true, experimental: true },
  { id: 'vehicle.adaptation', domain: 'vehicle', safetyCritical: true, writable: true, experimental: true },
  // Navigation
  { id: 'navigation.gps', domain: 'navigation' },
  { id: 'navigation.offline_map', domain: 'navigation' },
  { id: 'navigation.offline_routing', domain: 'navigation' },
  { id: 'navigation.live_traffic', domain: 'navigation' },
  { id: 'navigation.dead_reckoning', domain: 'navigation' },
  { id: 'navigation.lane_guidance', domain: 'navigation' },
  // AI
  { id: 'ai.offline_commands', domain: 'ai' },
  { id: 'ai.offline_conversation', domain: 'ai', deviceTierMinimum: 'mid' },
  { id: 'ai.cloud', domain: 'ai' },
  { id: 'ai.gemini', domain: 'ai' },
  { id: 'ai.groq', domain: 'ai' },
  { id: 'ai.claude', domain: 'ai' },
  { id: 'ai.grok', domain: 'ai', experimental: true },
  { id: 'ai.local_model', domain: 'ai', deviceTierMinimum: 'high' },
  { id: 'ai.safety_kernel', domain: 'ai', safetyCritical: true },
  // Vision
  { id: 'vision.dashcam', domain: 'vision' },
  { id: 'vision.front_camera', domain: 'vision' },
  { id: 'vision.rear_camera', domain: 'vision' },
  { id: 'vision.object_detection', domain: 'vision', deviceTierMinimum: 'mid' },
  { id: 'vision.lane_detection', domain: 'vision', deviceTierMinimum: 'mid' },
  // Remote
  { id: 'remote.cloud_commands', domain: 'remote' },
  { id: 'remote.local_ble', domain: 'remote' },
  { id: 'remote.local_wifi', domain: 'remote' },
  { id: 'remote.live_telemetry', domain: 'remote' },
  { id: 'remote.push_notifications', domain: 'remote' },
  // Platform
  { id: 'platform.deep_scan', domain: 'platform' },
  { id: 'platform.vehicle_learning', domain: 'platform' },
  { id: 'platform.assistant_context', domain: 'platform' },
  { id: 'platform.ota', domain: 'platform' },
  { id: 'platform.secure_storage', domain: 'platform' },
  { id: 'platform.offline_first', domain: 'platform' },
  // OEM / Fleet
  { id: 'oem.white_label', domain: 'oem' },
  { id: 'oem.factory_provisioning', domain: 'oem' },
  { id: 'fleet.multi_tenant', domain: 'fleet' },
  { id: 'fleet.driver_scoring', domain: 'fleet', experimental: true },
  { id: 'fleet.remote_diagnostics', domain: 'fleet' },
]);

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

const VIN_RE = /\b[A-HJ-NPR-Z0-9]{17}\b/g;
const MAC_RE = /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g;
const COORD_RE = /-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g;
const RAW_HEX_RE = /\b[0-9A-Fa-f]{8,}\b/g;
const SECRET_RE = /\b(?:sk|pk|api|key|token|bearer)[-_]?[A-Za-z0-9_-]{12,}\b/gi;

/** Gizlilik temizliği: VIN/MAC/koordinat/ham hex/secret → [redacted], kırpılır. SAF. */
function _sanitize(input: unknown, maxChars = MAX_TEXT_CHARS): string {
  if (typeof input !== 'string') return '';
  const cleaned = input
    .replace(SECRET_RE, '[redacted]')
    .replace(MAC_RE, '[redacted]')
    .replace(VIN_RE, '[redacted]')
    .replace(COORD_RE, '[redacted]')
    .replace(RAW_HEX_RE, '[redacted]')
    .trim();
  return cleaned.length > maxChars ? cleaned.slice(0, maxChars) : cleaned;
}

function _clamp01(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function _quality(v: unknown): CapabilityQuality {
  return typeof v === 'string' && VALID_QUALITIES.has(v) ? (v as CapabilityQuality) : 'unknown';
}

function _tier(v: unknown): DeviceTier {
  return v === 'low' || v === 'mid' || v === 'high' ? v : 'low';
}

function _textOrNull(v: unknown): string | null {
  const c = _sanitize(v);
  return c || null;
}

function _details(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  if (!v || typeof v !== 'object') return out;
  let n = 0;
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (n >= MAX_DETAIL_KEYS) break;
    const key = _sanitize(k, 40);
    const value = _sanitize(typeof val === 'string' ? val : String(val));
    if (key) { out[key] = value; n++; }
  }
  return out;
}

function _limitations(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const l of v) { if (out.length >= MAX_LIMITATIONS) break; const c = _sanitize(l); if (c) out.push(c); }
  return out;
}

function _freezeRecord(r: CapabilityRecord): CapabilityRecord {
  return Object.freeze({
    ...r,
    details: Object.freeze({ ...r.details }),
    limitations: Object.freeze([...r.limitations]),
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * SAF çözümleyici — tanım + kanıt(lar) → çözülmüş durum
 * ════════════════════════════════════════════════════════════════════════ */

interface ResolveOutcome {
  status: CapabilityStatus;
  available: boolean;
  quality: CapabilityQuality;
  confidence: number;
  source: CapabilitySource;
  provider: string | null;
  version: string | null;
  details: Record<string, string>;
  limitations: string[];
  stale: boolean;
  reason: string | null;
}

interface NormEvidence {
  source: CapabilitySource;
  available: boolean | null;
  quality: CapabilityQuality;
  confidence: number;
  stale: boolean;
  authoritative: boolean;
  provider: string | null;
  version: string | null;
  details: Record<string, string>;
  limitations: string[];
  reason: string | null;
}

function _normEvidence(ev: CapabilityEvidence, now: number, staleMs: number): NormEvidence | null {
  if (!ev || typeof ev !== 'object' || !VALID_SOURCES.has(ev.source)) return null;
  const observedAt = typeof ev.observedAt === 'number' && Number.isFinite(ev.observedAt) ? ev.observedAt : NaN;
  const age = Number.isFinite(observedAt) ? now - observedAt : 0; // observedAt yoksa taze say
  const stale = Number.isFinite(observedAt) ? (age < 0 || age > staleMs) : false;
  const confidence = ev.confidence !== undefined ? _clamp01(ev.confidence) : SOURCE_BASE_CONFIDENCE[ev.source];
  const authoritative = AUTHORITATIVE_SOURCES.has(ev.source) && ev.authoritative !== false;
  return {
    source: ev.source,
    available: ev.available === true ? true : ev.available === false ? false : null,
    quality: _quality(ev.quality),
    confidence,
    stale,
    authoritative,
    provider: _textOrNull(ev.provider),
    version: _textOrNull(ev.version),
    details: _details(ev.details),
    limitations: _limitations(ev.limitations),
    reason: _textOrNull(ev.reason),
  };
}

/**
 * Tanım + kanıt(lar) + tier → çözülmüş durum. Fail-closed: yeterli kanıt yoksa unknown.
 */
export function resolveCapabilityState(
  def: Pick<CapabilityRecord, 'domain' | 'deviceTierMinimum' | 'safetyCritical' | 'writable'>,
  evidences: readonly CapabilityEvidence[],
  deviceTier: DeviceTier,
  now: number,
  staleMs: number = CAPABILITY_STALE_MS_DEFAULT,
): ResolveOutcome {
  const base = (status: CapabilityStatus, reason: string, extra?: Partial<ResolveOutcome>): ResolveOutcome => ({
    status,
    available: status === 'available',
    quality: extra?.quality ?? 'unknown',
    confidence: extra?.confidence ?? 0,
    source: extra?.source ?? 'none',
    provider: extra?.provider ?? null,
    version: extra?.version ?? null,
    details: extra?.details ?? {},
    limitations: extra?.limitations ?? [],
    stale: extra?.stale ?? false,
    reason,
  });

  const norm: NormEvidence[] = [];
  if (Array.isArray(evidences)) for (const e of evidences) { const n = _normEvidence(e, now, staleMs); if (n) norm.push(n); }

  // Kanıt yok → unknown.
  const withDecision = norm.filter((e) => e.available !== null && e.source !== 'none');
  if (withDecision.length === 0) return base('unknown', 'no_evidence');

  // Config TEK BAŞINA fiziksel donanımı açamaz → hardware domain'de config'i düş.
  const isHardware = HARDWARE_DOMAINS.has(def.domain);
  const usable = withDecision.filter((e) => !(e.source === 'config' && isHardware));
  if (usable.length === 0) return base('unknown', 'config_only_hardware');

  // Stale olmayanlar onay için; hepsi stale ise → unknown + stale.
  const fresh = usable.filter((e) => !e.stale);
  if (fresh.length === 0) return base('unknown', 'stale_evidence', { stale: true });

  const positives = fresh.filter((e) => e.available === true);
  const negatives = fresh.filter((e) => e.available === false);
  const authPos = positives.filter((e) => e.authoritative);
  const authNeg = negatives.filter((e) => e.authoritative);

  // Çelişki: iki authoritative kaynak zıt → unknown (fail-closed).
  if (authPos.length > 0 && authNeg.length > 0) return base('unknown', 'conflict');

  // En güçlü kanıtı seç (authoritative önce, sonra confidence).
  const rank = (e: NormEvidence) => (e.authoritative ? 1000 : 0) + e.confidence;
  const best = fresh.slice().sort((a, b) => rank(b) - rank(a))[0];

  const merged: Partial<ResolveOutcome> = {
    quality: best.quality,
    confidence: best.confidence,
    source: best.source,
    provider: best.provider,
    version: best.version,
    details: best.details,
    limitations: best.limitations,
    stale: false,
  };

  // En güçlü kanıt "unavailable" diyorsa → unavailable.
  if (best.available === false) return base('unavailable', best.reason ?? 'reported_unavailable', merged);

  // best.available === true yolu.
  const conf = Math.max(...positives.map((e) => e.confidence), best.confidence);
  merged.confidence = conf;

  // DeviceTier minimumu karşılanmıyorsa → restricted (tier engeli).
  if (TIER_RANK[deviceTier] < TIER_RANK[def.deviceTierMinimum]) {
    return base('restricted', 'device_tier_minimum', { ...merged, confidence: conf });
  }

  // Safety-critical WRITABLE: yalnız authoritative + yüksek confidence.
  if (def.safetyCritical && def.writable) {
    if (!best.authoritative || conf < HIGH_CONFIDENCE) {
      return base('restricted', 'safety_critical_requires_authoritative_high_confidence', { ...merged, confidence: conf });
    }
  }
  // Safety-critical (yalnız-okuma dahil): tek zayıf inferred açamaz.
  if (def.safetyCritical && best.source === 'inferred' && conf < HIGH_CONFIDENCE) {
    return base('restricted', 'safety_critical_weak_inferred', { ...merged, confidence: conf });
  }

  // Confidence düşük veya kalite low → degraded (sınırlı çalışır).
  if (conf < MIN_AVAILABLE_CONFIDENCE || best.quality === 'low' || best.limitations.length > 0) {
    return base('degraded', best.reason ?? 'limited', { ...merged, confidence: conf });
  }

  return base('available', best.reason ?? 'confirmed', { ...merged, confidence: conf });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Registry
 * ════════════════════════════════════════════════════════════════════════ */

export class CapabilityRegistry {
  private readonly _now: () => number;
  private readonly _tierProvider: () => DeviceTier;
  private readonly _staleMs: number;

  private _caps = new Map<string, CapabilityRecord>();
  private readonly _listeners = new Set<CapabilityListener>();
  private _revision = 0;
  private _disposed = false;

  constructor(deps: CapabilityRegistryDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    const dt = deps.deviceTier;
    this._tierProvider = typeof dt === 'function' ? dt : () => _tier(dt ?? 'low');
    this._staleMs = typeof deps.staleMs === 'number' && deps.staleMs > 0 ? deps.staleMs : CAPABILITY_STALE_MS_DEFAULT;

    // Katalog tohumla (statik tanımlar → başlangıç `unknown`, KANIT YOK). Donanım probu YOK.
    const seed = deps.seedCatalog === undefined ? DEFAULT_CAPABILITY_CATALOG : deps.seedCatalog;
    if (seed) for (const d of seed) this._seedDefinition(d);
  }

  /* ── Dahili ──────────────────────────────────────────────────────────── */

  private _nowSafe(): number {
    try { const n = this._now(); return Number.isFinite(n) ? n : 0; } catch { return 0; }
  }

  private _tier(): DeviceTier {
    try { return _tier(this._tierProvider()); } catch { return 'low'; }
  }

  private _seedDefinition(d: CapabilityDefinition): void {
    if (!d || typeof d.id !== 'string' || !d.id || !VALID_DOMAINS.has(d.domain)) return;
    if (this._caps.has(d.id) || this._caps.size >= MAX_CAPABILITIES) return;
    const now = this._nowSafe();
    this._caps.set(d.id, _freezeRecord({
      id: d.id, domain: d.domain, status: 'unknown', available: false, quality: 'unknown',
      confidence: 0, source: 'none', provider: null, version: null, details: {}, limitations: [],
      firstSeen: now, lastSeen: now, updatedAt: now, stale: false, reason: 'no_evidence',
      deviceTierMinimum: _tier(d.deviceTierMinimum ?? 'low'),
      safetyCritical: d.safetyCritical === true, writable: d.writable === true, experimental: d.experimental === true,
    }));
  }

  private _emit(type: CapabilityChangeType, id: string | null): void {
    if (this._disposed || this._listeners.size === 0) return;
    const event: CapabilityChangeEvent = Object.freeze({ type, id, revision: this._revision, at: this._nowSafe() });
    for (const l of [...this._listeners]) {
      try { l(event); } catch (err) { console.error('[CapabilityRegistry] dinleyici hatası — servis etkilenmedi', err); }
    }
  }

  private _changed(before: CapabilityRecord | undefined, after: CapabilityRecord): boolean {
    if (!before) return true;
    return before.status !== after.status || before.available !== after.available ||
      before.confidence !== after.confidence || before.source !== after.source ||
      before.quality !== after.quality || before.reason !== after.reason;
  }

  /* ── Public API ──────────────────────────────────────────────────────── */

  /** Capability kaydeder/DETERMINISTIK birleştirir (aynı id → merge, duplicate yok). */
  registerCapability(input: CapabilityInput): CapabilityRecord | null {
    if (this._disposed) return null;
    if (!input || typeof input.id !== 'string' || !input.id || !VALID_DOMAINS.has(input.domain)) return null;
    const now = this._nowSafe();
    const prev = this._caps.get(input.id);
    if (!prev && this._caps.size >= MAX_CAPABILITIES) return null; // bounded

    const status = typeof input.status === 'string' && VALID_STATUSES.has(input.status) ? input.status : (prev?.status ?? 'unknown');
    const record: CapabilityRecord = _freezeRecord({
      id: input.id,
      domain: input.domain,
      status,
      available: status === 'available',
      quality: input.quality !== undefined ? _quality(input.quality) : (prev?.quality ?? 'unknown'),
      confidence: input.confidence !== undefined ? _clamp01(input.confidence) : (prev?.confidence ?? 0),
      source: typeof input.source === 'string' && VALID_SOURCES.has(input.source) ? input.source : (prev?.source ?? 'none'),
      provider: input.provider !== undefined ? _textOrNull(input.provider) : (prev?.provider ?? null),
      version: input.version !== undefined ? _textOrNull(input.version) : (prev?.version ?? null),
      details: input.details !== undefined ? _details(input.details) : (prev?.details ?? {}),
      limitations: input.limitations !== undefined ? _limitations(input.limitations) : (prev ? [...prev.limitations] : []),
      firstSeen: prev?.firstSeen ?? now,
      lastSeen: now,
      updatedAt: now,
      stale: input.stale === true,
      reason: input.reason !== undefined ? _textOrNull(input.reason) : (prev?.reason ?? null),
      deviceTierMinimum: input.deviceTierMinimum !== undefined ? _tier(input.deviceTierMinimum) : (prev?.deviceTierMinimum ?? 'low'),
      safetyCritical: input.safetyCritical !== undefined ? input.safetyCritical === true : (prev?.safetyCritical ?? false),
      writable: input.writable !== undefined ? input.writable === true : (prev?.writable ?? false),
      experimental: input.experimental !== undefined ? input.experimental === true : (prev?.experimental ?? false),
    });
    this._caps.set(record.id, record);
    if (this._changed(prev, record)) { this._revision++; this._emit(prev ? 'updated' : 'registered', record.id); }
    return record;
  }

  /** Kısmi güncelleme (yalnız verilen alanlar). Değişmezse event yok. */
  updateCapability(id: string, patch: Partial<CapabilityInput>): CapabilityRecord | null {
    if (this._disposed) return null;
    const prev = this._caps.get(id);
    if (!prev) return null;
    return this.registerCapability({ ...prev, ...patch, id: prev.id, domain: patch.domain ?? prev.domain });
  }

  /**
   * Kanıt(lar)ı değerlendirip capability durumunu çözer (fail-closed karar kuralları).
   * Kayıt yoksa domain'i çıkaramayacağı için kanıt `domain` içermeli; aksi hâlde null.
   */
  resolveCapability(id: string, evidence: CapabilityEvidence | readonly CapabilityEvidence[], domain?: CapabilityDomain): CapabilityRecord | null {
    if (this._disposed || typeof id !== 'string' || !id) return null;
    const prev = this._caps.get(id);
    const dom = prev?.domain ?? domain;
    if (!dom || !VALID_DOMAINS.has(dom)) return null;
    if (!prev && this._caps.size >= MAX_CAPABILITIES) return null;

    const evidences = Array.isArray(evidence) ? evidence : [evidence as CapabilityEvidence];
    const now = this._nowSafe();
    const def = {
      domain: dom,
      deviceTierMinimum: prev?.deviceTierMinimum ?? 'low' as DeviceTier,
      safetyCritical: prev?.safetyCritical ?? false,
      writable: prev?.writable ?? false,
    };
    const out = resolveCapabilityState(def, evidences, this._tier(), now, this._staleMs);

    const record: CapabilityRecord = _freezeRecord({
      id, domain: dom, status: out.status, available: out.available, quality: out.quality,
      confidence: out.confidence, source: out.source, provider: out.provider, version: out.version,
      details: out.details, limitations: out.limitations,
      firstSeen: prev?.firstSeen ?? now, lastSeen: now, updatedAt: now, stale: out.stale, reason: out.reason,
      deviceTierMinimum: def.deviceTierMinimum, safetyCritical: def.safetyCritical, writable: def.writable,
      experimental: prev?.experimental ?? false,
    });
    this._caps.set(id, record);
    if (this._changed(prev, record)) { this._revision++; this._emit(prev ? 'updated' : 'registered', id); }
    return record;
  }

  removeCapability(id: string): boolean {
    if (this._disposed) return false;
    if (!this._caps.delete(id)) return false;
    this._revision++;
    this._emit('removed', id);
    return true;
  }

  getCapability(id: string): CapabilityRecord | null {
    const r = this._caps.get(id);
    return r ?? null; // zaten frozen
  }

  hasCapability(id: string): boolean {
    return this._caps.has(id);
  }

  /** Yalnız status==='available' → true (degraded/restricted/unknown → false, fail-closed). */
  isAvailable(id: string): boolean {
    return this._caps.get(id)?.status === 'available';
  }

  getStatus(id: string): CapabilityStatus {
    return this._caps.get(id)?.status ?? 'unknown';
  }

  getConfidence(id: string): number {
    return this._caps.get(id)?.confidence ?? 0;
  }

  listCapabilities(filter?: (r: CapabilityRecord) => boolean): CapabilityRecord[] {
    const all = [...this._caps.values()];
    const filtered = typeof filter === 'function' ? all.filter((r) => { try { return filter(r); } catch { return false; } }) : all;
    return filtered.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  listByDomain(domain: CapabilityDomain): CapabilityRecord[] {
    return this.listCapabilities((r) => r.domain === domain);
  }

  /** Gereksinim kümesini değerlendirir. */
  evaluateRequirements(requirements: readonly CapabilityRequirement[]): RequirementResult {
    const missing: string[] = [];
    if (Array.isArray(requirements)) {
      for (const req of requirements) {
        if (!req || typeof req.id !== 'string') continue;
        const rec = this._caps.get(req.id);
        const okStatus = req.mustBeAvailable === false ? rec?.status !== 'unavailable' && rec?.status !== 'unsupported' : rec?.status === 'available';
        const okConf = typeof req.minConfidence === 'number' ? (rec?.confidence ?? 0) >= req.minConfidence : true;
        if (!rec || !okStatus || !okConf) missing.push(req.id);
      }
    }
    return Object.freeze({ satisfied: missing.length === 0, missing: Object.freeze(missing) });
  }

  /** Neden available değil — kısa, temizlenmiş açıklama. */
  explainUnavailable(id: string): string {
    const rec = this._caps.get(id);
    if (!rec) return 'not_registered';
    if (rec.status === 'available') return 'available';
    return rec.reason ?? rec.status;
  }

  createSnapshot(): CapabilitySnapshot {
    const capabilities = this.listCapabilities(); // sıralı (cold-path)
    let available = 0, unavailable = 0, unknown = 0, degraded = 0;
    for (const c of capabilities) {
      if (c.status === 'available') available++;
      else if (c.status === 'unavailable' || c.status === 'unsupported') unavailable++;
      else if (c.status === 'degraded') degraded++;
      else unknown++; // unknown + restricted
    }
    return Object.freeze({
      revision: this._revision,
      generatedAt: this._nowSafe(),
      deviceTier: this._tier(),
      capabilities: Object.freeze(capabilities),
      availableCount: available,
      unavailableCount: unavailable,
      unknownCount: unknown,
      degradedCount: degraded,
    });
  }

  subscribe(listener: CapabilityListener): () => void {
    if (this._disposed || typeof listener !== 'function') return () => { /* no-op */ };
    if (!this._listeners.has(listener) && this._listeners.size >= MAX_CAPABILITY_LISTENERS) return () => { /* no-op */ };
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  get listenerCount(): number {
    return this._listeners.size;
  }

  get size(): number {
    return this._caps.size;
  }

  /** Tüm capability'leri sıfırlar (kataloğu YENİDEN tohumlamaz — boş kalır). */
  reset(): void {
    if (this._disposed) return;
    this._caps = new Map();
    this._revision++;
    this._emit('reset', null);
  }

  dispose(): void {
    if (this._disposed) return;
    this._listeners.clear();
    this._caps = new Map();
    this._disposed = true;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

/**
 * Fabrika — DI ile örnek üretir. Yapıcı yalnız statik kataloğu tohumlar (donanım probu/
 * timer/abonelik/native çağrı YOK) → import + oluşturma davranış değiştirmez.
 */
export function createCapabilityRegistry(deps: CapabilityRegistryDeps = {}): CapabilityRegistry {
  return new CapabilityRegistry(deps);
}

/**
 * Uygulama geneli tekil registry. Katalog `unknown` olarak tohumlu; hiçbir provider'a
 * BAĞLI DEĞİL → gerçek kanıt gelene kadar her capability `unknown` (fail-closed).
 * SystemBoot'a bağlı değildir; hardware provider wiring + persistence + OEM config
 * AYRI PR'lardır.
 */
export const capabilityRegistry = new CapabilityRegistry();
