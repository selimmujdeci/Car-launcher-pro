/**
 * driverAssignmentSnapshot.ts — HEAD UNIT SÜRÜCÜ ATAMA ANLIK GÖRÜNTÜSÜ.
 *
 * ── NE YAPAR ──────────────────────────────────────────────────────────
 * Trip BAŞLADIĞINDA sunucudan aktif atamayı bir kez okur ve **değişmez**
 * bir snapshot olarak tutar. Trip boyunca bu snapshot SESSİZCE DEĞİŞMEZ:
 * yolculuğun ortasında yönetici atamayı değiştirse bile, o yolculuğun
 * başladığı andaki gerçek korunur. Nihai hüküm yine de sunucudadır
 * (kapanışta backend attribution yeniden hesaplar).
 *
 * ── NE YAPMAZ ─────────────────────────────────────────────────────────
 * · Sürücü SEÇTİRMEZ — head unit'te güvenli kimlik doğrulama yoktur.
 *   Serbest sürücü seçimi açmak, "kim olduğunu iddia eden herkes o kişi
 *   sayılır" demektir; bu, attribution'ı kanıt olmaktan çıkarır.
 * · Kişisel veri TUTMAZ — sunucu zaten ehliyet/telefon/e-posta göndermez.
 * · SÜRESİZ CACHE tutmaz — bayat snapshot `UNKNOWN`'a düşer.
 *
 * ── GERÇEK CİHAZ DURUMU ───────────────────────────────────────────────
 * Bu modül gerçek head unit'te HİÇ ÇALIŞTIRILMADI. Sözleşme ve testler
 * hazırdır; saha doğrulaması `BLOCKED_REAL_DEVICE`'tır.
 *
 * ⚠️ DAHA TEMELİ — KABLO YOK (2026-08-21 denetimi): yukarıdaki "trip
 * başladığında okur" cümlesi TASARIMI anlatır, ÜRÜNÜ değil. `capture()`
 * ürün kodunda hiçbir yerden ÇAĞRILMIYOR (yalnız testlerden) → üründe
 * `fetchCount` DAİMA 0, snapshot DAİMA `UNKNOWN`. Yani bu, "cihazda
 * denenmedi" değil "hiç bağlanmadı" durumudur; ikisini karıştırmak
 * özelliği olduğundan hazır gösterir. Borç: kütük #690.
 *
 * SAF DEĞİL (ağ okur) ama: timer YOK · abonelik YOK · otomatik yenileme YOK.
 */

import { callVehicleRpc } from '../vehicleIdentityService';

/* ── Sözleşme ──────────────────────────────────────────────────────────── */

export const SNAPSHOT_STATUSES = ['ACTIVE', 'UNKNOWN', 'STALE'] as const;
export type SnapshotStatus = (typeof SNAPSHOT_STATUSES)[number];

/**
 * Trip başlangıcında alınan **değişmez** atama görüntüsü.
 *
 * Hassas kişisel veri YOKTUR: `displayName` head unit ekranında "kim
 * atanmış" göstermek için gereken asgari alandır; ehliyet, telefon,
 * e-posta ve kullanıcı kimliği taşınmaz.
 */
export interface DriverAssignmentSnapshot {
  readonly status: SnapshotStatus;
  readonly driverId: string | null;
  readonly assignmentId: string | null;
  readonly assignmentRevision: number | null;
  readonly displayName: string | null;
  readonly source: string | null;
  readonly confidence: string | null;
  /** Atamanın geçerlilik aralığı (epoch ms). */
  readonly validFromMs: number | null;
  readonly validUntilMs: number | null;
  /** Bu snapshot'ın alındığı an (epoch ms) — yaş buradan hesaplanır. */
  readonly capturedAtMs: number | null;
  /** Neden `UNKNOWN` — sessiz boşluk YOK. */
  readonly reason: string | null;
}

export const UNKNOWN_SNAPSHOT: DriverAssignmentSnapshot = Object.freeze({
  status: 'UNKNOWN', driverId: null, assignmentId: null,
  assignmentRevision: null, displayName: null, source: null, confidence: null,
  validFromMs: null, validUntilMs: null, capturedAtMs: null, reason: 'NOT_CAPTURED',
});

/**
 * SNAPSHOT YAŞ SINIRI (ms).
 *
 * NEDEN GEREKLİ: cihaz günlerce çevrimdışı kalabilir. Sınırsız cache,
 * üç gün önce görevden alınmış bir sürücünün bugünkü yolculuğa
 * bağlanmasına yol açar. 12 saat, bir vardiyayı kapsayacak kadar uzun,
 * atama değişikliğini kaçırmayacak kadar kısadır.
 */
