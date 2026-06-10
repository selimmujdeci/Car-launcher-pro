/**
 * remoteLogService — Remote Log v1 / Commit 2: uzak hata & tanı toplama
 *
 * Sahadaki cihazlardan kritik hata, OBD tanısı ve destek anlık görüntüsünü
 * vehicle_events üzerinden toplar. Mevcut zincir yeniden kullanılır:
 *
 *   crashLogger (registerRemoteSink) ─┐
 *   boot-time drain (getErrorLog)    ─┼→ remoteLogService
 *   reportObdDiag / SupportSnapshot  ─┘        │ sanitize + dedup + rate limit
 *                                              ▼
 *   pushVehicleEvent → push_vehicle_event RPC → connectivityService
 *   (at-least-once kuyruk; sunucu tarafı 16KB guard + rate limit + 30g
 *    retention migration 020'de — client bekçileri bunun ÖN katmanı)
 *
 * ── Gizlilik (allowlist) ────────────────────────────────────────────
 *  Üst seviyede YALNIZ ALLOW_KEYS alanları çıkar; her derinlikte
 *  DENY_KEYS düşülür (konum/kimlik/ağ/kimlik bilgisi); string'lerde
 *  VIN / MAC / koordinat çifti / api_key= / token= regex maskelenir.
 *  Konum bilgisi HİÇBİR event'te uzağa gitmez.
 *
 * ── Koruma katmanları ───────────────────────────────────────────────
 *  Dedup      : aynı ctx+msg oturum başına 1 kez (critical_error)
 *  Rate limit : token bucket — saatte maks. 10 critical_error
 *               (monotonic performance.now — saat atlaması güvenli)
 *  Watermark  : canlı sink ile gönderilen entry bir sonraki boot
 *               drain'inde TEKRAR gönderilmez (safeStorage, reboot dayanıklı)
 */

import {
  getErrorLog,
  clearErrorLog,
  registerRemoteSink,
  type CrashEntry,
} from './crashLogger';
import { pushVehicleEvent }  from './vehicleIdentityService';
import { healthMonitor }     from './system/SystemHealthMonitor';
import { getOBDStatusSnapshot } from './obdService';
import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../utils/safeStorage';

/* ── Sabitler ───────────────────────────────────────────────── */

/** Canlı sink ile gönderilen son entry ts'i — boot drain çift göndermesin */
const WATERMARK_KEY = 'rls_sent_watermark_v1';

/** Token bucket: saatte maks. 10 critical_error */
const RATE_CAPACITY  = 10;
const RATE_REFILL_MS = 3_600_000 / RATE_CAPACITY; // 1 jeton / 6 dk

/** Dedup seti tavanı — sınırsız büyüme yok (zero-leak) */
const DEDUP_MAX = 200;

/** String alan tavanları — sunucu 16KB guard'ından önce client kırpar */
const MAX_MSG_LEN   = 2_048;
const MAX_STR_LEN   = 2_048;
const MAX_DEPTH     = 4;
const MAX_ARRAY_LEN = 20;

/** Oturum kimliği — 8 karakter (17 karakterlik VIN maskesine takılmaz) */
const BOOT_ID: string = (() => {
  try { return crypto.randomUUID().slice(0, 8); }
  catch { return Math.random().toString(36).slice(2, 10); }
})();

/* ── Sanitize katmanı ───────────────────────────────────────── */

/** Üst seviye allowlist — uzağa çıkabilecek alanların tamamı */
const ALLOW_KEYS = new Set([
  'ctx', 'msg', 'stack', 'errorCode', 'severity', 'source', 'appVersion',
  'transport', 'protocol', 'attempts', 'elapsedMs', 'bootId',
  // obd_diag alanları (Commit 3): bağlantı fazı + araç tipi + son veri zamanı
  'phase', 'vehicleType', 'lastSeenMs',
]);

/** Her derinlikte düşülen alanlar (küçük harf karşılaştırma) */
const DENY_KEYS = new Set([
  'lat', 'lng', 'latitude', 'longitude', 'location', 'address',
  'vin', 'plate', 'plaka', 'phone', 'contact',
  'ssid', 'bssid', 'mac', 'api_key', 'token',
]);

