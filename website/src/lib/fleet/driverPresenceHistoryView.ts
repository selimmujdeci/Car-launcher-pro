/**
 * driverPresenceHistoryView.ts — SÜRÜCÜ VARLIĞI GEÇMİŞİ GÖRÜNÜM MODELİ (SAF).
 *
 * ── CEVAPLANAN SORU ───────────────────────────────────────────────────
 * Araç detayında: **"Bu araçta EN SON hangi sürücü görüldü?"**
 *
 * ── BU, "TRIP SÜRÜCÜSÜ" DEĞİLDİR ──────────────────────────────────────
 * Trip attribution bir KARARDIR (`_resolve_driver_presence` verir).
 * "Son görülen sürücü" bir GÖZLEMDİR: araçta fiziksel bir varlık işareti
 * okundu demektir, o yolculuğun ona ait olduğu demek DEĞİLDİR. İkisi
 * karıştırılırsa, doğrulanmamış bir gözlem sessizce bir attribution
 * iddiasına dönüşür.
 *
 * ── DOĞRULANMAMIŞ KAYNAK İSİM GÖSTERMEZ (BAĞLAYICI) ───────────────────
 * Head unit'ten gelen "ben Ahmet'im" beyanı bir kimlik kanıtı değildir.
 * Sunucu bu tür kayıtlarda `driver_id`/`driver_name` alanlarını zaten
 * **NULL** döndürür (migration 050); bu katman da isim UYDURMAZ ve
 * kaynağın doğrulanmadığını açıkça YAZAR.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

/* ── Sözleşme (050 ile birebir) ────────────────────────────────────────── */

export const PRESENCE_HISTORY_STATUSES =
  ['OPEN', 'SUPERSEDED', 'TTL_EXPIRED', 'CLEARED'] as const;
export type PresenceHistoryStatus = (typeof PRESENCE_HISTORY_STATUSES)[number];

export const PRESENCE_HISTORY_SOURCES =
  ['UNKNOWN', 'HEAD_UNIT', 'PHONE', 'BLUETOOTH', 'NFC'] as const;
export type PresenceHistorySource = (typeof PRESENCE_HISTORY_SOURCES)[number];

export const PRESENCE_HISTORY_CONFIDENCES =
  ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'] as const;
export type PresenceHistoryConfidence = (typeof PRESENCE_HISTORY_CONFIDENCES)[number];

/** `list_vehicle_presence_history()` satırı. */
export interface PresenceHistoryRow {
  readonly history_id?: string | null;
  readonly vehicle_id?: string | null;
  /** Doğrulanmamış kaynakta sunucu bunu **NULL** gönderir. */
  readonly driver_id?: string | null;
  readonly driver_name?: string | null;
  readonly source?: string | null;
  readonly confidence?: string | null;
  readonly identity_verifying?: boolean | null;
  readonly detected_at?: string | null;
  readonly expires_at?: string | null;
  readonly expired_at?: string | null;
  readonly duration_ms?: number | string | null;
  readonly close_reason?: string | null;
  readonly status?: string | null;
  readonly refresh_count?: number | null;
}

export interface PresenceHistoryEntryView {
  readonly historyId: string;
  readonly driverId: string | null;
  readonly driverName: string | null;
  readonly source: PresenceHistorySource;
  readonly confidence: PresenceHistoryConfidence;
  readonly identityVerifying: boolean;
  readonly detectedAtMs: number | null;
  readonly expiredAtMs: number | null;
  /** Kapanmamış ve süresi geçmemiş segmentte `null` — sahte 0 YOK. */
  readonly durationMs: number | null;
  readonly status: PresenceHistoryStatus;
  readonly refreshCount: number | null;
}

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

function text(raw: unknown): string | null {
  return typeof raw === 'string' && raw.trim().length > 0 ? raw.trim() : null;
}

/** ISO → epoch ms; geçersizse `null` (uydurma tarih YOK). */
export function presenceTimeMs(raw: unknown): number | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? null : t;
}