export const SNAPSHOT_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/* ── Saf yardımcılar (test edilebilir) ─────────────────────────────────── */

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function timeMs(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.length > 0) {
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

/**
 * Sunucu yanıtını snapshot'a daraltır.
 *
 * Beklenmeyen/eksik alan UYDURULMAZ. Sunucu `ACTIVE` demediyse veya
 * sürücü kimliği yoksa sonuç `UNKNOWN`'dır.
 */
export function parseAssignmentSnapshot(
  raw: unknown,
  capturedAtMs: number,
): DriverAssignmentSnapshot {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const status = String(o.status ?? '');
  const driverId = str(o.driverId);

  if (status !== 'ACTIVE' || driverId === null) {
    return {
      ...UNKNOWN_SNAPSHOT,
      capturedAtMs: Number.isFinite(capturedAtMs) ? capturedAtMs : null,
      reason: str(o.reason) ?? 'NO_ACTIVE_ASSIGNMENT',
    };
  }

  return {
    status: 'ACTIVE',
    driverId,
    assignmentId: str(o.assignmentId),
    assignmentRevision: num(o.assignmentRevision),
    displayName: str(o.displayName),
    source: str(o.source),
    confidence: str(o.confidence),
    validFromMs: timeMs(o.validFrom),
    validUntilMs: timeMs(o.validUntil),
    capturedAtMs: Number.isFinite(capturedAtMs) ? capturedAtMs : null,
    reason: null,
  };
}

/**
 * Snapshot hâlâ kullanılabilir mi.
 *
 * Üç kapı: (1) yakalanmış olmalı, (2) yaş sınırını aşmamalı,
 * (3) atamanın geçerlilik aralığı hâlâ sürmeli.
 * Herhangi biri düşerse `STALE` — ve bayat snapshot **sürücü kanıtı
 * DEĞİLDİR**; attribution `UNKNOWN`'a düşer.
 */
export function evaluateSnapshotFreshness(
  snap: DriverAssignmentSnapshot,
  nowMs: number,
  maxAgeMs: number = SNAPSHOT_MAX_AGE_MS,
): SnapshotStatus {
  if (snap.status !== 'ACTIVE' || snap.capturedAtMs === null) return 'UNKNOWN';
  if (nowMs - snap.capturedAtMs > maxAgeMs) return 'STALE';
  if (snap.validUntilMs !== null && nowMs > snap.validUntilMs) return 'STALE';
  if (snap.validFromMs !== null && nowMs < snap.validFromMs) return 'STALE';
  return 'ACTIVE';
}

/* ── Runtime (ince kablolama) ──────────────────────────────────────────── */

class DriverSnapshotRuntime {
  private _snapshot: DriverAssignmentSnapshot = UNKNOWN_SNAPSHOT;
  private _lastFetchAtMs: number | null = null;
  private _lastFailureReason: string | null = null;
  private _fetchCount = 0;
  private _inFlight = false;

  /**
   * Sunucudan aktif atamayı bir kez okur.
   *
   * ⚠️ ÇAĞIRAN YOK (2026-08-21 denetimi). Bu yorum daha önce "Çağıran: trip
   * başlangıcı" diyordu — repoda böyle bir çağrı HİÇ OLMADI. Tasarlanan yer
   * doğruydu, kablolama yazılmadı: `capture()` yalnız testlerden çağrılıyor,
   * dolayısıyla `fetchCount` üründe DAİMA 0 ve snapshot DAİMA `UNKNOWN`.
   * CAROS LAB · Fleet Driver Identity ekranı bu yüzden cihazda boş görünür ve
   * bunu dürüstçe "zincirin bu ucu bağlı değil" diye gösterir.
   *
   * Yorumu düzeltmek kabloyu KURMAZ; borç kütükte #690 olarak açıktır. Buraya
   * bir çağıran eklendiğinde bu not silinmeli, aksi hâlde ters yönde yalan olur.
   *
   * Otomatik yenileme YOKTUR — trip boyunca snapshot bilinçli olarak dondurulur.
   */
  async capture(nowMs: number): Promise<DriverAssignmentSnapshot> {
    if (this._inFlight) return this._snapshot;
    this._inFlight = true;
    try {
      const raw = await callVehicleRpc('get_active_driver_assignment', {});
      this._fetchCount += 1;
      this._lastFetchAtMs = nowMs;
      if (raw === null) {
        /* Ağ/RPC hatası → sürücü UYDURULMAZ. */
        this._lastFailureReason = 'TRANSPORT';
        this._snapshot = { ...UNKNOWN_SNAPSHOT, capturedAtMs: nowMs, reason: 'TRANSPORT' };
        return this._snapshot;
      }
      this._lastFailureReason = null;
      this._snapshot = parseAssignmentSnapshot(raw, nowMs);
      return this._snapshot;
    } catch {
      this._lastFailureReason = 'EXCEPTION';
      this._snapshot = { ...UNKNOWN_SNAPSHOT, capturedAtMs: nowMs, reason: 'EXCEPTION' };
      return this._snapshot;
    } finally {
      this._inFlight = false;
    }
  }

  /** Snapshot'ı temizler (trip kapanışı / araç değişimi). */
  clear(): void {
    this._snapshot = UNKNOWN_SNAPSHOT;
  }

  /** LAB salt-okur — ASLA fırlatmaz, hiçbir şey tetiklemez. */
  read(): {
    readonly snapshot: DriverAssignmentSnapshot;
    readonly lastFetchAtMs: number | null;
    readonly lastFailureReason: string | null;
    readonly fetchCount: number;
  } {
    try {
      return {
        snapshot: this._snapshot,
        lastFetchAtMs: this._lastFetchAtMs,
        lastFailureReason: this._lastFailureReason,
        fetchCount: this._fetchCount,
      };
    } catch {
      return {
        snapshot: UNKNOWN_SNAPSHOT, lastFetchAtMs: null,
        lastFailureReason: null, fetchCount: 0,
      };
    }
  }
}

export const driverSnapshotRuntime = new DriverSnapshotRuntime();

/** LAB salt-okuma yüzeyi — hiçbir ağ çağrısı TETİKLEMEZ. */
export function readDriverSnapshot() {
  return driverSnapshotRuntime.read();
}
