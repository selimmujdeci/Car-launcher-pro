/**
 * mediaAuthorityEvents.ts — MÜZİK HUB PAKET B · Bounded yapılandırılmış olay izi.
 *
 * NEDEN: Paket A sayaç ve anlık görüntü üretiyordu; "şu an ne durumda" sorusuna
 * cevap veriyordu ama **"cihazda az önce NE OLDU"** sorusuna veremiyordu. Gerçek
 * araç doğrulaması sıralı olay gerektirir: focus istendi → verildi → kayboldu →
 * duraklatıldı → geri geldi. Tek bir anlık görüntü bu zinciri gösteremez.
 *
 * TASARIM:
 *   - Sabit boyutlu halka tampon (bellek sınırlı, sızıntı YOK).
 *   - **Monotonic zaman**: `performance.now()` tercih edilir; sistem saati
 *     atlarsa (araçta kontak/RTC) sıra bozulmaz.
 *   - Ardışık AYNI olay bastırılır (`repeat` sayacı) — focus churn'de tampon
 *     tek bir olayla dolup teşhis kaybolmasın.
 *   - Yazma O(1), tahsis en fazla bir nesne; hot-path'te JSON üretilmez.
 *
 * GİZLİLİK (pazarlıksız): parça başlığı · sanatçı · **URL/URI** · token · kişi
 * verisi BURAYA GİRMEZ. Yalnız sabit olay adı, kaynak SINIFI, sayısal durum ve
 * bounded hata kodu tutulur. `detail` alanı allowlist'ten geçer.
 */

/** Kaydedilebilir olaylar — sabit küme (serbest metin YASAK). */
export type MediaEventType =
  // Servis / oynatıcı yaşam döngüsü
  | 'service_created' | 'service_destroyed'
  | 'player_created' | 'player_released'
  | 'media_session_created' | 'media_session_released'
  // Audio focus
  | 'focus_requested' | 'focus_granted' | 'focus_denied' | 'focus_delayed'
  | 'focus_lost' | 'focus_duck' | 'focus_regained'
  | 'becoming_noisy' | 'route_changed'
  // Komut hattı
  | 'command_received' | 'command_accepted' | 'command_rejected'
  | 'playback_state_changed'
  // Kaynak devri
  | 'source_switch_started' | 'source_switch_completed' | 'source_switch_failed'
  // Kuyruk kurtarma
  | 'queue_drift_detected'
  | 'queue_recovery_started' | 'queue_recovery_completed' | 'queue_recovery_failed'
  // Process restore
  | 'process_restore_started' | 'process_restore_completed'
  // Bayat olay reddi
  | 'stale_callback_rejected';

/** `detail` alanında kabul edilen sabit kodlar — serbest metin sızıntısını keser. */
const ALLOWED_DETAIL = /^[A-Za-z0-9_.:-]{1,48}$/;

export interface MediaEvent {
  readonly seq: number;
  /** Monotonic ms (uygulama başlangıcına göre) — sistem saati atlaması etkilemez. */
  readonly atMs: number;
  readonly type: MediaEventType;
  /** Otorite generation'ı — bayat olayları ayırt etmek için. */
  readonly generation: number;
  /** Kaynak SINIFI (LOCAL/STREAM/...) — parça kimliği DEĞİL. */
  readonly source: string;
  /** Komut kimliği (üretilen sayaç tabanlı kimlik; kullanıcı verisi taşımaz). */
  readonly commandId: string | null;
  readonly queueRevision: number | null;
  readonly playerState: string | null;
  readonly focusState: string | null;
  /** Bounded hata/sebep kodu (allowlist'ten geçmiş). */
  readonly detail: string | null;
  /** Ardışık aynı olayın bastırılan tekrar sayısı (0 = tekrar yok). */
  readonly repeat: number;
}

export interface MediaEventInput {
  readonly type: MediaEventType;
  readonly generation?: number;
  readonly source?: string;
  readonly commandId?: string | null;
  readonly queueRevision?: number | null;
  readonly playerState?: string | null;
  readonly focusState?: string | null;
  readonly detail?: string | null;
}

