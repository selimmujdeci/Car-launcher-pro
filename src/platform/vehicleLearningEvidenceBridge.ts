/**
 * vehicleLearningEvidenceBridge — Öğrenme Kanıtı Yazma Köprüsü (P2-6).
 *
 * AMAÇ: Vehicle Learning Evidence Store'u runtime öğrenme akışına GÜVENLİ bağlar. P2-1→P2-5
 * katmanları kuruldu ama Evidence Store'a runtime yazıcı YOKtu → learning rozetleri / Expert
 * özeti / diagnostic learning context BOŞ kalıyordu. Bu köprü eksik write-path'i bağlar:
 *
 *   Vehicle Knowledge Base (autoLearningEngine ile beslenir — SALT-OKUNUR gözlenir)
 *       ↓  discovery/VID değişimi (debounce'lu tetik)
 *   vehicleLearningEngine.computeEvidence()   (VKB → LearningEvidence, formül DEĞİŞMEZ)
 *       ↓
 *   vehicleLearningEvidenceStore.save(ev)     (idempotent reproject — aşağıya bkz.)
 *       ↓
 *   Pattern Engine / Integration Service list() ile okur → Dashboard/Expert/Diagnostic dolar.
 *
 * NEDEN save() (upsert DEĞİL): computeEvidence() VKB'nin TAM KÜMÜLATİF projeksiyonudur
 * (her çağrı güncel bütün gerçeği verir). Store'un `upsert`i delta-toplayıcıdır
 * (observationCount'u EKLER) → aynı projeksiyonu tekrar yazınca sayacı ŞİŞİRİR. `save`
 * (overwrite, createdAt korunur, confidence/status P1 formülüyle yeniden hesap) idempotenttir:
 * VKB büyüdükçe observationCount doğru artar, tekrar yazımda şişmez, vehicleCount distinct
 * kalır. Store'un merge davranışı/formülü DEĞİŞTİRİLMEZ — yalnız uygun mevcut metod seçilir.
 *
 * KESİN SINIRLAR (CLAUDE.md): confidence/decay/pattern-promotion FORMÜLLERİ DEĞİŞMEZ ·
 * Discovery capture/queue · Fingerprint · Auto Learning · VKB · Manufacturer Intelligence ·
 * Diagnostic safety/severity/driveSafe · PID/DID registry DEĞİŞMEZ. Cloud/SQL/LLM/Native YOK.
 * 3Hz OBD HOT-PATH'e GİRMEZ (yalnız discovery/knowledge değişiminde, debounce'lu, cold-path).
 * bounded (store 512 LRU) · throttle'lı yazma · fail-soft (hata OBD/Discovery'ye SIZMAZ) ·
 * zero-leak dispose (flush + unsubscribe).
 */

import { vehicleLearningEngine } from './vehicleLearningEngine';
import { vehicleLearningEvidenceStore } from './vehicleLearningEvidenceStore';
import { discoveryCaptureService } from './obd/discovery';
import { useVidStore } from '../store/useVidStore';
import { getDeviceTier, type DeviceTier } from './deviceCapabilities';
import { type LearningEvidence } from './vehicleLearningEngine';

/* ══════════════════════════════════════════════════════════════════════════
 * Sabitler
 * ════════════════════════════════════════════════════════════════════════ */

/** Debounce (ms) — BALANCED/HIGH: normal cold-path yazımı. */
export const BRIDGE_DEBOUNCE_MS_NORMAL = 8_000;
/** Debounce (ms) — BASIC_JS(low): daha SEYREK (düşük-uçta CPU/IO tasarrufu). */
export const BRIDGE_DEBOUNCE_MS_LOW = 20_000;

/** Bir değişim kaynağına abone olan fonksiyon (unsub döndürür). */
export type BridgeSubscribeSource = (cb: () => void) => (() => void) | void;

