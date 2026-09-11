/**
 * tripJournalStore.ts — SEYİR DEFTERİ YEREL KAYDI (TAM KANIT, CİHAZDA KALIR).
 *
 * ── OTORİTE SINIRI ────────────────────────────────────────────────────
 * Bu depo **hiçbir şey ÖLÇMEZ ve hiçbir şeye KARAR VERMEZ.** Yolculuğun ne
 * zaman başlayıp bittiğine `tripLogService` karar verir; süre/mesafe/skor
 * `TripRecord`'un ve `tripMetricsAccumulator`'ın hükmüdür. Burada yalnız o
 * hükmün DAYANDIĞI ham kanıt saklanır: rota izi · duruşlar · başlangıç/varış
 * konumu · hareket kanıtı · olaylar.
 *
 * Türetilmiş hiçbir büyüklük (km · dk · ort. hız · skor) BU DOSYADA
 * HESAPLANMAZ — hesaplanırsa aynı sayının ikinci bir sahibi doğar.
 *
 * ── BULUTA GİTMEZ ─────────────────────────────────────────────────────
 * Rota izi ve koordinatlar **yalnız bu cihazda** yaşar. `tripUploadRuntime`
 * bu depoyu rota için OKUMAZ; yalnız kaba alan adını (`startArea`/`endArea`)
 * okur. Şema bunu yapısal olarak korur: yükleme yükünde koordinat alanı
 * YOKTUR ve sunucu tablosunda koordinat kolonu YASAKTIR (migration 046/g).
 *
 * ── ÇÖKME SONRASI KURTARMA ────────────────────────────────────────────
 * Açık yolculuk ayrı bir TASLAK anahtarında tutulur. Uygulama çökerse taslak
 * diskte kalır; bir sonraki açılışta `recoverOpenJournal()` onu `UNKNOWN`
 * bitiş gerekçesiyle mühürler. Taslak kaydı SESSİZCE SİLİNMEZ — kanıt kaybı
 * da bir olaydır ve gerekçesiyle birlikte saklanır.
 *
 * ── DEPO SÖZLEŞMESİ ───────────────────────────────────────────────────
 * Mevcut kalıcılık otoritesi (`safeStorage`) KULLANILIR; yeni bir DB
 * açılmaz (CLAUDE.md §5/§6 — kanıt olmadan DB mimarisi değiştirilmez).
 * Büyüme üç kapıyla sınırlıdır: yolculuk başına nokta tavanı · defterdeki
 * yolculuk tavanı · kayıt başına bayt tavanı.
 */

import { safeGetRaw, safeSetRaw } from '../../utils/safeStorage';
import {
  TRIP_JOURNAL_SCHEMA_VERSION,
  ROUTE_MAX_POINTS,
  JOURNAL_MAX_STOPS,
  JOURNAL_MAX_EVENTS,
  decideRouteSample,
  encodeRouteTrace,
  readTripJournalRecord,
  type RoutePoint,
  type JournalPoint,
  type JournalStop,
  type JournalEvent,
  type JournalEventKind,
  type JournalMotionEvidence,
  type TripEndReason,
  type TripJournalRecord,
} from './tripJournalModel';

/* ── Depo anahtarları ──────────────────────────────────────────────────── */

const INDEX_KEY = 'caros.trip.journal.index';
const RECORD_PREFIX = 'caros.trip.journal.rec.';
const DRAFT_KEY = 'caros.trip.journal.draft';

/** Defterde tutulan azami yolculuk — bounded retention. */
export const MAX_JOURNAL_RECORDS = 60;

/**
 * Kayıt başına azami serileştirilmiş boyut (bayt).
 *
 * Aşılırsa kayıt DÜŞÜRÜLMEZ; en büyük alan olan rota izi çıkarılır ve kayıt
 * `route: null` ile saklanır. "Rotayı kaybettik" demek, bütün yolculuğu
 * kaybetmekten dürüsttür.
 */
export const MAX_RECORD_BYTES = 192 * 1024;

