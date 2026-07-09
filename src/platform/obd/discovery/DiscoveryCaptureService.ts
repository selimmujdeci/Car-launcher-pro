/**
 * DiscoveryCaptureService — keşif yakalama boru hattının MERKEZÎ orkestratörü (PR-DISC-1).
 *
 * SORUMLULUK (Single Responsibility): araçtan gözlemlenen bir PID/DID sonucunu alır,
 *   (1) katalogda VAR MI diye bakar → varsa YOK SAYAR ("registry'de olanları tekrar kaydetme"),
 *   (2) YOKSA hash-dedup'tan geçirir (DiscoveryCache) → tekrarsa yok sayar,
 *   (3) yeni + benzersizse: offline kuyruğa yazar (DiscoveryQueue) + tanı log'una
 *       discovery event'i düşer (mevcut 'ecuQuery' stage'i — tanı tipleri DEĞİŞMEZ).
 *
 * BAĞIMLILIK TERSİNE ÇEVİRME (DIP/SOLID): registry "biliniyor mu" denetimleri ve tanı
 * emitörü DIŞARIDAN enjekte edilebilir (test + gevşek bağlaşım). Varsayılanlar:
 *   - isPidKnown → StandardPidRegistry.STANDARD_PID_MAP (SALT-OKUNUR; registry'ye DOKUNULMAZ)
 *   - isDidKnown → setKnownDids ile beslenen küme (araç DID profili anahtarları)
 *   - emitDiagnostic → obdDiagnosticRecorder.recordDiag (stage 'ecuQuery', status 'info')
 *
 * NATIVE'e / hot-poll'a / PID registry'ye / DTC kataloğuna DOKUNMAZ. Ağ çağrısı YOK.
 */

import { STANDARD_PID_MAP } from '../StandardPidRegistry';
import { recordDiag } from '../../obdDiagnosticRecorder';
import { DiscoveryCache } from './DiscoveryCache';
import { DiscoveryQueue } from './DiscoveryQueue';
import { exportDiscoveryJson } from './discoveryExport';
import {
  createDiscoveryRecord,
  normalizeHex,
  discoveryHash,
  type DiscoveryRecord,
  type DiscoverySource,
} from './discoveryModel';

/** captureDiscovery girişi — bilinenler geçilir, gerisi güvenli varsayılana düşer. */
export type DiscoveryInput = Partial<DiscoveryRecord> & {
  pidOrDid:        string;
  discoverySource: DiscoverySource;
};

/** Yakalama sonucu — dürüst ayrım: yeni mi, biliniyor mu, tekrar mı. */
export type CaptureResult =
  | { captured: true;  record: DiscoveryRecord }
  | { captured: false; reason: 'known' | 'duplicate' };

/**
 * Gözlem kaydı (SALT-OKUNUR gözlemlenebilirlik — Dashboard için, PR-DISC-3).
 * capture() KARARINI DEĞİŞTİRMEZ; her benzersiz kimlik için (dedupKey) tek gözlem tutulur:
 *   status 'new'  = katalog dışı (yakalandı/kuyruğa girdi)
 *   status 'known'= registry/profil'de var (yakalanmadı)
 *   seenCount > 1 = aynı sinyal tekrar gözlemlendi (duplicate göstergesi)
 */
export type DiscoveryObservationStatus = 'new' | 'known';

export interface DiscoveryObservation {
  record:    DiscoveryRecord;
  status:    DiscoveryObservationStatus;
  seenCount: number;
  firstAt:   number;
  lastAt:    number;
}

/** Gözlem halkası tavanı — benzersiz sinyal başına 1 kayıt (zero-leak). */
const MAX_OBSERVATIONS = 4096;

export interface DiscoveryCaptureOptions {
  /** PID katalogda var mı (varsayılan: standart registry — salt-okunur). */
  isPidKnown?:     (pid: string) => boolean;
  /** DID katalogda var mı (varsayılan: setKnownDids ile beslenen küme). */
  isDidKnown?:     (did: string) => boolean;
  /** Yeni keşifte tanı log'una event düşürücü (varsayılan: recordDiag → 'ecuQuery'). */
  emitDiagnostic?: (record: DiscoveryRecord) => void;
  /** Test/özelleştirme için enjekte edilebilir cache/queue. */
  cache?:          DiscoveryCache;
  queue?:          DiscoveryQueue;
}

/** Varsayılan tanı emitörü — yeni keşfi mevcut 'ecuQuery' stage'iyle timeline'a yazar. */
function defaultDiagnosticEmitter(r: DiscoveryRecord): void {
  recordDiag({
    stage:            'ecuQuery',
    status:           'info',
    protocol:         r.protocol || null,
    command:          r.request || null,
    response:         r.rawResponse || null,
    technicalMessage: `Keşif: katalogda olmayan ${r.discoverySource} ${r.pidOrDid}` +
                      (r.ecuAddress ? ` (ECU ${r.ecuAddress})` : '') +
                      (r.supported ? ' — desteklen/yanıtladı' : ' — yanıt yok/negatif'),
    userMessage:      'Yeni araç sinyali keşfedildi',
  });
}