/** Halka kapasitesi — düşük-uç bellek bütçesi. */
export const MAX_EVENTS = 120;

const _events: MediaEvent[] = [];
let _seq = 0;
let _dropped = 0;

/** Monotonic saat — `performance.now` yoksa 0'dan artan sayaç (asla geri gitmez). */
let _fallbackClock = 0;
function monotonicNow(): number {
  try {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
      return Math.round(performance.now());
    }
  } catch { /* fail-soft */ }
  _fallbackClock += 1;
  return _fallbackClock;
}

function sanitizeDetail(v: string | null | undefined): string | null {
  if (typeof v !== 'string' || v.length === 0) return null;
  // Allowlist DIŞI her şey düşer: URL, başlık, sanatçı, token buradan GEÇEMEZ.
  return ALLOWED_DETAIL.test(v) ? v : null;
}

function sanitizeSource(v: string | undefined): string {
  if (typeof v !== 'string' || v.length === 0) return 'NONE';
  return ALLOWED_DETAIL.test(v) ? v : 'INVALID';
}

/** Ardışık aynı olay mı (tekrar bastırma kararı). */
function isSameAsLast(input: MediaEventInput, last: MediaEvent | undefined): boolean {
  if (!last) return false;
  return last.type === input.type
    && last.source === sanitizeSource(input.source)
    && last.detail === sanitizeDetail(input.detail)
    && last.focusState === (input.focusState ?? null)
    && last.playerState === (input.playerState ?? null);
}

/**
 * Olay kaydeder. FAIL-SOFT: kayıt hiçbir koşulda oynatmayı bozmaz.
 * Ardışık aynı olay yeni kayıt AÇMAZ, `repeat` sayacını artırır.
 */
export function recordMediaEvent(input: MediaEventInput): void {
  try {
    const last = _events[_events.length - 1];
    if (isSameAsLast(input, last)) {
      _events[_events.length - 1] = { ...last, repeat: last.repeat + 1, atMs: monotonicNow() };
      return;
    }

    _seq += 1;
    _events.push({
      seq: _seq,
      atMs: monotonicNow(),
      type: input.type,
      generation: typeof input.generation === 'number' ? input.generation : 0,
      source: sanitizeSource(input.source),
      commandId: typeof input.commandId === 'string' && ALLOWED_DETAIL.test(input.commandId)
        ? input.commandId
        : null,
      queueRevision: typeof input.queueRevision === 'number' && Number.isFinite(input.queueRevision)
        ? input.queueRevision
        : null,
      playerState: input.playerState ?? null,
      focusState: input.focusState ?? null,
      detail: sanitizeDetail(input.detail),
      repeat: 0,
    });

    while (_events.length > MAX_EVENTS) { _events.shift(); _dropped += 1; }
  } catch { /* olay yazımı ASLA medya akışını bozmaz */ }
}

export interface MediaEventSnapshot {
  readonly events: readonly MediaEvent[];
  readonly capacity: number;
  /** Tampon dolduğu için DÜŞEN olay sayısı — "hiç olmadı" ile karıştırılmaz. */
  readonly dropped: number;
  readonly total: number;
}

/** Bounded, salt-okunur anlık görüntü (LAB okur). */
export function getMediaEvents(): MediaEventSnapshot {
  return {
    events: _events.slice(),
    capacity: MAX_EVENTS,
    dropped: _dropped,
    total: _seq,
  };
}

/** Yalnız belirli türleri süz — LAB filtreleri için (kopya döner). */
export function filterMediaEvents(types: readonly MediaEventType[]): readonly MediaEvent[] {
  const set = new Set(types);
  return _events.filter((e) => set.has(e.type));
}

export function __resetMediaEventsForTest(): void {
  _events.length = 0;
  _seq = 0;
  _dropped = 0;
  _fallbackClock = 0;
}
