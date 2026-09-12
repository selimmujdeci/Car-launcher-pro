/**
 * realtimeSyncAuthority.ts — REALTIME GAP DETECTION + SNAPSHOT UZLAŞTIRMA.
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────
 * Realtime akışı TEK BAŞINA GERÇEK DEĞİLDİR. Bağlantı koptuğunda sunucuda
 * olan değişiklikler istemciye HİÇ ulaşmaz; bağlantı geri geldiğinde akış
 * kaldığı yerden değil, YENİDEN başlar. Aradaki boşluk sessizce atlanırsa
 * kullanıcı, sunucuda artık doğru olmayan bir filoyu "güncel" sanır —
 * üyeliği kaldırılmış bir araç hâlâ düzenlenebilir görünür.
 *
 * Bu modül tek otoritedir: reconnect sonrası akışa KÖR GÜVENMEZ, önce
 * sunucu anlık görüntüsünü (snapshot) ister, onu bekleyen yerel
 * mutation'larla uzlaştırır ve ancak ondan sonra LIVE'a geçer.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK · global durum YOK.
 * Zaman ve taşıyıcı DIŞARIDAN enjekte edilir → testler saat oynatır, ağ kurmaz.
 */

/* ── Durum makinesi ────────────────────────────────────────────────────── */

export const REALTIME_STATES = [
  'IDLE',          // hiç başlatılmadı
  'CONNECTING',    // abonelik kuruluyor
  'LIVE',          // akış güvenilir — snapshot ile uzlaşmış
  'SUSPECTED_GAP', // boşluk şüphesi — akışa güvenilmez
  'RESYNCING',     // sunucu snapshot'ı alınıyor
  'RECONCILING',   // snapshot yerel kuyrukla uzlaştırılıyor
  'DEGRADED',      // resync başarısız — UI "güncel" DEMEZ
  'STOPPED',       // çıkış / hesap değişimi
] as const;
export type RealtimeState = (typeof REALTIME_STATES)[number];

/** Kullanıcıya "veriler güncel" denebilecek TEK durum. */
export function isTrustworthy(state: RealtimeState): boolean {
  return state === 'LIVE';
}

/* ── Boşluk sebepleri (bounded sözleşme) ───────────────────────────────── */

export const GAP_REASONS = [
  'REVISION_JUMP',        // revision 10 → 12 (11 kayıp)
  'NON_MONOTONIC',        // revision geriye gitti
  'RECONNECTED',          // bağlantı koptu ve geri geldi
  'SUBSCRIPTION_REBUILT', // kanal yeniden kuruldu
  'SERVER_AHEAD',         // sunucu revision'ı yerelden ileri
  'MISSING_CURSOR',       // süreç yeniden başladı, güvenilir imleç yok
  'UNKNOWN_ENTITY_EVENT', // var olmayan varlık için update/delete olayı
  'GENERATION_MISMATCH',  // olay eski hesap/şirket kuşağından
] as const;
export type GapReason = (typeof GAP_REASONS)[number];

/* ── Kapsam ────────────────────────────────────────────────────────────── */

export interface RealtimeScope {
  accountId:      string;
  companyId:      string | null;
  /** Hesap/şirket değişiminde artar — eski callback'ler bununla elenir. */
  generation:     number;
  subscriptionId: string;
}

export function scopeKey(scope: RealtimeScope): string {
  return `${scope.accountId}:${scope.companyId ?? '-'}:${scope.generation}`;
}

/* ── Olay ──────────────────────────────────────────────────────────────── */

export interface RealtimeEvent {
  /** Sunucu tarafı monoton revizyon. */
  revision:   number;
  entityId:   string;
  entityKind: 'company' | 'member' | 'vehicle' | 'pairing';
  action:     'INSERT' | 'UPDATE' | 'DELETE';
  /** Olayın ait olduğu kapsam — uyuşmazsa REDDEDİLİR. */
  scope:      RealtimeScope;
  receivedAt: number;
}

/* ── Snapshot ──────────────────────────────────────────────────────────── */

export interface SnapshotEntity {
  entityId:   string;
  entityKind: RealtimeEvent['entityKind'];
  revision:   number;
  deleted:    boolean;
}

export interface ServerSnapshot {
  revision: number;
  entities: readonly SnapshotEntity[];
  takenAt:  number;
}