export class DiscoveryCaptureService {
  private readonly _cache: DiscoveryCache;
  private readonly _queue: DiscoveryQueue;
  private readonly _isPidKnown: (pid: string) => boolean;
  private readonly _isDidKnown: (did: string) => boolean;
  private readonly _emitDiagnostic: (record: DiscoveryRecord) => void;
  /** setKnownDids ile beslenen bilinen DID kümesi (varsayılan isDidKnown bunu okur). */
  private _knownDids = new Set<string>();
  /** SALT-OKUNUR gözlem katmanı (Dashboard) — kimlik başına 1 kayıt; capture kararını ETKİLEMEZ. */
  private readonly _obs = new Map<string, DiscoveryObservation>();
  /** Canlı güncelleme aboneleri (UI) — her gözlemde tetiklenir. */
  private readonly _subscribers = new Set<() => void>();

  constructor(opts: DiscoveryCaptureOptions = {}) {
    this._cache = opts.cache ?? new DiscoveryCache();
    this._queue = opts.queue ?? new DiscoveryQueue();
    this._isPidKnown = opts.isPidKnown ?? ((pid) => STANDARD_PID_MAP.has(normalizeHex(pid)));
    this._isDidKnown = opts.isDidKnown ?? ((did) => this._knownDids.has(normalizeHex(did)));
    this._emitDiagnostic = opts.emitDiagnostic ?? defaultDiagnosticEmitter;
  }

  /**
   * Bilinen DID kümesini (yüklü araç DID profili anahtarları) ayarlar — böylece profildeki
   * DID'ler "keşif" sayılmaz. Registry'ye DOKUNMADAN dışarıdan beslenir (DIP).
   */
  setKnownDids(dids: Iterable<string>): void {
    this._knownDids = new Set([...dids].map(normalizeHex));
  }

  /** Bir PID/DID gözlemini işler. Katalogda varsa/tekrarsa yakalamaz (dürüst reason). */
  capture(input: DiscoveryInput): CaptureResult {
    const record = createDiscoveryRecord(input);

    const known = record.discoverySource === 'PID'
      ? this._isPidKnown(record.pidOrDid)
      : this._isDidKnown(record.pidOrDid);

    // Gözlemlenebilirlik (Dashboard) — capture KARARINI değiştirmez, yalnız kaydeder + bildirir.
    this._observe(record, known ? 'known' : 'new');

    if (known) return { captured: false, reason: 'known' };

    // Katalogda YOK → yeni aday; hash-dedup (aynı ECU+mode+PID/DID ikinci gözlemi elenir).
    const isNew = this._cache.add(record);
    if (!isNew) return { captured: false, reason: 'duplicate' };

    this._queue.enqueue(record);
    try { this._emitDiagnostic(record); } catch { /* tanı log hatası yakalamayı engellemez */ }
    return { captured: true, record };
  }

  /** Kimlik başına gözlemi günceller (seenCount++/lastAt) veya ekler; sonra abonelere bildirir. */
  private _observe(record: DiscoveryRecord, status: DiscoveryObservationStatus): void {
    const h = discoveryHash(record);
    const existing = this._obs.get(h);
    if (existing) {
      existing.seenCount++;
      existing.lastAt = record.timestamp;
    } else {
      this._obs.set(h, { record, status, seenCount: 1, firstAt: record.timestamp, lastAt: record.timestamp });
      if (this._obs.size > MAX_OBSERVATIONS) {
        const oldest = this._obs.keys().next().value;
        if (oldest !== undefined) this._obs.delete(oldest);
      }
    }
    this._notify();
  }

  private _notify(): void {
    this._subscribers.forEach((cb) => { try { cb(); } catch { /* abone hatası diğerlerini engellemez */ } });
  }

  /**
   * Canlı güncelleme aboneliği (UI Dashboard) — her yeni gözlemde çağrılır. Döndürdüğü
   * fonksiyon aboneliği kaldırır (zero-leak: bileşen unmount'ta çağırmalı).
   */
  subscribe(cb: () => void): () => void {
    this._subscribers.add(cb);
    return () => { this._subscribers.delete(cb); };
  }

  /** Gözlemlenen benzersiz sinyallerin kopyası (Dashboard listesi) — kimlik başına 1. */
  getObservations(): DiscoveryObservation[] {
    return [...this._obs.values()].map((o) => ({ ...o, record: { ...o.record } }));
  }

  /** Yakalanmış (kuyruktaki) tüm keşiflerin kopyası. */
  getCaptured(): DiscoveryRecord[] {
    return this._queue.peekAll();
  }

  /** Yakalanan keşifleri sürümlü JSON zarfına serileştirir (yerel export). */
  exportJson(pretty = true): string {
    return exportDiscoveryJson(this._queue.peekAll(), pretty);
  }

  /** Benzersiz yakalanan keşif sayısı (dedup sonrası). */
  get capturedCount(): number {
    return this._cache.size;
  }

  /** Cache + kuyruğu + gözlemleri sıfırlar (oturum kapanışı / araç değişimi). Aboneler KALIR. */
  reset(): void {
    this._cache.clear();
    this._queue.clear();
    this._knownDids.clear();
    this._obs.clear();
    this._notify();
  }
}

/** Uygulama geneli tekil örnek (servis wiring). Testler kendi örneğini kurar. */
export const discoveryCaptureService = new DiscoveryCaptureService();
