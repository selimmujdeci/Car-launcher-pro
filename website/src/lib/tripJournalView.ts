/**
 * tripJournalView.ts — "ARABAM CEBİMDE" SEYİR DEFTERİ GÖRÜNÜM MODELİ (SAF).
 *
 * ── NE DEĞİLDİR ───────────────────────────────────────────────────────
 * Otorite DEĞİLDİR. Mesafe · süre · hız · skor **cihazda ölçülür**, buluta
 * özet olarak yazılır ve burada yalnız BİÇİMLENDİRİLİR. Bu dosya hiçbir
 * büyüklüğü YENİDEN HESAPLAMAZ — hesaplasaydı aynı sayının ikinci bir
 * sahibi doğar ve iki ekran farklı km gösterirdi.
 *
 * Tek istisna, bir SUNUM türetmesidir: "hareket + duruş" toplamı ayrı ayrı
 * gösterilebilsin diye taşınır; toplam süre yine sunucunun `duration_min`i
 * ile anlatılır, iki parçanın toplamıyla DEĞİL.
 *
 * ── DÜRÜSTLÜK KURALLARI ──────────────────────────────────────────────
 *   1. Kanıt yoksa `null` → "Bilinmiyor". Sahte `0` YASAK.
 *   2. "Okunamadı" ile "yolculuk yok" AYRI durumlardır ve ayrı gösterilir.
 *   3. "Çevrimdışısınız" ile "bu araca erişiminiz yok" AYRI gösterilir.
 *   4. **TAM ROTA YOKTUR.** Bulutta rota izi saklanmaz; bu katman harita
 *      çizgisi ÜRETMEZ ve "rota" vaat etmez.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

import type { TripRow } from '@/lib/fleet/vehicleTripsView';

/* ══════════════════════════════════════════════════════════════════════════
 * Yüzey durumu
 * ════════════════════════════════════════════════════════════════════════ */

export const JOURNAL_SURFACE_STATES = [
  'NO_VEHICLE',    // eşleşmiş araç yok
  'LOADING',       // okuma sürüyor
  'READY',         // en az bir yolculuk var
  'EMPTY',         // okuma BAŞARILI ve gerçekten hiç yolculuk yok
  'OFFLINE',       // cihaz çevrimdışı
  'UNAUTHORIZED',  // oturum yok ya da bu araca yetki yok
  'ERROR',         // okunamadı (sunucu/RPC/ağ)
] as const;
export type JournalSurfaceState = (typeof JOURNAL_SURFACE_STATES)[number];

export interface JournalSurfaceInput {
  readonly hasVehicle: boolean;
  readonly loading: boolean;
  /** Okuma başarısızsa gerekçe; başarılıysa `null`. */
  readonly failure: 'NOT_CONFIGURED' | 'OFFLINE' | 'UNAUTHORIZED' | 'UNAVAILABLE' | null;
  /** Başarılı okumada dönen satır sayısı; okuma yapılmadıysa `null`. */
  readonly rowCount: number | null;
}

/**
 * Yüzey durumunu türet — SAF, fail-closed.
 *
 * SIRALAMA GEREKÇESİ: araç yoksa yükleme/okuma hiç anlamlı değildir; yükleme
 * sürerken bir hata gösterilmez (henüz hüküm yok); hata varsa **boş liste
 * gösterilmez** — bu, "yolculuğunuz yok" yalanı olurdu.
 */
export function deriveJournalSurfaceState(input: JournalSurfaceInput): JournalSurfaceState {
  if (!input || !input.hasVehicle) return 'NO_VEHICLE';
  if (input.loading) return 'LOADING';

  if (input.failure !== null) {
    if (input.failure === 'OFFLINE') return 'OFFLINE';
    if (input.failure === 'UNAUTHORIZED') return 'UNAUTHORIZED';
    return 'ERROR';
  }

  if (input.rowCount === null) return 'LOADING';   // hiç okuma yapılmadı
  return input.rowCount > 0 ? 'READY' : 'EMPTY';
}

