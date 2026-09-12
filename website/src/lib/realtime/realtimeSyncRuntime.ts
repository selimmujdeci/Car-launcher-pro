/**
 * realtimeSyncRuntime.ts — `useRealtime` ↔ `RealtimeSyncAuthority` ADAPTÖRÜ.
 *
 * ── NEDEN AYRI DOSYA ──────────────────────────────────────────────────
 * `useRealtime` mevcut Supabase motorunu (kanal kurma, araç kümesi, bildirim)
 * yönetir. Boşluk (gap) kararı ORADA VERİLMEZ — verilirse ikinci bir otorite
 * doğar ve iki yerden "veriler güncel mi?" cevabı çıkar. Bu adaptör tek yönlü
 * bir köprüdür: motorun ham sinyallerini (bağlantı durumu, olay) otoriteye
 * taşır, kararı YALNIZ otorite verir.
 *
 * ── REVİZYON KAYNAĞI (dürüst sınır) ───────────────────────────────────
 * Supabase realtime payload'ları sunucu revizyonu TAŞIMAZ. Bu yüzden
 * revizyon YALNIZ snapshot'tan okunur (`vehicles.revision`, migration 039).
 * Kolon yoksa (039 uygulanmamış ortam) snapshot yine alınır ama revizyon
 * `0` kalır ve `revisionSource: 'UNAVAILABLE'` raporlanır:
 *   · reconnect → snapshot → LIVE akışı ÇALIŞIR (asıl kazanç budur),
 *   · `SERVER_AHEAD` sinyali devre dışı kalır (uydurma revizyon ÜRETİLMEZ).
 * LAB bu farkı gösterir; "gap tespiti tam çalışıyor" iddiası edilmez.
 */

import {
  RealtimeSyncAuthority,
  registerRealtimeAuthority,
  type RealtimeScope,
  type ServerSnapshot,
  type SnapshotEntity,
  type SnapshotFetcher,
  type PendingLocalEntity,
  type ReconciliationItem,
} from './realtimeSyncAuthority';

/** `useRealtime`'ın motorundan gelen bağlantı durumu. */
export type EngineConnectionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export type RevisionSource = 'SERVER_REVISION' | 'UNAVAILABLE';

/* ── Snapshot getirici ─────────────────────────────────────────────────── */

/** Snapshot okuma yüzeyi — Supabase istemcisinden AYRILMIŞ (test edilebilirlik). */
export interface VehicleSnapshotReader {
  /**
   * Kullanıcının erişebildiği araçları döndürür. RLS kapsamı zaten süzer.
   * `revision` alanı yoksa `null` verilmelidir — uydurulmaz.
   */
  readVehicles(): Promise<readonly {
    id: string;
    revision: number | null;
    deleted?: boolean;
  }[]>;
}

/**
 * Snapshot'ı araç listesinden kurar.
 *
 * Snapshot revizyonu = araç revizyonlarının EN BÜYÜĞÜ. Monoton artan bir
 * değerdir (039 trigger'ı yalnız sahiplik/kimlik değişiminde artırır), bu
 * yüzden "sunucu ilerledi mi?" sorusuna güvenilir cevap verir.
 * Hiçbir araçta revizyon yoksa 0 → SERVER_AHEAD sinyali kullanılmaz.
 */
export class VehicleSnapshotFetcher implements SnapshotFetcher {
  lastRevisionSource: RevisionSource = 'UNAVAILABLE';

  constructor(private readonly reader: VehicleSnapshotReader) {}

  async fetchSnapshot(_scope: RealtimeScope): Promise<ServerSnapshot> {
    void _scope;
    const rows = await this.reader.readVehicles();

    let maxRevision = 0;
    let sawRevision = false;
    const entities: SnapshotEntity[] = [];

    for (const row of rows) {
      const revision = typeof row.revision === 'number' && Number.isFinite(row.revision)
        ? row.revision
        : null;
      if (revision !== null) {
        sawRevision = true;
        if (revision > maxRevision) maxRevision = revision;
      }
      entities.push({
        entityId:   row.id,
        entityKind: 'vehicle',
        revision:   revision ?? 0,
        deleted:    row.deleted === true,
      });
    }

    this.lastRevisionSource = sawRevision ? 'SERVER_REVISION' : 'UNAVAILABLE';
    return { revision: maxRevision, entities, takenAt: 0 };
  }
}