/**
 * Taslak yazma kısması (kaydedilen nokta sayısı).
 *
 * Her noktada yazmak eMMC'yi yorar; hiç yazmamak çökmede bütün yolculuğu
 * kaybettirir. 20 nokta ≈ en kötü ihtimalle birkaç yüz metrelik kanıt riski.
 */
const DRAFT_FLUSH_EVERY_POINTS = 20;

/* ══════════════════════════════════════════════════════════════════════════
 * Açık yolculuk taslağı
 * ════════════════════════════════════════════════════════════════════════ */

interface OpenJournal {
  tripId: string;
  startedAtMs: number;
  /** Monotonik başlangıç — offset'ler buradan türer. */
  startMonoMs: number;
  startLocation: JournalPoint | null;
  endLocation: JournalPoint | null;
  points: RoutePoint[];
  stops: JournalStop[];
  events: JournalEvent[];
  motionEvidence: JournalMotionEvidence;
  /** İçinde bulunulan duruşun başlangıç offset'i; hareketteyse `null`. */
  openStopOffsetMs: number | null;
  /** Son taslak yazımından bu yana eklenen nokta sayısı. */
  sinceFlush: number;
}

let _open: OpenJournal | null = null;

/* ══════════════════════════════════════════════════════════════════════════
 * Yaşam döngüsü
 * ════════════════════════════════════════════════════════════════════════ */

export interface BeginJournalInput {
  readonly tripId: string;
  readonly startedAtMs: number;
  readonly startMonoMs: number;
  readonly startLocation: JournalPoint | null;
  readonly motionEvidence: JournalMotionEvidence;
}

/**
 * Yeni yolculuk kaydı aç.
 *
 * Zaten açık bir kayıt varsa **mühürlenmeden ATILMAZ**: önce `SERVICE_STOPPED`
 * gerekçesiyle kapatılır. Aksi halde bir önceki yolculuğun bütün kanıtı
 * sessizce buharlaşırdı.
 */
export function beginJournal(input: BeginJournalInput): void {
  try {
    if (_open !== null) {
      finalizeJournal({
        tripId: _open.tripId, endedAtMs: null, endMonoMs: null,
        endLocation: null, endReason: 'SERVICE_STOPPED',
      });
    }
    if (!input || typeof input.tripId !== 'string' || input.tripId.length === 0) return;
    if (!Number.isFinite(input.startedAtMs) || !Number.isFinite(input.startMonoMs)) return;

    _open = {
      tripId: input.tripId,
      startedAtMs: input.startedAtMs,
      startMonoMs: input.startMonoMs,
      startLocation: input.startLocation ?? null,
      endLocation: null,
      points: [],
      stops: [],
      events: [],
      motionEvidence: input.motionEvidence
        ?? { sampleCount: 0, spanMs: 0, sourceCount: 0 },
      openStopOffsetMs: null,
      sinceFlush: 0,
    };
    _flushDraft();
  } catch { /* kanıt kaydı yolculuk akışını ASLA bozmaz */ }
}

/**
 * Bir konum örneğini işle — ADAPTİF örnekleme kararı modele aittir.
 *
 * @returns nokta gerçekten kaydedildiyse `true`.
 */
export function recordJournalFix(sample: {
  readonly monoMs: number;
  readonly lat: number | null;
  readonly lon: number | null;
  readonly speedKmh: number | null;
  readonly stopped: boolean;
}): boolean {
  try {
    const open = _open;
    if (open === null || !sample || !Number.isFinite(sample.monoMs)) return false;

    const tOffsetMs = Math.max(0, sample.monoMs - open.startMonoMs);
    const last = open.points.length > 0
      ? (open.points[open.points.length - 1] as RoutePoint)
      : null;

    const decision = decideRouteSample({
      lat: sample.lat, lon: sample.lon, tOffsetMs,
      speedKmh: sample.speedKmh, last,
      recordedCount: open.points.length,
      stopped: sample.stopped === true,
    });

    /* Konum kaydedilmese bile VARIŞ konumu güncellenir: son geçerli fix
       yolculuğun bittiği yerdir ve örnekleme kısmasına kurban edilemez. */
    if (sample.lat !== null && sample.lon !== null
      && Number.isFinite(sample.lat) && Number.isFinite(sample.lon)
      && !(sample.lat === 0 && sample.lon === 0)) {
      const p: JournalPoint = { lat: sample.lat, lon: sample.lon };
      open.endLocation = p;
      if (open.startLocation === null) open.startLocation = p;
    }

    if (!decision.record) return false;

    open.points.push({
      lat: sample.lat as number, lon: sample.lon as number,
      tOffsetMs, speedKmh: sample.speedKmh,
    });
    if (open.points.length > ROUTE_MAX_POINTS) open.points.length = ROUTE_MAX_POINTS;

    open.sinceFlush += 1;
    if (open.sinceFlush >= DRAFT_FLUSH_EVERY_POINTS) _flushDraft();
    return true;
  } catch { return false; }
}