/** PostgREST `bigint` alanları METİN olarak gelebilir. */
function num(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw === 'string' && raw.trim().length > 0) {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function normalizeStatus(v: unknown): PresenceHistoryStatus {
  /* Tanınmayan durum "açık" SAYILMAZ — bilinmeyen bir kayıt, hâlâ araçta
     olduğu iddiasına dönüştürülemez. */
  return (PRESENCE_HISTORY_STATUSES as readonly string[]).includes(String(v))
    ? (v as PresenceHistoryStatus) : 'CLEARED';
}

function normalizeSource(v: unknown): PresenceHistorySource {
  return (PRESENCE_HISTORY_SOURCES as readonly string[]).includes(String(v))
    ? (v as PresenceHistorySource) : 'UNKNOWN';
}

function normalizeConfidence(v: unknown): PresenceHistoryConfidence {
  return (PRESENCE_HISTORY_CONFIDENCES as readonly string[]).includes(String(v))
    ? (v as PresenceHistoryConfidence) : 'UNKNOWN';
}

export function buildPresenceHistoryEntry(row: PresenceHistoryRow): PresenceHistoryEntryView {
  const source = normalizeSource(row.source);
  /* Kimlik doğrulama bayrağı SUNUCUDAN gelir; gelmediyse kaynağa bakılır
     ama asla "doğrulandı" varsayılmaz (fail-closed). */
  const verifying = row.identity_verifying === true
    || (row.identity_verifying == null && (source === 'NFC' || source === 'BLUETOOTH'));
  const driverId = text(row.driver_id);
  return {
    historyId: text(row.history_id) ?? '',
    /* Doğrulanmamış kaynakta kimlik TAŞINMAZ — sunucu zaten göndermez,
       biri gönderirse burada da düşürülür (iki kapı). */
    driverId: verifying ? driverId : null,
    driverName: verifying ? text(row.driver_name) : null,
    source,
    confidence: normalizeConfidence(row.confidence),
    identityVerifying: verifying,
    detectedAtMs: presenceTimeMs(row.detected_at),
    expiredAtMs: presenceTimeMs(row.expired_at),
    durationMs: num(row.duration_ms),
    status: normalizeStatus(row.status),
    refreshCount: typeof row.refresh_count === 'number'
      && Number.isFinite(row.refresh_count) ? row.refresh_count : null,
  };
}

/* ── "Son görülen sürücü" ──────────────────────────────────────────────── */

export interface LastSeenDriverView {
  /** `false` = OKUNAMADI. "Kayıt yok" ile KARIŞTIRILMAZ. */
  readonly readable: boolean;
  /** Defterde bu araç için hiç kayıt var mı. */
  readonly hasRecord: boolean;
  /** Kimlik doğrulayan kaynaktan gelen en son gözlem; yoksa `null`. */
  readonly entry: PresenceHistoryEntryView | null;
  /**
   * Defterde kayıt VAR ama hepsi doğrulanmamış kaynaktan.
   * Bu ayrı gösterilir: "kimse görülmedi" DEMEK DEĞİLDİR.
   */
  readonly unverifiedOnly: boolean;
  /** Gözlem hâlâ açık mı (şu an araçta). */
  readonly isCurrent: boolean;
}

export interface LastSeenDriverInput {
  /** RPC satırları; okuma BAŞARISIZ olduysa `null`. */
  readonly rows: readonly PresenceHistoryRow[] | null;
  readonly readable: boolean;
}

/**
 * Araç detayı için "son görülen sürücü".
 *
 * Doğrulanmamış kaynaklı kayıtlar bir sürücü ADI olarak SUNULMAZ; yalnız
 * "doğrulanmamış gözlem var" bilgisi taşınır. Satırlar sunucudan
 * `detected_at DESC` gelir; bu katman sıralamaya GÜVENMEZ ve kendi
 * en yenisini seçer (bozuk sıralama sessizce yanlış sürücü göstermesin).
 */
export function buildLastSeenDriverView(input: LastSeenDriverInput): LastSeenDriverView {
  if (!input.readable || input.rows === null) {
    return {
      readable: false, hasRecord: false, entry: null,
      unverifiedOnly: false, isCurrent: false,
    };
  }

  const entries = input.rows
    .map(buildPresenceHistoryEntry)
    .filter((e) => e.historyId.length > 0);

  if (entries.length === 0) {
    return {
      readable: true, hasRecord: false, entry: null,
      unverifiedOnly: false, isCurrent: false,
    };
  }

  const newest = (list: readonly PresenceHistoryEntryView[]) =>
    list.reduce<PresenceHistoryEntryView | null>((best, e) => {
      if (e.detectedAtMs === null) return best;
      if (best === null || best.detectedAtMs === null) return e;
      return e.detectedAtMs > best.detectedAtMs ? e : best;
    }, null);

  const verified = newest(entries.filter((e) => e.identityVerifying));

  return {
    readable: true,
    hasRecord: true,
    entry: verified,
    unverifiedOnly: verified === null,
    isCurrent: verified !== null && verified.status === 'OPEN',
  };
}

/* ── Kullanıcıya dönük etiketler ───────────────────────────────────────── */

export function presenceHistoryStatusLabel(s: PresenceHistoryStatus): string {
  switch (s) {
    case 'OPEN':        return 'Şu an araçta';
    case 'SUPERSEDED':  return 'Yerine başka sürücü geçti';
    case 'TTL_EXPIRED': return 'Gözlemin süresi doldu';
    case 'CLEARED':     return 'Oturum temizlendi';
  }
}

export function presenceHistorySourceLabel(s: PresenceHistorySource): string {
  switch (s) {
    case 'NFC':       return 'NFC kart';
    case 'BLUETOOTH': return 'Bluetooth';
    case 'PHONE':     return 'Telefon';
    case 'HEAD_UNIT': return 'Araç ekranı';
    case 'UNKNOWN':   return 'Bilinmiyor';
  }
}

/**
 * "Son görülen sürücü" metni.
 *
 * ── ASLA ────────────────────────────────────────────────────────────────
 *   · okunamadı  → "Kayıt yok"        (ikisi AYRI şeydir)
 *   · doğrulanmamış gözlem → bir İSİM (beyan kimlik değildir)
 *   · kayıt yok  → araç sahibi / son giriş yapan (varlık ≠ erişim)
 */
export function lastSeenDriverLabel(v: LastSeenDriverView): string {
  if (!v.readable) return 'Okunamadı';
  if (!v.hasRecord) return 'Kayıt yok';
  if (v.entry === null) {
    return v.unverifiedOnly
      ? 'Doğrulanmamış gözlem — sürücü belirlenemedi'
      : 'Kayıt yok';
  }
  return v.entry.driverName ?? 'Sürücü kaydı bulunamadı';
}

/** Süre metni — bilinmiyorsa UYDURULMAZ. */
export function presenceDurationLabel(ms: number | null): string {
  if (ms === null) return 'Veri yok';
  if (ms < 60_000) return `${Math.max(0, Math.floor(ms / 1_000))} sn`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} dk`;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return m === 0 ? `${h} sa` : `${h} sa ${m} dk`;
}

/**
 * Ayrıntı satırı: kaynak · durum · süre.
 *
 * Kanıt yoksa boş döner — "bilinmiyor" bile YAZILMAZ, çünkü gösterecek
 * bir gözlem yoktur.
 */
export function lastSeenDetailLabel(v: LastSeenDriverView): string | null {
  if (!v.readable || v.entry === null) return null;
  const parts = [
    presenceHistorySourceLabel(v.entry.source),
    presenceHistoryStatusLabel(v.entry.status),
  ];
  if (v.entry.durationMs !== null) {
    parts.push(presenceDurationLabel(v.entry.durationMs));
  }
  return parts.join(' · ');
}