/** Bekleyen yerel mutation'ın uzlaştırma için gereken EN AZ alanı. */
export interface PendingLocalEntity {
  entityId:      string;
  entityKind:    RealtimeEvent['entityKind'];
  /** Mutation üretilirken bilinen sunucu revizyonu. */
  baseRevision:  number;
  /** Güvenlik/sahiplik işlemi mi — çakışmada ASLA local-wins olmaz. */
  authoritative: boolean;
}

/* ── Uzlaştırma sınıfları ──────────────────────────────────────────────── */

export const RECONCILIATION_CLASSES = [
  'SERVER_ONLY_ENTITY',
  'LOCAL_PENDING_ENTITY',
  'MATCHED',
  'SERVER_NEWER',
  'LOCAL_PENDING_NEWER',
  'SERVER_DELETED_LOCAL_PENDING',
  'UNKNOWN_REVISION',
] as const;
export type ReconciliationClass = (typeof RECONCILIATION_CLASSES)[number];

export type ReconciliationOutcome =
  | 'ACCEPT_SERVER'      // sunucu durumu alınır
  | 'KEEP_LOCAL_PENDING' // yerel bekleyen korunur, sunucu ezilmez
  | 'DROP_STALE_LOCAL'   // yerel mutation anlamsız kaldı → düşürülür
  | 'USER_ACTION'        // otomatik çözülemez
  | 'FAIL_CLOSED';       // belirsiz → güvenli tarafta kal

export interface ReconciliationItem {
  entityId:   string;
  entityKind: RealtimeEvent['entityKind'];
  klass:      ReconciliationClass;
  outcome:    ReconciliationOutcome;
}

/**
 * Snapshot ile bekleyen yerel mutation'ları uzlaştırır (SAF).
 *
 * ANAYASA: sunucu **otoritedir**. Yerel bekleyen değişiklik sunucuyu
 * sessizce EZMEZ; güvenlik/sahiplik alanlarında (authoritative) çakışma
 * daima fail-closed sonuçlanır.
 */
export function reconcile(
  snapshot: ServerSnapshot,
  pending: readonly PendingLocalEntity[],
): ReconciliationItem[] {
  const out: ReconciliationItem[] = [];
  const pendingByKey = new Map(pending.map((p) => [`${p.entityKind}:${p.entityId}`, p]));

  for (const entity of snapshot.entities) {
    const key   = `${entity.entityKind}:${entity.entityId}`;
    const local = pendingByKey.get(key);
    pendingByKey.delete(key);

    if (!local) {
      out.push({
        entityId: entity.entityId, entityKind: entity.entityKind,
        klass: 'SERVER_ONLY_ENTITY', outcome: 'ACCEPT_SERVER',
      });
      continue;
    }

    // Sunucuda silinmiş ama yerelde bekleyen değişiklik var.
    if (entity.deleted) {
      out.push({
        entityId: entity.entityId, entityKind: entity.entityKind,
        klass: 'SERVER_DELETED_LOCAL_PENDING',
        // Güvenlik işlemi ise kullanıcı görmeli; değilse mutation anlamsız.
        outcome: local.authoritative ? 'USER_ACTION' : 'DROP_STALE_LOCAL',
      });
      continue;
    }

    // Revizyon bilinmiyorsa "başarılı" SAYILMAZ.
    if (!Number.isFinite(local.baseRevision) || local.baseRevision < 0) {
      out.push({
        entityId: entity.entityId, entityKind: entity.entityKind,
        klass: 'UNKNOWN_REVISION', outcome: 'FAIL_CLOSED',
      });
      continue;
    }

    if (entity.revision > local.baseRevision) {
      out.push({
        entityId: entity.entityId, entityKind: entity.entityKind,
        klass: 'SERVER_NEWER',
        // Güvenlik alanında sunucu kazanır; sıradan metadata kullanıcıya sorulur.
        outcome: local.authoritative ? 'ACCEPT_SERVER' : 'USER_ACTION',
      });
    } else if (entity.revision === local.baseRevision) {
      out.push({
        entityId: entity.entityId, entityKind: entity.entityKind,
        klass: 'MATCHED', outcome: 'KEEP_LOCAL_PENDING',
      });
    } else {
      // Yerel taban sunucudan ileri — imleç bozuk. Sessizce kabul edilmez.
      out.push({
        entityId: entity.entityId, entityKind: entity.entityKind,
        klass: 'LOCAL_PENDING_NEWER', outcome: 'FAIL_CLOSED',
      });
    }
  }

  // Snapshot'ta HİÇ olmayan bekleyen varlıklar (henüz sunucuya ulaşmamış
  // yaratma işlemleri) — korunur, düşürülmez.
  for (const local of Array.from(pendingByKey.values())) {
    out.push({
      entityId: local.entityId, entityKind: local.entityKind,
      klass: 'LOCAL_PENDING_ENTITY', outcome: 'KEEP_LOCAL_PENDING',
    });
  }

  return out;
}

