/**
 * capabilityProviderAdapter — Gerçek runtime/cihaz/platform kanıtlarını Capability
 * Registry kayıtlarına aktaran SALT-OKUNUR provider adapter — FOUNDATION.
 *
 * AKIŞ: (gerçek runtime kanıtları) → Capability Provider Adapter → Capability Registry.
 *
 * ⚠️ KOD GERÇEĞİ (salt-okunur analiz): Doğrulanabilir gerçek kaynaklar sınırlı —
 *  - `deviceCapabilities` (WebGL/CSS/SAB/cores/memory browser probe'ları) → device/platform.
 *  - `vehicleHal.getCapability/hasSignal` → araç sinyali desteği (foundation'da hepsi false).
 *  - Browser/native API: gps(navigator.geolocation)/microphone/bluetooth/storage → yalnız
 *    "API var" der, gerçek donanım erişimini KESİNLEŞTİRMEZ (→ düşük confidence/degraded).
 *  - Config/lisans: oem.* · ai.gemini/groq/claude (BYOK anahtarı) → source=config/license.
 *  - **Runtime kaynağı HİÇ YOK:** `vehicle.ignition` (kontak kaynağı yok), `ai.grok` (xAI
 *    entegrasyonu yok), `navigation.offline_map` (tile paketi yoksa) → unknown/unavailable KALIR.
 *  UI/dosya/modül varlığı capability kanıtı DEĞİLDİR.
 *
 * NE YAPMAZ (bilinçli — bu PR yalnız provider FOUNDATION'ıdır):
 *  - Donanımı DOĞRUDAN TARAMAZ: yalnız DI ile verilen `providers`'ı okur. Foundation'da
 *    YERLEŞİK gerçek provider YOK (gerçek prob'lar ayrı wiring PR'ında). Import YAN ETKİSİZDİR
 *    (provider yalnız `start()`/`refresh()`'te çalışır; yapıcı hiçbir provider çağırmaz).
 *  - Event Bus'a YAYINLAMAZ · SystemBoot'a BAĞLANMAZ · UI/SQL/persistence/cloud YOK ·
 *    native tarama/OBD-CAN sorgusu BAŞLATMAZ. Capability Registry'nin KARAR KURALLARINI
 *    değiştirmez (yalnız kanıt besler; status'ü Registry çözer). Registry'nin SAHİBİ DEĞİL:
 *    `dispose()` Registry'yi dispose ETMEZ.
 *
 * KARAR: Kaynağı olmayan capability available YAPILMAZ (fail-closed). Stale/timeout/hata →
 * güvenli unknown. Çelişki Registry'de unknown/degraded olur. ZERO-LEAK: `dispose()` durumu
 * kilitler (steady-state timer YOK; timeout yalnız opt-in ve settle'da temizlenir). FAIL-SOFT:
 * bir provider hatası diğerlerini durdurmaz; public API throw ETMEZ.
 */

import type {
  CapabilityDomain, CapabilityStatus, CapabilitySource, CapabilityQuality,
  CapabilityEvidence, CapabilityRecord,
} from './capabilityRegistry';

/* ══════════════════════════════════════════════════════════════════════════
 * Provider sözleşmesi + DI hedefleri
 * ════════════════════════════════════════════════════════════════════════ */

export type CapabilityRefreshPolicy = 'once' | 'on_demand' | 'on_refresh';

/** Provider'ın döndürdüğü ham sonuç (Registry evidence'ına normalize edilir). */
export interface CapabilityProviderResult {
  readonly status?: CapabilityStatus;
  readonly available?: boolean;
  readonly quality?: CapabilityQuality;
  readonly confidence?: number;
  readonly source?: CapabilitySource;
  readonly provider?: string;
  readonly version?: string;
  readonly details?: Record<string, unknown>;
  readonly limitations?: readonly string[];
  readonly observedAt?: number;
  readonly reason?: string;
}

export interface CapabilityProvider {
  readonly id: string;
  readonly domain: CapabilityDomain;
  readonly source: CapabilitySource;
  readonly authoritative?: boolean;
  readonly refreshPolicy?: CapabilityRefreshPolicy;
  /** Gerçek kanıt okuma (sync veya async). Kaynak yoksa null döner. */
  readonly read: () => CapabilityProviderResult | null | Promise<CapabilityProviderResult | null>;
}

/** Registry hedefi (DI) — gerçek CapabilityRegistry yapısal olarak uyar. */
export interface CapabilityRegistryTarget {
  resolveCapability(
    id: string,
    evidence: CapabilityEvidence | readonly CapabilityEvidence[],
    domain?: CapabilityDomain,
  ): CapabilityRecord | null;
  getCapability(id: string): CapabilityRecord | null;
}