/**
 * Duruş durumunu bildir — duruşun BAŞI ve SONU burada mühürlenir.
 *
 * Çağıran karar vermez, yalnız accumulator'ın gözlemini iletir. Aynı duruş
 * iki kez açılmaz; süren duruş `endOffsetMs: null` ile taşınır.
 */
export function recordJournalStopState(monoMs: number, stopped: boolean): void {
  try {
    const open = _open;
    if (open === null || !Number.isFinite(monoMs)) return;
    const offset = Math.max(0, monoMs - open.startMonoMs);

    if (stopped) {
      if (open.openStopOffsetMs !== null) return;   // duruş zaten açık
      if (open.stops.length >= JOURNAL_MAX_STOPS) return;
      open.openStopOffsetMs = offset;
      open.stops.push({ startOffsetMs: offset, endOffsetMs: null, durationMs: 0 });
      _pushEvent(open, 'STOP', offset, null);
      return;
    }

    if (open.openStopOffsetMs === null) return;     // zaten hareketteydi
    const startedAt = open.openStopOffsetMs;
    open.openStopOffsetMs = null;
    const idx = open.stops.length - 1;
    const cur = idx >= 0 ? open.stops[idx] : undefined;
    if (cur !== undefined && cur.endOffsetMs === null) {
      open.stops[idx] = {
        startOffsetMs: cur.startOffsetMs,
        endOffsetMs: offset,
        durationMs: Math.max(0, offset - startedAt),
      };
    }
    _pushEvent(open, 'RESUME', offset, null);
  } catch { /* fail-soft */ }
}

/** Yolculuk içi olay kaydet (koordinat İÇERMEZ). */
export function recordJournalEvent(
  monoMs: number, kind: JournalEventKind, magnitude: number | null,
): void {
  try {
    const open = _open;
    if (open === null || !Number.isFinite(monoMs)) return;
    _pushEvent(open, kind, Math.max(0, monoMs - open.startMonoMs), magnitude);
  } catch { /* fail-soft */ }
}

function _pushEvent(
  open: OpenJournal, kind: JournalEventKind, atOffsetMs: number, magnitude: number | null,
): void {
  if (open.events.length >= JOURNAL_MAX_EVENTS) return;
  open.events.push({
    kind, atOffsetMs,
    magnitude: typeof magnitude === 'number' && Number.isFinite(magnitude)
      ? magnitude : null,
  });
}

export interface FinalizeJournalInput {
  readonly tripId: string;
  /** Duvar saati bitişi; bilinmiyorsa `null` (uydurma tarih YOK). */
  readonly endedAtMs: number | null;
  readonly endMonoMs: number | null;
  readonly endLocation: JournalPoint | null;
  readonly endReason: TripEndReason;
}

/**
 * Açık kaydı mühürle ve kalıcı deftere yaz.
 *
 * `tripId` uyuşmuyorsa kayıt YİNE mühürlenir (kanıt atılmaz) ama gerekçe
 * çağıranınkiyle değil `UNKNOWN` ile yazılır: hangi yolculuğun bittiğini
 * bilmiyorsak bir gerekçe İDDİA EDEMEYİZ.
 *
 * @returns mühürlenen kayıt; açık kayıt yoksa `null`.
 */