/* ── Sayaçlar (bounded / saturating) ───────────────────────────────────── */

/** Sayaç tavanı — sonsuz büyüme yok, LAB'da taşma göstermez. */
export const COUNTER_CAP = 9_999;

export interface RealtimeCounters {
  reconnectCount:          number;
  suspectedGapCount:       number;
  confirmedGapCount:       number;
  resyncAttemptCount:      number;
  resyncSuccessCount:      number;
  resyncFailureCount:      number;
  staleCallbackRejectCount:number;
  duplicateEventCount:     number;
  snapshotEntityCount:     number;
  reconciliationConflictCount: number;
}

function emptyCounters(): RealtimeCounters {
  // Şablon nesne — tüm anahtarlar başta tanımlı (V8 hidden-class kararlılığı).
  return {
    reconnectCount: 0, suspectedGapCount: 0, confirmedGapCount: 0,
    resyncAttemptCount: 0, resyncSuccessCount: 0, resyncFailureCount: 0,
    staleCallbackRejectCount: 0, duplicateEventCount: 0,
    snapshotEntityCount: 0, reconciliationConflictCount: 0,
  };
}

function bump(counters: RealtimeCounters, key: keyof RealtimeCounters): void {
  if (counters[key] < COUNTER_CAP) counters[key] += 1;
}

/* ── Backoff ───────────────────────────────────────────────────────────── */

export const RESYNC_BACKOFF_BASE_MS = 1_000;
export const RESYNC_BACKOFF_MAX_MS  = 60_000;
export const MAX_RESYNC_ATTEMPTS    = 5;

/**
 * Deterministik üstel backoff + **deterministik jitter**.
 *
 * `Math.random()` KULLANILMAZ: test edilebilirlik ve tekrar üretilebilirlik
 * için jitter, denemeye ve abonelik kimliğine bağlı saf bir karışımdan
 * türetilir. Böylece farklı istemciler farklı anlarda dener (reconnect storm
 * engellenir) ama aynı istemci aynı girdiyle DAİMA aynı gecikmeyi üretir.
 */
export function resyncBackoffMs(attempt: number, subscriptionId: string): number {
  if (attempt <= 0) return 0;
  const raw = Math.min(RESYNC_BACKOFF_BASE_MS * 2 ** (attempt - 1), RESYNC_BACKOFF_MAX_MS);

  let hash = 0x811c9dc5;
  const seed = `${subscriptionId}:${attempt}`;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // Jitter: taban gecikmenin %0–25'i.
  const jitter = (hash % 250) / 1000;
  return Math.round(raw * (1 + jitter));
}

/* ── Otorite ───────────────────────────────────────────────────────────── */

export interface SnapshotFetcher {
  /** Sunucudan authoritative anlık görüntü alır. Hata fırlatabilir. */
  fetchSnapshot(scope: RealtimeScope): Promise<ServerSnapshot>;
}

export interface AuthorityOptions {
  now: () => number;
  fetcher: SnapshotFetcher;
  /** Bekleyen yerel mutation'ları veren okuma (uzlaştırma girdisi). */
  readPending: () => readonly PendingLocalEntity[];
}

export interface AuthoritySnapshotView {
  state:               RealtimeState;
  scope:               RealtimeScope | null;
  lastServerRevision:  number | null;
  lastEventRevision:   number | null;
  lastEventAt:         number | null;
  connectedAt:         number | null;
  disconnectedAt:      number | null;
  lastResyncAt:        number | null;
  lastResyncDurationMs:number | null;
  lastGapReason:       GapReason | null;
  resyncAttempt:       number;
  nextResyncAt:        number | null;
  counters:            RealtimeCounters;
}

/**
 * TEK REALTIME OTORİTESİ.
 *
 * · Reconnect DAİMA `SUSPECTED_GAP`'e düşürür — snapshot alınmadan LIVE olunmaz.
 * · Eski kuşaktan gelen olay/sonuç REDDEDİLİR (hesap değişimi izolasyonu).
 * · Aynı kapsam için aynı anda TEK resync.
 * · Sonsuz retry yok: `MAX_RESYNC_ATTEMPTS` sonrası `DEGRADED`.
 * · `lastServerRevision` YALNIZ başarılı uzlaştırmadan sonra ilerler.
 */