/* ── Runtime ───────────────────────────────────────────────────────────── */

export interface RuntimeOptions {
  now:      () => number;
  reader:   VehicleSnapshotReader;
  /** Bekleyen yerel mutation'lar — uzlaştırma girdisi. */
  readPending: () => readonly PendingLocalEntity[];
  /** Uzlaştırma sonucu tüketicisi (store temizliği vb.). Hata YUTULUR. */
  onReconciled?: (items: readonly ReconciliationItem[]) => void;
}

/**
 * TEK REALTIME RUNTIME'I.
 *
 * · `start(scope)` — abonelik kurulurken çağrılır.
 * · `onConnectionStatus(status)` — motorun durum geçişleri buraya akar.
 *   `connected` DOĞRUDAN LIVE YAPMAZ: otorite `SUSPECTED_GAP`'e düşer ve
 *   snapshot tetiklenir.
 * · `stop()` — çıkış/hesap değişimi: abort + kayıt silme + zamanlayıcı yok.
 *
 * Zamanlayıcı KULLANMAZ: yeniden deneme, bir sonraki bağlantı olayında veya
 * `tick()` çağrısında backoff kapısıyla değerlendirilir → zombi timer olamaz.
 */
export class RealtimeSyncRuntime {
  private readonly authority: RealtimeSyncAuthority;
  private readonly fetcher: VehicleSnapshotFetcher;
  private scope: RealtimeScope | null = null;
  private lastStatus: EngineConnectionStatus | null = null;
  private resyncChain: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly options: RuntimeOptions) {
    this.fetcher = new VehicleSnapshotFetcher(options.reader);
    this.authority = new RealtimeSyncAuthority({
      now: options.now,
      fetcher: this.fetcher,
      readPending: options.readPending,
    });
  }

  /** Aboneliği başlatır ve otoriteyi LAB gözlemine kaydeder. */
  start(scope: RealtimeScope): void {
    this.stopped = false;
    this.scope = scope;
    this.authority.start(scope);
    registerRealtimeAuthority(this.authority);
  }

  /**
   * Motorun bağlantı durumu değişti.
   *
   * KRİTİK: `connected` geldiğinde otorite `connected()` çağrısıyla
   * **SUSPECTED_GAP**'e düşer — snapshot alınmadan LIVE OLUNMAZ.
   */
  onConnectionStatus(status: EngineConnectionStatus): void {
    if (this.stopped || !this.scope) return;
    if (status === this.lastStatus) return;      // yinelenen bildirim
    this.lastStatus = status;

    switch (status) {
      case 'connected':
        this.authority.connected();
        this.scheduleResync();
        break;
      case 'disconnected':
      case 'error':
        this.authority.disconnected();
        break;
      case 'connecting':
        break;                                   // durum değiştirmez
    }
  }

  /**
   * Resync'i **seri** kuyruğa alır: eşzamanlı iki reconnect callback'i iki
   * snapshot isteği üretemez. Otorite ayrıca kendi tek-uçuş kilidini uygular
   * (çift savunma).
   */
  scheduleResync(): void {
    if (this.stopped) return;
    this.resyncChain = this.resyncChain
      .then(() => this.runResync())
      .catch(() => { /* fail-soft: zincir kopmaz */ });
  }

  private async runResync(): Promise<void> {
    if (this.stopped) return;

    // Zaten güvenilir durumdaysak snapshot İSTEMEYİZ. Zincire birden fazla
    // istek düşmüş olabilir (iki reconnect callback'i); ilki LIVE yaptıysa
    // kalanlar sunucuya gereksiz yük bindirmemelidir — reconnect fırtınasında
    // bu fark tek istek ile onlarca istek arasındaki farktır.
    if (this.authority.getState() === 'LIVE') return;

    const result = await this.authority.resync();
    if (!result || !result.ok) return;           // başarısızsa LIVE olunmadı
    if (this.stopped) return;
    try {
      this.options.onReconciled?.(result.items);
    } catch {
      /* tüketici hatası otoriteyi bozmaz */
    }
  }

  /** Backoff dolduysa yeniden dener (dış tetikleyici; timer YOK). */
  tick(): void {
    if (this.stopped) return;
    if (this.authority.getState() === 'LIVE') return;
    this.scheduleResync();
  }

  /** Kullanıcı "tekrar dene" dedi. */
  retryNow(): void {
    if (this.stopped) return;
    this.authority.retryNow();
    this.scheduleResync();
  }

  /**
   * Çıkış / hesap değişimi / unmount.
   * Uçuştaki resync'in sonucu artık uygulanamaz ve LAB kaydı bırakılır.
   */
  stop(): void {
    this.stopped = true;
    this.authority.stop();
    this.scope = null;
    this.lastStatus = null;
    registerRealtimeAuthority(null);
  }

  /** UI "veriler güncel" diyebilir mi — TEK KARAR NOKTASI. */
  isTrustworthy(): boolean {
    return this.authority.getState() === 'LIVE';
  }

  getAuthority(): RealtimeSyncAuthority {
    return this.authority;
  }

  getRevisionSource(): RevisionSource {
    return this.fetcher.lastRevisionSource;
  }
}

