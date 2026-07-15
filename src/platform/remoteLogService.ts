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
import { useOtaStore, getCurrentVersionCode } from './otaUpdateService';
import { safeGetRaw, safeSetRaw, safeRemoveRaw } from '../utils/safeStorage';
import { getCapabilities, getDeviceTier } from './deviceCapabilities';
import { getUiActivitySnapshot } from './uiActivityRecorder';
import { getDiagnosticTrail } from './diagnosticTrail';
import { getPerfSeriesSnapshot } from './perfSeriesRecorder';
import {
  buildObdDeepSnapshot, buildNetAiSnapshot,
  buildGpsDeepSnapshot, buildVoiceSnapshot, buildGeofenceSnapshot, buildStorageQueueSnapshot,
  buildPowerSnapshot, buildFusionSnapshot, buildBootTimingSnapshot, buildTransportSnapshot,
  buildPlatformRuntimeSnapshot,
} from './diagnosticSections';
// PR-OBD-DIAG-3: native extended poll kanıtı async — buildObdDeepSnapshot senkron okumadan
// önce tazelenir (fail-soft: eski APK / hata → kanıt yok).
import { refreshExtendedPollEvidence } from './obd/extendedPollEvidence';
import { buildTriageSnapshot, buildRootCauseSnapshot, buildDiagnosticVerdict, type TriageSections, type ErrorLedgerLike } from './diagnosticTriage';
import { buildErrorLedger, type RawErrorLike } from './errorLedger';
import { useVidStore } from '../store/useVidStore';
import {
  beginDelivery, getDelivery, deriveReportId, isTerminal, SERVER_MAX_BYTES,
  _resetDeliveryLedgerForTest,
  type DeliveryState,
} from './diagnosticDelivery';

/* ── Sabitler ───────────────────────────────────────────────── */

/** Canlı sink ile gönderilen son entry ts'i — boot drain çift göndermesin */
const WATERMARK_KEY = 'rls_sent_watermark_v1';

/** Token bucket: saatte maks. 10 critical_error */
const RATE_CAPACITY  = 10;
const RATE_REFILL_MS = 3_600_000 / RATE_CAPACITY; // 1 jeton / 6 dk

/** Dedup seti tavanı — sınırsız büyüme yok (zero-leak) */
const DEDUP_MAX = 200;

/** String alan tavanları — sunucu payload guard'ından önce client kırpar */
const MAX_MSG_LEN   = 2_048;
const MAX_STR_LEN   = 2_048;

/**
 * Sanitize derinlik tavanı — ÖLÇÜLMÜŞ değer, keyfi değil.
 *
 * `_deepSanitize` derinlik >= MAX_DEPTH olan KABI (nesne/dizi) düşürür; ilkeller
 * (string/sayı/boolean) derinlikten bağımsız akar. Payload gövdesindeki en derin
 * kaplar derinlik 4'te:
 *   root(0) → obdDeep(1) → dtc(2)      → codes[](3)    → kod nesnesi(4)
 *   root(0) → obdDeep(1) → extended(2) → samples[](3)  → örnek nesnesi(4)
 *   root(0) → uiActivity(1) → recent[](2) → olay(3)    → reasons[](4)
 *   inspector(1) → timeline(2) → kayıt(3) → signals/env(4)   [_deepSanitize(…, 1)]
 *   inspector(1) → runtime(2)  → workers[](3) → worker(4)
 *
 * MAX_DEPTH=4 iken bunların HEPSİ düşüyordu — DTC kodları kabloda `[null, null]`
 * gidiyor, DTC varken triyaj çöküyordu (denetim 2026-07-12, P0).
 *
 * 5 = ölçülen minimum yeterli değer. 6 seçildi: derinlik-1'den başlayan girişler
 * (sanitizeForRemote :143, inspector :494) için bir seviye pay bırakır ve ölçülen
 * payload'da derinlik >= 5'te KAP OLMADIĞI için bugün 0 ek bayt akıtır.
 * Yükseltmeden önce derinlik haritasını yeniden ölç — bu sabit körlemesine artmaz.
 */
const MAX_DEPTH     = 6;
const MAX_ARRAY_LEN = 20;

/** Oturum kimliği — 8 karakter (17 karakterlik VIN maskesine takılmaz) */
const BOOT_ID: string = (() => {
  try { return crypto.randomUUID().slice(0, 8); }
  catch { return Math.random().toString(36).slice(2, 10); }
})();

/** Bu oturumun (app boot) başlangıç zamanı — errorLedger'da eski/yeni sınırı
 *  (PR-2). Modül erken boot'ta yüklendiği için app oturumu başlangıcına yakındır;
 *  lastErrors KALICI ring olduğundan bundan ÖNCEKİ ts'ler önceki boot'tandır. */
const SESSION_START_MS: number = Date.now();

/* ── Sanitize katmanı ───────────────────────────────────────── */

/** Üst seviye allowlist — uzağa çıkabilecek alanların tamamı */
const ALLOW_KEYS = new Set([
  'ctx', 'msg', 'stack', 'errorCode', 'severity', 'source', 'appVersion',
  'transport', 'protocol', 'attempts', 'elapsedMs', 'bootId',
  // obd_diag alanları (Commit 3): bağlantı fazı + araç tipi + son veri zamanı
  'phase', 'vehicleType', 'lastSeenMs',
]);