export class RealtimeSyncAuthority {
  private state: RealtimeState = 'IDLE';
  private scope: RealtimeScope | null = null;
  private lastServerRevision: number | null = null;
  private lastEventRevision:  number | null = null;
  private lastEventAt:        number | null = null;
  private connectedAt:        number | null = null;
  private disconnectedAt:     number | null = null;
  private lastResyncAt:       number | null = null;
  private lastResyncDurationMs: number | null = null;
  private lastGapReason: GapReason | null = null;
  private resyncAttempt = 0;
  private nextResyncAt: number | null = null;
  private resyncInFlight = false;
  private readonly counters = emptyCounters();
  /** Görülen olay kimlikleri — duplicate bastırma (bounded). */
  private readonly seenEvents = new Set<string>();
  private static readonly SEEN_CAP = 500;

  constructor(private readonly options: AuthorityOptions) {}

  /* ── Yaşam döngüsü ───────────────────────────────────────────────── */

  start(scope: RealtimeScope): void {
    this.scope = scope;
    this.state = 'CONNECTING';
    this.connectedAt = this.options.now();
    this.disconnectedAt = null;
    this.seenEvents.clear();
  }

  /**
   * Abonelik kuruldu.
   *
   * İLK kurulumda güvenilir imleç YOKTUR → doğrudan LIVE olunmaz.
   * Süreç yeniden başlamış olabilir ve aradaki değişiklikler kaçmış olabilir.
   */
  connected(): void {
    if (this.state === 'STOPPED') return;
    this.markGap(this.lastServerRevision === null ? 'MISSING_CURSOR' : 'RECONNECTED');
  }

  disconnected(): void {
    if (this.state === 'STOPPED') return;
    this.disconnectedAt = this.options.now();
    bump(this.counters, 'reconnectCount');
    this.state = 'SUSPECTED_GAP';
  }

  /** Çıkış / hesap değişimi — uçuştaki her şey geçersiz. */
  stop(): void {
    this.state = 'STOPPED';
    this.scope = null;
    this.resyncInFlight = false;
    this.nextResyncAt = null;
    this.seenEvents.clear();
  }

  /* ── Olay girişi ─────────────────────────────────────────────────── */

  /**
   * Realtime olayı işler.
   *
   * @returns olayın kabul edilip edilmediği ve reddedildiyse sebebi.
   */
  onEvent(event: RealtimeEvent): { accepted: boolean; reason: GapReason | 'DUPLICATE' | 'STOPPED' | null } {
    if (this.state === 'STOPPED' || !this.scope) {
      return { accepted: false, reason: 'STOPPED' };
    }

    // KUŞAK KAPISI — eski hesap/şirket kapsamından gelen olay yeni kapsama
    // ASLA uygulanmaz.
    if (scopeKey(event.scope) !== scopeKey(this.scope)) {
      bump(this.counters, 'staleCallbackRejectCount');
      this.lastGapReason = 'GENERATION_MISMATCH';
      return { accepted: false, reason: 'GENERATION_MISMATCH' };
    }

    // Duplicate bastırma (bounded küme).
    const eventKey = `${event.entityKind}:${event.entityId}:${event.revision}:${event.action}`;
    if (this.seenEvents.has(eventKey)) {
      bump(this.counters, 'duplicateEventCount');
      return { accepted: false, reason: 'DUPLICATE' };
    }
    this.rememberEvent(eventKey);

    // Boşluk şüphesi varken akış GÜVENİLİR DEĞİLDİR — olay yutulmaz ama
    // "güncel" sayılmaz; snapshot beklenir.
    if (this.state !== 'LIVE') {
      this.lastEventRevision = event.revision;
      this.lastEventAt = event.receivedAt;
      return { accepted: false, reason: this.lastGapReason };
    }

    const previous = this.lastEventRevision ?? this.lastServerRevision;

    if (previous !== null) {
      if (event.revision < previous) {
        this.markGap('NON_MONOTONIC');
        return { accepted: false, reason: 'NON_MONOTONIC' };
      }
      // Ardışık olmayan revizyon = aradaki olay(lar) KAÇTI.
      if (event.revision > previous + 1) {
        this.markGap('REVISION_JUMP');
        return { accepted: false, reason: 'REVISION_JUMP' };
      }
    }

    this.lastEventRevision = event.revision;
    this.lastEventAt = event.receivedAt;
    return { accepted: true, reason: null };
  }

