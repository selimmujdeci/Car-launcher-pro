/**
 * BlackBoxService — Araç Kara Kutusu  (U-5 · R-1 Operasyon)
 *
 * İşlevler:
 *  1. Rolling Buffer: Son 30 saniyelik araç durumu (VehicleState + OBD + G-kuvveti)
 *     sirkülasyon tamponu içinde tutulur. Zero-allocation: 300 slot önceden
 *     ayrılır, her tick mevcut slotun alanları yerinde güncellenir.
 *
 *  2. Darbe Algılama: DeviceMotionEvent.acceleration (yerçekimsiz doğrusal
 *     ivme) dinlenir. Herhangi bir eksende |ivme| > 6.0G (58.84 m/s²) ise
 *     _lockCrashData() tetiklenir.
 *     (Native High-G callback araştırması: CarLauncherPlugin'de dedicated
 *      'highG' event yok — DeviceMotionEvent tüm head unit WebView'larda çalışır.)
 *
 *  3. Veri Kilitleme: Darbe anında tampon JSON'a dönüştürülür ve
 *     safeSetRawImmediate (R-2 Atomik Filesystem) ile "crash-log-[ts]" anahtarına
 *     yazılır. Native modda Filesystem atomik yazma; web modda localStorage fallback.
 *
 *  4. Olay Yayımı: dispatchCrashDetected(peakG) → VehicleEventHub üzerinden
 *     tüm aboneler (SystemOrchestrator → GlobalAlert + TTS) uyarılır.
 *
 *  5. Adli Veri: Her slot GPS hızı + OBD hızı (çapraz kontrol) + RPM + fren tahmini
 *     içerir. Kaza analizi ve hız uyuşmazlığı tespiti için hazırdır.
 *
 * Darbe eşiği: 6.0G   Soğuma süresi: 10s (aynı çarpışma çift yazılmaz)
 * Buffer boyutu: 300 entry × 100ms/entry = 30 saniye @ 10Hz
 *
 * Zaman kaynağı — R-1 Patch (Monotonic Time):
 *   BufferSlot.ts = performance.now() - _origin   (monotonic delta, ms)
 *   CrashRecord.crashAt  = Date.now()             (duvar saati, adli raporlama)
 *   CrashRecord.crashMono = ts at crash moment    (aynı referans — "frenle çarpış arası kaç ms?")
 *   CrashRecord.originEpoch = Date.now() at _origin → slot.ts + originEpoch = duvar saati
 *   Sistem saati atlamalarında buffer kronolojisi bozulmaz (CLAUDE.md §4).
 */

