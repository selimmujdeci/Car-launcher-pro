/**
 * deepScanIgnitionSource — Deep Scan için GÜVENLİ, deterministik Ignition (kontak)
 * kaynak çözümleyici FOUNDATION katmanı.
 *
 * NEDEN VAR: Deep Scan Runtime'ın üç durumlu `ignitionConfirmed` alanı (`true`/`false`/
 * `null=bilinmiyor`) yalnız dışarıdan beslenir. Bu katman o beslemeyi mevcut araç
 * sinyallerinden GÜVENLİ ve deterministik biçimde üretecek SÖZLEŞMEYİ ve saf
 * çözümleyiciyi kurar.
 *
 * ⚠️ KOD GERÇEĞİ (salt-okunur denetim, 2026-07-11): Bu depoda **doğrudan kontak/ACC/
 * key-state yayan HİÇBİR kaynak YOKTUR.**
 *  - VAL `NormalizedVehicleData` (valTypes.ts): speed/reverse/fuel/rpm/coolant/oil/
 *    throttle/batteryVolt/gearPos/ambient/location/heading/distance/tpms — kontak YOK.
 *  - Hiworld CAN protokolü (HiworldProtocolParser.java): DOOR/AC/SPEED/RPM/TEMPS/FUEL/
 *    GEAR/LIGHTS/SAFETY/REVERSE/THROTTLE/BATT_VOLT/TYRE — açık ACC/IGN komutu YOK.
 *  - NativeHAL (AAOS VHAL plugin): speed/rpm/fuel/coolant/gear — ignition alanı YOK.
 *  - `useAssistantContextStore`: `status.ignition` = null, "kontak durumu yayan sinyal YOK".
 *  - `commandExecutor.ignitionOn`: yalnız remote-command parametresi (OBD PID 0x01 yorumu),
 *    gerçek store kaynağı yok.
 * Bu yüzden bu katman kontağı **ASLA tek yardımcı sinyalden ÇIKARSAMAZ**; yalnız
 * AUTHORITATIVE (doğrudan) kaynaklar onay verir. Gerçek doğrudan kaynak (native ACC /
 * CAN ignition / motor-çalışıyor) ileride eklenince bu sözleşmeye AYNEN oturur.
 *
 * GÜVENLİK İLKESİ (fail-closed): Kontak KESİN doğrulanamıyorsa `unknown` → `confirmed=null`.
 * Tehlikeli tekil varsayım YASAK: "hız>0 → açık" · "RPM>0 → ON" · "voltaj yüksek → ON" ·
 * "OBD bağlı → kontak açık" — bunların HİÇBİRİ tek başına ON üretmez. Fizik eşiği
 * (RPM/voltaj) UYDURULMAZ: yardımcı sinyaller çağıran tarafından bool'a yorumlanıp
 * `engine_running` gibi AUTHORITATIVE bir kanıt olarak sunulur; bu katman ham sayıya
 * eşik uygulamaz (zero-trust telemetry).
 *
 * NE YAPMAZ: `deepScanRuntimeService`'e OTOMATİK BAĞLANMAZ · SystemBoot wiring YOK ·
 * native OBD/CAN'e dokunmaz · polling timer AÇMAZ · yeni bağımlılık EKLEMEZ · import
 * edilmesi YAN ETKİSİZDİR. Yalnız ileride orchestration PR'ının kullanacağı temiz
 * adapter API'si (`getConfirmedValue(): boolean | null`) sunar.
 *
 * ZERO-LEAK: `dispose()` tüm dinleyicileri/kanıtları bırakır; sonrası güvenli no-op.
 * FAIL-SOFT: kaynak/dinleyici hatası servisi çökertmez; tüm public API throw ETMEZ.
 */

import { sanitizeText } from './deepScanModel';

/* ══════════════════════════════════════════════════════════════════════════
 * Tipler
 * ════════════════════════════════════════════════════════════════════════ */

export type IgnitionState = 'on' | 'off' | 'unknown';

export type IgnitionEvidenceSource =
  | 'native_acc'       // doğrudan native ACC/key-state (AUTHORITATIVE) — henüz kaynak yok
  | 'can_ignition'     // doğrudan CAN ignition sinyali (AUTHORITATIVE) — henüz kaynak yok
  | 'engine_running'   // motor çalışıyor (AUTHORITATIVE, çağıran birleşik kanıttan türetir)
  | 'rpm'              // yardımcı — tek başına ONAY VERMEZ
  | 'alternator'       // yardımcı — tek başına ONAY VERMEZ
  | 'battery_voltage'  // yardımcı — tek başına ONAY VERMEZ
  | 'obd_transport'    // yardımcı (OBD ECU yanıtı) — tek başına ONAY VERMEZ
  | 'manual'           // yalnız developer/test override (AUTHORITATIVE, prod'da kapalı)
  | 'none';            // sentinel — kanıt yok