  /** Sunucu revizyonu yereldan ileriyse boşluk vardır. */
  observeServerRevision(revision: number): void {
    if (this.state === 'STOPPED') return;
    const known = this.lastEventRevision ?? this.lastServerRevision;
    if (known !== null && revision > known) this.markGap('SERVER_AHEAD');
  }

  /** Var olmayan varlık için güncelleme/silme geldi → imleç güvenilmez. */
  observeUnknownEntityEvent(): void {
    if (this.state === 'STOPPED') return;
    this.markGap('UNKNOWN_ENTITY_EVENT');
  }

  private rememberEvent(key: string): void {
    if (this.seenEvents.size >= RealtimeSyncAuthority.SEEN_CAP) {
      // En eski girdiyi at (Set ekleme sırasını korur).
      const oldest = this.seenEvents.values().next().value;
      if (oldest !== undefined) this.seenEvents.delete(oldest);
    }
    this.seenEvents.add(key);
  }

  private markGap(reason: GapReason): void {
    this.lastGapReason = reason;
    bump(this.counters, 'suspectedGapCount');
    this.state = 'SUSPECTED_GAP';
  }

  /* ── Yeniden eşitleme ────────────────────────────────────────────── */

  /**
   * Sunucu snapshot'ı alır ve bekleyen yerel mutation'larla uzlaştırır.
   *
   * Sonuç `null` ise resync YAPILMADI (zaten çalışıyor, kapsam yok,
   * backoff dolmadı veya durdurulmuş) — çağıran bunu "başarılı" SAYMAZ.
   */
  async resync(): Promise<{ ok: boolean; items: ReconciliationItem[]; reason: string | null } | null> {
    if (this.state === 'STOPPED' || !this.scope) return null;
    if (this.resyncInFlight) return null;                 // tek resync
    const now = this.options.now();
    if (this.nextResyncAt !== null && now < this.nextResyncAt) return null;

    const scopeAtStart = this.scope;
    const generationAtStart = scopeKey(scopeAtStart);

    this.resyncInFlight = true;
    this.state = 'RESYNCING';
    this.resyncAttempt += 1;
    bump(this.counters, 'resyncAttemptCount');
    const startedAt = now;

    let snapshot: ServerSnapshot;
    try {
      snapshot = await this.options.fetcher.fetchSnapshot(scopeAtStart);
    } catch {
      this.resyncInFlight = false;
      return this.failResync(startedAt, 'SNAPSHOT_FAILED');
    }

    // BAYAT SONUÇ KAPISI — snapshot dönerken hesap/şirket değiştiyse
    // sonuç YENİ kapsama uygulanamaz.
    // (`getState()` üzerinden okumak ŞART: `await` sırasında `stop()` çağrılmış
    //  olabilir; alan doğrudan okunursa TS akış analizi tipi 'RESYNCING'e
    //  daraltıp karşılaştırmayı "imkânsız" sanıyor.)
    if (this.getState() === 'STOPPED' || !this.scope || scopeKey(this.scope) !== generationAtStart) {
      this.resyncInFlight = false;
      bump(this.counters, 'staleCallbackRejectCount');
      return { ok: false, items: [], reason: 'STALE_SCOPE' };
    }

    this.state = 'RECONCILING';
    const items = reconcile(snapshot, this.options.readPending());
    const conflicts = items.filter(
      (i) => i.outcome === 'USER_ACTION' || i.outcome === 'FAIL_CLOSED',
    ).length;

    this.counters.snapshotEntityCount = Math.min(snapshot.entities.length, COUNTER_CAP);
    for (let i = 0; i < conflicts; i++) bump(this.counters, 'reconciliationConflictCount');

    // Boşluk DOĞRULANDI: snapshot yerelden ileriyse gerçekten olay kaçmış.
    const known = this.lastEventRevision ?? this.lastServerRevision;
    if (known !== null && snapshot.revision > known) {
      bump(this.counters, 'confirmedGapCount');
    }

    // `lastServerRevision` YALNIZ burada — başarılı uzlaştırmadan sonra — ilerler.
    this.lastServerRevision = snapshot.revision;
    this.lastEventRevision  = snapshot.revision;
    this.lastResyncAt = this.options.now();
    this.lastResyncDurationMs = this.lastResyncAt - startedAt;
    this.resyncAttempt = 0;
    this.nextResyncAt = null;
    this.resyncInFlight = false;
    bump(this.counters, 'resyncSuccessCount');
    this.state = 'LIVE';

    return { ok: true, items, reason: null };
  }