export function finalizeJournal(input: FinalizeJournalInput): TripJournalRecord | null {
  try {
    const open = _open;
    if (open === null) return null;
    _open = null;

    const matches = input && input.tripId === open.tripId;
    const reason: TripEndReason = matches ? input.endReason : 'UNKNOWN';

    /* Süren duruş varsa yolculuk bitişinde kapanır. */
    if (open.openStopOffsetMs !== null && input && Number.isFinite(input.endMonoMs)) {
      const endOffset = Math.max(0, (input.endMonoMs as number) - open.startMonoMs);
      const idx = open.stops.length - 1;
      const cur = idx >= 0 ? open.stops[idx] : undefined;
      if (cur !== undefined && cur.endOffsetMs === null) {
        open.stops[idx] = {
          startOffsetMs: cur.startOffsetMs,
          endOffsetMs: endOffset,
          durationMs: Math.max(0, endOffset - cur.startOffsetMs),
        };
      }
    }

    const record: TripJournalRecord = {
      schemaVersion: TRIP_JOURNAL_SCHEMA_VERSION,
      tripId: open.tripId,
      startedAtMs: open.startedAtMs,
      endedAtMs: input && Number.isFinite(input.endedAtMs)
        ? (input.endedAtMs as number) : null,
      endReason: reason,
      startLocation: open.startLocation,
      endLocation: (matches ? input.endLocation : null) ?? open.endLocation,
      startArea: null,
      endArea: null,
      route: encodeRouteTrace(open.points),
      stops: open.stops,
      motionEvidence: open.motionEvidence,
      events: open.events,
    };

    _persistRecord(record);
    _clearDraft();
    return record;
  } catch {
    _open = null;
    return null;
  }
}

/**
 * Kaba alan adını sonradan iliştir (ters geocode ASENKRONDUR).
 *
 * Kayıt mühürlendikten SONRA çağrılır; alan adı bir SÜSLEMEDİR ve onun
 * gecikmesi yolculuğun kaydedilmesini bekletemez. Kayıt bulunamazsa
 * sessizce hiçbir şey yapılmaz — uydurma kayıt YARATILMAZ.
 */
export function attachJournalAreas(
  tripId: string, startArea: string | null, endArea: string | null,
): void {
  try {
    const rec = readJournal(tripId);
    if (rec === null) return;
    _writeRecord({ ...rec, startArea: _area(startArea), endArea: _area(endArea) });
  } catch { /* fail-soft */ }
}

function _area(v: string | null): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim().slice(0, 80) : null;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Okuma
 * ════════════════════════════════════════════════════════════════════════ */

/** Tek yolculuğun ham kanıdı. Yoksa `null` — boş kayıt UYDURULMAZ. */
export function readJournal(tripId: string): TripJournalRecord | null {
  try {
    if (typeof tripId !== 'string' || tripId.length === 0) return null;
    const raw = safeGetRaw(RECORD_PREFIX + tripId);
    if (!raw) return null;
    return readTripJournalRecord(JSON.parse(raw));
  } catch { return null; }
}

/** Defterdeki yolculuk kimlikleri — en yeni önce. */
export function listJournalIds(): readonly string[] {
  return _readIndex();
}

/** Açık yolculuğun canlı görüntüsü (LAB gözlemi). Yoksa `null`. */
export function readOpenJournal(): {
  readonly tripId: string;
  readonly startedAtMs: number;
  readonly routePointCount: number;
  readonly stopCount: number;
  readonly eventCount: number;
  readonly stopOpen: boolean;
} | null {
  const open = _open;
  if (open === null) return null;
  return {
    tripId: open.tripId,
    startedAtMs: open.startedAtMs,
    routePointCount: open.points.length,
    stopCount: open.stops.length,
    eventCount: open.events.length,
    stopOpen: open.openStopOffsetMs !== null,
  };
}

/**
 * Çökme sonrası kurtarma — diskteki taslağı mühürler.
 *
 * Açılışta BİR KEZ çağrılır. Taslak yoksa hiçbir şey yapmaz. Mühürlenen
 * kaydın gerekçesi `UNKNOWN`tur: uygulamanın neden kapandığını bilmiyoruz ve
 * `SERVICE_STOPPED` demek düzgün bir kapanış İDDİASI olurdu.
 *
 * @returns kurtarılan kaydın kimliği; taslak yoksa `null`.
 */
