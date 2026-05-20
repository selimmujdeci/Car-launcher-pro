/**
 * EventRecorder — Patch 5
 *
 * Debug HUD için canlı araç olay kayıt tamponu.
 * Ring buffer (max 150 entry) — bellek sabit kalır.
 *
 * Kayıt türleri:
 *   intent   — Android broadcast/intent yakalandı
 *   packet   — Ham seri/CAN paketi
 *   service  — Service callback yanıtı
 *   signal   — Normalize edilmiş sinyal değeri
 *   diag     — Tanı log satırı (canDiag)
 *   error    — Hata / güvenlik reddi
 */

export type EventKind = 'intent' | 'packet' | 'service' | 'signal' | 'diag' | 'error' | 'marker';
export type EventSource = 'MCU' | 'OBD' | 'RAW_CAN' | 'GPS' | 'SYSTEM';

export interface VehicleEvent {
  id:       number;
  ts:       number;       // Date.now() ms
  kind:     EventKind;
  source:   EventSource;
  label:    string;       // kısa başlık: "reverse=true", "speed=42 km/h"
  raw?:     string;       // ham veri (uzunsa kırpılır)
  accepted: boolean;      // gate tarafından geçirildi mi?
}

// ── Sabitler ──────────────────────────────────────────────────────────────────

const MAX_ENTRIES   = 150;
const MAX_RAW_LEN   = 200;   // raw alan truncation
let   _seq          = 0;     // monoton ID

// ── Ring buffer ───────────────────────────────────────────────────────────────

const _buf: VehicleEvent[] = [];
let   _head = 0;   // bir sonraki yazılacak indeks

function _push(ev: VehicleEvent): void {
  if (_buf.length < MAX_ENTRIES) {
    _buf.push(ev);
  } else {
    _buf[_head] = ev;
    _head = (_head + 1) % MAX_ENTRIES;
  }
  _notify(ev);
}

// ── Listener'lar ──────────────────────────────────────────────────────────────

const _listeners = new Set<(ev: VehicleEvent) => void>();

function _notify(ev: VehicleEvent): void {
  _listeners.forEach(fn => {
    try { fn(ev); } catch { /* listener hataları sızdırmaz */ }
  });
}

// ── API ───────────────────────────────────────────────────────────────────────

/** Kronolojik sırada tüm kayıtları döner */
export function getEventLog(): VehicleEvent[] {
  if (_buf.length < MAX_ENTRIES) return [..._buf];
  // Ring buffer'ı doğrusal sıraya çevir
  return [..._buf.slice(_head), ..._buf.slice(0, _head)];
}

/** Son N kaydı döner */
export function getRecentEvents(n: number): VehicleEvent[] {
  const log = getEventLog();
  return log.slice(-n);
}

/** Yeni event kaydı ekle */
export function recordEvent(
  kind: EventKind,
  source: EventSource,
  label: string,
  opts?: { raw?: string; accepted?: boolean },
): void {
  _push({
    id:       ++_seq,
    ts:       Date.now(),
    kind,
    source,
    label,
    raw:      opts?.raw ? opts.raw.slice(0, MAX_RAW_LEN) : undefined,
    accepted: opts?.accepted ?? true,
  });
}

/** canDiag satırından event oluştur (K24 tanı günlüğü entegrasyonu) */
export function recordDiagLine(line: string, source: EventSource = 'MCU'): void {
  // Kısa etiket: ilk 60 karakter
  const label = line.length > 60 ? line.slice(0, 57) + '…' : line;
  _push({ id: ++_seq, ts: Date.now(), kind: 'diag', source, label, raw: line, accepted: true });
}

/** Değişiklik listener */
export function onEvent(fn: (ev: VehicleEvent) => void): () => void {
  _listeners.add(fn);
  return () => _listeners.delete(fn);
}

/** Tamponu temizle */
export function clearEventLog(): void {
  _buf.length = 0;
  _head = 0;
}

/**
 * Test protokolü marker — fiziksel olay öncesinde logla.
 * Format: "[MARKER] TEST_REVERSE_ON ts=1716123456789"
 * Native cihazda canDiag kanalına da iletilir (CanDiagPanel'de görünür).
 */
export function insertMarker(marker: string): void {
  const ts    = Date.now();
  const label = `[MARKER] ${marker}`;
  _push({ id: ++_seq, ts, kind: 'marker', source: 'SYSTEM',
          label, raw: `${label} ts=${ts}`, accepted: true });
}
