/**
 * domainQueue.ts — TYPED OFFLINE DOMAIN KUYRUĞU (ownership / fleet).
 *
 * Mevcut `connectivityService` telemetri kuyruğuna DOKUNULMAZ; bu ayrı bir
 * kuyruktur ve yalnız sahiplik/filo işlemlerini taşır.
 *
 * Garantiler:
 *   · BOUNDED     — `MAX_QUEUE_SIZE` aşılırsa en eski terminal öğe atılır;
 *                   hepsi aktifse yeni ekleme REDDEDİLİR (sessiz veri kaybı yok).
 *   · TTL         — `expiresAt` geçmiş öğe EXPIRED olur, ASLA gönderilmez.
 *   · BACKOFF     — deterministik üstel geri çekilme (`Math.random` yok).
 *   · DEDUPE      — aynı `dedupKey` ile ikinci aktif öğe eklenmez.
 *   · POISON      — `maxAttempts` dolunca PERMANENT_FAILED; sonsuz retry YOK.
 *   · RESTORE     — kalıcı depodan okunur; bozuk kayıt fail-soft karantinaya alınır.
 *   · SYNCING     — yeniden açılışta kör "başarılı" sayılmaz; RETRYABLE_FAILED'a
 *                   düşürülür ki idempotency key ile gerçek sonuç sorulabilsin.
 *
 * Zaman `now()` ile ENJEKTE edilir → testler saat oynatabilir.
 */

import {
  type QueueItem,
  type EnqueueInput,
  type SyncStatus,
  type OperationType,
  DOMAIN_ORDER,
  MAX_QUEUE_SIZE,
  DEFAULT_TTL_MS,
  DEFAULT_MAX_ATTEMPTS,
  backoffDelayMs,
  isTerminal,
} from './types';
import { QUEUE_ITEM_SCHEMA_VERSION, QUEUE_ENVELOPE_VERSION } from './types';
import { type QueueStorage, MemoryQueueStorage } from './storage';

export interface DomainQueueOptions {
  storage?: QueueStorage;
  now?:     () => number;
  /** Deterministik id üretimi (test edilebilirlik). */
  idFactory?: () => string;
  maxSize?: number;
  /**
   * Kuyruğun bağlı olduğu hesap. Verilirse **cross-account kapısı** açılır:
   * depodan okunan başka hesaba ait kayıt yüklenmez, farklı `actorId` ile
   * ekleme reddedilir. Verilmezse (test/telemetri) kapı uygulanmaz.
   */
  accountId?: string;
}

interface PersistedShape {
  version: number;
  items:   QueueItem[];
}

/** Bilinmeyen/eksik alanlı kaydı reddeder (bozuk depo koruması). */
function isValidItem(value: unknown): value is QueueItem {
  if (typeof value !== 'object' || value === null) return false;
  const it = value as Record<string, unknown>;
  return (
    typeof it.id === 'string' &&
    typeof it.operationType === 'string' &&
    (it.operationType as OperationType) in DOMAIN_ORDER &&
    typeof it.actorId === 'string' &&
    typeof it.dedupKey === 'string' &&
    typeof it.idempotencyKey === 'string' &&
    typeof it.createdAt === 'number' &&
    typeof it.expiresAt === 'number' &&
    typeof it.attemptCount === 'number' &&
    typeof it.maxAttempts === 'number' &&
    typeof it.status === 'string' &&
    Array.isArray(it.dependsOn)
  );
}

/** Öğenin şema sürümü — alan yoksa 1 (bu alandan önce yazılmış kayıt). */
function schemaVersionOf(item: QueueItem): number {
  const raw = (item as { schemaVersion?: unknown }).schemaVersion;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 1;
}

export class DomainQueue {
  private items: QueueItem[] = [];
  private readonly storage: QueueStorage;
  private readonly now: () => number;
  private readonly maxSize: number;
  private idCounter = 0;
  private readonly idFactory: () => string;
  private readonly accountId: string | null;
  private loaded = false;
  /** Bozuk kayıt sayısı — LAB panelinde gösterilir (gizlenmez). */
  private corruptCount = 0;
  /** Bilinmeyen şema sürümü yüzünden reddedilen kayıt sayısı. */
  private schemaRejectedCount = 0;
  /** Başka hesaba ait olduğu için reddedilen kayıt sayısı (sızıntı kapısı). */
  private foreignAccountCount = 0;