/**
 * Anahtar normalizasyonu — küçült + alfanümerik olmayanı at.
 *   api_key · apiKey · API_KEY · Api-Key   → 'apikey'
 *   access_token · accessToken · Access-Token → 'accesstoken'
 * Eskiden yalnız `key.toLowerCase()` yapılıyordu → `apiKey` → 'apikey' ≠ 'api_key'
 * → deny listesine TAKILMIYOR, SIZIYORDU.
 */
function _normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Her derinlikte düşülen alanlar — NORMALİZE edilmiş anahtarlar, TAM EŞLEŞME.
 *
 * ⚠️ TAM eşleşme ZORUNLU; substring/prefix eşleşmesi YASAK. Kanıt: `lat` deny'i
 * substring olsaydı `platform` (p·LAT·form → W4E runtime teşhis bölümünün TAMAMI)
 * ve `detectedPlatform` düşerdi; `vin` prefix olsaydı `vinMasked` (VIN sızıntısını
 * ÖNLEMEK için üretilen maskeli türev) silinirdi. Yani gevşek eşleşme, korumaya
 * çalıştığımız raporu sessizce boşaltır.
 */
const DENY_KEYS = new Set([
  // konum
  'lat', 'lng', 'latitude', 'longitude', 'location', 'address',
  // araç / kişi kimliği
  'vin', 'plate', 'plaka', 'phone', 'contact', 'email',
  // ağ kimliği
  'ssid', 'bssid', 'mac',
  // kimlik bilgisi / sır (api_key ve accessToken gibi yazımlar normalize ile aynı girişe düşer)
  'apikey', 'accesstoken', 'refreshtoken', 'authorization', 'bearer',
  'secret', 'password', 'jwt', 'token',
]);

/** Dairesel referans işareti — "alan yoktu" ile "alan dairesel olduğu için atıldı" AYRI. */
const CYCLE_MARKER = '[CYCLE]';
/** Okunamayan düğüm (getter throw / Proxy trap) — tek zehirli alan raporu öldürmesin. */
const UNREADABLE_MARKER = '[UNREADABLE]';

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

/**
 * Deny-list + regex maskesi — her derinlikte uygulanır.
 *
 * `ancestors` = ŞU ANKİ özyineleme yolundaki (kendi ATALARI) kaplar. Dairesel
 * referans YALNIZ bir nesne kendi atası olduğunda vardır. Naif "görülen nesneler"
 * seti KULLANILMAZ: paylaşılan referansı (aynı nesne iki KARDEŞ dalda) cycle sanar
 * ve ikinci dalı sessizce boşaltırdı — DTC `[null,null]` ile aynı sınıf sessiz kayıp.
 * Girerken ekle, `finally` ile çıkarken sil.
 *
 * ASLA THROW ETMEZ: getter/Proxy patlarsa o DÜĞÜM `[UNREADABLE]` olur, kardeş
 * alanlar akmaya devam eder (`_safeSection`'ın düğüm-bazlı karşılığı) — tek zehirli
 * alan tüm tanı raporunu öldüremez.
 */
function _deepSanitize(value: unknown, depth: number, ancestors?: Set<object>): unknown {
  if (value == null) return value;
  if (typeof value === 'string')  return _maskString(value);
  if (typeof value === 'number')  return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'object')  return undefined; // function / symbol / bigint → düş
  if (depth >= MAX_DEPTH)         return undefined; // derin ağaç → düş

  const obj  = value as object;
  const path = ancestors ?? new Set<object>();
  if (path.has(obj)) return CYCLE_MARKER; // kendi atası → dairesel

  path.add(obj);
  try {
    if (Array.isArray(value)) {
      // Düşen eleman diziden ÇIKARILIR — `.map` ile yerinde bırakılırsa `undefined`
      // olur ve JSON'da `null`a döner: tüketici (triyaj) bunu "kod var ama boş" diye
      // okur ve patlar. Sessiz `null` yerine kısa dizi (dürüst eksiklik).
      // Cycle `[CYCLE]` döndüğü için elenmez → dizi uzunluğu korunur.
      const out: unknown[] = [];
      const len = Math.min(value.length, MAX_ARRAY_LEN);
      for (let i = 0; i < len; i++) {
        let v: unknown;
        try { v = _deepSanitize(value[i], depth + 1, path); }
        catch { v = UNREADABLE_MARKER; } // eleman getter'ı patladı → yalnız o eleman
        if (v !== undefined) out.push(v);
      }
      return out;
    }

    let keys: string[];
    try { keys = Object.keys(obj as Record<string, unknown>); }
    catch { return UNREADABLE_MARKER; } // Proxy ownKeys trap'i patladı → düğüm okunamaz

    const out: Record<string, unknown> = {};
    for (const key of keys) {
      if (DENY_KEYS.has(_normalizeKey(key))) continue; // konum/kimlik/sır → düş
      let v: unknown;
      try { v = _deepSanitize((obj as Record<string, unknown>)[key], depth + 1, path); }
      catch { v = UNREADABLE_MARKER; }  // getter patladı → yalnız o anahtar
      if (v !== undefined) out[key] = v;
    }
    return out;
  } finally {
    path.delete(obj); // yoldan çık — kardeş dal aynı nesneyi cycle SANMASIN
  }
}

/**
 * Rapor gövdesine SONRADAN eklenen üst-seviye bölümler (inspector, selfTest) için
 * ortak sanitize kapısı. Gövde alanları `_deepSanitize(payload, 0)` içinde derinlik
 * 1'de değerlendirilir; sonradan eklenen bölüm de aynı bütçeye tabi olsun diye 1.
 * TEK KAPI: yeni bir bölüm eklendiğinde sanitize'ı atlamak imkânsızlaşsın.
 */