/* ── Supabase okuyucu (üretim yolu) ────────────────────────────────────── */

/** Minimal Supabase yüzeyi — tam istemci tipine bağlanmaz (test edilebilirlik). */
export interface SupabaseLikeClient {
  from(table: string): {
    select(columns: string): Promise<{ data: unknown; error: unknown }>;
  };
}

/**
 * Gerçek araç snapshot'ı.
 *
 * `revision` kolonu YOKSA (migration 039 uygulanmamış) sorgu hata verir;
 * bu durumda revizyonsuz kolon kümesiyle TEKRAR denenir ve `revision: null`
 * döndürülür — snapshot yine de alınır, uydurma revizyon ÜRETİLMEZ.
 */
export class SupabaseVehicleSnapshotReader implements VehicleSnapshotReader {
  constructor(private readonly client: SupabaseLikeClient) {}

  async readVehicles(): Promise<readonly { id: string; revision: number | null }[]> {
    const withRevision = await this.client.from('vehicles').select('id, revision');
    if (!withRevision.error && Array.isArray(withRevision.data)) {
      return (withRevision.data as { id?: unknown; revision?: unknown }[])
        .filter((row): row is { id: string; revision: unknown } => typeof row.id === 'string')
        .map((row) => ({
          id: row.id,
          revision: typeof row.revision === 'number' ? row.revision : null,
        }));
    }

    // 039 yok → revizyonsuz devam (fail-soft, sahte revizyon YOK).
    const plain = await this.client.from('vehicles').select('id');
    if (plain.error || !Array.isArray(plain.data)) {
      throw new Error('snapshot_unavailable');   // otorite DEGRADED'e düşer
    }
    return (plain.data as { id?: unknown }[])
      .filter((row): row is { id: string } => typeof row.id === 'string')
      .map((row) => ({ id: row.id, revision: null }));
  }
}

/* ── Tekil örnek (uygulama yolu) ───────────────────────────────────────── */

let _runtime: RealtimeSyncRuntime | null = null;

/** Aktif runtime (yoksa null). LAB ve hook bunu okur; YENİ örnek KURMAZ. */
export function peekRealtimeRuntime(): RealtimeSyncRuntime | null {
  return _runtime;
}

/**
 * Runtime'ı kurar. Zaten varsa ÖNCE durdurulur → aynı anda iki runtime
 * (dolayısıyla iki otorite) OLAMAZ.
 */
export function startRealtimeRuntime(
  scope: RealtimeScope,
  options: RuntimeOptions,
): RealtimeSyncRuntime {
  _runtime?.stop();
  _runtime = new RealtimeSyncRuntime(options);
  _runtime.start(scope);
  return _runtime;
}

export function stopRealtimeRuntime(): void {
  _runtime?.stop();
  _runtime = null;
}