export function journalSurfaceMessage(state: JournalSurfaceState): string {
  switch (state) {
    case 'NO_VEHICLE':
      return 'Önce bir araç eşleştirin.';
    case 'LOADING':
      return 'Seyir defteri yükleniyor…';
    case 'READY':
      return '';
    case 'EMPTY':
      return 'Henüz tamamlanmış yolculuk yok. Araç yola çıkıp durduğunda yolculuk burada görünür.';
    case 'OFFLINE':
      return 'Çevrimdışısınız. Seyir defteri bağlantı gelince yüklenecek.';
    case 'UNAUTHORIZED':
      return 'Bu aracın seyir defterini görme yetkiniz yok.';
    case 'ERROR':
      return 'Seyir defteri okunamadı. Bu, yolculuğunuz olmadığı anlamına gelmez.';
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Tek yolculuk girdisi
 * ════════════════════════════════════════════════════════════════════════ */

export interface JournalEntry {
  /** Liste anahtarı — sunucu dedupe anahtarı. Yoksa girdi ATILIR. */
  readonly tripKey: string;
  /** Epoch ms; çözülemezse `null`. */
  readonly startedAtMs: number | null;
  readonly endedAtMs: number | null;
  /** Cihazın yolculuğu kapattığı an — sunucunun GÖRDÜĞÜ an DEĞİL. */
  readonly completedAtMs: number | null;

  readonly startArea: string | null;
  readonly endArea: string | null;

  readonly distanceKm: number | null;
  readonly durationMin: number | null;
  readonly movingMin: number | null;
  readonly stoppedMin: number | null;
  readonly avgSpeedKmh: number | null;
  readonly maxSpeedKmh: number | null;
  readonly score: number | null;

  readonly endReason: string | null;
  /** Kapanış GERÇEK bir bitiş kanıtına mı dayanıyor. */
  readonly cleanEnd: boolean;
  readonly confidence: string | null;
}

/** Sayıya çevir; `numeric` kolonları PostgREST'ten METİN gelebilir. */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/** Negatif olamayacak büyüklük — negatifse ölçüm bozuktur, `null`. */
function nonNeg(v: unknown): number | null {
  const n = num(v);
  return n === null || n < 0 ? null : n;
}

/** ISO damgayı epoch ms'e çevir; çözülemezse `null` (uydurma tarih YOK). */
function ms(v: unknown): number | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  const t = Date.parse(v);
  return Number.isFinite(t) ? t : null;
}

function text(v: unknown, max = 80): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, max) : null;
}

/**
 * RPC satırını görünüm girdisine çevir.
 *
 * `null` döner = satır KULLANILAMAZ (anahtarsız). Bozuk bir satır listeyi
 * düşürmez; yalnız kendisi elenir — bir bozuk kayıt yüzünden kullanıcının
 * bütün geçmişini gizlemek kanıt kaybıdır.
 */
export function buildJournalEntry(row: TripRow | null | undefined): JournalEntry | null {
  if (!row || typeof row !== 'object') return null;
  const tripKey = text(row.trip_key, 200);
  if (tripKey === null) return null;

  const endReason = text(row.end_reason, 40);

  return {
    tripKey,
    startedAtMs: ms(row.started_at),
    endedAtMs: ms(row.ended_at),
    completedAtMs: ms(row.completed_at),
    startArea: text(row.start_area),
    endArea: text(row.end_area),
    distanceKm: nonNeg(row.distance_km),
    durationMin: nonNeg(row.duration_min),
    movingMin: nonNeg(row.moving_time_min),
    stoppedMin: nonNeg(row.idle_time_min),
    avgSpeedKmh: nonNeg(row.avg_speed_kmh),
    maxSpeedKmh: nonNeg(row.max_speed_kmh),
    score: nonNeg(row.score),
    endReason,
    /* Yalnız duruş penceresi GERÇEK bitiş kanıtıdır; veri kesilmesi ya da
       uygulama kapanması "düzgün kapanış" SAYILMAZ. */
    cleanEnd: endReason === 'IDLE_WINDOW',
    confidence: text(row.confidence, 20),
  };
}

/**
 * Satır listesini görünüm listesine çevir — en yeni önce.
 *
 * Sıralama BURADA da uygulanır: sunucu zaten sıralı döner ama bozuk/eksik
 * damgalı satırlar araya karışabilir; kullanıcıya gösterilen sıra
 * tahmine bırakılmaz. Damgası olmayan satırlar SONA düşer (uydurma
 * tarihle öne çekilmezler).
 */