  constructor(options: DomainQueueOptions = {}) {
    this.storage   = options.storage ?? new MemoryQueueStorage();
    this.now       = options.now ?? (() => Date.now());
    this.maxSize   = options.maxSize ?? MAX_QUEUE_SIZE;
    this.idFactory = options.idFactory ?? (() => `q_${++this.idCounter}_${this.now()}`);
    this.accountId = options.accountId ?? null;
  }

  /* ── Kalıcılık ───────────────────────────────────────────────────────── */

  /**
   * Depodan yükler. Bozuk JSON veya geçersiz kayıt uygulamayı ÇÖKERTMEZ:
   * geçerli kayıtlar alınır, geçersizler sayılır ve atılır (fail-soft).
   */
  async load(): Promise<void> {
    this.loaded = true;
    let raw: string | null = null;
    try {
      raw = await this.storage.read();
    } catch {
      raw = null;
    }
    if (!raw) {
      this.items = [];
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.corruptCount++;
      this.items = [];
      return;
    }

    const shape = parsed as Partial<PersistedShape>;

    // ZARF SÜRÜMÜ — bilinmeyen sürüm FAIL-CLOSED.
    // İleri sürümden geri dönülen tarayıcıda alan anlamları değişmiş olabilir;
    // "anladım" varsayıp yorumlamak sessiz veri bozulmasıdır. Kuyruk boş açılır,
    // depo SİLİNMEZ (ileri sürüm tekrar açılırsa kayıtlarını bulur).
    const envelopeVersion = typeof shape?.version === 'number' ? shape.version : 0;
    if (envelopeVersion !== QUEUE_ENVELOPE_VERSION) {
      this.schemaRejectedCount += Array.isArray(shape?.items) ? shape.items.length : 1;
      this.items = [];
      return;
    }

    const list  = Array.isArray(shape?.items) ? shape.items : [];
    const valid: QueueItem[] = [];
    for (const candidate of list) {
      if (!isValidItem(candidate)) { this.corruptCount++; continue; }

      // ÖĞE ŞEMASI — desteklenenden yeni kayıt yorumlanmaz.
      if (schemaVersionOf(candidate) > QUEUE_ITEM_SCHEMA_VERSION) {
        this.schemaRejectedCount++;
        continue;
      }

      // CROSS-ACCOUNT KAPISI — başka hesabın işlemi bu oturuma SIZAMAZ.
      // (Depo namespace'i zaten hesap başınadır; bu ikinci savunma hattıdır:
      //  namespace kirlenirse veya kayıt elle taşınırsa yine reddedilir.)
      if (this.accountId !== null && candidate.actorId !== this.accountId) {
        this.foreignAccountCount++;
        continue;
      }

      valid.push(candidate);
    }

    // Kapanış anında SYNCING kalan işlem KÖR ŞEKİLDE başarılı SAYILMAZ.
    // İdempotency key ile sunucudan gerçek sonuç sorulabilsin diye
    // yeniden denenebilir duruma çekilir.
    for (const item of valid) {
      if (item.status === 'SYNCING') {
        item.status      = 'RETRYABLE_FAILED';
        item.failureCode = 'interrupted_in_flight';
      }
    }

    this.items = valid;
    this.expireOverdue();
  }

  private async persist(): Promise<void> {
    const shape: PersistedShape = { version: QUEUE_ENVELOPE_VERSION, items: this.items };
    try {
      await this.storage.write(JSON.stringify(shape));
    } catch {
      /* fail-soft: bellek kuyruğu çalışmaya devam eder */
    }
  }

  /** Oturum kapanışı / hesap değişimi — kuyruk TAMAMEN temizlenir. */
  async clear(): Promise<void> {
    this.items = [];
    this.corruptCount = 0;
    this.schemaRejectedCount = 0;
    this.foreignAccountCount = 0;
    try {
      await this.storage.clear();
    } catch {
      /* fail-soft */
    }
  }

  /* ── Ekleme ──────────────────────────────────────────────────────────── */