import { useUnifiedVehicleStore as useVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import { dispatchCrashDetected }   from '../vehicleDataLayer';
import {
  safeSetRawImmediate,
  safeGetRaw,
  safeRemoveRaw,
  listKeysWithPrefix,
}                                  from '../../utils/safeStorage';
import { onOBDData, getOBDDataSnapshot, getObdSessionHealth, getObdFreshWindowMs } from '../obdService';
import { runtimeManager }          from '../../core/runtime/AdaptiveRuntimeManager';
import type { WorkerLifecycleStatus } from '../../core/runtime/AdaptiveRuntimeManager';
import { getThermalLevel }         from '../thermalWatchdog';
import { onMemoryPressure }        from '../memoryWatchdog';
import { getLastIntent }           from '../commandExecutor';
import { registerBlackBoxGetter }  from '../crashLogger';
import { subscribeMotion }         from '../sensors';

/* ── Sabitler ────────────────────────────────────────────────── */

const BUFFER_SIZE       = 300;   // 10Hz × 30s = 300 slot
const SAMPLE_INTERVAL   = 100;   // ms — 10Hz örnekleme
const CRASH_G_THRESHOLD = 6.0;   // G birimi — 6G gerçek darbe, 3.5G false-positive'e yol açıyordu
const G_TO_MS2          = 9.80665;
const CRASH_COOLDOWN_MS = 10_000;
const CRASH_KEY_PREFIX  = 'crash-log-';

/* ── Kaza kararı: HAREKET KANITI zorunlu (kütük #456) ──────────────────────
 *
 * SAHA 2026-08-06, cihaz depolaması: 15+ `crash-log-*` kaydı (~70 KB/adet),
 * `peakG` değerleri 6,0-9,99 G. Otomobilde bu gerçek çarpışma demektir; oysa
 * araç sağlam ve yolculuklar normal tamamlanmıştı → tetikleyici, telefonun
 * ELLE SALLANMASIYDI. 6G eşiği tek başına aracı elden ayırt edemez.
 *
 * Kural: "kanıtsız bilgi üretilmez". Bir kaza kaydı, kaza OLDUĞUNU iddia eden
 * bir belgedir; hareket kanıtı olmadan üretilmesi uydurma kanıttır. Bu yüzden
 * darbe, yakın geçmişte ÖLÇÜLMÜŞ araç hareketiyle desteklenmelidir.
 *
 * Fail-soft ve dürüstlük: hız BİLİNMİYORSA (sensör yok/bağlantı kopuk) bu
 * "araç duruyor" DEMEK DEĞİLDİR — ama "kaza oldu" da demek değildir. Kayıt
 * üretilmez, olay SAYILIR (`getCrashDetectionHealth`) ki sahada körlük değil
 * ölçülebilir bir büyüklük olarak görünsün. */
const CRASH_MIN_SPEED_KMH    = 15;      // altında çarpışma kaydı üretilmez
const CRASH_MOTION_WINDOW_MS = 10_000;  // hareket kanıtının tazelik penceresi

/* Depolama tavanı: kayıtlar ~70 KB. Sahada 15+ kayıt × 70 KB birikmişti ve
 * hiç budanmıyordu (CLAUDE.md: büyük blob'u localStorage'a yığmak yasak).
 * En yeni N tutulur — kaza sonrası incelemede anlamlı olan en son olaydır. */
const MAX_CRASH_RECORDS = 5;

/* ══════════════════════════════════════════════════════════════════
   CRASH REPLAY BUFFER — 1Hz / 60 Entry Ring (Post-Mortem Analysis)
   10Hz G-force buffer'dan ayrı; yalnızca logError anında diske yazılır.
   GİZLİLİK: Bu buffer'da lat/lng/adres alanı YOKTUR.
══════════════════════════════════════════════════════════════════ */

/**
 * 1Hz sistem durumu anlık görüntüsü.
 * Gizlilik zorunlu: location asla eklenmez.
 */
export interface BlackBoxSample {
  ts:      number;
  signals: {
    spd:  number | null;
    rpm:  number | null;
    gear: number | null;   // sayısal vites pozisyonu, bilinmiyorsa null
    fuel: number | null;
  };
  /**
   * T2: worker yaşam-döngüsü durumu. Geriye dönük uyumlu — değerler hâlâ string,
   * 'active' ve 'dead' aynı anlamı taşır; 'not_started'/'stopped' ise ESKİDEN
   * yanlışlıkla 'dead' raporlanan durumları ayırır.
   */
  workers:  Record<string, WorkerLifecycleStatus>;
  env: {
    therm: number;           // ThermalLevel 0–3
    mem:   'OK' | 'MOD' | 'CRIT';
  };
  lastCmd?: string;          // Son tetiklenen intent type
}

const REPLAY_RING_SIZE = 60;   // 60 saniye @ 1Hz
const _replayRing      = new Array<BlackBoxSample>(REPLAY_RING_SIZE);
let   _rHead           = 0;    // sonraki yazma pozisyonu
let   _rCount          = 0;    // yazılan toplam (max REPLAY_RING_SIZE)

function _replayPush(sample: BlackBoxSample): void {
  _replayRing[_rHead] = sample;
  _rHead = (_rHead + 1) % REPLAY_RING_SIZE;
  if (_rCount < REPLAY_RING_SIZE) _rCount++;
}

/* ── Replay: bellek baskı izleme ─────────────────────────────── */

let _replayMemLevel: 'OK' | 'MOD' | 'CRIT' = 'OK';
let _replayMemUnsub: (() => void) | null    = null;
let _replayTimer:    ReturnType<typeof setInterval> | null = null;

/* ── Replay: 1Hz örnekleyici ─────────────────────────────────── */

/**
 * T1: canonical OBD motor devri — kaza sonrası adli değer.
 *
 * ESKİ KUSUR (saha snapshot 2026-08-01): burada `useUnifiedVehicleStore.rpm`
 * okunuyordu. O alana YALNIZ CAN extras yolu yazar (`CanExtrasPatch.rpm`);
 * OBD hattı `updateVehicleState` üzerinden rpm GÖNDERMEZ (bkz. vehicleDataLayer/
 * index.ts — "rpm: SAB kanalından gelir, index.ts'e STATE_UPDATE ile gelmez").
 * Sonuç: RAW CAN'i olmayan araçlarda — yani hedef aftermarket filosunun tamamında —
 * BlackBox motor devrini SONSUZA DEK `null` kaydediyordu (ham trafikte 410C1990 =
 * 1636 rpm akarken bile).
 *
 * Otorite artık `obdService` anlık görüntüsüdür (UI store DEĞİL) ve üç kapıdan geçer:
 *   1. Oturum tazeliği — `dataFresh` false ise BAYAT değer gerçekmiş gibi yazılmaz.
 *   2. Paket yaşı      — aktif poll kadansından türeyen pencereyi aşarsa null.
 *   3. Geçerlilik      — `-1` sentineli "desteklenmiyor/EV" demektir; 0 DEĞİLDİR.
 * Hiçbir kapı sıfır üretmez; bilinmeyen DAİMA `null` kalır.
 */
function _canonicalObdRpm(): number | null {
  try {
    const health = getObdSessionHealth();
    if (!health.dataFresh) return null;              // bayat oturum → eski değeri diriltme

    const snap = getOBDDataSnapshot();
    if (snap.connectionState !== 'connected') return null;

    // Paket yaşı kapısı — freshWindow aktif poll kadansından türer (POWER_SAVE'de geniş).
    const lastRx = typeof snap.lastSeenMs === 'number' ? snap.lastSeenMs : 0;
    if (lastRx > 0) {
      const age = Date.now() - lastRx;
      if (age > getObdFreshWindowMs()) return null;
    }

    const rpm = snap.rpm;
    // -1 = araç bu PID'i vermiyor / EV. Geçersiz veya negatif → BİLİNMİYOR (0 değil).
    if (typeof rpm !== 'number' || !Number.isFinite(rpm) || rpm < 0) return null;
    return rpm;
  } catch {
    return null;   // fail-closed: örnekleme asla uydurmaz
  }
}

/** @internal T1 kilit testleri için — üretim kodu çağırmaz. */
export function __testCanonicalObdRpm(): number | null {
  return _canonicalObdRpm();
}

function _takeReplaySample(): void {
  try {
    /* #555: taban aralık kapısı — aynı milisaniyede iki kayıt YAZILAMAZ.
       Saat geriye sıçrarsa (`gap < 0`) kapı UYGULANMAZ: sıçrama yüzünden
       kanıt kaybetmek, mükerrer kayıttan daha kötüdür. */
    const nowMs = Date.now();
    const gap = nowMs - _lastReplaySampleMs;
    if (_lastReplaySampleMs > 0 && gap >= 0 && gap < REPLAY_MIN_GAP_MS) return;
    _lastReplaySampleMs = nowMs;

    const vs = useVehicleStore.getState();

    // PRIVACY: lat/lng/location.address asla eklenmez
    const signals: BlackBoxSample['signals'] = {
      spd:  typeof vs.speed === 'number' ? vs.speed : null,
      rpm:  _canonicalObdRpm(),
      // gear: CAN-only sinyal. RAW CAN yoksa BİLİNMİYOR kalır — OBD'den türetilmez.
      gear: vs.canGearPos ?? null,
      fuel: typeof vs.fuel  === 'number' ? vs.fuel  : null,
    };

    // T2: atomik, donmuş snapshot — canlı Map üzerinde gezerken anahtar kaybolmaz.
    const workers: Record<string, WorkerLifecycleStatus> = {};
    for (const row of runtimeManager.getWorkerSnapshot()) {
      workers[row.key] = row.status;
    }

    _replayPush({
      ts:      Date.now(),
      signals,
      workers,
      env:     { therm: getThermalLevel(), mem: _replayMemLevel },
      lastCmd: getLastIntent(),
    });
  } catch {
    // Örnekleme asla crash'e yol açmamalı
  }
}

/* ══════════════════════════════════════════════════════════════════════════
 * #555 · ÖRNEKLEYİCİ BİRİKMESİ — "1 Hz" iddiası sahada tutmuyordu
 *
 * ── SAHA KANITI (2026-08-12, gerçek araç · CAROS LAB kopyası) ──────────────
 * 60 örneğin en az beş ÇİFTİ BİREBİR AYNI `ts` ile yazılmış (…127774 ×2,
 * …141586 ×2, …145593 ×2, …158630/631, …170544 ×2) ve aralıklar 0,24 s ile
 * 2,4 s arasında savruluyor.
 *
 * KÖK: saniyede bir `requestIdleCallback(…, {timeout: 1500})` KUYRUĞA atılıyor
 * ama bekleyen istek olup olmadığına bakılmıyordu. Cihaz meşgulken istekler
 * birikiyor, idle anı gelince arka arkaya boşalıyor ve aynı milisaniyede iki
 * örnek yazılıyordu.
 *
 * NEDEN ÖNEMLİ: bu halka kaza sonrası ADLİ kayıttır. Mükerrer örnekler 60
 * elemanlı halkayı erken doldurur → "son 60 saniye" beyanı sessizce yalan olur
 * (gerçekte daha kısa bir pencere kalır). Yani kusur kozmetik değil, KANITIN
 * KAPSAMINI daraltıyordu.
 *
 * DÜZELTME iki katmanlı: (1) bekleyen istek varken yenisi kuyruğa GİRMEZ —
 * birikmenin kökü; (2) yazım anında taban aralık kapısı — aynı milisaniyede
 * iki kayıt yapısal olarak imkânsız. Yeni timer KURULMAZ.
 * ════════════════════════════════════════════════════════════════════════ */

/** Kuyrukta bekleyen örnekleme var mı — birikmeyi önleyen tek bayrak. */
let _replayPending = false;
/** Son yazılan örneğin duvar-saati damgası. */
let _lastReplaySampleMs = 0;
/**
 * İki örnek arasındaki taban aralık (ms). 1 Hz hedefinin altında bilinçli
 * seçildi: idle gecikmesi normal salınımı biraz kaydırabilir, o meşrudur —
 * kapı yalnız AYNI ANDA iki yazımı keser, düzenli örneklemeyi seyreltmez.
 */
const REPLAY_MIN_GAP_MS = 750;

function _scheduleReplaySample(): void {
  /* Bekleyen istek varken ikincisini kuyruğa ATMA — birikme burada kesilir. */
  if (_replayPending) return;
  _replayPending = true;
  const run = (): void => {
    /* Bayrak örneklemeden ÖNCE düşer: `_takeReplaySample` beklenmedik bir
       şekilde düşse bile örnekleyici kalıcı olarak kilitlenmez. */
    _replayPending = false;
    _takeReplaySample();
  };
  if (typeof requestIdleCallback !== 'undefined') {
    requestIdleCallback(run, { timeout: 1500 });
  } else {
    setTimeout(run, 0);
  }
}

/* ── Replay public API ────────────────────────────────────────── */

/**
 * Son 60 saniyeye ait 1Hz snapshot'ları kronolojik sırayla döndürür.
 * Disk yazma YOK — yalnızca bellek okuma.
 * logError() tarafından CrashEntry.replayBuffer alanına eklenir.
 */
export function getReplayData(): BlackBoxSample[] {
  if (_rCount === 0) return [];

  if (_rCount < REPLAY_RING_SIZE) {
    return _replayRing.slice(0, _rCount).filter(Boolean);
  }

  // Tampon doldu — head'den başlayarak (en eski → en yeni)
  const out: BlackBoxSample[] = [];
  for (let i = 0; i < REPLAY_RING_SIZE; i++) {
    const s = _replayRing[(_rHead + i) % REPLAY_RING_SIZE];
    if (s) out.push(s);
  }
  return out;
}

/* ── Monotonic zaman referansı ───────────────────────────────── */

/**
 * Modül yüklendiği andaki performance.now() ve Date.now() ikilisi.
 * _origin: BufferSlot.ts değerlerinin referans noktası (performance.now() - _origin).
 * _originEpoch: slot.ts'i duvar saatine dönüştürmek için (slot.ts + _originEpoch ≈ epochMs).
 * İki değer birlikte monotonic delta ↔ wall clock dönüşümünü mümkün kılar.
 */
const _origin:      number = performance.now();
const _originEpoch: number = Date.now();

/* ── Buffer giriş yapısı ─────────────────────────────────────── */

/**
 * Her slot pre-allocate edilmiş; tick başına sadece field'lar güncellenir.
 * Zero-allocation — GC baskısı minimumdur (CLAUDE.md §3).
 *
 * Adli alanlar:
 *   ts       → performance.now() - _origin (monotonic delta, ms)
 *              Sistem saati atlamasından etkilenmez.
 *              slot.ts + CrashRecord.originEpoch ≈ duvar saati (epoch ms)
 *              Ardışık slot farkı ≈ SAMPLE_INTERVAL (100ms); büyük fark = sistem dondurması.
 *   speed    → GPS hızı (km/h)
 *   obdSpeed → OBD hızı — speed ile çapraz kontrol için (R-4 hazırlığı)
 *   rpm      → motor devri (-1 = EV/OBD bağlı değil)
 *   brake    → fren tahmini: -1=bilinmiyor, 0=basılmıyor, 1=basılıyor
 */
interface BufferSlot {
  ts:       number;   // monotonic delta from _origin (ms) — NOT epoch
  speed:    number;   // GPS hızı (km/h)
  obdSpeed: number;   // OBD hızı — -1 = veri yok
  rpm:      number;   // motor RPM — -1 = veri yok
  brake:    number;   // -1=bilinmiyor | 0=yok | 1=var (throttle inferans)
  heading:  number;
  lat:      number;
  lng:      number;
  fuel:     number;   // -1 = yok
  gForce:   number;   // kombine G büyüklüğü
  gx:       number;
  gy:       number;
  gz:       number;
}

/**
 * Diske yazılan kilitli kaza kaydı formatı (version 3 — R-1 Monotonic Patch).
 *
 * Zaman alanları:
 *   crashAt     → Date.now() — "saat kaçta kaza oldu?" (duvar saati, insan okur)
 *   crashMono   → performance.now() - _origin — "frenle çarpış arası kaç ms?"
 *   originEpoch → Date.now() at _origin — slot.ts + originEpoch ≈ slot epoch ms
 *
 * Buffer slot timestamp:
 *   slot.ts = monotonic delta from _origin
 *   Ardışık slot farkı ≈ 100ms; büyük fark sistem dondurmasını gösterir.
 *   Crash-relative timing: crashMono - slot.ts = "crash öncesi kaç ms"
 */
export interface CrashRecord {
  version:     3;
  crashAt:     number;   // epoch ms — duvar saati (Date.now())
  crashMono:   number;   // monotonic ms — kaza anı _origin'den delta
  originEpoch: number;   // _origin'in epoch karşılığı — slot→wall clock dönüşümü
  peakG:       number;
  buffer:      BufferSlot[];   // ts = monotonic delta, en eski → en yeni
}

/* ── Sirkülasyon tamponu — Zero-allocation ────────────────────── */

const _slots: BufferSlot[] = Array.from({ length: BUFFER_SIZE }, () => ({
  ts: 0, speed: 0, obdSpeed: -1, rpm: -1, brake: -1,
  heading: 0, lat: 0, lng: 0, fuel: -1,
  gForce: 0, gx: 0, gy: 0, gz: 0,
}));

let _head   = 0;
let _filled = 0;

function _snapshot(): BufferSlot[] {
  if (_filled === 0) return [];
  const out: BufferSlot[] = [];
  const start = _filled < BUFFER_SIZE ? 0 : _head;
  for (let i = 0; i < _filled; i++) {
    out.push({ ..._slots[(start + i) % BUFFER_SIZE] });
  }
  return out;
}

/* ── Modül durumu ────────────────────────────────────────────── */

let _sampleTimer:        ReturnType<typeof setInterval> | null = null;
let _accelUnsub:         (() => void) | null = null;
let _obdUnsub:           (() => void) | null = null;
// Monotonic cooldown: performance.now() tabanlı → sistem saati atlamasına karşı bağışık
let _lastCrashMono       = -Infinity;
/** Hareket KANITININ son görüldüğü an (monotonic ms). -Infinity = hiç görülmedi. */
let _lastMotionMono      = -Infinity;
/** Gözlemlenebilirlik sayaçları — hüküm değil, ölçüm (bkz. getCrashDetectionHealth). */
let _crashRecorded       = 0;
let _crashRejectedNoMotion = 0;
// Safety Lock hysteresis timer — manevra bitiminden 2s sonra kilidi serbest bırakır
let _safetyUnlockTimer:  ReturnType<typeof setTimeout> | null = null;

// İvmeölçer — DeviceMotionEvent'ten güncellenir (her frame)
let _lastGx = 0, _lastGy = 0, _lastGz = 0;

// OBD snapshot — onOBDData callback'ten güncellenir (push, ~3s aralık)
// _sampleVehicleState 100ms'de bir bu değerleri okur; hesaplama yok
let _lastOBDSpeed    = -1;
let _lastOBDRpm      = -1;
let _lastOBDThrottle = -1; // fren inferansı için

/* ── Safety Lock helpers — hot path'te closure allocation yok ───── */

/** Hysteresis geri çağrısı: named function → setTimeout'a referans geçilir, lambda değil. */
function _clearSafetyLock(): void {
  (window as unknown as Record<string, unknown>).__SAFETY_LOCK__ = false;
  _safetyUnlockTimer = null;
}

/* ── Kaza verisi kilitleme ────────────────────────────────────── */

/**
 * `crash-log-*` kayıtlarını en yeni `MAX_CRASH_RECORDS` adetle sınırlar.
 *
 * Anahtar biçimi `crash-log-<Date.now()>` olduğundan sıralama sözlüksel DEĞİL
 * SAYISAL yapılır (13 haneli epoch'ta sözlüksel sıra tesadüfen doğru çalışır
 * ama 2286'da hane değişince sessizce bozulurdu). Ayrıştırılamayan anahtar
 * EN ESKİ sayılır — bozuk kayıt yeni kaydı dışarı itemez.
 *
 * Fail-soft: depolama listelenemezse budama atlanır, kaza kaydı yine yazılmıştır.
 */
function _pruneCrashLogs(): void {
  try {
    const keys = listCrashLogKeys();
    if (keys.length <= MAX_CRASH_RECORDS) return;
    const ts = (k: string): number => {
      const n = Number(k.slice(CRASH_KEY_PREFIX.length));
      return Number.isFinite(n) ? n : -1;
    };
    keys.sort((a, b) => ts(b) - ts(a));                  // en yeni başa
    for (const k of keys.slice(MAX_CRASH_RECORDS)) safeRemoveRaw(k);
  } catch { /* budama yapılamadı — kaza kaydının kendisi etkilenmez */ }
}

function _lockCrashData(peakG: number): void {
  const mono = performance.now() - _origin;  // monotonic delta — cooldown + crashMono için
  const now  = Date.now();                   // duvar saati — yalnızca crashAt ve dosya adı için

  // Monotonic cooldown: Date.now() atlaması çift kaydı tetikleyemez
  if (mono - _lastCrashMono < CRASH_COOLDOWN_MS) return;

  /* HAREKET KANITI KAPISI (kütük #456) — cooldown mandalından SONRA, ama
     mandalı KİLİTLEMEDEN önce: kanıtsız darbe kaydı üretmez ve gerçek bir
     çarpışma hemen ardından gelirse cooldown onu yutmaz. */
  if (mono - _lastMotionMono > CRASH_MOTION_WINDOW_MS) {
    _crashRejectedNoMotion++;
    return;
  }
  _lastCrashMono = mono;

  // Kaza anındaki G verisini mevcut slota yaz (snapshot öncesi)
  const cur = _slots[_head % BUFFER_SIZE];
  cur.gx     = _lastGx;
  cur.gy     = _lastGy;
  cur.gz     = _lastGz;
  cur.gForce = Math.sqrt(_lastGx ** 2 + _lastGy ** 2 + _lastGz ** 2);

  const record: CrashRecord = {
    version:     3,
    crashAt:     now,         // "saat kaçta kaza oldu?" — duvar saati
    crashMono:   mono,        // "frenle çarpış arası kaç ms?" — monotonic anchor
    originEpoch: _originEpoch, // slot.ts + originEpoch ≈ epoch ms (dönüşüm katsayısı)
    peakG,
    buffer: _snapshot(),
  };

  // R-2 Atomik Filesystem: native → atomik .tmp→rename; web → localStorage
  const key = `${CRASH_KEY_PREFIX}${now}`;
  void safeSetRawImmediate(key, JSON.stringify(record));
  _crashRecorded++;
  _pruneCrashLogs();

  dispatchCrashDetected(peakG);
}

/* ── İvmeölçer listener ──────────────────────────────────────── */

function _startAccelerometer(): () => void {
  if (typeof window === 'undefined' || !('DeviceMotionEvent' in window)) {
    return () => undefined;
  }

  const handler = (e: DeviceMotionEvent): void => {
    const a = e.acceleration;
    if (!a) return;

    const gx = (a.x ?? 0) / G_TO_MS2;
    const gy = (a.y ?? 0) / G_TO_MS2;
    const gz = (a.z ?? 0) / G_TO_MS2;

    _lastGx = gx;
    _lastGy = gy;
    _lastGz = gz;

    const peakG = Math.max(Math.abs(gx), Math.abs(gy), Math.abs(gz));
    if (peakG > CRASH_G_THRESHOLD) {
      _lockCrashData(peakG);
    }
  };

  // Ham window aboneliği yerine merkezi Orientation Sensor Gate; gate release'i
  // aynen döndürülür (çağıran _accelUnsub sözleşmesi değişmez).
  return subscribeMotion(handler);
}

/* ── OBD snapshot listener ───────────────────────────────────── */

function _startOBDListener(): () => void {
  return onOBDData((obd) => {
    // Basit atama — hesaplama yok; _sampleVehicleState 10Hz'de bu değerleri okur
    _lastOBDSpeed    = obd.speed;              // -1 = desteklenmiyor
    _lastOBDRpm      = obd.rpm;               // -1 = EV/yok
    _lastOBDThrottle = obd.throttle;          // -1 = desteklenmiyor
  });
}

/* ── Buffer doldurma — 10Hz ──────────────────────────────────── */

/**
 * Her 100ms çağrılır. Ağır hesaplama yok — sadece alan atamaları.
 * gForce: tek sqrt, kaza olmayan durumda ivme verisi DeviceMotionEvent'te
 * zaten hazır; yeniden hesaplamaya gerek yok.
 */
function _sampleVehicleState(): void {
  const vs   = useVehicleStore.getState();
  const slot = _slots[_head];

  // Fren tahmini: throttle PID destekleniyorsa ve throttle 0 iken araç hareket ediyorsa
  let brake = -1;
  if (_lastOBDThrottle >= 0) {
    brake = (_lastOBDThrottle <= 0 && _lastOBDSpeed > 2) ? 1 : 0;
  }

  // Zero-allocation: slot alanları yerinde güncellenir
  slot.ts       = performance.now() - _origin;  // monotonic delta — saat atlamasından bağımsız
  slot.speed    = vs.speed ?? 0;
  slot.obdSpeed = _lastOBDSpeed;
  slot.rpm      = _lastOBDRpm;
  slot.brake    = brake;
  slot.heading  = vs.heading  ?? 0;
  slot.lat      = vs.location ? vs.location.latitude  : 0;
  slot.lng      = vs.location ? vs.location.longitude : 0;
  slot.fuel     = vs.fuel     ?? -1;
  slot.gForce   = Math.sqrt(_lastGx ** 2 + _lastGy ** 2 + _lastGz ** 2);
  slot.gx       = _lastGx;
  slot.gy       = _lastGy;
  slot.gz       = _lastGz;

  /* HAREKET KANITI (kütük #456): kaza kararının ikinci ayağı. ÖLÇÜLMÜŞ hız
     aranır — `vs.speed ?? 0` gibi sahte bir 0 kanıt sayılmaz, `null` de
     "duruyor" diye okunmaz; yalnız gerçek bir sayı eşiği geçerse an damgalanır.
     OBD hızı ayrı bir tanıktır (-1 = PID desteklenmiyor). Zero-allocation. */
  const _vsSpeed  = typeof vs.speed === 'number' ? vs.speed : -1;
  const _bestSpd  = _lastOBDSpeed > _vsSpeed ? _lastOBDSpeed : _vsSpeed;
  if (_bestSpd >= CRASH_MIN_SPEED_KMH) _lastMotionMono = slot.ts;

  // Maneuver Detection → Safety Lock (CLAUDE.md §2.3 Hysteresis)
  // peakG: max-abs ekseni — araç sert fren / hızlanma / viraj ivmesini yakalar.
  // Zero-allocation: primitif karşılaştırma, nesne yok.
  const peakG = Math.max(Math.abs(_lastGx), Math.abs(_lastGy), Math.abs(_lastGz));
  const _win  = window as unknown as Record<string, unknown>;
  if (peakG > 0.5) {
    _win.__SAFETY_LOCK__ = true;
    // Manevra devam ediyor — bekleyen unlock timer'ı iptal et (kilit uzasın)
    if (_safetyUnlockTimer !== null) { clearTimeout(_safetyUnlockTimer); _safetyUnlockTimer = null; }
  } else if (_win.__SAFETY_LOCK__) {
    // Manevra bitti — henüz timer yoksa 2s sonra kilidi aç (hysteresis)
    if (_safetyUnlockTimer === null) _safetyUnlockTimer = setTimeout(_clearSafetyLock, 2000);
  }

  _head   = (_head + 1) % BUFFER_SIZE;
  if (_filled < BUFFER_SIZE) _filled++;
}

/* ── Public API ──────────────────────────────────────────────── */

/** BlackBox'ı başlatır. Dönen fn cleanup'tır — App.tsx useEffect'te kullanılır. */
export function startBlackBox(): () => void {
  if (_sampleTimer !== null) return () => {};  // idempotent

  _head          = 0;
  _filled        = 0;
  _lastCrashMono = -Infinity;  // cooldown sıfırla — ilk kaza her zaman geçer
  /* Hareket kanıtı DEVRALINMAZ: yeni oturum, kanıtı yeniden ölçmelidir.
     Muhafazakâr yön — kanıt yokken kapı kapalıdır (kütük #456). */
  _lastMotionMono = -Infinity;
  _crashRecorded = _crashRejectedNoMotion = 0;
  _lastGx = _lastGy = _lastGz = 0;
  _lastOBDSpeed = _lastOBDRpm = _lastOBDThrottle = -1;

  // 10Hz G-force + araç state örnekleyicisi
  _sampleTimer = setInterval(_sampleVehicleState, SAMPLE_INTERVAL);
  _accelUnsub  = _startAccelerometer();
  _obdUnsub    = _startOBDListener();

  // 1Hz Post-Mortem replay buffer — UI thread'i yük altında bırakmaz
  _rHead  = 0;
  _rCount = 0;
  _replayMemLevel = 'OK';
  _replayMemUnsub = onMemoryPressure((evt) => {
    _replayMemLevel = evt.level === 'CRITICAL' ? 'CRIT' : 'MOD';
  });
  _scheduleReplaySample(); // İlk örnek hemen
  _replayTimer = setInterval(_scheduleReplaySample, 1000);

  // crashLogger'a replay getter'ı kaydet (döngüsel bağımlılık olmadan)
  registerBlackBoxGetter(getReplayData);

  return () => {
    if (_sampleTimer  !== null) { clearInterval(_sampleTimer);  _sampleTimer  = null; }
    if (_replayTimer  !== null) { clearInterval(_replayTimer);  _replayTimer  = null; }
    /* #555: durdurulunca bekleyen bayrak da düşer — yeniden başlatıldığında
       ilk örnek "kuyrukta bekleyen var" sanılıp atlanmasın. */
    _replayPending = false;
    _accelUnsub?.();      _accelUnsub     = null;
    _obdUnsub?.();        _obdUnsub       = null;
    _replayMemUnsub?.();  _replayMemUnsub = null;
    if (_safetyUnlockTimer !== null) { clearTimeout(_safetyUnlockTimer); _safetyUnlockTimer = null; }
  };
}

/** Buffer'ın güncel anlık görüntüsü — debug veya UI için. */
export function getBlackBoxSnapshot(): CrashRecord['buffer'] {
  return _snapshot();
}

/**
 * Kaydedilmiş kaza loglarının anahtarlarını döner.
 * R-2: native modda _fsCache taranır; web modda localStorage taranır.
 * Write pipeline'daki henüz yazılmamış kayıtlar da dahildir.
 */
export function listCrashLogKeys(): string[] {
  return listKeysWithPrefix(CRASH_KEY_PREFIX);
}

/**
 * Belirli bir kaza kaydını okur.
 * safeGetRaw: buffer → _fsCache (native) → localStorage (web/migration).
 */
export function readCrashLog(key: string): CrashRecord | null {
  try {
    const raw = safeGetRaw(key);
    if (!raw) return null;
    return JSON.parse(raw) as CrashRecord;
  } catch { return null; }
}

/**
 * Belirli bir kaza kaydını siler.
 * safeRemoveRaw: native → _fsCache + Filesystem; web → localStorage.
 */
export function deleteCrashLog(key: string): void {
  safeRemoveRaw(key);
}

/** Kaza algılama sağlığı — salt-okunur ÖLÇÜM (hüküm/iddia değil). */
export interface CrashDetectionHealth {
  /** Bu oturumda diske yazılan kaza kaydı sayısı. */
  readonly recorded: number;
  /** Eşiği aşan ama hareket kanıtı olmayan darbe sayısı (elde sallama vb.). */
  readonly rejectedNoMotion: number;
  /** Hareket kanıtı hiç görülmedi mi — `true` ise her darbe reddedilir. */
  readonly motionEvidenceSeen: boolean;
  /** Depoda duran kaza kaydı sayısı; `null` = depo listelenemedi (UNAVAILABLE). */
  readonly storedRecords: number | null;
  /** Yürürlükteki eşikler — sahada ölçümü yorumlayabilmek için. */
  readonly minSpeedKmh: number;
  readonly motionWindowMs: number;
  readonly maxStored: number;
}

/**
 * Kaza algılamanın ölçülebilir durumu (kütük #456).
 *
 * Neden var: "hareket kanıtı yok" diye reddedilen darbeler sessizce yok
 * olursa, sahada eşiğin fazla mı sıkı yoksa gevşek mi olduğu ASLA bilinemez.
 * Sayaç, kararın kendisini değiştirmez — yalnız görünür kılar.
 */
export function getCrashDetectionHealth(): CrashDetectionHealth {
  let stored: number | null = null;
  try { stored = listCrashLogKeys().length; } catch { stored = null; }
  return {
    recorded:           _crashRecorded,
    rejectedNoMotion:   _crashRejectedNoMotion,
    motionEvidenceSeen: _lastMotionMono > -Infinity,
    storedRecords:      stored,
    minSpeedKmh:        CRASH_MIN_SPEED_KMH,
    motionWindowMs:     CRASH_MOTION_WINDOW_MS,
    maxStored:          MAX_CRASH_RECORDS,
  };
}

/* ── HMR cleanup ─────────────────────────────────────────────── */

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (_sampleTimer  !== null) { clearInterval(_sampleTimer);  _sampleTimer  = null; }
    if (_replayTimer  !== null) { clearInterval(_replayTimer);  _replayTimer  = null; }
    /* #555: durdurulunca bekleyen bayrak da düşer — yeniden başlatıldığında
       ilk örnek "kuyrukta bekleyen var" sanılıp atlanmasın. */
    _replayPending = false;
    _accelUnsub?.();      _accelUnsub     = null;
    _obdUnsub?.();        _obdUnsub       = null;
    _replayMemUnsub?.();  _replayMemUnsub = null;
    if (_safetyUnlockTimer !== null) { clearTimeout(_safetyUnlockTimer); _safetyUnlockTimer = null; }
  });
}