export interface CapabilityProviderAdapterDeps {
  readonly registry: CapabilityRegistryTarget;
  readonly providers: readonly CapabilityProvider[];
  readonly now?: () => number;
  /** Opt-in provider okuma timeout'u (ms). 0/undefined → timeout yok (senkron beklenir). */
  readonly timeoutMs?: number;
}

export interface CapabilityProviderAdapterStatus {
  readonly started: boolean;
  readonly disposed: boolean;
  readonly lastRefreshAt: number | null;
  readonly providerCount: number;
  readonly resolvedCount: number;
  readonly refreshCount: number;
}

export const MAX_CAPABILITY_PROVIDERS = 128;
const MAX_TEXT_CHARS = 96;

/* ══════════════════════════════════════════════════════════════════════════
 * Saf yardımcılar
 * ════════════════════════════════════════════════════════════════════════ */

function _clamp01(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function _text(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v
    .replace(/\b(?:sk|pk|api|key|token|bearer)[-_]?[A-Za-z0-9_-]{12,}\b/gi, '[redacted]')
    .replace(/\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g, '[redacted]')
    .replace(/\b[A-HJ-NPR-Z0-9]{17}\b/g, '[redacted]')
    .replace(/-?\d{1,3}\.\d{4,}\s*[,;]\s*-?\d{1,3}\.\d{4,}/g, '[redacted]')
    .trim();
  const c = s.length > MAX_TEXT_CHARS ? s.slice(0, MAX_TEXT_CHARS) : s;
  return c || null;
}

/** Dedup imzası — sonuç değişmediyse Registry update yapılmaz. */
function _signature(r: CapabilityProviderResult): string {
  return `${r.status ?? ''}|${r.available ?? ''}|${r.source ?? ''}|${r.quality ?? ''}|${_clamp01(r.confidence)}|${r.reason ?? ''}`;
}

/** Sonucu güvenli/dondurulmuş dış-referanssız kopyaya çevirir (getProviderResults için). */
function _freezeResult(r: CapabilityProviderResult): CapabilityProviderResult {
  const details: Record<string, string> = {};
  if (r.details && typeof r.details === 'object') {
    let n = 0;
    for (const [k, v] of Object.entries(r.details)) {
      if (n >= 12) break;
      const val = _text(typeof v === 'string' ? v : String(v));
      if (val) { details[k] = val; n++; }
    }
  }
  return Object.freeze({
    status: r.status,
    available: r.available,
    quality: r.quality,
    confidence: r.confidence !== undefined ? _clamp01(r.confidence) : undefined,
    source: r.source,
    provider: _text(r.provider) ?? undefined,
    version: _text(r.version) ?? undefined,
    details: Object.freeze(details),
    limitations: Object.freeze((Array.isArray(r.limitations) ? r.limitations.map((l) => _text(l) ?? '').filter(Boolean) : []).slice(0, 8)),
    observedAt: r.observedAt,
    reason: _text(r.reason) ?? undefined,
  });
}

/** Provider sonucunu Registry evidence'ına çevirir (status → available hint). */
function _toEvidence(prov: CapabilityProvider, r: CapabilityProviderResult, now: number): CapabilityEvidence {
  const available = r.available !== undefined ? r.available
    : r.status === 'available' ? true
    : (r.status === 'unavailable' || r.status === 'unsupported') ? false
    : undefined;
  return {
    source: r.source ?? prov.source,
    available,
    quality: r.quality,
    confidence: r.confidence,
    observedAt: r.observedAt ?? now,
    provider: r.provider ?? prov.id,
    version: r.version,
    details: r.details,
    limitations: r.limitations,
    reason: r.reason,
    authoritative: prov.authoritative,
  };
}

function _withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  if (!(ms > 0)) return p;
  return new Promise<T>((resolve) => {
    let done = false;
    const timer = setTimeout(() => { if (!done) { done = true; resolve(onTimeout()); } }, ms);
    p.then(
      (v) => { if (!done) { done = true; clearTimeout(timer); resolve(v); } },
      () => { if (!done) { done = true; clearTimeout(timer); resolve(onTimeout()); } },
    );
  });
}

const TIMEOUT_MARKER = Symbol('capability_provider_timeout');

/* ══════════════════════════════════════════════════════════════════════════
 * Adapter
 * ════════════════════════════════════════════════════════════════════════ */

export class CapabilityProviderAdapter {
  private readonly _registry: CapabilityRegistryTarget;
  private readonly _providers: CapabilityProvider[] = [];
  private readonly _now: () => number;
  private readonly _timeoutMs: number;

  private readonly _last = new Map<string, string>();          // id → son sonuç imzası (dedup)
  private readonly _results = new Map<string, CapabilityProviderResult>(); // id → son dondurulmuş sonuç
  private _started = false;
  private _disposed = false;
  private _lastRefreshAt: number | null = null;
  private _refreshCount = 0;

