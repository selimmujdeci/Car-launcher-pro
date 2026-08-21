/**
 * toolCallEvidence — araç çağrısı (tool call) turlarının BOUNDED kanıt defteri.
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * `runToolLoop` her çağrı için ZATEN gizlilik-güvenli bir `ToolTelemetry`
 * üretiyordu (`toolName · effect · ok · errorCode · durationMs · resultFields`)
 * — ama bunu yalnız çağırana döndürüyor, çağıran da kullanmadan atıyordu.
 * Sonuç: hangi aracın ne sıklıkla çağrıldığı, hangi hata koduyla düştüğü ve ne
 * kadar sürdüğü ÜRÜNDE HİÇBİR YERDEN görülemiyordu (kütük #694).
 *
 * Bu modül YENİ VERİ ÜRETMEZ: zaten üretilen telemetriyi sınırlı bir halkada
 * TUTAR. Yeni ölçüm, yeni çağrı, yeni zamanlayıcı YOKTUR.
 *
 * ── GİZLİLİK ────────────────────────────────────────────────────────────────
 * `ToolTelemetry` tasarımı gereği ARGÜMAN ve SONUÇ TAŞIMAZ. Bu defter de
 * yalnız onu saklar: kullanıcı sorusu, araç argümanı, araç çıktısı, konum,
 * araç kimliği ve serbest metin BURAYA GİRMEZ. Yalnız araç ADI (sabit enum
 * benzeri kısa tanımlayıcı), etki sınıfı, başarı bayrağı, hata KODU, süre ve
 * alan ADEDİ tutulur.
 *
 * ── BÜTÇE ───────────────────────────────────────────────────────────────────
 * Sabit tavanlı halka tampon (bellek sınırlı, sınırsız büyüme YOK). Timer YOK,
 * I/O YOK, kalıcı depo YOK — süreç ömürlü (uygulama yeniden başlayınca boşalır).
 * Kayıt yolu ASLA fırlatmaz: kanıt toplama, sohbet akışını bozamaz.
 */

import type { ToolTelemetry } from './toolTypes';

/** Halka tampon tavanı — teşhis için yeterli, bellek için ucuz. */
export const TOOL_EVIDENCE_CAPACITY = 40;

/** Tek çağrının defterdeki hâli — telemetriye yalnız DAMGA eklenir. */
export interface ToolCallRecord {
  readonly toolName: string;
  readonly effect: ToolTelemetry['effect'];
  readonly ok: boolean;
  readonly errorCode: ToolTelemetry['errorCode'] | null;
  readonly durationMs: number;
  readonly resultFields: number;
  /** Kaydın duvar saati damgası (epoch ms). */
  readonly atMs: number;
}

export interface ToolCallEvidence {
  /** En yeni sonda olacak şekilde bounded kayıtlar. */
  readonly records: readonly ToolCallRecord[];
  readonly capacity: number;
  /** Oturum boyunca ÇAĞRI sayısı (doyumlu — tampon taşsa bile artar). */
  readonly totalCalls: number;
  readonly failedCalls: number;
  /** Tamamlanan tool loop TURU sayısı. */
  readonly totalLoops: number;
  /** Modelin araç istediği ama tavana takıldığı tur sayısı. */
  readonly cappedLoops: number;
  /** Son kaydın damgası; `null` = hiç çağrı yok. */
  readonly lastCallAtMs: number | null;
}

let _records: ToolCallRecord[] = [];
let _totalCalls = 0;
let _failedCalls = 0;
let _totalLoops = 0;
let _cappedLoops = 0;
let _lastCallAtMs: number | null = null;

/**
 * Tek bir araç çağrısını defterler. ASLA fırlatmaz.
 *
 * @param t   `toolRouter`ın ürettiği gizlilik-güvenli telemetri.
 * @param atMs Duvar saati damgası — çağıran basar (bu modül `Date.now` çağırmaz).
 */
export function recordToolCall(t: ToolTelemetry, atMs: number): void {
  try {
    if (!t || typeof t.toolName !== 'string') return;
    _totalCalls += 1;
    if (t.ok !== true) _failedCalls += 1;
    _lastCallAtMs = Number.isFinite(atMs) ? atMs : null;

    _records.push({
      toolName: t.toolName,
      effect: t.effect,
      ok: t.ok === true,
      errorCode: t.errorCode ?? null,
      durationMs: Number.isFinite(t.durationMs) ? t.durationMs : 0,
      resultFields: Number.isFinite(t.resultFields) ? t.resultFields : 0,
      atMs: Number.isFinite(atMs) ? atMs : 0,
    });
    if (_records.length > TOOL_EVIDENCE_CAPACITY) {
      _records = _records.slice(-TOOL_EVIDENCE_CAPACITY);   // en eski düşer
    }
  } catch { /* fail-soft: kanıt toplama sohbeti ASLA bozmaz */ }
}

/**
 * Bir tool loop turunun kapandığını defterler.
 *
 * @param capped Model daha fazla araç isterken tur tavanına takıldıysa `true`.
 */
export function recordToolLoopEnd(capped: boolean): void {
  try {
    _totalLoops += 1;
    if (capped === true) _cappedLoops += 1;
  } catch { /* fail-soft */ }
}

/** LAB salt-okuma yüzeyi — ASLA fırlatmaz, hiçbir şey tetiklemez. */
export function getToolCallEvidence(): ToolCallEvidence {
  return {
    records: [..._records],
    capacity: TOOL_EVIDENCE_CAPACITY,
    totalCalls: _totalCalls,
    failedCalls: _failedCalls,
    totalLoops: _totalLoops,
    cappedLoops: _cappedLoops,
    lastCallAtMs: _lastCallAtMs,
  };
}

/** @internal — testler arası izolasyon. */
export function _resetToolCallEvidenceForTest(): void {
  _records = [];
  _totalCalls = 0;
  _failedCalls = 0;
  _totalLoops = 0;
  _cappedLoops = 0;
  _lastCallAtMs = null;
}
