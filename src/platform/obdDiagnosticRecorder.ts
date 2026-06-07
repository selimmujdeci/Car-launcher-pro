/**
 * OBD Teşhis Timeline — kayıt motoru (Faz 1 MVP, JS-only, pasif gözlemci).
 *
 * Bağlantı akışının adımlarını (izin → tarama → seçim → bond → BLE/classic →
 * canlı veri → disconnect/retry) bounded ring buffer'a yazar; UI'a abone
 * yayını yapar; JSON + kopyalanabilir metin export'u ve "son oturum"
 * kalıcılığı sağlar.
 *
 * Tasarım çapası: blackBoxService (ring buffer + monotonik delta + safeStorage).
 *  - Zero-leak: sabit boyutlu ring buffer (MAX_EVENTS); UI aboneleri Set'te,
 *    subscribe() bir unsubscribe döndürür; disposeAll() native listener
 *    handle'larını (Faz 3 wiring) ve aboneleri temizler.
 *  - Saat-atlama güvenliği: süreler/zaman damgaları performance.now() delta;
 *    Date.now() yalnızca id/gösterim.
 *  - Native hot-path'e DOKUNMAZ (OBDManager/BleObdManager/CarLauncherPlugin'i
 *    değiştirmez); mevcut event'lerden beslenir (wiring Faz 3'te).
 */

import { safeSetRaw, safeGetRaw } from '../utils/safeStorage';
import {
  DIAG_EVENT_TEMPLATE,
  FAILURE_META,
  type ObdDiagEvent,
  type ObdDiagSession,
  type ObdStage,
  type ObdDiagStatus,
  type ObdTransport,
  type ObdFailureReason,
} from './obdDiagnosticTypes';

/* ── Sabitler ──────────────────────────────────────────────── */

const MAX_EVENTS = 200;                       // bounded memory — oturum başına tavan
const LAST_SESSION_KEY = 'obd-diag-last-session';

/* ── Modül durumu ──────────────────────────────────────────── */

// Ring buffer — sabit boyutlu; en eski → en yeni okunur.
const _slots: (ObdDiagEvent | null)[] = Array.from({ length: MAX_EVENTS }, () => null);
let _head = 0;        // bir sonraki yazım indeksi
let _filled = 0;      // dolu slot sayısı (≤ MAX_EVENTS)
let _seq = 0;         // event id sayacı (oturum içi)

let _origin = 0;      // performance.now() oturum başlangıcı (monotonik referans)
let _sessionId = '';
let _startedWallMs = 0;
let _device: ObdDiagSession['device'] = null;
let _outcome: ObdDiagSession['outcome'] = 'pending';

// UI aboneleri — her değişimde tetiklenir.
const _subscribers = new Set<() => void>();

// Native/dış listener temizleyicileri (Faz 3 wiring buraya kaydolur).
const _disposers: Array<() => void> = [];

/* ── Yardımcılar ───────────────────────────────────────────── */

function _now(): number {
  return typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now();
}

function _notify(): void {
  // Abonelerden biri hata atarsa diğerleri etkilenmesin.
  _subscribers.forEach((cb) => { try { cb(); } catch { /* yoksay */ } });
}

/**
 * MAC adresini maskeler: ortadaki oktetleri gizler (gizlilik).
 * "AA:BB:CC:DD:EE:FF" → "AA:BB:**:**:**:FF". MAC değilse olduğu gibi kısaltır.
 */
export function maskMac(addr: string): string {
  const a = (addr ?? '').trim();
  const parts = a.split(':');
  if (parts.length === 6) {
    return `${parts[0]}:${parts[1]}:**:**:**:${parts[5]}`.toUpperCase();
  }
  // MAC formatı değilse uçları göster.
  if (a.length > 6) return `${a.slice(0, 3)}…${a.slice(-2)}`;
  return a;
}

/* ── Oturum yaşam döngüsü ──────────────────────────────────── */

/**
 * Yeni teşhis oturumu başlatır — buffer'ı sıfırlar, monotonik referansı kurar.
 * @returns sessionId
 */
export function startSession(device?: { name: string; address: string; transport: ObdTransport }): string {
  _slots.fill(null);
  _head = 0;
  _filled = 0;
  _seq = 0;
  _origin = _now();
  _startedWallMs = Date.now();
  _sessionId = `obd-${_startedWallMs.toString(36)}`;
  _outcome = 'pending';
  _device = device
    ? { name: device.name || '', addrMasked: maskMac(device.address), transport: device.transport }
    : null;
  _notify();
  return _sessionId;
}

/** Seçilen/bağlanılan cihazı oturuma iliştirir (tarama sonrası seçimde). */
export function setSessionDevice(device: { name: string; address: string; transport: ObdTransport }): void {
  _device = { name: device.name || '', addrMasked: maskMac(device.address), transport: device.transport };
  _notify();
}

/** Oturumu sonlandırır ve "son oturum"u kalıcı yazar (gösterim için). */
export function endSession(outcome: ObdDiagSession['outcome']): void {
  _outcome = outcome;
  try {
    safeSetRaw(LAST_SESSION_KEY, JSON.stringify(getSession()), 0, true);
  } catch { /* kota/serileştirme hatası — yoksay */ }
  _notify();
}

/* ── Event kaydı ───────────────────────────────────────────── */