/** Tek bir kontak kanıtı. `value`: on=true · off=false · bilinmiyor=null. */
export interface IgnitionEvidence {
  readonly source: IgnitionEvidenceSource;
  readonly value: boolean | null;
  /** 0..1 güvenilirlik (VAL confidence modeli ile uyumlu). */
  readonly confidence: number;
  /** Ölçüm zamanı — `Date.now()` ms (VAL IVehicleSignal.ts ile aynı taban). */
  readonly observedAt: number;
  /** Resolver hesaplar; çağıran zorlayabilir (yaş > eşik veya saat geriye → true). */
  readonly stale?: boolean;
  /** Doğrudan kontak/motor göstergesi mi. Yalnız inherently-authoritative kaynaklar
   *  true olabilir; yardımcı kaynak `true` verse bile ONAY VEREMEZ (güvenlik). */
  readonly authoritative?: boolean;
  readonly reason?: string | null;
}

/** Dondurulmuş kontak durumu anlık görüntüsü — ham/gizli alan içermez. */
export interface IgnitionSnapshot {
  readonly state: IgnitionState;
  /** Deep Scan `ignitionConfirmed` eşlemesi: on→true · off→false · unknown→null. */
  readonly confirmed: boolean | null;
  readonly confidence: number;
  readonly primarySource: IgnitionEvidenceSource;
  readonly evidence: readonly IgnitionEvidence[];
  readonly updatedAt: number;
  readonly stale: boolean;
  readonly reason: string | null;
}

export type IgnitionListener = (snapshot: IgnitionSnapshot) => void;

/** Kanıt sağlayıcı (pull) — `refresh()` çağırır; fail-soft try/catch ile sarılır. */
export type IgnitionEvidenceProvider = () => IgnitionEvidence | null;

export interface DeepScanIgnitionDeps {
  readonly now?: () => number;
  /** Kanıt bundan eski (ms) ise stale → onay için kullanılmaz. */
  readonly maxAgeMs?: number;
  /** Authoritative kanıtın onay verebilmesi için minimum confidence. */
  readonly minConfidence?: number;
  /** Manual override PRODUCTION'da VARSAYILAN KAPALI — yalnız dev/test için true. */
  readonly allowManualOverride?: boolean;
  /** İsteğe bağlı pull sağlayıcılar (foundation'da yok — orchestration PR'ı sağlar). */
  readonly providers?: readonly IgnitionEvidenceProvider[];
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler (politika — fizik magic number DEĞİL)
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Stale eşiği. Gerekçe: VAL `SIGNAL_SOURCE_DEFAULTS` timeout'ları (HAL/CAN 3000 ·
 * OBD 2000 · GPS/FUSED 5000). En geniş sınır (5000) dış tazelik kapısı olarak alınır;
 * daha eski kontak kanıtı ONAY için KULLANILMAZ. Bir fizik eşiği değil, tazelik politikası.
 */
export const IGNITION_STALE_MS_DEFAULT = 5000;

/**
 * Authoritative kanıtın onay için gereken min confidence. Gerekçe: VAL base confidence
 * (OBD 0.85 · CAN 0.92 · HAL 0.98). 0.7 kapısı; taze doğrudan kaynak geçer, zayıf/çürümüş
 * kanıt geçmez. Politika sabiti (cihazda ayarlanabilir), fizik magic number değil.
 */
export const IGNITION_MIN_CONFIDENCE_DEFAULT = 0.7;

/** Bounded: en fazla bu kadar kanıt tutulur (kaynak türü sayısı zaten sınırlı). */
export const MAX_IGNITION_EVIDENCE = 16;
/** Bounded: en fazla dinleyici (Set semantiğiyle duplicate zaten engellenir). */
export const MAX_IGNITION_LISTENERS = 32;
/** Reason metni üst sınırı. */
const MAX_REASON_CHARS = 96;