  constructor(deps: CapabilityProviderAdapterDeps) {
    this._registry = deps.registry;
    this._now = typeof deps.now === 'function' ? deps.now : () => Date.now();
    this._timeoutMs = typeof deps.timeoutMs === 'number' && deps.timeoutMs > 0 ? deps.timeoutMs : 0;
    // Duplicate id engelle + bounded.
    const seen = new Set<string>();
    for (const p of Array.isArray(deps.providers) ? deps.providers : []) {
      if (!p || typeof p.id !== 'string' || !p.id || typeof p.read !== 'function') continue;
      if (seen.has(p.id) || this._providers.length >= MAX_CAPABILITY_PROVIDERS) continue;
      seen.add(p.id);
      this._providers.push(p);
    }
  }

  private _nowSafe(): number {
    try { const n = this._now(); return Number.isFinite(n) ? n : 0; } catch { return 0; }
  }

  /** Store aboneliği YOK — start yalnız ilk refresh'i tetikler. İDEMPOTENT. */
  start(): void {
    if (this._disposed || this._started) return;
    this._started = true;
    void this.refresh();
  }

  /** Tüm provider'ları okuyup (paralel, biri diğerini bloke etmez) Registry'ye çözer. */
  async refresh(): Promise<void> {
    if (this._disposed) return;
    this._refreshCount++;
    this._lastRefreshAt = this._nowSafe();
    await Promise.allSettled(this._providers.map((p) => this._runProvider(p)));
  }

  async refreshProvider(id: string): Promise<void> {
    if (this._disposed) return;
    const p = this._providers.find((x) => x.id === id);
    if (p) await this._runProvider(p);
  }

  private async _runProvider(prov: CapabilityProvider): Promise<void> {
    if (this._disposed) return;
    let result: CapabilityProviderResult | null;
    try {
      const raw = this._timeoutMs > 0
        ? await _withTimeout(Promise.resolve().then(() => prov.read()), this._timeoutMs, () => TIMEOUT_MARKER as never)
        : await prov.read();
      if ((raw as unknown) === TIMEOUT_MARKER) {
        result = { source: 'none', reason: 'provider_timeout' };  // timeout → güvenli unknown
      } else {
        result = raw && typeof raw === 'object' ? raw : { source: 'none', reason: 'provider_no_result' };
      }
    } catch {
      result = { source: 'none', reason: 'provider_error' };       // hata → güvenli unknown, izole
    }
    if (this._disposed) return;

    // Dedup: sonuç değişmediyse Registry update YOK.
    const sig = _signature(result);
    if (this._last.get(prov.id) === sig) return;
    this._last.set(prov.id, sig);
    this._results.set(prov.id, _freezeResult(result));

    // Registry'ye çöz (karar kuralları Registry'de — status'ü Registry belirler). Hata izole.
    try {
      this._registry.resolveCapability(prov.id, _toEvidence(prov, result, this._nowSafe()), prov.domain);
    } catch { /* Registry update hatası diğer provider'ları engellemez */ }
  }

  getStatus(): CapabilityProviderAdapterStatus {
    return Object.freeze({
      started: this._started,
      disposed: this._disposed,
      lastRefreshAt: this._lastRefreshAt,
      providerCount: this._providers.length,
      resolvedCount: this._results.size,
      refreshCount: this._refreshCount,
    });
  }

  getLastRefreshAt(): number | null {
    return this._lastRefreshAt;
  }

  /** Son provider sonuçları (dondurulmuş kopyalar — iç referans vermez). */
  getProviderResults(): Record<string, CapabilityProviderResult> {
    const out: Record<string, CapabilityProviderResult> = {};
    for (const [id, r] of this._results) out[id] = r; // öğeler zaten frozen
    return out;
  }

  /** Dedup/sonuç durumunu sıfırlar (provider listesi korunur). */
  reset(): void {
    if (this._disposed) return;
    this._last.clear();
    this._results.clear();
  }

  /** Aboneliği bırakır (İDEMPOTENT). */
  stop(): void {
    this._started = false;
  }

  /** Zero-leak: durumu kilitler. Registry çağıranındır → dispose EDİLMEZ. */
  dispose(): void {
    if (this._disposed) return;
    this._started = false;
    this._last.clear();
    this._results.clear();
    this._disposed = true;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

/**
 * Fabrika — DI ile örnek üretir. Yapıcı YAN ETKİSİZ: provider ÇAĞRILMAZ, native/registry
 * dokunulmaz (yalnız `start()`/`refresh()`'te çalışır) → import edilmesi davranış değiştirmez.
 */
export function createCapabilityProviderAdapter(deps: CapabilityProviderAdapterDeps): CapabilityProviderAdapter {
  return new CapabilityProviderAdapter(deps);
}