  private failResync(startedAt: number, reason: string): { ok: false; items: []; reason: string } {
    bump(this.counters, 'resyncFailureCount');
    this.lastResyncDurationMs = this.options.now() - startedAt;

    if (this.resyncAttempt >= MAX_RESYNC_ATTEMPTS) {
      // Sonsuz retry YOK. UI "güncel" DEMEZ.
      this.state = 'DEGRADED';
      this.nextResyncAt = null;
    } else {
      this.state = 'SUSPECTED_GAP';
      this.nextResyncAt =
        this.options.now() + resyncBackoffMs(this.resyncAttempt, this.scope?.subscriptionId ?? '');
    }
    return { ok: false, items: [], reason };
  }

  /** Kullanıcı "tekrar dene" dedi — backoff kapısı sıfırlanır. */
  retryNow(): void {
    if (this.state === 'STOPPED') return;
    this.nextResyncAt = null;
    if (this.state === 'DEGRADED') {
      this.resyncAttempt = 0;
      this.state = 'SUSPECTED_GAP';
    }
  }

  /* ── Gözlem (salt-okuma) ─────────────────────────────────────────── */

  view(): AuthoritySnapshotView {
    return {
      state:               this.state,
      scope:               this.scope,
      lastServerRevision:  this.lastServerRevision,
      lastEventRevision:   this.lastEventRevision,
      lastEventAt:         this.lastEventAt,
      connectedAt:         this.connectedAt,
      disconnectedAt:      this.disconnectedAt,
      lastResyncAt:        this.lastResyncAt,
      lastResyncDurationMs:this.lastResyncDurationMs,
      lastGapReason:       this.lastGapReason,
      resyncAttempt:       this.resyncAttempt,
      nextResyncAt:        this.nextResyncAt,
      counters:            { ...this.counters },
    };
  }

  getState(): RealtimeState {
    return this.state;
  }
}

/* ── Gözlem kaydı (CAROS LAB için) ─────────────────────────────────────── */

/**
 * LAB'ın okuyabilmesi için aktif otoritenin **salt-okunur** kaydı.
 *
 * Neden kayıt: LAB kendi otoritesini KURMAMALI (gözlem, gözlenen sistemi
 * değiştirmez). Uygulama otoriteyi kurduğunda buraya kaydeder; LAB yalnız
 * varsa okur, yoksa UNAVAILABLE gösterir — sahte 0 ÜRETMEZ.
 */
let _observed: RealtimeSyncAuthority | null = null;

export function registerRealtimeAuthority(authority: RealtimeSyncAuthority | null): void {
  _observed = authority;
}

/** SALT-OKUMA: kayıtlı otorite (yoksa null). Yeni örnek KURMAZ. */
export function peekRealtimeAuthority(): RealtimeSyncAuthority | null {
  return _observed;
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function realtimeStateLabel(state: RealtimeState): string {
  switch (state) {
    case 'IDLE':          return 'Başlatılmadı';
    case 'CONNECTING':    return 'Bağlanıyor';
    case 'LIVE':          return 'Canlı — veriler güncel';
    case 'SUSPECTED_GAP': return 'Bağlantı kesintisi — veriler doğrulanıyor';
    case 'RESYNCING':     return 'Sunucuyla eşitleniyor';
    case 'RECONCILING':   return 'Değişiklikler karşılaştırılıyor';
    case 'DEGRADED':      return 'Eşitlenemedi — veriler güncel olmayabilir';
    case 'STOPPED':       return 'Durduruldu';
  }
}

export function gapReasonLabel(reason: GapReason): string {
  switch (reason) {
    case 'REVISION_JUMP':        return 'Ara değişiklikler kaçırıldı';
    case 'NON_MONOTONIC':        return 'Sıra dışı güncelleme alındı';
    case 'RECONNECTED':          return 'Bağlantı yeniden kuruldu';
    case 'SUBSCRIPTION_REBUILT': return 'Abonelik yenilendi';
    case 'SERVER_AHEAD':         return 'Sunucuda daha yeni veri var';
    case 'MISSING_CURSOR':       return 'Güvenilir başlangıç noktası yok';
    case 'UNKNOWN_ENTITY_EVENT': return 'Tanınmayan kayıt güncellemesi';
    case 'GENERATION_MISMATCH':  return 'Eski oturum bildirimi';
  }
}
