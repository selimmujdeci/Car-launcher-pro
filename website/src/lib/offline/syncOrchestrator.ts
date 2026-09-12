/**
 * syncOrchestrator.ts — ÇEVRİMİÇİ OLUNCA DOĞRU SIRAYLA SENKRONİZASYON.
 *
 * Sıra (domain bağımlılığı):
 *   1 profile readiness → 2 company → 3 membership → 4 ownership claim
 *   → 5 pairing → 6 company vehicle assignment → 7 location → 8 vehicle event
 *
 * · `dependsOn` çözülmeden işlem GÖNDERİLMEZ (kuyruk zorlar).
 * · AYNI entity için işlemler SERİLEŞTİRİLİR (yarış yok).
 * · FARKLI araçlar paralel işlenebilir.
 * · Conflict otomatik local-wins ile ÇÖZÜLMEZ — server-wins/fail-closed.
 */

import { DomainQueue } from './domainQueue';
import type { QueueItem, OperationType } from './types';
import { toConflictCode, policyFor } from './conflictEngine';
import { type FleetErrorCode, isFleetErrorCode } from '../fleet/errors';

/** Tek bir işlemin sunucuya gönderim sonucu. */
export type TransportResult =
  | { ok: true }
  | { ok: false; retryable: true;  errorCode: FleetErrorCode | 'network_error' }
  | { ok: false; retryable: false; errorCode: FleetErrorCode };

/** Sunucu taşıyıcısı — enjekte edilir (test edilebilirlik). */
export interface SyncTransport {
  send(item: QueueItem): Promise<TransportResult>;
}

/** Profil hazır mı — sıranın 1. adımı. Hazır değilse HİÇBİR işlem gönderilmez. */
export interface ProfileReadinessCheck {
  isReady(): Promise<boolean>;
}

export interface SyncRunResult {
  attempted: number;
  synced:    number;
  conflicts: number;
  failed:    number;
  skippedNotReady: boolean;
  /** Zaten bir senkron turu çalışıyordu — ikinci tur BAŞLATILMADI. */
  skippedAlreadyRunning: boolean;
  /**
   * Sonuç geldiğinde kapsam (hesap/şirket) değişmişti → kuyruğa YAZILMADI.
   * Bayat bir yanıtın yeni hesabın kuyruğunu değiştirmesi sessiz sızıntıdır.
   */
  staleRejected: number;
}

function emptyResult(): SyncRunResult {
  return {
    attempted: 0, synced: 0, conflicts: 0, failed: 0,
    skippedNotReady: false, skippedAlreadyRunning: false, staleRejected: 0,
  };
}

/**
 * Aynı entity'yi tanımlayan anahtar. Bu anahtarı paylaşan işlemler
 * TEK TURDA yalnız bir kez işlenir → serileştirme sağlanır.
 */
export function entityKeyOf(item: QueueItem): string {
  const scope: Record<OperationType, string> = {
    COMPANY_CREATE:         `company:${item.actorId}`,
    COMPANY_UPDATE:         `company:${item.companyId ?? item.actorId}`,
    MEMBER_ADD:             `member:${String(item.payload.userId ?? item.actorId)}`,
    MEMBER_ROLE_UPDATE:     `member:${String(item.payload.userId ?? item.actorId)}`,
    MEMBER_REMOVE:          `member:${String(item.payload.userId ?? item.actorId)}`,
    VEHICLE_PAIR:           `vehicle:${item.vehicleId ?? item.dedupKey}`,
    VEHICLE_ASSIGN_COMPANY: `vehicle:${item.vehicleId ?? item.dedupKey}`,
    VEHICLE_REMOVE_COMPANY: `vehicle:${item.vehicleId ?? item.dedupKey}`,
    OWNERSHIP_CLAIM:        `vehicle:${item.vehicleId ?? item.dedupKey}`,
    // Devir işlemleri de araç kapsamındadır → aynı araçta serileştirilir.
    VEHICLE_TRANSFER_START:  `vehicle:${item.vehicleId ?? item.dedupKey}`,
    VEHICLE_TRANSFER_ACCEPT: `vehicle:${item.vehicleId ?? item.dedupKey}`,
    VEHICLE_TRANSFER_REJECT: `vehicle:${item.vehicleId ?? item.dedupKey}`,
    VEHICLE_TRANSFER_CANCEL: `vehicle:${item.vehicleId ?? item.dedupKey}`,
    LOCATION_EVENT:         `vehicle:${item.vehicleId ?? item.dedupKey}`,
    VEHICLE_EVENT:          `vehicle:${item.vehicleId ?? item.dedupKey}`,
    /* Her kayıt AYRI bir satır ekler; aynı satırı iki işlem değiştirmez →
       araç kapsamında serileştirmeye gerek YOKTUR. Araç kapsamı verilseydi
       10 bekleyen kayıt 10 tur sürerdi; kayıt kapsamıyla tek turda giderler.
       Çift gönderim koruması burada değil, sunucudaki `client_ref` benzersiz
       indeksindedir. */
    FUEL_LOG_ADD:           `record:${item.dedupKey}`,
    SERVICE_RECORD_ADD:     `record:${item.dedupKey}`,
  };
  return scope[item.operationType];
}

/**
 * TEK SENKRON OTORİTESİ.
 *
 * · Aynı anda YALNIZ BİR tur çalışır (`running` kilidi) — iki tur aynı öğeyi
 *   sunucuya iki kez göndermez.
 * · `abort()` kuşak (generation) sayacını artırır. Uçuştaki bir isteğin yanıtı
 *   geldiğinde kuşak değişmişse sonuç kuyruğa YAZILMAZ: hesap değişimi, çıkış
 *   veya şirket değişiminden sonra bayat bir yanıt yeni kapsamı bozamaz.
 */