/** Regex maskeleri — sıra önemli: key=value önce (VIN maskesi değeri yutmasın) */
const MASKS: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bapi_key=[^\s&"']+/gi,                       'api_key=[MASKED]'],
  [/\btoken=[^\s&"']+/gi,                         'token=[MASKED]'],
  [/\b[A-HJ-NPR-Z0-9]{17}\b/g,                    '[VIN]'],
  [/\b[0-9A-Fa-f]{2}(?::[0-9A-Fa-f]{2}){5}\b/g,   '[MAC]'],
  [/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g,  '[COORD]'],
];

function _maskString(s: string): string {
  let out = s.length > MAX_STR_LEN ? s.slice(0, MAX_STR_LEN) : s;
  for (const [re, repl] of MASKS) out = out.replace(re, repl);
  return out;
}

/** Deny-list + regex maskesi — her derinlikte uygulanır */
function _deepSanitize(value: unknown, depth: number): unknown {
  if (value == null) return value;
  if (typeof value === 'string')  return _maskString(value);
  if (typeof value === 'number')  return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (depth >= MAX_DEPTH) return undefined; // derin ağaç → düş

  if (Array.isArray(value)) {
    return value.slice(0, MAX_ARRAY_LEN).map((v) => _deepSanitize(v, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>)) {
      if (DENY_KEYS.has(key.toLowerCase())) continue; // konum/kimlik → düş
      const v = _deepSanitize((value as Record<string, unknown>)[key], depth + 1);
      if (v !== undefined) out[key] = v;
    }
    return out;
  }
  return undefined; // function / symbol / bigint → düş
}

/**
 * Uzağa gidecek payload'ı temizler:
 *  1. Üst seviye allowlist — ALLOW_KEYS dışındaki her alan düşer
 *  2. Her derinlikte DENY_KEYS düşer
 *  3. String'lerde VIN/MAC/koordinat/api_key=/token= maskelenir
 */
export function sanitizeForRemote(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(payload)) {
    if (!ALLOW_KEYS.has(key)) continue;
    if (DENY_KEYS.has(key.toLowerCase())) continue;
    const v = _deepSanitize(payload[key], 1);
    if (v !== undefined) out[key] = v;
  }
  return out;
}

/* ── Dedup + rate limit ─────────────────────────────────────── */

const _dedupSeen = new Set<string>();

let _tokens     = RATE_CAPACITY;
let _lastRefill = typeof performance !== 'undefined' ? performance.now() : 0;

/** Token bucket — monotonic delta (CLAUDE.md: saat atlaması güvenli) */
function _takeToken(): boolean {
  const now     = performance.now();
  const elapsed = now - _lastRefill;
  if (elapsed > 0) {
    _tokens     = Math.min(RATE_CAPACITY, _tokens + elapsed / RATE_REFILL_MS);
    _lastRefill = now;
  }
  if (_tokens < 1) return false;
  _tokens -= 1;
  return true;
}

/* ── critical_error ─────────────────────────────────────────── */

function _appVersion(): string {
  try { return healthMonitor.getGlobalHealthSnapshot().appVersion; }
  catch { return '0.0.0-unknown'; }
}

/**
 * İç gönderim — dedup/rate limit düşürmesinde false döner; enqueue
 * HATASINDA throw eder (drain bunu "log silme" kararında ayırt eder).
 */
async function _sendCriticalOrThrow(
  ctx: string,
  msg: string,
  extra?: { stack?: string; errorCode?: string },
): Promise<boolean> {
  const key = `${ctx}::${msg}`;
  if (_dedupSeen.has(key)) return false;          // oturum başına 1 kez
  if (!_takeToken())       return false;          // saatlik bütçe doldu

  if (_dedupSeen.size >= DEDUP_MAX) _dedupSeen.clear(); // tavan koruması
  _dedupSeen.add(key);

  const payload = sanitizeForRemote({
    ctx,
    msg: msg.slice(0, MAX_MSG_LEN),
    stack:      extra?.stack,
    errorCode:  extra?.errorCode,
    severity:   'critical',
    appVersion: _appVersion(),
    bootId:     BOOT_ID,
  });
  await pushVehicleEvent('critical_error', payload);
  return true;
}

/**
 * Kritik hatayı uzağa raporlar.
 *
 * Sıra: dedup (jeton harcamaz) → token bucket → sanitize → pushVehicleEvent.
 * Dönüş: true = kuyruğa kabul edildi; false = dedup/rate limit düşürdü
 * veya enqueue hatası. Asla throw etmez — hata yolundan çağrılmaya güvenlidir.
 */
export async function reportCritical(
  ctx: string,
  msg: string,
  extra?: { stack?: string; errorCode?: string },
): Promise<boolean> {
  try {
    return await _sendCriticalOrThrow(ctx, msg, extra);
  } catch {
    return false; // logger hattı asla crash ettirmez
  }
}

/* ── obd_diag ───────────────────────────────────────────────── */

/**
 * OBD tanı raporu — bağlantı teşhis akışından çağrılır.
 * Alanlar allowlist'ten geçer (transport/protocol/attempts/elapsedMs/
 * errorCode/msg/ctx); konum ve cihaz kimliği yapısal olarak çıkamaz.
 */
export async function reportObdDiag(diag: Record<string, unknown>): Promise<void> {
  try {
    const payload = sanitizeForRemote({
      ...diag,
      ctx:        typeof diag.ctx === 'string' ? diag.ctx : 'OBD',
      appVersion: _appVersion(),
      bootId:     BOOT_ID,
    });
    await pushVehicleEvent('obd_diag', payload);
  } catch { /* fire-and-forget */ }
}

/* ── support_snapshot ───────────────────────────────────────── */

/**
 * Destek anlık görüntüsü: appVersion + OBD durumu + son hata özeti +
 * sağlık özeti. Konum bilgisi YOK — her bölüm güvenli alanlardan elle
 * kurulur, üstüne deep sanitize (deny + maske) uygulanır.
 */
export async function reportSupportSnapshot(): Promise<Record<string, unknown>> {
  const obd    = getOBDStatusSnapshot();
  const health = healthMonitor.getGlobalHealthSnapshot();

  // Son 5 hata — yalnız ts/ctx/msg/severity; stack ve replayBuffer
  // (kara kutu: konum içerir) bilinçli olarak DIŞARIDA.
  const lastErrors = getErrorLog().slice(-5).map((e) => ({
    ts:       e.ts,
    ctx:      _maskString(e.ctx),
    msg:      _maskString(e.msg.slice(0, 256)),
    severity: e.severity ?? 'error',
  }));

  const payload = _deepSanitize({
    appVersion: health.appVersion,
    bootId:     BOOT_ID,
    obd: {
      connectionState: obd.connectionState,
      source:          obd.source,
      vehicleType:     obd.vehicleType,
      lastSeenMs:      obd.lastSeenMs,
    },
    lastErrors,
    health: {
      overallHealth: health.overallHealth,
      services:      health.services.map((s) => ({
        name: s.name, healthy: s.healthy, restartCount: s.restartCount,
      })),
    },
  }, 0) as Record<string, unknown>;

  try { await pushVehicleEvent('support_snapshot', payload); }
  catch { /* fire-and-forget */ }
  return payload;
}

/* ── Boot-time crash drain ──────────────────────────────────── */

function _watermark(): number {
  const raw = safeGetRaw(WATERMARK_KEY);
  const n   = raw ? Number(raw) : 0;
  return Number.isFinite(n) ? n : 0;
}

function _markLiveSent(ts: number): void {
  try {
    if (ts > _watermark()) safeSetRaw(WATERMARK_KEY, String(ts), undefined, true);
  } catch { /* sessiz */ }
}

/**
 * Önceki oturumun crash kayıtlarını uzağa boşaltır.
 *
 *  - Yalnız severity === 'critical' entry'ler gönderilir
 *  - Watermark altındakiler atlanır (canlı sink zaten gönderdi)
 *  - TÜM gönderimler kuyruğa kabul edildikten SONRA clearErrorLog()
 *    çağrılır; enqueue hatasında log durur → bir sonraki boot yeniden dener
 *
 * Dönüş: kuyruğa kabul edilen event sayısı.
 */
export async function drainBootCrashLog(): Promise<number> {
  let entries: CrashEntry[];
  try { entries = getErrorLog(); } catch { return 0; }

  const wm        = _watermark();
  const criticals = entries.filter((e) => e.severity === 'critical' && e.ts > wm);
  if (criticals.length === 0) return 0;

  let sent = 0;
  try {
    for (const e of criticals) {
      // throw eden sürüm: enqueue hatası ile guard düşürmesi ayırt edilir
      const ok = await _sendCriticalOrThrow(e.ctx, e.msg, { stack: e.stack });
      if (ok) sent++;
    }
    // Başarılı gönderim (enqueue) sonrası: log + watermark temizlenir
    clearErrorLog();
    safeRemoveRaw(WATERMARK_KEY);
  } catch {
    // Enqueue hatası — log silinmez, bir sonraki boot'ta yeniden denenir
  }
  return sent;
}

/* ── Yaşam döngüsü ──────────────────────────────────────────── */

let _running = false;

/**
 * Servisi başlatır (SystemBoot Wave 4):
 *  1. crashLogger remote sink kaydı — canlı critical hatalar anında gider
 *  2. Boot-time drain — önceki oturumun crash'leri boşaltılır
 *
 * İdempotent; dönen cleanup sink kaydını söker (zero-leak).
 */
export function startRemoteLogService(): () => void {
  if (_running) return () => {};
  _running = true;

  registerRemoteSink((entry) => {
    // crashLogger yalnız critical için çağırır; yine de çift kontrol
    if (entry.severity !== 'critical') return;
    void reportCritical(entry.ctx, entry.msg, { stack: entry.stack })
      .then((ok) => { if (ok) _markLiveSent(entry.ts); });
  });

  void drainBootCrashLog();

  return () => {
    registerRemoteSink(null);
    _running = false;
  };
}

/* ── Test yardımcıları ──────────────────────────────────────── */

/**
 * Vitest: modül-seviyesi durumu sıfırlar (dedup + token bucket + running).
 * keepWatermark — "yeni oturum" simülasyonu: oturum-içi state sıfırlanır
 * ama safeStorage watermark'ı (reboot dayanıklı) korunur.
 */
export function _resetRemoteLogServiceForTest(opts?: { keepWatermark?: boolean }): void {
  _dedupSeen.clear();
  _tokens     = RATE_CAPACITY;
  _lastRefill = performance.now();
  _running    = false;
  registerRemoteSink(null);
  if (!opts?.keepWatermark) safeRemoveRaw(WATERMARK_KEY);
}
