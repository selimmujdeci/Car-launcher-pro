/**
 * deepScanRuntimeService — Deep Scan runtime FOUNDATION katmanı.
 *
 * NE YAPAR: Deep Scan sürecinin DURUMUNU, İLERLEMESİNİ, KEŞİF SAYAÇLARINI,
 * OLAYLARINI ve GÜVENLİ ÇALIŞMA KOŞULLARINI yönetir.
 *
 * NE YAPMAZ (bilinçli — bu PR foundation'dır):
 *  - Gerçek ECU/PID/DID taraması BAŞLATMAZ. Araca TEK BİR sorgu bile göndermez.
 *  - Hiçbir discovery/OBD/fingerprint/learning servisini import ETMEZ → import
 *    edildiğinde YAN ETKİ ÜRETMEZ (timer yok, abonelik yok, native çağrı yok).
 *  - SystemBoot'a bağlanmaz (yanlışlıkla araca aktif sorgu gitmesin).
 *  - Kalıcı tarama geçmişi TUTMAZ (`hasCompletedScanBefore` çağırandan gelir).
 *    Kalıcılık ayrı PR kapsamıdır.
 *
 * KONTAK GÜVENLİĞİ (fail-closed): Bu depoda kontak/ACC durumunu yayan GERÇEK bir
 * kaynak YOK. `ignitionConfirmed` üç durumlu (`true`/`false`/`null=bilinmiyor`) ve
 * yalnız `setIgnitionConfirmed()` ile DIŞARIDAN beslenir — servis kontağı ASLA
 * tahmin etmez. `true` DEĞİLSE: aktif faz (araca sorgu) açılmaz, keşif kaydı kabul
 * edilmez; yalnız offline fazlar (analiz/rapor) çalışır.
 *
 * PERFORMANS: timer YOK, abonelik YOK, hot-path YOK. Pasifken (tarama yokken) yük
 * sıfırdır — API çağrılmadıkça hiçbir kod çalışmaz. Tüm koleksiyonlar bounded.
 *
 * GİZLİLİK: snapshot'a ham VIN · MAC · koordinat · ham CAN frame · API key/secret
 * GİRMEZ. ECU adresleri yalnız DEDUP anahtarı olarak bellekte tutulur, snapshot'a
 * yalnız SAYIM olarak yansır. Serbest metinler (`warnings`, `errorCode`, rapor notu)
 * `sanitizeText()` süzgecinden geçer.
 *
 * ZERO-LEAK: `dispose()` tüm dinleyicileri ve koleksiyonları temizler; sonrasında
 * her API çağrısı güvenli no-op'tur (dangling referans snapshot yayınlayamaz).
 */

import {
  isActivePhase,
  isCriticalPhase,
  isTerminalStatus,
  monotonicProgress,
  normalizeFingerprintHash,
  normalizeIgnition,
  resolveIsFirstScan,
  resolveScanMode,
  sanitizeText,
  canRunPhase,
  MAX_LISTENERS,
  MAX_WARNINGS,
  PHASE_PROGRESS_FLOOR,
  type ChangeDetectionInput,
  type CompleteDeepScanInput,
  type DeepScanEvent,
  type DeepScanEventType,
  type DeepScanListener,
  type DeepScanMode,
  type DeepScanPhase,
  type DeepScanReportSummary,
  type DeepScanSnapshot,
  type DeepScanStatus,
  type EcuDiscoveryInput,
  type FirmwareResultInput,
  type SignalDiscoveryInput,
  type StartDeepScanInput,
} from './deepScanModel';

/** Dedup anahtar kümesi tavanı (DiscoveryCaptureService ile aynı mertebe). */
export const MAX_DISCOVERY_KEYS = 4096;

/** Enjekte edilebilir bağımlılıklar (test için; prod varsayılanı sistem saati). */
export interface DeepScanRuntimeDeps {
  now: () => number;
}

const DEFAULT_DEPS: DeepScanRuntimeDeps = { now: () => Date.now() };