/** Hangi kaynaklar İÇSEL olarak authoritative (onay verebilir). */
const AUTHORITATIVE_BY_SOURCE: Readonly<Record<IgnitionEvidenceSource, boolean>> = {
  native_acc:      true,
  can_ignition:    true,
  engine_running:  true,
  manual:          true,
  rpm:             false,
  alternator:      false,
  battery_voltage: false,
  obd_transport:   false,
  none:            false,
};

/** Kaynak önceliği (yüksek→düşük). primarySource seçiminde ve sıralamada kullanılır. */
const SOURCE_PRIORITY: readonly IgnitionEvidenceSource[] = [
  'native_acc', 'can_ignition', 'engine_running', 'manual',
  'rpm', 'alternator', 'battery_voltage', 'obd_transport', 'none',
];
const _PRIORITY_INDEX: Readonly<Record<string, number>> = SOURCE_PRIORITY.reduce(
  (acc, s, i) => { acc[s] = i; return acc; },
  {} as Record<string, number>,
);

const VALID_SOURCES: ReadonlySet<string> = new Set<IgnitionEvidenceSource>(SOURCE_PRIORITY);

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _clamp01(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function _boolOrNull(v: unknown): boolean | null {
  return v === true ? true : v === false ? false : null;
}

function _reason(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const c = sanitizeText(v, MAX_REASON_CHARS);
  return c || null;
}

/**
 * Ham kanıtı normalize + stale hesabıyla dondurur. `now` ile yaş: negatif (saat geriye)
 * veya > maxAge → stale. Yardımcı kaynak ASLA authoritative olamaz (güvenlik).
 */
function _normalizeEvidence(ev: IgnitionEvidence, now: number, maxAgeMs: number): IgnitionEvidence | null {
  if (!ev || typeof ev !== 'object') return null;
  if (!VALID_SOURCES.has(ev.source) || ev.source === 'none') return null;
  const observedAt = typeof ev.observedAt === 'number' && Number.isFinite(ev.observedAt) ? ev.observedAt : NaN;
  const age = Number.isFinite(observedAt) ? now - observedAt : Infinity;
  // Saat geriye sıçradıysa (age<0) negatif yaş üretme → stale (fail-closed).
  const computedStale = !Number.isFinite(observedAt) || age < 0 || age > maxAgeMs;
  const stale = ev.stale === true ? true : computedStale;
  const authoritative = AUTHORITATIVE_BY_SOURCE[ev.source] && ev.authoritative !== false;
  return Object.freeze({
    source: ev.source,
    value: _boolOrNull(ev.value),
    confidence: _clamp01(ev.confidence),
    observedAt: Number.isFinite(observedAt) ? observedAt : now,
    stale,
    authoritative,
    reason: _reason(ev.reason),
  });
}

function _priority(s: IgnitionEvidenceSource): number {
  return _PRIORITY_INDEX[s] ?? SOURCE_PRIORITY.length;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SAF çözümleyici
 * ════════════════════════════════════════════════════════════════════════ */

export interface ResolveConfig {
  readonly maxAgeMs?: number;
  readonly minConfidence?: number;
}

/**
 * Kanıt listesinden kontak durumunu deterministik + fail-closed çözer.
 *  - Taze + authoritative + confidence≥min + value≠null kanıtlar "usable".
 *  - usable yok → `unknown` (yardımcı kanıt tek başına ONAY VERMEZ).
 *  - usable içinde hem on hem off → ÇELİŞKİ → `unknown`.
 *  - hepsi hemfikir → o durum; primarySource en yüksek öncelikli usable kaynak.
 * Girdi mutate EDİLMEZ; çıktı dondurulmuş.
 */
export function resolveIgnitionState(
  evidences: readonly IgnitionEvidence[],
  now: number,
  cfg: ResolveConfig = {},
): IgnitionSnapshot {
  const maxAgeMs = typeof cfg.maxAgeMs === 'number' && cfg.maxAgeMs > 0 ? cfg.maxAgeMs : IGNITION_STALE_MS_DEFAULT;
  const minConf = typeof cfg.minConfidence === 'number' ? _clamp01(cfg.minConfidence) : IGNITION_MIN_CONFIDENCE_DEFAULT;

  const normalized: IgnitionEvidence[] = [];
  if (Array.isArray(evidences)) {
    for (const raw of evidences) {
      if (normalized.length >= MAX_IGNITION_EVIDENCE) break;
      const n = _normalizeEvidence(raw, now, maxAgeMs);
      if (n) normalized.push(n);
    }
  }
  // Deterministik sıralama (öncelik → kaynak adı).
  normalized.sort((a, b) => _priority(a.source) - _priority(b.source));
  const frozenEvidence = Object.freeze(normalized.map((e) => e)); // öğeler zaten frozen

  const usable = normalized.filter(
    (e) => e.authoritative && !e.stale && e.confidence >= minConf && e.value !== null,
  );

  const build = (
    state: IgnitionState,
    confirmed: boolean | null,
    confidence: number,
    primarySource: IgnitionEvidenceSource,
    stale: boolean,
    reason: string | null,
  ): IgnitionSnapshot => Object.freeze({
    state, confirmed, confidence, primarySource,
    evidence: frozenEvidence, updatedAt: now, stale, reason,
  });

  if (usable.length === 0) {
    // Authoritative kanıt vardı ama stale/zayıf mı → stale=true; hiç yoktu → false.
    const hadAuthButUnusable = normalized.some((e) => e.authoritative && e.value !== null);
    return build('unknown', null, 0, 'none', hadAuthButUnusable,
      hadAuthButUnusable ? 'stale_or_low_confidence' : 'no_authoritative_evidence');
  }

  const hasOn = usable.some((e) => e.value === true);
  const hasOff = usable.some((e) => e.value === false);
  if (hasOn && hasOff) {
    // İki güvenilir authoritative kaynak çelişiyor → fail-closed unknown.
    return build('unknown', null, 0, 'none', false, 'conflict');
  }

  const state: IgnitionState = hasOn ? 'on' : 'off';
  // usable zaten öncelik sırasında (normalized sıralı) → ilki en yüksek öncelikli.
  const primary = usable[0];
  const confidence = usable.reduce((m, e) => (e.confidence > m ? e.confidence : m), 0);
  return build(state, state === 'on', confidence, primary.source, false, primary.reason ?? null);
}

/** Boş/başlangıç anlık görüntüsü. */
function _emptySnapshot(now: number): IgnitionSnapshot {
  return Object.freeze({
    state: 'unknown', confirmed: null, confidence: 0, primarySource: 'none',
    evidence: Object.freeze([]), updatedAt: now, stale: false, reason: 'no_authoritative_evidence',
  });
}

/* ══════════════════════════════════════════════════════════════════════════
 * Servis
 * ════════════════════════════════════════════════════════════════════════ */

export class DeepScanIgnitionSource {
  private readonly _now: () => number;
  private readonly _maxAgeMs: number;
  private readonly _minConfidence: number;
  private readonly _allowManual: boolean;
  private readonly _providers: readonly IgnitionEvidenceProvider[];

  /** source → son kanıt (kaynak başına tek → doğal bounded). */
  private _evidence = new Map<IgnitionEvidenceSource, IgnitionEvidence>();
  private _manual: boolean | null = null;
  private readonly _listeners = new Set<IgnitionListener>();
  private _snapshot: IgnitionSnapshot | null = null;
  private _disposed = false;

  constructor(deps: DeepScanIgnitionDeps = {}) {
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._maxAgeMs = typeof deps.maxAgeMs === 'number' && deps.maxAgeMs > 0 ? deps.maxAgeMs : IGNITION_STALE_MS_DEFAULT;
    this._minConfidence = typeof deps.minConfidence === 'number' ? _clamp01(deps.minConfidence) : IGNITION_MIN_CONFIDENCE_DEFAULT;
    this._allowManual = deps.allowManualOverride === true;
    this._providers = Array.isArray(deps.providers) ? deps.providers.slice(0, MAX_IGNITION_EVIDENCE) : [];
  }

  /* ── Dahili ──────────────────────────────────────────────────────────── */

  private _nowSafe(): number {
    try { const n = this._now(); return Number.isFinite(n) ? n : 0; } catch { return 0; }
  }

  private _collectEvidence(now: number): IgnitionEvidence[] {
    const list: IgnitionEvidence[] = [...this._evidence.values()];
    if (this._allowManual && this._manual !== null) {
      list.push({ source: 'manual', value: this._manual, confidence: 1, observedAt: now, authoritative: true, reason: 'manual_override' });
    }
    return list;
  }

  private _recompute(emit: boolean): IgnitionSnapshot {
    const now = this._nowSafe();
    const next = resolveIgnitionState(this._collectEvidence(now), now, {
      maxAgeMs: this._maxAgeMs,
      minConfidence: this._minConfidence,
    });
    const prev = this._snapshot;
    this._snapshot = next;
    // Yalnız anlamlı değişimde yay (gürültü önleme): state/confirmed/primarySource.
    const changed = !prev || prev.state !== next.state || prev.confirmed !== next.confirmed || prev.primarySource !== next.primarySource;
    if (emit && changed) this._emit(next);
    return next;
  }

  private _emit(snapshot: IgnitionSnapshot): void {
    if (this._disposed || this._listeners.size === 0) return;
    for (const listener of [...this._listeners]) {
      try { listener(snapshot); }
      catch (err) { console.error('[DeepScanIgnition] dinleyici hatası — servis etkilenmedi', err); }
    }
  }

  /* ── Public API ──────────────────────────────────────────────────────── */

  /** Dışarıdan kanıt ekler (push). Aynı kaynağın önceki kanıtını değiştirir. */
  submitEvidence(evidence: IgnitionEvidence): IgnitionSnapshot {
    if (this._disposed) return this.getSnapshot();
    const now = this._nowSafe();
    const n = _normalizeEvidence(evidence, now, this._maxAgeMs);
    if (n) this._evidence.set(n.source, n);
    return this._recompute(true);
  }

  /** Sağlayıcılardan kanıt çeker (pull, fail-soft) + yeniden hesaplar. İDEMPOTENT. */
  refresh(): IgnitionSnapshot {
    if (this._disposed) return this.getSnapshot();
    const now = this._nowSafe();
    for (const provider of this._providers) {
      let ev: IgnitionEvidence | null = null;
      try { ev = provider(); } catch { ev = null; } // kaynak hatası izole
      const n = ev ? _normalizeEvidence(ev, now, this._maxAgeMs) : null;
      if (n) this._evidence.set(n.source, n);
    }
    return this._recompute(true);
  }

  getSnapshot(): IgnitionSnapshot {
    if (this._snapshot) return this._snapshot;
    // İlk okuma: mevcut kanıtla hesapla (yan etkisiz — provider ÇAĞIRMAZ).
    if (this._evidence.size === 0 && !(this._allowManual && this._manual !== null)) {
      this._snapshot = _emptySnapshot(this._nowSafe());
      return this._snapshot;
    }
    return this._recompute(false);
  }

  /** Deep Scan adapter API'si — `ignitionConfirmed` beslemesi (orchestration PR'ı kullanır). */
  getConfirmedValue(): boolean | null {
    return this.getSnapshot().confirmed;
  }

  /**
   * Developer/test override. PRODUCTION'da varsayılan KAPALI (`allowManualOverride`
   * false ise etkisiz). `null` → override kaldırılır.
   */
  setManualOverride(value: boolean | null): IgnitionSnapshot {
    if (this._disposed) return this.getSnapshot();
    this._manual = value === true ? true : value === false ? false : null;
    return this._recompute(true);
  }

  subscribe(listener: IgnitionListener): () => void {
    if (this._disposed || typeof listener !== 'function') return () => { /* no-op */ };
    if (!this._listeners.has(listener) && this._listeners.size >= MAX_IGNITION_LISTENERS) {
      return () => { /* no-op */ };
    }
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  get listenerCount(): number {
    return this._listeners.size;
  }

  /** Kanıtları ve manual override'ı sıfırlar. Dinleyiciler KORUNUR. */
  reset(): void {
    if (this._disposed) return;
    this._evidence = new Map();
    this._manual = null;
    this._snapshot = null;
  }

  /** Zero-leak temizlik. Sonrası her API güvenli no-op. */
  dispose(): void {
    if (this._disposed) return;
    this._evidence = new Map();
    this._manual = null;
    this._listeners.clear();
    this._snapshot = null;
    this._disposed = true;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

/**
 * Fabrika — bağımlılık enjeksiyonu ile örnek üretir. Yapıcı YAN ETKİSİZ (timer yok,
 * provider ÇAĞRILMAZ, native/store dokunulmaz) → import edilmesi hiçbir davranış değiştirmez.
 */
export function createDeepScanIgnitionSource(deps: DeepScanIgnitionDeps = {}): DeepScanIgnitionSource {
  return new DeepScanIgnitionSource(deps);
}

/**
 * Uygulama geneli tekil kaynak. Sağlayıcı YOK (foundation) · manual override KAPALI →
 * `getConfirmedValue()` daima `null` döner ta ki orchestration PR'ı gerçek kaynak besleyene
 * kadar. `deepScanRuntimeService`'e BAĞLI DEĞİLDİR.
 */
export const deepScanIgnitionSource = new DeepScanIgnitionSource();