interface RecordInput {
  stage:             ObdStage;
  status:            ObdDiagStatus;
  transport?:        ObdTransport;
  protocol?:         string | null;
  command?:          string | null;
  response?:         string | null;
  durationMs?:       number | null;
  reason?:           ObdFailureReason | null;
  userMessage?:      string;
  technicalMessage?: string;
  nextAction?:       string | null;
}

/**
 * Bir teşhis event'i kaydeder. Eksik kullanıcı mesajı/eylemi, reason verilmişse
 * FAILURE_META'dan otomatik doldurulur. Template spread → hidden class kararlı.
 */
export function recordDiag(input: RecordInput): ObdDiagEvent {
  if (!_sessionId) startSession();   // güvenli: oturumsuz kayıt gelirse aç

  const meta = input.reason ? FAILURE_META[input.reason] : null;

  const evt: ObdDiagEvent = {
    ...DIAG_EVENT_TEMPLATE,
    id:               `evt-${_seq++}`,
    tsMonoMs:         _now() - _origin,
    tsWallMs:         Date.now(),
    stage:            input.stage,
    status:           input.status,
    transport:        input.transport ?? 'unknown',
    protocol:         input.protocol ?? null,
    command:          input.command ?? null,
    response:         input.response ?? null,
    durationMs:       input.durationMs ?? null,
    reason:           input.reason ?? null,
    userMessage:      input.userMessage ?? meta?.userMessage ?? '',
    technicalMessage: input.technicalMessage ?? '',
    nextAction:       input.nextAction ?? meta?.nextAction ?? null,
    severity:         meta?.severity ?? (input.status === 'fail' ? 'high' : 'low'),
  };

  _slots[_head] = evt;
  _head = (_head + 1) % MAX_EVENTS;
  if (_filled < MAX_EVENTS) _filled++;

  _notify();
  return evt;
}

/* ── Okuma ─────────────────────────────────────────────────── */

/** Mevcut oturum event'leri — kronolojik (en eski → en yeni). */
export function getEvents(): ObdDiagEvent[] {
  const out: ObdDiagEvent[] = [];
  const start = _filled < MAX_EVENTS ? 0 : _head;
  for (let i = 0; i < _filled; i++) {
    const e = _slots[(start + i) % MAX_EVENTS];
    if (e) out.push(e);
  }
  return out;
}

/** Oturum özeti (event'ler dahil). */
export function getSession(): ObdDiagSession {
  return {
    sessionId:     _sessionId,
    startedWallMs: _startedWallMs,
    device:        _device,
    outcome:       _outcome,
    events:        getEvents(),
  };
}

/** Kalıcı yazılmış son oturumu döner (yoksa null). */
export function loadLastSession(): ObdDiagSession | null {
  try {
    const raw = safeGetRaw(LAST_SESSION_KEY);
    return raw ? (JSON.parse(raw) as ObdDiagSession) : null;
  } catch {
    return null;
  }
}

/* ── Export ────────────────────────────────────────────────── */

/** Tam oturumu JSON string olarak döner. */
export function exportJson(): string {
  return JSON.stringify(getSession(), null, 2);
}

/** İnsan-okur, kopyalanabilir metin dökümü (teknik mod formatı). */
export function exportText(): string {
  const s = getSession();
  const lines: string[] = [];
  lines.push(`CarOS Pro — OBD Teşhis Oturumu`);
  lines.push(`Oturum: ${s.sessionId}`);
  lines.push(`Cihaz:  ${s.device ? `${s.device.name || '(adsız)'} [${s.device.addrMasked}] ${s.device.transport}` : '(yok)'}`);
  lines.push(`Sonuç:  ${s.outcome}`);
  lines.push('─'.repeat(48));
  for (const e of s.events) {
    const t = `${(e.tsMonoMs / 1000).toFixed(2)}s`.padStart(8);
    const head = `${t}  ${e.stage}/${e.status}`;
    const detail = [
      e.transport !== 'unknown' ? e.transport : null,
      e.protocol,
      e.command ? `cmd=${e.command}` : null,
      e.response ? `resp=${e.response}` : null,
      e.durationMs != null ? `${Math.round(e.durationMs)}ms` : null,
      e.reason,
    ].filter(Boolean).join(' · ');
    lines.push(detail ? `${head}  (${detail})` : head);
    if (e.userMessage) lines.push(`          → ${e.userMessage}${e.nextAction ? `  [${e.nextAction}]` : ''}`);
  }
  return lines.join('\n');
}

/* ── Abonelik & temizlik ───────────────────────────────────── */

/** UI aboneliği — değişimde cb çağrılır. Dönen fonksiyon aboneliği kaldırır. */
export function subscribe(cb: () => void): () => void {
  _subscribers.add(cb);
  return () => { _subscribers.delete(cb); };
}

/**
 * Dış kaynak temizleyicisi kaydeder (Faz 3: native PluginListenerHandle.remove).
 * disposeAll() çağrıldığında hepsi çalıştırılır.
 */
export function registerDisposer(fn: () => void): void {
  _disposers.push(fn);
}

/** Tüm dış listener'ları ve UI abonelerini temizler (zero-leak). */
export function disposeAll(): void {
  while (_disposers.length) {
    const fn = _disposers.pop();
    try { fn?.(); } catch { /* yoksay */ }
  }
  _subscribers.clear();
}

/** Buffer'ı boşaltır (oturumu kapatmadan). Testler ve manuel sıfırlama için. */
export function clear(): void {
  _slots.fill(null);
  _head = 0;
  _filled = 0;
  _seq = 0;
  _notify();
}