  /**
   * Kuyruğa ekler. Aynı `dedupKey` ile AKTİF bir öğe varsa yenisi eklenmez ve
   * mevcut öğe döner (duplicate operation koruması).
   *
   * Kuyruk doluysa önce terminal öğeler budanır; yine yer yoksa `null` döner
   * — çağıran bunu kullanıcıya bildirmek ZORUNDADIR (sessiz kayıp yasak).
   */
  async enqueue(input: EnqueueInput): Promise<QueueItem | null> {
    if (!this.loaded) await this.load();

    // Hesap kapısı: bir hesabın kuyruğuna başka hesabın işlemi YAZILAMAZ.
    if (this.accountId !== null && input.actorId !== this.accountId) return null;

    const existing = this.items.find(
      (i) => i.dedupKey === input.dedupKey && !isTerminal(i.status),
    );
    if (existing) return existing;

    if (this.items.length >= this.maxSize) {
      this.items = this.items.filter((i) => !isTerminal(i.status));
      if (this.items.length >= this.maxSize) return null;
    }

    const now  = this.now();
    const item: QueueItem = {
      schemaVersion:  QUEUE_ITEM_SCHEMA_VERSION,
      id:             this.idFactory(),
      operationType:  input.operationType,
      actorId:        input.actorId,
      companyId:      input.companyId ?? null,
      vehicleId:      input.vehicleId ?? null,
      payload:        input.payload,
      createdAt:      now,
      clientRevision: input.clientRevision ?? 0,
      dedupKey:       input.dedupKey,
      idempotencyKey: input.idempotencyKey,
      dependsOn:      input.dependsOn ?? [],
      attemptCount:   0,
      maxAttempts:    input.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      nextAttemptAt:  now,
      expiresAt:      now + (input.ttlMs ?? DEFAULT_TTL_MS),
      status:         'PENDING',
      failureCode:    null,
    };

    this.items.push(item);
    await this.persist();
    return item;
  }

  /* ── Durum geçişleri ─────────────────────────────────────────────────── */

  /** TTL'i geçmiş aktif öğeleri EXPIRED yapar. */
  private expireOverdue(): void {
    const now = this.now();
    for (const item of this.items) {
      if (!isTerminal(item.status) && item.expiresAt <= now) {
        item.status      = 'EXPIRED';
        item.failureCode = 'ttl_expired';
      }
    }
  }

  private byId(id: string): QueueItem | undefined {
    return this.items.find((i) => i.id === id);
  }

  /** Bağımlılıkları çözülmüş mü (hepsi SYNCED). */
  private dependenciesMet(item: QueueItem): boolean {
    for (const depId of item.dependsOn) {
      const dep = this.byId(depId);
      if (!dep) continue;            // kayıp bağımlılık engel sayılmaz
      if (dep.status !== 'SYNCED') return false;
    }
    return true;
  }

  /**
   * Gönderilmeye hazır öğeler — domain sırasına, sonra oluşturma anına göre.
   * Bağımlılığı çözülmemiş öğe BLOCKED_BY_DEPENDENCY olarak işaretlenir ve
   * listeye ALINMAZ.
   */
  async ready(): Promise<QueueItem[]> {
    if (!this.loaded) await this.load();
    this.expireOverdue();

    const now = this.now();
    const out: QueueItem[] = [];

    for (const item of this.items) {
      if (isTerminal(item.status) || item.status === 'CONFLICT' || item.status === 'SYNCING') continue;
      if (!this.dependenciesMet(item)) {
        item.status = 'BLOCKED_BY_DEPENDENCY';
        continue;
      }
      if (item.status === 'BLOCKED_BY_DEPENDENCY') item.status = 'PENDING';
      if (item.nextAttemptAt > now) continue;
      out.push(item);
    }

    out.sort((a, b) => {
      const d = DOMAIN_ORDER[a.operationType] - DOMAIN_ORDER[b.operationType];
      if (d !== 0) return d;
      return a.createdAt - b.createdAt;
    });

    await this.persist();
    return out;
  }

  async markSyncing(id: string): Promise<void> {
    const item = this.byId(id);
    if (!item || isTerminal(item.status)) return;
    item.status = 'SYNCING';
    await this.persist();
  }

  async markSynced(id: string): Promise<void> {
    const item = this.byId(id);
    if (!item) return;
    item.status      = 'SYNCED';
    item.failureCode = null;
    await this.persist();
  }