/** Enjekte edilebilir zamanlayıcı (test determinizmi + Node/DOM uyumu). */
export interface BridgeTimer {
  set:   (cb: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const DEFAULT_TIMER: BridgeTimer = {
  set:   (cb, ms) => setTimeout(cb, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** Varsayılan değişim kaynakları — discovery gözlemi + VID (kimlik) değişimi. */
const DEFAULT_SOURCES: BridgeSubscribeSource[] = [
  (cb) => discoveryCaptureService.subscribe(cb),
  (cb) => useVidStore.subscribe(cb),
];

export interface BridgeDeps {
  /** VKB'den LearningEvidence üretir (varsayılan P2-1 motoru). */
  computeEvidence?: () => LearningEvidence[];
  /** Bir kanıtı depoya YAZAR (varsayılan store.save — idempotent reproject). */
  writeEvidence?:   (ev: LearningEvidence) => void;
  /** Değişim kaynakları (varsayılan discovery + VID). */
  subscribeSources?: BridgeSubscribeSource[];
  /** Cihaz tier okuyucu (debounce seçimi). */
  tier?:            () => DeviceTier;
  /** Zamanlayıcı (test için enjekte edilebilir). */
  timer?:           BridgeTimer;
  /** Debounce süreleri (override). */
  debounceNormalMs?: number;
  debounceLowMs?:    number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Köprü
 * ════════════════════════════════════════════════════════════════════════ */

export class VehicleLearningEvidenceBridge {
  private readonly _computeEvidence: () => LearningEvidence[];
  private readonly _writeEvidence:   (ev: LearningEvidence) => void;
  private readonly _sources:         BridgeSubscribeSource[];
  private readonly _tier:            () => DeviceTier;
  private readonly _timer:           BridgeTimer;
  private readonly _debounceNormalMs: number;
  private readonly _debounceLowMs:    number;

  private _unsubs: Array<() => void> = [];
  private _handle: unknown = null;
  private _started = false;
  private _disposed = false;
  private _projecting = false;
  private _lastWriteCount = 0;

  constructor(deps: BridgeDeps = {}) {
    this._computeEvidence = deps.computeEvidence ?? (() => vehicleLearningEngine.computeEvidence());
    this._writeEvidence   = deps.writeEvidence   ?? ((ev) => { vehicleLearningEvidenceStore.save(ev); });
    this._sources         = deps.subscribeSources ?? DEFAULT_SOURCES;
    this._tier            = deps.tier ?? (() => getDeviceTier());
    this._timer           = deps.timer ?? DEFAULT_TIMER;
    this._debounceNormalMs = deps.debounceNormalMs ?? BRIDGE_DEBOUNCE_MS_NORMAL;
    this._debounceLowMs    = deps.debounceLowMs ?? BRIDGE_DEBOUNCE_MS_LOW;
  }

  /**
   * Değişim kaynaklarına abone olur (İDEMPOTENT — ikinci start duplicate abonelik açmaz).
   * Boot'ta ağır iş yapmamak için ilk projeksiyon da debounce'lu planlanır. Döndürülen
   * fonksiyon köprüyü durdurur.
   */
  start(): () => void {
    if (this._started) return () => this.stop(); // idempotent
    this._started = true;
    this._disposed = false;
    for (const sub of this._sources) {
      try {
        const u = sub(() => this._schedule());
        if (typeof u === 'function') this._unsubs.push(u);
      } catch { /* tek kaynak hatası diğerlerini etkilemez (fail-soft) */ }
    }
    this._schedule(); // ilk projeksiyonu (debounce'lu) planla
    return () => this.stop();
  }

  private _debounceMs(): number {
    let t: DeviceTier = 'high';
    try { t = this._tier(); } catch { t = 'high'; }
    return t === 'low' ? this._debounceLowMs : this._debounceNormalMs;
  }

  /** Debounce'lu tetik — art arda sinyaller TEK projeksiyona indirgenir (disk yazımı sınırlı). */
  private _schedule(): void {
    if (this._disposed) return;
    if (this._handle !== null) this._timer.clear(this._handle);
    this._handle = this._timer.set(() => { this._handle = null; this._project(); }, this._debounceMs());
  }

  /** Bekleyen projeksiyonu HEMEN çalıştırır (debounce beklemeden). */
  flush(): void {
    if (this._handle !== null) { this._timer.clear(this._handle); this._handle = null; }
    this._project();
  }

  /** VKB → evidence projeksiyonu + depoya yazım. Reentry-safe · FAIL-SOFT (upstream'e sızmaz). */
  private _project(): void {
    if (this._projecting) return; // reentry guard
    this._projecting = true;
    try {
      const list = this._computeEvidence() ?? [];
      let written = 0;
      for (const ev of list) {
        try {
          if (ev && typeof ev === 'object' && typeof ev.evidenceId === 'string' && ev.evidenceId) {
            this._writeEvidence(ev);
            written++;
          }
        } catch { /* tek kayıt hatası diğerlerini etkilemez */ }
      }
      this._lastWriteCount = written;
    } catch {
      /* köprü hatası OBD/Discovery akışına SIZMAZ (fail-soft) */
    } finally {
      this._projecting = false;
    }
  }

  /** Abonelikleri bırakır + zamanlayıcıyı temizler (yazım YAPMAZ). */
  stop(): void {
    for (const u of this._unsubs) { try { u(); } catch { /* yoksay */ } }
    this._unsubs = [];
    if (this._handle !== null) { this._timer.clear(this._handle); this._handle = null; }
    this._started = false;
  }

  /** Kapanışta: bekleyen projeksiyonu FLUSH et, sonra abonelikleri bırak (zero-leak). */
  dispose(): void {
    if (this._disposed) return;
    this._disposed = true;
    if (this._handle !== null) { this._timer.clear(this._handle); this._handle = null; }
    this._project(); // final flush
    for (const u of this._unsubs) { try { u(); } catch { /* yoksay */ } }
    this._unsubs = [];
    this._started = false;
  }

  /** Son projeksiyonda yazılan kanıt sayısı (gözlemlenebilirlik). */
  get lastWriteCount(): number { return this._lastWriteCount; }
  /** Köprü aktif mi. */
  get isRunning(): boolean { return this._started; }
}

/* ── Uygulama geneli tekil köprü + boot wiring ────────────────────────────── */

/** Uygulama geneli tekil köprü. */
export const vehicleLearningEvidenceBridge = new VehicleLearningEvidenceBridge();

/**
 * SystemBoot cold-path wiring — köprüyü başlatır (idempotent). Döndürülen fonksiyon durdurur
 * (SystemBoot `_reg` ile kaydeder → kapanışta stop). Kapanışta kalıcı flush için `dispose()`
 * çağrılabilir; stop() abonelik/timer sızıntısını önler.
 */
export function startVehicleLearningEvidenceBridge(): () => void {
  return vehicleLearningEvidenceBridge.start();
}