function _sanitizeSection(value: unknown): unknown {
  return _deepSanitize(value, 1);
}

/**
 * Uzağa gidecek payload'ı temizler:
 *  1. Üst seviye allowlist — ALLOW_KEYS dışındaki her alan düşer
 *  2. Her derinlikte DENY_KEYS düşer (normalize edilmiş anahtar, TAM eşleşme)
 *  3. String'lerde VIN/MAC/koordinat/api_key=/token= maskelenir
 *
 * ASLA THROW ETMEZ — hata yolundan (crashLogger) çağrılmaya güvenlidir.
 */
export function sanitizeForRemote(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let keys: string[];
  try { keys = Object.keys(payload); } catch { return out; }

  for (const key of keys) {
    if (!ALLOW_KEYS.has(key)) continue;
    if (DENY_KEYS.has(_normalizeKey(key))) continue;
    let v: unknown;
    try { v = _deepSanitize(payload[key], 1); }
    catch { v = UNREADABLE_MARKER; }
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
 * Diğer tanı üreticileri (voiceDiagService) için oturum kimliği + sürüm.
 * Aynı bootId → admin tarafında critical_error/voice_diag korelasyonu.
 */
export function getRemoteLogSession(): { bootId: string; appVersion: string } {
  return { bootId: BOOT_ID, appVersion: _appVersion() };
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
 * Destek anlık görüntüsü: appVersion/versionCode + OBD durumu + son hata
 * özeti + son critical hata + sağlık özeti + OTA durumu. Konum/VIN/plaka/
 * MAC/cihaz adı/token YOK — her bölüm güvenli alanlardan elle kurulur,
 * üstüne deep sanitize (deny + maske) uygulanır.
 *
 * Enqueue hatası PROPAGATE eder — triggerSupportSnapshot bunu kullanıcıya
 * "gönderilemedi" olarak yansıtır.
 */
export async function reportSupportSnapshot(
  reportId?: string,
  meta?: DiagnosticReportMeta,
): Promise<Record<string, unknown>> {
  const payload = await _buildSupportSnapshotPayload();
  _attachUserReport(payload, meta);
  _attachTriage(payload);
  await pushVehicleEvent('support_snapshot', payload, reportId);
  return payload;
}

/** Bölüm toplayıcısı tamamen düşse bile payload üretilsin (fail-soft). */
function _safeSection<T>(fn: () => T): T | null {
  try { return fn(); } catch { return null; }
}

/** _safeSection'ın async toplayıcılar için karşılığı (GPS izin kontrolü Promise döner). */
async function _safeSectionAsync<T>(fn: () => Promise<T>): Promise<T | null> {
  try { return await fn(); } catch { return null; }
}

/**
 * ÖNCELİKLİ BULGU TRİYAJI — payload TAMAMEN kurulduktan SONRA (selfTest/
 * inspector dahil, hangisi varsa) çağrılır ki kural motoru en zengin veriyle
 * çalışsın. Fail-soft: triyaj patlarsa ana rapor gövdesi ETKİLENMEZ.
 */
function _attachTriage(payload: Record<string, unknown>): void {
  try {
    payload.triage = buildTriageSnapshot(payload as TriageSections);
  } catch { /* triyaj asla ana raporu bozmaz */ }
  // V2 (Root Cause Engine, PR-1) — AYRI fail-soft: rootCause patlasa bile
  // ne ana rapor ne de klasik triage etkilenir (bağımsız geçiş).
  try {
    payload.rootCause = buildRootCauseSnapshot(payload as TriageSections);
  } catch { /* kök-neden bloğu asla ana raporu/triyajı bozmaz */ }
  // V2 (PR-2) — ESKİ/YENİ hata ayrımı: lastErrors (+ lastCritical) → dedup defter.
  // Ayrı fail-soft geçiş; kalıcı ring'teki önceki-boot hataları activeNow:false olur.
  try {
    const raw: RawErrorLike[] = [];
    if (Array.isArray(payload.lastErrors)) raw.push(...(payload.lastErrors as RawErrorLike[]));
    if (payload.lastCritical && typeof payload.lastCritical === 'object') {
      raw.push(payload.lastCritical as RawErrorLike);
    }
    payload.errorLedger = buildErrorLedger(raw, {
      nowMs: Date.now(), sessionStartMs: SESSION_START_MS, bootId: BOOT_ID,
    });
  } catch { /* defter bloğu asla ana raporu/triyajı bozmaz */ }
  // V2 (PR-7) — BİRLEŞİK VERDİKT: rootCause + inconclusive + errorLedger old/new →
  // tek bakılacak nesne. Ayrı fail-soft geçiş; errorLedger yoksa da çalışır.
  try {
    payload.diagnosticVerdict = buildDiagnosticVerdict(
      payload as TriageSections,
      (payload.errorLedger as ErrorLedgerLike | undefined) ?? null,
    );
  } catch { /* verdict bloğu asla ana raporu/triyajı bozmaz */ }
}

/* ── VID aynası (vidMirror) — EXPLICIT ALLOWLIST ─────────────────────
 * VID store'un HAM objesi payload'a ASLA doğrudan konmaz. Aşağıdaki dört
 * bölüm alan-alan elle kurulur; allowlist DIŞINDA hiçbir şey uzağa gidemez:
 *   • Ham VIN yok  → yalnız vinMasked (maskeli türev)
 *   • Ham MAC/adres yok → lastAddress bilinçli DIŞARIDA
 *   • Bluetooth cihaz adı yok · installedPackages (uygulama listesi) yok
 *   • Store action fonksiyonları yapısal olarak dışarıda (üst-seviye vid
 *     nesnesi hiç spread edilmez; ayrıca _deepSanitize function'ı düşürür)
 * _buildVidMirror çağrısı _safeSection ile fail-soft; üretilen nesne yine
 * payload gövdesinin _deepSanitize'ından (deny + VIN/MAC/koordinat maskesi)
 * geçer — allowlist ile son savunma katmanı üst üste biner. */

/** VIN'i maskeler: yalnız WMI (ilk 3 — marka/bölge, kişi-tanımlayıcı değil)
 *  açık kalır; benzersiz seri (VDS/VIS) '*' ile gizlenir. Çıktı '*' içerdiği
 *  için 17-karakter VIN regex'ine takılmaz → maske kendisi de korunur. */
function _maskVin(vin: string): string {
  const v = vin.trim().toUpperCase();
  if (v.length < 6) return '*'.repeat(v.length); // kısa/geçersiz → tamamen gizle
  return v.slice(0, 3) + '*'.repeat(v.length - 3);
}

/** VID şemasında henüz bulunmayan (ileride eklenebilecek) opsiyonel alanı
 *  tip-güvenli okur — allowlist ileriye-dönük olsun, `any` gerekmesin. */
function _readOptional(obj: object, key: string): unknown {
  const rec = obj as Record<string, unknown>;
  return key in rec ? rec[key] : undefined;
}

/** VID store'dan yalnız allowlist alanlarını içeren yeni nesne kurar. */
function _buildVidMirror(): Record<string, unknown> {
  const vid = useVidStore.getState();
  const rawVin = vid.vehicle.vin;
  return {
    headUnit: {
      detectedPlatform:        vid.headUnit.detectedPlatform,
      webViewChromeVersion:    vid.headUnit.webViewChromeVersion,
      isPlayServicesAvailable: vid.headUnit.isPlayServicesAvailable,
    },
    obdAdapter: {
      lastTransport:        vid.obdAdapter.lastTransport,
      transportVerified:    vid.obdAdapter.isTransportVerified,
      lastProtocolNum:      vid.obdAdapter.lastProtocolNum,
      // connectionHealth / lastDisconnectReason: VID şemasında henüz yok →
      // undefined döner, _deepSanitize düşürür (şema büyürse otomatik akar).
      connectionHealth:     _readOptional(vid.obdAdapter, 'connectionHealth'),
      lastDisconnectReason: _readOptional(vid.obdAdapter, 'lastDisconnectReason'),
    },
    vehicle: {
      make:        vid.vehicle.make,
      model:       vid.vehicle.model,
      modelYear:   vid.vehicle.modelYear,
      vehicleType: vid.vehicle.vehicleType,
      // Ham VIN ASLA girmez — yalnız maskelenmiş türev (VIN yoksa null).
      vinMasked:   rawVin ? _maskVin(rawVin) : null,
    },
    telemetry: {
      trustScore:           vid.telemetry.trustScore,
      healthState:          vid.telemetry.healthState,
      thermalStatus:        vid.telemetry.thermalStatus,
      isDiagnosticDegraded: vid.telemetry.isDiagnosticDegraded,
      plausibilityFailures: vid.telemetry.plausibilityFailures,
    },
  };
}

/** Ortak snapshot gövdesi — reportSupportSnapshot ve reportDiagnosticSnapshot kullanır. */
async function _buildSupportSnapshotPayload(): Promise<Record<string, unknown>> {
  const obd    = getOBDStatusSnapshot();
  const health = healthMonitor.getGlobalHealthSnapshot();
  const ota    = useOtaStore.getState();
  const versionCode = await getCurrentVersionCode().catch(() => 0);

  // Son 15 hata (genişlik — eskiden 5) + kısaltılmış stack (ilk kare; PII'siz —
  // _maskString VIN/MAC/koordinat/token maskeler). replayBuffer (kara kutu:
  // konum içerir) yine bilinçli DIŞARIDA.
  const entries    = getErrorLog();
  const lastErrors = entries.slice(-15).map((e) => ({
    ts:       e.ts,
    ctx:      _maskString(e.ctx),
    msg:      _maskString(e.msg.slice(0, 256)),
    severity: e.severity ?? 'error',
    stack:    e.stack ? _maskString(e.stack.split('\n').slice(0, 2).join(' | ').slice(0, 240)) : undefined,
  }));

  // Son critical hata özeti — yoksa null
  const lastCrit = entries.filter((e) => e.severity === 'critical').slice(-1)[0];
  const lastCritical = lastCrit
    ? { ts: lastCrit.ts, ctx: _maskString(lastCrit.ctx), msg: _maskString(lastCrit.msg.slice(0, 256)) }
    : null;

  // Cihaz profili — saha teşhisi için (Duster vakası: eski WebView'de inline
  // modern CSS düşüp dashboard çöküyordu). PII yok: sürüm/çekirdek/ekran sayısal.
  const caps = getCapabilities();

  // Async genişlik bölümleri — GPS izin kontrolü (Capacitor) ve depolama/kuyruk
  // (navigator.storage.estimate + connectivityService.queueSize) Promise döner.
  const [gps, storageQueue] = await Promise.all([
    _safeSectionAsync(buildGpsDeepSnapshot),
    buildStorageQueueSnapshot().catch(() => ({ queuePending: 0, storagePct: -1, storageWarn: false })),
    // PR-OBD-DIAG-3: native extended poll kanıtını tazele → buildObdDeepSnapshot senkron okur.
    refreshExtendedPollEvidence().catch(() => { /* fail-soft: kanıt yok */ }),
  ]);

  const payload = _deepSanitize({
    appVersion:  health.appVersion,
    versionCode,
    bootId:      BOOT_ID,
    device: {
      webViewVersion: caps.webViewVersion,
      androidVersion: caps.androidVersion,
      tier:           getDeviceTier(),
      cores:          caps.cores,
      memoryMb:       caps.memoryMb,
      screenW:        typeof window !== 'undefined' ? window.screen?.width  ?? 0 : 0,
      screenH:        typeof window !== 'undefined' ? window.screen?.height ?? 0 : 0,
    },
    obd: {
      connectionState: obd.connectionState,
      source:          obd.source,
      vehicleType:     obd.vehicleType,
      lastSeenMs:      obd.lastSeenMs,
    },
    lastErrors,
    lastCritical,
    health: {
      overallHealth: health.overallHealth,
      services:      health.services.map((s) => ({
        name: s.name, healthy: s.healthy, restartCount: s.restartCount,
      })),
    },
    // OTA durumu — apkPath/fileName (storage yolu) BİLİNÇLİ dışarıda
    ota: {
      state:             ota.state,
      errorCode:         ota.errorCode,
      targetVersionCode: ota.release?.versionCode ?? null,
      lastCheckTs:       ota.lastCheckTs,
    },
    // UI aktivite izi — zamansız açılan modal/overlay tespiti (açık yüzeyler +
    // son olaylar + zamansız açılış sayısı). PII yok (yalnız tag/class/z/alan).
    uiActivity: getUiActivitySnapshot(),
    // Olay izi (breadcrumb) — mod/OBD/ekran/hata/modal kronolojik hikâyesi
    // ("soruna ne yol açtı"). Genişlik backbone'u.
    trail: getDiagnosticTrail(),
    // OBD derin — adaptör/kaynak + sensör tazeliği + canlı sinyaller + keşfedilen
    // extended PID'ler + DTC arıza kodları. Fail-soft (kaynak yoksa boş/–1).
    obdDeep: _safeSection(buildObdDeepSnapshot),
    // Perf zaman serisi — oturum boyu termal/bellek/fps/lag halka tamponu (trend:
    // ısınma/sızıntı/kasma anlık snapshot'ta görünmez).
    perfSeries: getPerfSeriesSnapshot(),
    // Ağ/AI sağlığı — online + AI devre kesici + sağlayıcı 429/kota pencereleri.
    netAi: _safeSection(buildNetAiSnapshot),
    // GPS derin — izin durumu + fix tazeliği + doğruluk + DR aktif mi.
    // 🔒 KOORDİNAT YOK (mahremiyet kilidi) — yalnız durum/sayısal alanlar.
    gps,
    // Sesli asistan/STT — Vosk model hazırlığı + wake word + son sonuç (ham
    // transkript YOK — PII değil).
    voice: _safeSection(buildVoiceSnapshot),
    // Güvenli bölge (geofence) — bulut-okuma durumu + bölge sayısı + senkron aktif mi.
    geofence: _safeSection(buildGeofenceSnapshot),
    // Depolama + kuyruk — bekleyen at-least-once event sayısı + disk kullanımı.
    storageQueue,
    // Güç/Akü sağlığı — 12V voltaj + kaynak (CAN/OBD) + rozet + son 10sn min/max.
    power: _safeSection(buildPowerSnapshot),
    // Sensör füzyon tutarlılığı — aktif hız kaynağı + GPS/donanım farkı + güven
    // rozeti (zero-trust: kaynaklar çelişiyorsa confidence düşer) + DR aktif mi.
    fusion: _safeSection(buildFusionSnapshot),
    // Boot zaman çizelgesi — her Wave'in süresi + toplam cold-start + en yavaş dalga.
    bootTiming: _safeSection(buildBootTimingSnapshot),
    // Transport/bağlantı sağlığı — aktif transport (CAN/classic/ble/tcp) + reconnect
    // deneme sayısı + son kopma nedeni.
    transport: _safeSection(buildTransportSnapshot),
    // VID aynası — araç/head unit/OBD adaptör/telemetri özeti. EXPLICIT ALLOWLIST
    // (ham VIN/MAC/cihaz adı/uygulama listesi yapısal olarak dışarıda); fail-soft.
    vidMirror: _safeSection(_buildVidMirror),
    // Platform runtime (W4E) — Event Bus + Vehicle HAL wiring BOUNDED sayaçları:
    // tek instance / tek abonelik / event sayaçları cihazda ADB veya geçici debug
    // expose OLMADAN okunabilsin diye. YALNIZ durum+sayaç (event payload'ı, history
    // içeriği, araç sinyal DEĞERLERİ, VIN/koordinat/CAN YOK). Wiring yoksa sayaçlar
    // null ("ölçülemiyor" ≠ 0). Bridge henüz bağlı değil → bölümü YOK.
    platform: _safeSection(buildPlatformRuntimeSnapshot),
  }, 0) as Record<string, unknown>;

  return payload;
}

/* ── diagnostic snapshot (Dev Inspector "Tanı Gönder") ──────── */

/**
 * Dev Inspector tanı raporu — support_snapshot gövdesinin üstüne sanitize
 * edilmiş inspector özetini (runtime/timeline/network) ekler.
 *
 * Tip BİLİNÇLİ olarak 'support_snapshot': Admin Incident Center'ın mevcut
 * INCIDENT_TYPES filtresi/detay paneli yeni tip eklemeden görür;
 * `source: 'dev_inspector'` alanı kaynağı ayırt eder. Inspector verisi de
 * _deepSanitize'dan geçer (deny-list + VIN/MAC/koordinat/token maskesi) —
 * Copy for Claude payload'ı zaten PII'siz kurulur, bu ikinci savunma katmanı.
 *
 * Enqueue hatası PROPAGATE eder — triggerDiagnosticSnapshot 'error' yansıtır.
 */
export async function reportDiagnosticSnapshot(
  inspector: Record<string, unknown>,
  reportId?: string,
  meta?: DiagnosticReportMeta,
): Promise<Record<string, unknown>> {
  const base = await _buildSupportSnapshotPayload();
  const payload: Record<string, unknown> = {
    ...base,
    source:    'dev_inspector',
    inspector: _sanitizeSection(inspector),
  };
  _attachUserReport(payload, meta);
  _attachTriage(payload);
  await pushVehicleEvent('support_snapshot', payload, reportId);
  return payload;
}

/* ── self-test snapshot ("Tanı Robotu" — aktif tarama) ───────────
 * support_snapshot gövdesine aktif self-test raporunu (her alt sistemin
 * kapısı çalınıp geçti/uyarı/kaldı) ekler. Tip yine 'support_snapshot'
 * (panel mevcut filtre/detayla görür); `source:'self_test'` kaynağı ayırır.
 *
 * ⚠️ Robot raporu PII'siz ÜRETİLİR ama GARANTİ ETMEZ: prob `detail` alanları
 * SERBEST METİN taşır — ham `Error.message` (selfTestEngine runProbe catch), ham
 * fetch hata metni (probeBackend) ve stack karesi/dosya yolu (probeIdleRenderLoop).
 * Bu bölüm eskiden sanitize'ı TAMAMEN atlıyordu (ham spread) → deny-list, VIN/MAC/
 * koordinat/api_key maskeleri ve derinlik tavanı uygulanmıyordu. Artık inspector
 * ile AYNI kapıdan geçer. */
export async function reportSelfTestSnapshot(
  reportId?: string,
  meta?: DiagnosticReportMeta,
): Promise<Record<string, unknown>> {
  const [base, { runSelfTest }] = await Promise.all([
    _buildSupportSnapshotPayload(),
    import('./selfTestEngine'),
  ]);
  const selfTest = _sanitizeSection(await runSelfTest());
  const payload: Record<string, unknown> = { ...base, source: 'self_test', selfTest };
  _attachUserReport(payload, meta);
  _attachTriage(payload);
  await pushVehicleEvent('support_snapshot', payload, reportId);
  return payload;
}

/* ── Kullanıcı raporu meta + önizleme (PR-4: açıklama/kategori/önizleme/rıza) ──
 * PR-4 kullanıcı-yüzeyi katmanıdır: teknik payload'ı BOZMAZ; yalnız kullanıcının
 * yazdığı serbest metni + kategoriyi ekler ve gönderim-öncesi önizleme üretir.
 * Yeni veri kaynağı / telemetri / tracking YOK; PII kuralları ve redaction AYNEN
 * korunur (not alanı da _maskString'den geçer). */

/** Kullanıcı tarafından girilebilecek kategoriler (enum — PII değil). */
export const DIAGNOSTIC_CATEGORIES = [
  'OBD', 'GPS', 'Harita', 'Performans', 'Bluetooth', 'Ses', 'AI', 'Çökme', 'Donma', 'Diğer',
] as const;
export type DiagnosticCategory = typeof DIAGNOSTIC_CATEGORIES[number];

/** Kullanıcı rapor meta'sı — modaldan gelir. */
export interface DiagnosticReportMeta {
  note?:     string; // problem açıklaması (serbest metin — maskelenir + kırpılır)
  category?: string; // kategori etiketi (allowlist dışı → düşer)
}

const MAX_NOTE_LEN = 1_000;

/** UTF-8 octet uzunluğu (önizleme boyutu — sunucu octet_length ile aynı). */
function _octetLenLocal(s: string): number {
  try { return new TextEncoder().encode(s).length; }
  catch { return s.length; }
}

/**
 * Kullanıcı raporunu güvenli hale getirir: not _maskString'den geçer (VIN/MAC/
 * koordinat/token maskesi — serbest metinde PII sızıntısı önlenir) + uzunluk
 * kırpılır; kategori yalnız allowlist'ten kabul edilir. İkisi de yoksa undefined.
 */
function _sanitizeUserReport(meta?: DiagnosticReportMeta): { note?: string; category?: string } | undefined {
  if (!meta) return undefined;
  const rawNote = typeof meta.note === 'string' ? meta.note.trim() : '';
  const note = rawNote ? _maskString(rawNote.slice(0, MAX_NOTE_LEN)) : undefined;
  const category = typeof meta.category === 'string'
    && (DIAGNOSTIC_CATEGORIES as readonly string[]).includes(meta.category)
    ? meta.category : undefined;
  if (note === undefined && category === undefined) return undefined;
  return { note, category };
}

/** payload'a kullanıcı raporunu ekler (varsa) — teknik bölümler ETKİLENMEZ. */
function _attachUserReport(payload: Record<string, unknown>, meta?: DiagnosticReportMeta): void {
  const ur = _sanitizeUserReport(meta);
  if (ur) payload.userReport = ur;
}

/** Gönderim-öncesi önizleme — payload'ı KURAR ama GÖNDERMEZ (rıza öncesi upload yok). */
export interface DiagnosticPreview {
  sizeBytes:    number;                               // tahmini gövde boyutu
  willTruncate: boolean;                              // > 64KB → sunucu kırpar
  sections:     { key: string; label: string }[];    // gönderilecek bölümler
  masked:       string[];                             // maskelenen bilgi türleri
  notSent:      string[];                             // yapısal olarak gönderilmeyenler
}

const _SECTION_LABELS: Record<string, string> = {
  appVersion: 'Sürüm', versionCode: 'Sürüm kodu', bootId: 'Oturum kimliği',
  device: 'Cihaz profili', obd: 'OBD durumu', lastErrors: 'Son hatalar',
  lastCritical: 'Son kritik hata', health: 'Sistem sağlığı', ota: 'Güncelleme durumu',
  uiActivity: 'Arayüz aktivitesi', trail: 'Olay izi', obdDeep: 'OBD derin veri',
  perfSeries: 'Performans serisi', netAi: 'Ağ / AI sağlığı', gps: 'GPS durumu (konumsuz)',
  voice: 'Sesli asistan', geofence: 'Güvenli bölge', storageQueue: 'Depolama / kuyruk',
  power: 'Güç / akü', fusion: 'Sensör füzyon', bootTiming: 'Açılış zamanları',
  transport: 'Bağlantı sağlığı', vidMirror: 'Araç özeti', platform: 'Platform runtime',
  triage: 'Öncelikli bulgular', inspector: 'Geliştirici izi', selfTest: 'Otomatik test',
  userReport: 'Açıklamanız', source: 'Kaynak', rootCause: 'Kök neden',
  errorLedger: 'Hata defteri (eski/yeni)', diagnosticVerdict: 'Tanı verdikti',
};

const _MASKED_INFO = [
  'VIN (araç kimliği) → maskelenir', 'MAC / SSID (ağ) → maskelenir',
  'Koordinat (konum) → maskelenir', 'API anahtarı / token → maskelenir',
];
const _NOT_SENT_INFO = [
  'Ham konum / koordinatlar', 'VIN (yalnız maskeli türev gider)', 'MAC / BSSID / SSID',
  'Telefon / kişi / e-posta', 'Plaka', 'Bluetooth cihaz adı', 'Yüklü uygulama listesi',
  'Kara kutu (kaza tamponu)', 'Depolama yolları',
];

/**
 * "Tanı Gönder" önizlemesi: destek snapshot gövdesini KURAR (upload YOK), boyut +
 * gönderilecek bölümler + maskelenen/gönderilmeyen bilgi özetini döndürür. self_test/
 * inspector varyantları bu gövdeye tek bölüm ekler; boyut TAHMİNİDİR. Fail-soft:
 * gövde kurulamazsa boş/güvenli önizleme.
 */
export async function buildDiagnosticPreview(): Promise<DiagnosticPreview> {
  let payload: Record<string, unknown>;
  try { payload = await _buildSupportSnapshotPayload(); }
  catch { return { sizeBytes: 0, willTruncate: false, sections: [], masked: _MASKED_INFO, notSent: _NOT_SENT_INFO }; }

  const sizeBytes = _octetLenLocal(JSON.stringify(payload));
  const sections = Object.keys(payload)
    .filter((k) => payload[k] != null)
    .map((k) => ({ key: k, label: _SECTION_LABELS[k] ?? k }));
  return {
    sizeBytes,
    willTruncate: sizeBytes > SERVER_MAX_BYTES,
    sections,
    masked:  _MASKED_INFO,
    notSent: _NOT_SENT_INFO,
  };
}

/* ── Kullanıcı tetiklemeli snapshot (Settings "Tanı Gönder") ── */

/**
 * Tetikleme SONUCU — "kabul" durumu (senkron). DİKKAT: 'queued' = kuyruğa kabul
 * edildi, TESLİM EDİLDİ DEĞİL. Gerçek teslim (sunucu UUID'si) daha sonra drain
 * döngüsünde olur; UI onu `awaitDelivery(reportId)` ile öğrenir. Eski 'sent'
 * değeri (yalancı "Gönderildi") KALDIRILDI — enqueue çözülmesi teslim kanıtı değildi.
 *   - queued         : kuyruğa kabul edildi (çevrimiçi) — teslim HENÜZ değil
 *   - queued_offline : çevrimdışı — at-least-once kuyruğa alındı, internet gelince
 *   - cooldown       : SNAPSHOT_COOLDOWN_MS içinde ikinci basış → snapshot üretilmez
 *   - error          : enqueue hatası — cooldown YANMAZ, hemen yeniden denenebilir
 *   - not_paired     : cihaz eşlenmemiş — loglar gönderilemez
 */
export type SnapshotTriggerResult = 'queued' | 'queued_offline' | 'cooldown' | 'error' | 'not_paired';

/** Zengin tetikleme sonucu — kabul durumu + teslimat korelasyon anahtarı (reportId).
 *  UI reportId ile `awaitDelivery` çağırıp "Kuyrukta" → "Gönderildi" yükseltir. */
export interface SnapshotTriggerOutcome {
  status:   SnapshotTriggerResult;
  reportId: string | null; // yalnız queued/queued_offline'da dolu
}

/** Art arda basma spam koruması — pencere içinde tek snapshot */
export const SNAPSHOT_COOLDOWN_MS = 60_000;

let _lastSnapshotAt = Number.NEGATIVE_INFINITY; // monotonic (performance.now)

/* String-dönüşlü API (geriye uyumlu): mevcut tüketiciler yalnız durumu okur. */
export async function triggerSupportSnapshot(): Promise<SnapshotTriggerResult> {
  return (await triggerSupportSnapshotEx()).status;
}
export async function triggerDiagnosticSnapshot(
  inspector: Record<string, unknown>,
): Promise<SnapshotTriggerResult> {
  return (await triggerDiagnosticSnapshotEx(inspector)).status;
}
export async function triggerSelfTestSnapshot(): Promise<SnapshotTriggerResult> {
  return (await triggerSelfTestSnapshotEx()).status;
}

/* Zengin API (reportId + kullanıcı meta taşır) — UI teslimat gerçeğini bununla izler.
 * meta (PR-4): kullanıcı açıklaması + kategori; verilmezse eski davranış (PR-3). */
export async function triggerSupportSnapshotEx(meta?: DiagnosticReportMeta): Promise<SnapshotTriggerOutcome> {
  return _triggerSnapshot('support_snapshot', (rid) => reportSupportSnapshot(rid, meta));
}
export async function triggerDiagnosticSnapshotEx(
  inspector: Record<string, unknown>,
  meta?: DiagnosticReportMeta,
): Promise<SnapshotTriggerOutcome> {
  return _triggerSnapshot('support_snapshot', (rid) => reportDiagnosticSnapshot(inspector, rid, meta));
}
export async function triggerSelfTestSnapshotEx(meta?: DiagnosticReportMeta): Promise<SnapshotTriggerOutcome> {
  return _triggerSnapshot('support_snapshot', (rid) => reportSelfTestSnapshot(rid, meta));
}

/**
 * Teslimatı bekler (UI polling): reportId terminal duruma ulaşınca (delivered/
 * truncated/rejected/failed) döner, aksi timeout'ta son bilinen durumu verir.
 * Drain döngüsü asenkron çalıştığından kısa aralıkla defter yoklanır. Fail-soft:
 * timer yoksa (test) tek okuma döner.
 */
export async function awaitDelivery(
  reportId: string,
  timeoutMs = 30_000,
  pollMs = 500,
): Promise<DeliveryState> {
  const start = (typeof performance !== 'undefined' ? performance.now() : 0);
  for (;;) {
    const rec = getDelivery(reportId);
    if (rec && isTerminal(rec.state)) return rec.state;
    const elapsed = (typeof performance !== 'undefined' ? performance.now() : 0) - start;
    if (elapsed >= timeoutMs || typeof setTimeout === 'undefined') {
      return rec?.state ?? 'queued';
    }
    await new Promise<void>((r) => setTimeout(r, pollMs));
  }
}

/** Ortak tetikleme iskeleti: cooldown → reportId üret → gönder → durumu sınıflandır. */
async function _triggerSnapshot(
  type: string,
  send: (reportId: string) => Promise<Record<string, unknown>>,
): Promise<SnapshotTriggerOutcome> {
  const now = performance.now();
  if (now - _lastSnapshotAt < SNAPSHOT_COOLDOWN_MS) return { status: 'cooldown', reportId: null };

  // Eşleme ön-kontrolü: cihaz eşlenmemişse pushVehicleEvent event'i düşürür —
  // eskiden burası yine 'sent' diyordu (yalancı başarı). Kullanıcıya gerçek
  // neden + Mobil Bağlantı yönlendirmesi gösterilir; cooldown YANMAZ.
  // Fail-open: kontrol fonksiyonu yoksa (test mock'u / eski sürüm) atlanır.
  try {
    const vis = await import('./vehicleIdentityService');
    if (typeof vis.isDevicePaired === 'function' && !(await vis.isDevicePaired())) {
      return { status: 'not_paired', reportId: null };
    }
  } catch { /* tanı ön-kontrolü snapshot akışını asla kıramaz */ }

  // Fail-open: yalnız onLine === false kesin "çevrimdışı"dır; alan yoksa
  // (eski WebView / test ortamı) çevrimiçi varsayılır — kuyruk at-least-once
  // olduğundan yanlış 'queued' veri kaybettirmez.
  const online = typeof navigator === 'undefined' || navigator.onLine !== false;

  // Idempotency: her tetikleme deterministik-benzersiz reportId alır; kuyruğun
  // retry'leri AYNI reportId'yi taşır → defter tek kayıt tutar (duplicate yok).
  const reportId = deriveReportId(type, `${BOOT_ID}:${Math.round(now * 1000)}`);
  beginDelivery(reportId, type, Date.now());

  try {
    await send(reportId);
    _lastSnapshotAt = now;
    return { status: online ? 'queued' : 'queued_offline', reportId };
  } catch {
    return { status: 'error', reportId: null }; // cooldown yanmaz
  }
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
  _lastSnapshotAt = Number.NEGATIVE_INFINITY;
  _running    = false;
  registerRemoteSink(null);
  _resetDeliveryLedgerForTest();
  if (!opts?.keepWatermark) safeRemoveRaw(WATERMARK_KEY);
}