  /**
   * Yeniden denenebilir hata. `maxAttempts` dolduysa PERMANENT_FAILED
   * (poison-item) — sonsuz retry ASLA olmaz.
   */
  async markRetryableFailure(id: string, failureCode: string): Promise<void> {
    const item = this.byId(id);
    if (!item || isTerminal(item.status)) return;
    item.attemptCount += 1;
    item.failureCode   = failureCode;
    if (item.attemptCount >= item.maxAttempts) {
      item.status = 'PERMANENT_FAILED';
    } else {
      item.status        = 'RETRYABLE_FAILED';
      item.nextAttemptAt = this.now() + backoffDelayMs(item.attemptCount);
    }
    await this.persist();
  }

  async markPermanentFailure(id: string, failureCode: string): Promise<void> {
    const item = this.byId(id);
    if (!item || isTerminal(item.status)) return;
    item.status      = 'PERMANENT_FAILED';
    item.failureCode = failureCode;
    await this.persist();
  }

  /** Conflict — kullanıcı kararı beklenir; otomatik retry YAPILMAZ. */
  async markConflict(id: string, conflictCode: string): Promise<void> {
    const item = this.byId(id);
    if (!item || isTerminal(item.status)) return;
    item.status      = 'CONFLICT';
    item.failureCode = conflictCode;
    await this.persist();
  }

  /** Kullanıcı vazgeçti — işlem bir daha gönderilmez. */
  async cancel(id: string): Promise<void> {
    const item = this.byId(id);
    if (!item || item.status === 'SYNCED') return;
    item.status      = 'CANCELLED';
    item.failureCode = 'cancelled_by_user';
    await this.persist();
  }

  /** Kullanıcı "yeniden dene" dedi — conflict/failed öğe tekrar sıraya girer. */
  async retry(id: string): Promise<void> {
    const item = this.byId(id);
    if (!item) return;
    if (item.status === 'SYNCED' || item.status === 'EXPIRED') return;
    item.status        = 'PENDING';
    item.failureCode   = null;
    item.attemptCount  = 0;
    item.nextAttemptAt = this.now();
    await this.persist();
  }

  /* ── Okuma ───────────────────────────────────────────────────────────── */

  async all(): Promise<readonly QueueItem[]> {
    if (!this.loaded) await this.load();
    this.expireOverdue();
    return this.items;
  }

  async countByStatus(): Promise<Record<SyncStatus, number>> {
    const items = await this.all();
    const out = {
      PENDING: 0, BLOCKED_BY_DEPENDENCY: 0, SYNCING: 0, SYNCED: 0,
      RETRYABLE_FAILED: 0, PERMANENT_FAILED: 0, CONFLICT: 0,
      EXPIRED: 0, CANCELLED: 0,
    } satisfies Record<SyncStatus, number>;
    for (const item of items) out[item.status] += 1;
    return out;
  }

  async countByOperation(): Promise<Partial<Record<OperationType, number>>> {
    const items = await this.all();
    const out: Partial<Record<OperationType, number>> = {};
    for (const item of items) {
      out[item.operationType] = (out[item.operationType] ?? 0) + 1;
    }
    return out;
  }

  getCorruptCount(): number {
    return this.corruptCount;
  }

  /** Bilinmeyen şema sürümü nedeniyle reddedilen kayıt adedi (LAB gösterir). */
  getSchemaRejectedCount(): number {
    return this.schemaRejectedCount;
  }

  /** Başka hesaba ait olduğu için reddedilen kayıt adedi (sızıntı kanıtı). */
  getForeignAccountCount(): number {
    return this.foreignAccountCount;
  }

  /** Kuyruğun bağlı olduğu hesap (yoksa null — kapı uygulanmaz). */
  getAccountId(): string | null {
    return this.accountId;
  }

  /**
   * SENKRON salt-okuma: bellekte YÜKLÜ öğeler.
   *
   * `all()`'dan farkı: depodan okuma TETİKLEMEZ ve TTL taraması YAPMAZ.
   * Henüz `load()` çağrılmadıysa boş dizi döner — bu dürüsttür, kuyruk
   * gerçekten bilinmiyordur; sahte veri üretilmez.
   *
   * Senkron sözleşme gerektiren çağıranlar (realtime uzlaştırma girdisi)
   * için vardır; karar veren yollar `all()` kullanmaya devam eder.
   */
  peekLoadedItems(): readonly QueueItem[] {
    return this.loaded ? this.items : [];
  }
}