export class SyncOrchestrator {
  private running = false;
  private generation = 0;
  private staleRejectTotal = 0;

  constructor(
    private readonly queue: DomainQueue,
    private readonly transport: SyncTransport,
    private readonly profile: ProfileReadinessCheck,
  ) {}

  /**
   * Devam eden turu geçersiz kılar (çıkış · hesap değişimi · şirket değişimi).
   * Uçuştaki istekler tamamlanabilir ama sonuçları YOK SAYILIR.
   */
  abort(): void {
    this.generation += 1;
    this.running = false;
  }

  getGeneration(): number {
    return this.generation;
  }

  /** Bayat kuşak yüzünden yok sayılan sonuç adedi (LAB gösterir). */
  getStaleRejectCount(): number {
    return this.staleRejectTotal;
  }

  isRunning(): boolean {
    return this.running;
  }

  /**
   * Bir senkron turu çalıştırır.
   *
   * Her turda bir entity'den YALNIZ EN ÖNCELİKLİ işlem işlenir; kalanlar
   * bir sonraki tura kalır. Böylece aynı entity üzerinde yarış oluşmaz,
   * farklı araçlar ise aynı turda paralel ilerler.
   */
  async runOnce(): Promise<SyncRunResult> {
    const result = emptyResult();

    // TEK DÖNGÜ — ikinci eşzamanlı tur BAŞLATILMAZ (çift gönderim koruması).
    if (this.running) {
      result.skippedAlreadyRunning = true;
      return result;
    }
    this.running = true;
    const generation = this.generation;

    try {
      // ADIM 1 — profile readiness. Hazır değilse hiçbir şey gönderilmez.
      const ready = await this.profile.isReady();
      if (!ready) {
        result.skippedNotReady = true;
        return result;
      }
      if (generation !== this.generation) {
        this.staleRejectTotal += 1;
        result.staleRejected  += 1;
        return result;
      }

      const candidates = await this.queue.ready();

      // Entity başına tek işlem seç (serileştirme).
      const seen = new Set<string>();
      const batch: QueueItem[] = [];
      for (const item of candidates) {
        const key = entityKeyOf(item);
        if (seen.has(key)) continue;
        seen.add(key);
        batch.push(item);
      }

      // Farklı entity'ler paralel işlenir.
      await Promise.all(batch.map((item) => this.processOne(item, result, generation)));
      return result;
    } finally {
      // `abort()` bu turu zaten serbest bırakmış olabilir — kilidi yalnız
      // kuşağı hâlâ geçerliyse biz bırakırız.
      if (generation === this.generation) this.running = false;
    }
  }

  private async processOne(
    item: QueueItem,
    result: SyncRunResult,
    generation: number,
  ): Promise<void> {
    result.attempted += 1;
    await this.queue.markSyncing(item.id);

    let outcome: TransportResult;
    try {
      outcome = await this.transport.send(item);
    } catch {
      // Taşıyıcı istisnası ağ hatası sayılır — retryable.
      outcome = { ok: false, retryable: true, errorCode: 'network_error' };
    }

    // BAYAT SONUÇ KAPISI — kapsam değiştiyse kuyruğa hiçbir şey yazılmaz.
    if (generation !== this.generation) {
      this.staleRejectTotal += 1;
      result.staleRejected += 1;
      return;
    }

    if (outcome.ok) {
      await this.queue.markSynced(item.id);
      result.synced += 1;
      return;
    }

    // Conflict mi?
    if (isFleetErrorCode(outcome.errorCode)) {
      const conflict = toConflictCode(outcome.errorCode, item.operationType);
      if (conflict) {
        const policy = policyFor(conflict);
        if (policy.autoResolvable && policy.cancelOperation) {
          // Server-wins: yerel işlem iptal edilir, kullanıcıya bilgi verilir.
          await this.queue.markConflict(item.id, conflict);
        } else {
          // Kullanıcı kararı gerekir — otomatik çözüm YOK.
          await this.queue.markConflict(item.id, conflict);
        }
        result.conflicts += 1;
        return;
      }
    }

    if (outcome.retryable) {
      await this.queue.markRetryableFailure(item.id, outcome.errorCode);
    } else {
      await this.queue.markPermanentFailure(item.id, outcome.errorCode);
    }
    result.failed += 1;
  }

  /** Kuyruk boşalana veya ilerleme durana kadar tur çalıştırır (bounded). */
  async drain(maxRounds = 10): Promise<SyncRunResult> {
    const total = emptyResult();
    const generation = this.generation;

    for (let round = 0; round < maxRounds; round++) {
      const r = await this.runOnce();
      total.attempted     += r.attempted;
      total.synced        += r.synced;
      total.conflicts     += r.conflicts;
      total.failed        += r.failed;
      total.staleRejected += r.staleRejected;

      if (r.skippedAlreadyRunning) {
        total.skippedAlreadyRunning = true;
        break; // başka tur zaten ilerletiyor — üstüne binme
      }
      if (r.skippedNotReady) {
        total.skippedNotReady = true;
        break;
      }
      // Kapsam değiştiyse (çıkış/hesap değişimi) döngü DERHAL durur.
      if (generation !== this.generation) break;
      if (r.attempted === 0) break; // ilerleme yok → dur (sonsuz döngü yasak)
    }
    return total;
  }
}