/** Normalize edilmiş hex kimliği (dedup anahtarı). Boş/geçersiz → ''. */
function normHex(v: unknown): string {
  if (typeof v !== 'string') return '';
  return v.trim().toUpperCase().replace(/\s+/g, '').replace(/^0X/, '');
}

/** Bounded Set ekleme. @returns gerçekten YENİ eklendi mi (duplicate → false). */
function addBounded(set: Set<string>, key: string): boolean {
  if (!key) return false;
  if (set.has(key)) return false;
  if (set.size >= MAX_DISCOVERY_KEYS) return false; // tavan: sayaç şişmez, sızıntı yok
  set.add(key);
  return true;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Servis
 * ════════════════════════════════════════════════════════════════════════ */

export class DeepScanRuntimeService {
  private readonly _deps: DeepScanRuntimeDeps;
  private readonly _listeners = new Set<DeepScanListener>();

  private _disposed = false;
  private _scanCounter = 0;

  /* ── Durum ─────────────────────────────────────────────────────────────── */
  private _scanId: string | null = null;
  private _hash: string | null = null;
  private _status: DeepScanStatus = 'idle';
  private _mode: DeepScanMode | null = null;
  private _phase: DeepScanPhase | null = null;
  private _progress = 0;
  private _startedAt: number | null = null;
  private _updatedAt: number | null = null;
  private _completedAt: number | null = null;
  private _isFirstScan = true;
  private _ignition: boolean | null = null;
  private _changedFirmware = false;
  private _changedEcu = false;
  private _firmwareChecked = 0;
  private _errorCode: string | null = null;
  private _report: DeepScanReportSummary | null = null;
  private _warnings: string[] = [];

  /** `pauseScan()` öncesi durum — `resumeScan()` buraya döner. */
  private _resumeStatus: DeepScanStatus | null = null;

  /* ── Keşif dedup kümeleri (snapshot'a yalnız SAYIM olarak yansır) ──────── */
  private _ecus = new Set<string>();
  private _pids = new Set<string>();
  private _dids = new Set<string>();
  private _newKeys = new Set<string>();

  /** Dondurulmuş snapshot önbelleği — durum değişince geçersizleşir. */
  private _snapshot: DeepScanSnapshot | null = null;

  constructor(deps: Partial<DeepScanRuntimeDeps> = {}) {
    this._deps = { ...DEFAULT_DEPS, ...deps };
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Dahili yardımcılar
   * ════════════════════════════════════════════════════════════════════ */

  private _now(): number {
    try { return this._deps.now(); } catch { return 0; }
  }

  /** Tarama şu an mutasyon kabul ediyor mu (başlamış + terminal değil + canlı). */
  private _isMutable(): boolean {
    return !this._disposed && this._scanId !== null && !isTerminalStatus(this._status);
  }

  /** Uyarı ekler (temizlenmiş + bounded, en eskisi düşer). Olay YAYINLAMAZ. */
  private _warn(message: string): void {
    const clean = sanitizeText(message);
    if (!clean) return;
    this._warnings.push(clean);
    if (this._warnings.length > MAX_WARNINGS) {
      this._warnings.splice(0, this._warnings.length - MAX_WARNINGS);
    }
    this._snapshot = null;
  }

  private _touch(): void {
    this._updatedAt = this._now();
    this._snapshot = null;
  }

  /** Dinleyicilere olay yayınlar. Bir dinleyicinin hatası servisi ÇÖKERTMEZ. */
  private _emit(type: DeepScanEventType, reason?: string): void {
    if (this._disposed || this._listeners.size === 0) return;
    const event: DeepScanEvent = Object.freeze({
      type,
      at: this._now(),
      snapshot: this.getSnapshot(),
      reason: reason ? sanitizeText(reason) : null,
    });
    // Kopya üstünde dön: dinleyici içinde unsubscribe çağrılırsa iterasyon bozulmaz.
    for (const listener of [...this._listeners]) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[DeepScan] dinleyici hatası (${type}) — servis etkilenmedi`, err);
        this._warn(`listener_error:${type}`); // raporlanır, olay YENİDEN yayılmaz
      }
    }
  }

  /** Kontak doğrulanmadan aktif işe girişildi → beklemeye al + uyarı + olay. */
  private _requireIgnition(context: string): void {
    this._warn(`ignition_not_confirmed:${context}`);
    if (this._status !== 'waiting_for_ignition') {
      this._status = 'waiting_for_ignition';
      this._touch();
    }
    this._emit('ignition_required', context);
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Snapshot (immutable)
   * ════════════════════════════════════════════════════════════════════ */

  getSnapshot(): DeepScanSnapshot {
    if (this._snapshot) return this._snapshot;
    this._snapshot = Object.freeze({
      scanId:                 this._scanId,
      vehicleFingerprintHash: this._hash,
      status:                 this._status,
      mode:                   this._mode,
      phase:                  this._phase,
      progressPercent:        this._progress,
      startedAt:              this._startedAt,
      updatedAt:              this._updatedAt,
      completedAt:            this._completedAt,
      isFirstScan:            this._isFirstScan,
      ignitionRequired:       true, // aktif fazlar için daima kontak gerekir
      ignitionConfirmed:      this._ignition,
      discoveredEcuCount:     this._ecus.size,
      discoveredPidCount:     this._pids.size,
      discoveredDidCount:     this._dids.size,
      newDiscoveriesCount:    this._newKeys.size,
      changedFirmware:        this._changedFirmware,
      changedEcu:             this._changedEcu,
      warnings:               Object.freeze([...this._warnings]),
      errorCode:              this._errorCode,
      reportSummary:          this._report,
    });
    return this._snapshot;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Yaşam döngüsü
   * ════════════════════════════════════════════════════════════════════ */

  /**
   * Taramayı başlatır. İDEMPOTENT: `idle` dışındaki bir durumda çağrılırsa
   * hiçbir şey değişmez (yeni scanId üretilmez) — yeniden başlatmak için önce
   * `reset()` çağrılmalıdır.
   *
   * Mod: daha önce tamamlanmış tarama YOKSA `FULL_SCAN`, VARSA `CHANGE_CHECK`
   * (aynı araca her bağlantıda tam tarama yapılmaz — vizyon kuralı).
   *
   * Kontak `true` değilse durum `waiting_for_ignition` olur ve `ignition_required`
   * yayınlanır; aktif tarama OTOMATİK BAŞLAMAZ.
   */
  startScan(input: StartDeepScanInput = {}): DeepScanSnapshot {
    if (this._disposed) return this.getSnapshot();
    if (this._status !== 'idle') return this.getSnapshot(); // idempotent

    const now = this._now();
    this._scanCounter += 1;
    this._scanId      = `scan-${now}-${this._scanCounter}`;
    this._hash        = normalizeFingerprintHash(input.vehicleFingerprintHash);
    if (input.vehicleFingerprintHash !== undefined && this._hash === null) {
      this._warn('invalid_fingerprint_hash'); // VIN/serbest metin reddedildi
    }
    this._mode        = resolveScanMode(input.hasCompletedScanBefore);
    this._isFirstScan = resolveIsFirstScan(input.hasCompletedScanBefore);
    this._ignition    = normalizeIgnition(input.ignitionConfirmed);
    this._phase       = null;
    this._progress    = 0;
    this._startedAt   = now;
    this._updatedAt   = now;
    this._completedAt = null;
    this._errorCode   = null;
    this._report      = null;
    this._resumeStatus = null;
    this._status      = this._ignition === true ? 'preparing' : 'waiting_for_ignition';
    this._snapshot    = null;

    this._emit('scan_started');
    if (this._ignition !== true) this._emit('ignition_required', 'start');
    return this.getSnapshot();
  }

  /**
   * Kontak durumunu DIŞARIDAN besler — servisin kontağı öğrenebileceği TEK yol.
   * `boolean` dışındaki her değer `null` (bilinmiyor) sayılır.
   *
   * `true` olunca beklemedeki tarama `preparing`'e geçer. `true` olmaktan çıkınca
   * aktif fazdaki tarama `waiting_for_ignition`'a düşer (araca sorgu kesilir).
   */
  setIgnitionConfirmed(value: boolean | null, reason?: string): DeepScanSnapshot {
    if (this._disposed) return this.getSnapshot();
    const next = normalizeIgnition(value);
    if (next === this._ignition) return this.getSnapshot();
    this._ignition = next;
    this._touch();

    if (!this._isMutable()) return this.getSnapshot();

    if (next === true) {
      if (this._status === 'waiting_for_ignition') {
        this._status = 'preparing';
        this._touch();
        this._emit('scan_resumed', reason ?? 'ignition_confirmed');
      }
    } else if (this._status === 'scanning' || this._status === 'preparing') {
      // Kontak kaybedildi → aktif sorgu gerektiren durumdan çık (fail-closed).
      this._status = 'waiting_for_ignition';
      this._touch();
      this._emit('ignition_required', reason ?? 'ignition_lost');
    }
    return this.getSnapshot();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Faz / ilerleme
   * ════════════════════════════════════════════════════════════════════ */

  /**
   * Fazı günceller. Aktif faz (araca sorgu gönderen) yalnız kontak doğrulanmışsa
   * kabul edilir; aksi hâlde faz DEĞİŞMEZ, durum `waiting_for_ignition` olur.
   * Offline fazlar (analiz/rapor) kontak kapalıyken de çalışır.
   */
  updatePhase(phase: DeepScanPhase): DeepScanSnapshot {
    if (!this._isMutable()) return this.getSnapshot();
    if (this._status === 'paused') return this.getSnapshot(); // önce resume

    if (!canRunPhase(phase, this._ignition)) {
      this._requireIgnition(`phase:${phase}`);
      return this.getSnapshot();
    }

    const before = this._progress;
    this._phase    = phase;
    this._progress = monotonicProgress(this._progress, PHASE_PROGRESS_FLOOR[phase]);
    this._status   = isActivePhase(phase) ? 'scanning' : 'analyzing';
    this._touch();

    this._emit('phase_changed', phase);
    if (this._progress !== before) this._emit('progress_changed', phase);
    return this.getSnapshot();
  }

  /**
   * Ölçülmüş ilerleme bildirir. [0,100] clamp + MONOTONİK (geriye düşmez).
   * Sahte ilerleme üretilmez — değer çağırandan gelir.
   */
  updateProgress(progress: number): DeepScanSnapshot {
    if (!this._isMutable()) return this.getSnapshot();
    const next = monotonicProgress(this._progress, progress);
    if (next === this._progress) return this.getSnapshot();
    this._progress = next;
    this._touch();
    this._emit('progress_changed');
    return this.getSnapshot();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Keşif kayıtları — kontak doğrulanmadan KABUL EDİLMEZ (fail-closed)
   * ════════════════════════════════════════════════════════════════════ */

  /** Kontak + mutasyon kapısı: aktif araç sorgusundan gelen kayıtlar için. */
  private _acceptActiveRecord(context: string): boolean {
    if (!this._isMutable()) return false;
    if (this._ignition !== true) { this._requireIgnition(context); return false; }
    return true;
  }

  recordEcuDiscovery(input: EcuDiscoveryInput): DeepScanSnapshot {
    if (!this._acceptActiveRecord('ecu_discovery')) return this.getSnapshot();
    const key = normHex(input?.ecuAddress);
    if (!addBounded(this._ecus, key)) return this.getSnapshot(); // duplicate → sayaç şişmez
    if (input.isNew === true) this._newKeys.add(`ECU:${key}`);
    this._touch();
    this._emit('ecu_discovered');
    return this.getSnapshot();
  }

  recordPidDiscovery(input: SignalDiscoveryInput): DeepScanSnapshot {
    if (!this._acceptActiveRecord('pid_discovery')) return this.getSnapshot();
    const pid = normHex(input?.pidOrDid);
    const key = `${normHex(input?.ecuAddress)}:${pid}`;
    if (!pid || !addBounded(this._pids, key)) return this.getSnapshot();
    if (input.isNew === true) this._newKeys.add(`PID:${key}`);
    this._touch();
    this._emit('pid_discovered');
    return this.getSnapshot();
  }

  recordDidDiscovery(input: SignalDiscoveryInput): DeepScanSnapshot {
    if (!this._acceptActiveRecord('did_discovery')) return this.getSnapshot();
    const did = normHex(input?.pidOrDid);
    const key = `${normHex(input?.ecuAddress)}:${did}`;
    if (!did || !addBounded(this._dids, key)) return this.getSnapshot();
    if (input.isNew === true) this._newKeys.add(`DID:${key}`);
    this._touch();
    this._emit('did_discovered');
    return this.getSnapshot();
  }

  /** Firmware sorgusu sonucu. Sürüm metni SAKLANMAZ — yalnız sayım + değişim bayrağı. */
  recordFirmwareResult(input: FirmwareResultInput): DeepScanSnapshot {
    if (!this._acceptActiveRecord('firmware_inventory')) return this.getSnapshot();
    this._firmwareChecked += 1;
    if (input?.changed === true) this._changedFirmware = true;
    this._touch();
    this._emit('firmware_checked');
    return this.getSnapshot();
  }

  /**
   * Değişiklik tespiti (CHANGE_CHECK'in çıktısı). OFFLINE bir karardır — önceden
   * toplanmış veriyle karşılaştırma → kontak GEREKTİRMEZ.
   */
  recordChangeDetection(input: ChangeDetectionInput): DeepScanSnapshot {
    if (!this._isMutable()) return this.getSnapshot();
    let changed = false;
    if (input?.changedFirmware === true && !this._changedFirmware) { this._changedFirmware = true; changed = true; }
    if (input?.changedEcu === true && !this._changedEcu)           { this._changedEcu = true;      changed = true; }
    if (!changed) return this.getSnapshot();
    this._touch();
    this._emit('change_detected', input.reason);
    return this.getSnapshot();
  }

  /**
   * Bir fazın başarısızlığını bildirir (fail-soft):
   *  - KRİTİK faz (kimlik/protokol) → tarama `failed`.
   *  - Kritik olmayan faz → uyarı eklenir, faz ATLANIR, tarama devam eder.
   */
  reportPhaseFailure(phase: DeepScanPhase, errorCode: string): DeepScanSnapshot {
    if (!this._isMutable()) return this.getSnapshot();
    if (isCriticalPhase(phase)) return this.failScan(`${phase}:${errorCode}`);
    this._warn(`phase_skipped:${phase}:${errorCode}`);
    this._touch();
    return this.getSnapshot();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Duraklat / sürdür / iptal / hata / tamamla
   * ════════════════════════════════════════════════════════════════════ */

  pauseScan(reason?: string): DeepScanSnapshot {
    if (!this._isMutable() || this._status === 'paused') return this.getSnapshot();
    this._resumeStatus = this._status;
    this._status = 'paused';
    this._touch();
    this._emit('scan_paused', reason);
    return this.getSnapshot();
  }

  /**
   * Duraklatmadan döner. Aktif bir fazda duraklanmışsa ve kontak ARTIK doğrulanmış
   * değilse `waiting_for_ignition`'a düşer (araca sorgu yeniden başlamaz).
   */
  resumeScan(): DeepScanSnapshot {
    if (this._disposed || this._status !== 'paused') return this.getSnapshot();

    const target = this._resumeStatus ?? 'preparing';
    this._resumeStatus = null;

    const needsIgnition = this._phase !== null && isActivePhase(this._phase);
    if (needsIgnition && this._ignition !== true) {
      this._status = 'waiting_for_ignition';
      this._touch();
      this._emit('ignition_required', 'resume');
      return this.getSnapshot();
    }

    this._status = target === 'paused' ? 'preparing' : target;
    this._touch();
    this._emit('scan_resumed');
    return this.getSnapshot();
  }

  /** İptal — mevcut progress KORUNUR (sahte 100 yazılmaz). Terminal. */
  cancelScan(reason?: string): DeepScanSnapshot {
    if (!this._isMutable()) return this.getSnapshot();
    this._status = 'cancelled';
    this._touch();
    this._emit('scan_cancelled', reason);
    return this.getSnapshot();
  }

  /** Hata — mevcut progress KORUNUR. Terminal. */
  failScan(errorCode: string): DeepScanSnapshot {
    if (!this._isMutable()) return this.getSnapshot();
    this._status    = 'failed';
    this._errorCode = sanitizeText(errorCode, 64) || 'unknown_error';
    this._touch();
    this._emit('scan_failed', this._errorCode);
    return this.getSnapshot();
  }

  /** Tamamlandı → progress 100, rapor özeti üretilir. Terminal. */
  completeScan(input: CompleteDeepScanInput = {}): DeepScanSnapshot {
    if (!this._isMutable()) return this.getSnapshot();
    const now = this._now();
    this._status      = 'completed';
    this._progress    = 100;
    this._completedAt = now;
    this._report = Object.freeze({
      mode:                 this._mode ?? 'FULL_SCAN',
      ecuCount:             this._ecus.size,
      pidCount:             this._pids.size,
      didCount:             this._dids.size,
      newDiscoveriesCount:  this._newKeys.size,
      firmwareCheckedCount: this._firmwareChecked,
      changedFirmware:      this._changedFirmware,
      changedEcu:           this._changedEcu,
      warningCount:         this._warnings.length,
      durationMs:           this._startedAt !== null ? Math.max(0, now - this._startedAt) : 0,
      note:                 sanitizeText(input?.note) || null,
    });
    this._touch();
    this._emit('scan_completed');
    return this.getSnapshot();
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Olay aboneliği (bounded · duplicate'siz · fail-soft)
   * ════════════════════════════════════════════════════════════════════ */

  /**
   * Olaylara abone olur. Aynı fonksiyon ikinci kez verilirse Set semantiğiyle
   * DUPLICATE OLUŞMAZ. Tavan dolarsa abonelik reddedilir (no-op cleanup döner).
   * @returns cleanup thunk (idempotent)
   */
  subscribe(listener: DeepScanListener): () => void {
    if (this._disposed || typeof listener !== 'function') return () => { /* no-op */ };
    if (!this._listeners.has(listener) && this._listeners.size >= MAX_LISTENERS) {
      this._warn('listener_limit_reached');
      return () => { /* no-op */ };
    }
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  }

  /** Test/teşhis: aktif dinleyici sayısı (zero-leak kanıtı). */
  get listenerCount(): number {
    return this._listeners.size;
  }

  /* ══════════════════════════════════════════════════════════════════════
   * Sıfırlama / temizlik
   * ════════════════════════════════════════════════════════════════════ */

  /** Durumu `idle`'a döndürür. Dinleyiciler KORUNUR (yeni tarama izlenebilsin). */
  reset(): void {
    if (this._disposed) return;
    this._scanId = null;
    this._hash = null;
    this._status = 'idle';
    this._mode = null;
    this._phase = null;
    this._progress = 0;
    this._startedAt = null;
    this._updatedAt = null;
    this._completedAt = null;
    this._isFirstScan = true;
    this._ignition = null;
    this._changedFirmware = false;
    this._changedEcu = false;
    this._firmwareChecked = 0;
    this._errorCode = null;
    this._report = null;
    this._resumeStatus = null;
    this._warnings = [];
    this._ecus = new Set();
    this._pids = new Set();
    this._dids = new Set();
    this._newKeys = new Set();
    this._snapshot = null;
  }

  /**
   * Zero-leak temizlik: dinleyiciler ve tüm koleksiyonlar bırakılır. Sonrasında
   * her API çağrısı güvenli no-op'tur. Timer/abonelik açılmadığı için temizlenecek
   * başka kaynak YOKTUR.
   */
  dispose(): void {
    if (this._disposed) return;
    this.reset();
    this._listeners.clear();
    this._disposed = true;
    this._snapshot = null;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }
}

/**
 * Uygulama geneli tekil servis. Yapıcı YAN ETKİ ÜRETMEZ (timer/abonelik/native
 * çağrı yok) → yalnız import edilmesi hiçbir davranış değiştirmez. SystemBoot'a
 * BAĞLI DEĞİLDİR (bilinçli — gerçek orchestration ayrı PR).
 */
export const deepScanRuntimeService = new DeepScanRuntimeService();