export function recoverOpenJournal(): string | null {
  try {
    const raw = safeGetRaw(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as Partial<OpenJournal>;
    _clearDraft();

    if (typeof draft?.tripId !== 'string' || draft.tripId.length === 0) return null;
    if (!Number.isFinite(draft.startedAtMs)) return null;
    /* Aynı yolculuk zaten mühürlenmişse taslak bayattır — üzerine yazma. */
    if (readJournal(draft.tripId) !== null) return null;

    const points = Array.isArray(draft.points) ? draft.points : [];
    const record: TripJournalRecord = {
      schemaVersion: TRIP_JOURNAL_SCHEMA_VERSION,
      tripId: draft.tripId,
      startedAtMs: draft.startedAtMs as number,
      endedAtMs: null,
      endReason: 'UNKNOWN',
      startLocation: draft.startLocation ?? null,
      endLocation: draft.endLocation ?? null,
      startArea: null,
      endArea: null,
      route: encodeRouteTrace(points),
      stops: Array.isArray(draft.stops) ? draft.stops.slice(0, JOURNAL_MAX_STOPS) : [],
      motionEvidence: draft.motionEvidence
        ?? { sampleCount: 0, spanMs: 0, sourceCount: 0 },
      events: Array.isArray(draft.events) ? draft.events.slice(0, JOURNAL_MAX_EVENTS) : [],
    };
    _persistRecord(record);
    return record.tripId;
  } catch {
    _clearDraft();
    return null;
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * Kalıcılık
 * ════════════════════════════════════════════════════════════════════════ */

function _readIndex(): string[] {
  try {
    const raw = safeGetRaw(INDEX_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter((x): x is string => typeof x === 'string' && x.length > 0);
  } catch { return []; }
}

function _writeIndex(ids: readonly string[]): void {
  try { safeSetRaw(INDEX_KEY, JSON.stringify(ids)); } catch { /* fail-soft */ }
}

/**
 * Kaydı yaz ve defteri buda.
 *
 * BOYUT KAPISI: kayıt tavanı aşarsa rota izi DÜŞÜRÜLÜR, kayıt değil. Hâlâ
 * büyükse olay listesi budanır. Kayıt hiçbir koşulda sessizce atılmaz.
 */
function _persistRecord(record: TripJournalRecord): void {
  _writeRecord(record);

  const ids = _readIndex().filter((id) => id !== record.tripId);
  ids.unshift(record.tripId);

  /* Bounded retention: tavanı aşan EN ESKİ kayıtlar silinir. */
  const evicted = ids.slice(MAX_JOURNAL_RECORDS);
  for (const id of evicted) {
    try { safeSetRaw(RECORD_PREFIX + id, ''); } catch { /* fail-soft */ }
  }
  _writeIndex(ids.slice(0, MAX_JOURNAL_RECORDS));
}

function _writeRecord(record: TripJournalRecord): void {
  try {
    let payload = JSON.stringify(record);
    if (payload.length > MAX_RECORD_BYTES) {
      payload = JSON.stringify({ ...record, route: null });
    }
    if (payload.length > MAX_RECORD_BYTES) {
      payload = JSON.stringify({ ...record, route: null, events: [], stops: [] });
    }
    safeSetRaw(RECORD_PREFIX + record.tripId, payload);
  } catch { /* fail-soft */ }
}

function _flushDraft(): void {
  try {
    const open = _open;
    if (open === null) return;
    open.sinceFlush = 0;
    safeSetRaw(DRAFT_KEY, JSON.stringify(open));
  } catch { /* fail-soft */ }
}

function _clearDraft(): void {
  try { safeSetRaw(DRAFT_KEY, ''); } catch { /* fail-soft */ }
}

/** @internal testler için — modül durumunu sıfırlar (diske DOKUNMAZ). */
export function _resetJournalForTest(): void {
  _open = null;
}