export function buildJournalList(rows: readonly (TripRow | null)[] | null | undefined): JournalEntry[] {
  if (!Array.isArray(rows)) return [];
  const out: JournalEntry[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const e = buildJournalEntry(row);
    if (e === null) continue;
    if (seen.has(e.tripKey)) continue;   // aynı yolculuk iki kez listelenmez
    seen.add(e.tripKey);
    out.push(e);
  }
  out.sort((a, b) => {
    if (a.startedAtMs === null && b.startedAtMs === null) return 0;
    if (a.startedAtMs === null) return 1;
    if (b.startedAtMs === null) return -1;
    return b.startedAtMs - a.startedAtMs;
  });
  return out;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Biçimlendirme
 * ════════════════════════════════════════════════════════════════════════ */

/** Bilinmeyen değerin TEK metni — her yerde aynı kelime. */
export const UNKNOWN_LABEL = 'Bilinmiyor';

export function formatJournalDate(epochMs: number | null): string {
  if (epochMs === null) return UNKNOWN_LABEL;
  return new Date(epochMs).toLocaleDateString('tr-TR', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

export function formatJournalTime(epochMs: number | null): string {
  if (epochMs === null) return '--:--';
  return new Date(epochMs).toLocaleTimeString('tr-TR', {
    hour: '2-digit', minute: '2-digit',
  });
}

/** "18:12 → 19:47". Bilinmeyen uç `--:--` ile gösterilir, GİZLENMEZ. */
export function formatJournalTimeRange(entry: JournalEntry): string {
  return `${formatJournalTime(entry.startedAtMs)} → ${formatJournalTime(entry.endedAtMs)}`;
}

/**
 * "Tarsus → Mersin".
 *
 * İki uç da bilinmiyorsa tek bir "Bilinmiyor" döner — "Bilinmiyor →
 * Bilinmiyor" hem çirkin hem bilgisizdir. Tek uç biliniyorsa öteki uç
 * açıkça bilinmiyor gösterilir (sessizce kısaltmak bilgiyi saklar).
 */
export function formatJournalRoute(entry: JournalEntry): string {
  const a = entry.startArea;
  const b = entry.endArea;
  if (a === null && b === null) return UNKNOWN_LABEL;
  return `${a ?? UNKNOWN_LABEL} → ${b ?? UNKNOWN_LABEL}`;
}

export function formatJournalDistance(km: number | null): string {
  if (km === null) return UNKNOWN_LABEL;
  return `${km.toFixed(1)} km`;
}

export function formatJournalDuration(min: number | null): string {
  if (min === null) return UNKNOWN_LABEL;
  const whole = Math.round(min);
  if (whole < 60) return `${whole} dk`;
  const h = Math.floor(whole / 60);
  const m = whole % 60;
  return m > 0 ? `${h} sa ${m} dk` : `${h} sa`;
}

export function formatJournalSpeed(kmh: number | null): string {
  if (kmh === null) return UNKNOWN_LABEL;
  return `${Math.round(kmh)} km/sa`;
}

/** Skor 0–100. Yoksa "Bilinmiyor" — sahte `0` bir skor DEĞİLDİR. */
export function formatJournalScore(score: number | null): string {
  if (score === null) return UNKNOWN_LABEL;
  return String(Math.round(Math.max(0, Math.min(100, score))));
}

/**
 * Bitiş gerekçesinin kullanıcı metni.
 *
 * Düzgün kapanışta metin GÖSTERİLMEZ (`null`): normal olan şeyi her satıra
 * yazmak gürültüdür. Anormal kapanış ise AÇIKÇA söylenir — kullanıcı süreyi
 * neden tuhaf gördüğünü bilmelidir.
 */
export function journalEndReasonNote(entry: JournalEntry): string | null {
  switch (entry.endReason) {
    case 'IDLE_WINDOW':        return null;
    case 'DATA_SILENCE':       return 'Veri kesildiği için kapandı — süre ve mesafe eksik olabilir.';
    case 'SERVICE_STOPPED':    return 'Uygulama kapandığı için kapandı — bitiş gözlenmedi.';
    case 'DISCARDED_TOO_SHORT': return 'Çok kısa yolculuk.';
    case 'UNKNOWN':            return 'Nasıl bittiği bilinmiyor.';
    default:                   return null;   // eski kayıtlarda alan YOK
  }
}

/** Güven seviyesinin kullanıcı metni; bilinmiyorsa `null` (rozet çizilmez). */
export function journalConfidenceLabel(entry: JournalEntry): string | null {
  switch (entry.confidence) {
    case 'VERY_HIGH': return 'Çok yüksek doğruluk';
    case 'HIGH':      return null;   // normal olan şey rozet TAŞIMAZ
    case 'MEDIUM':    return 'Orta doğruluk';
    case 'LOW':       return 'Düşük doğruluk';
    case 'UNKNOWN':   return 'Doğruluk bilinmiyor';
    default:          return null;
  }
}
