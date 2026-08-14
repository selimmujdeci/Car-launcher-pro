/**
 * speedAlertRuntime.ts — "Arabam Cebimde" hız uyarısının ARAÇ TARAFI
 *
 * ÖLÇÜLEN KUSUR (2026-08-14): telefondaki Hız Uyarısı anahtarı eşiği yalnız
 * TELEFONUN localStorage'ına yazıyor ve `set_speed_alert` komutu gönderiyordu;
 * araç tarafında bu komut tipi HİÇ tanımlı değildi → ayar araca ULAŞMIYORDU
 * ama ekranda "Kaydedildi ✓" görünüyordu. Bu modül o ucu kapatır.
 *
 * ── İKİNCİ (ve daha ağır) KUSUR: TEHLİKELİ KOMUT KAPISI KÖRDÜ ──────────────
 * `commandListener.updateCurrentSpeed()` ürün yolunda **sıfır çağırana** sahipti
 * → `currentSpeedKmh` daima 0 → "sürüş sırasında lock/unlock reddi" (>5 km/h)
 * HİÇ tetiklenemiyordu; araç 100 km/h giderken uzaktan "Aç" komutu geçerdi.
 * Aynı abonelik o kapıyı da besler — hız için İKİNCİ bir otorite kurulmaz.
 *
 * ── TASARIM ────────────────────────────────────────────────────────────────
 *  · Karar SAF fonksiyondadır (`evaluateSpeedAlert`) — I/O · `Date.now` · global YOK.
 *  · Kendi timer'ı YOKTUR: mevcut `onOBDData` akışına abone olur (hot-path'e
 *    yeni bir zamanlayıcı eklenmez; iş yalnız birkaç karşılaştırmadır).
 *  · Histerezis + cooldown: dur-kalk trafiğinde bildirim yağmuru olmaz.
 *  · Zero-trust: eşik UZAKTAN gelir → aralık dışı/bozuk yapılandırma REDDEDİLİR.
 *  · Hız bilinmiyorsa karar ÜRETİLMEZ (0 km/h "duruyor" diye yorumlanmaz).
 */

import { onOBDData, type OBDData } from './obdService';
import { safeGetRaw, safeSetRaw } from '../utils/safeStorage';
import { logInfo } from './debug';

/* NOT: `commandListener` BURADAN İMPORT EDİLMEZ — o modül bu modülü import
 * ettiği için dairesel bağımlılık olurdu. Hız kapısı besleyicisi (`onSpeed`)
 * dışarıdan enjekte edilir; bağlama noktası `SystemBoot`tur. */

/* ── Politika sabitleri ───────────────────────────────────────────────────── */

/** Kabul edilen eşik aralığı — bunun dışındaki uzak yapılandırma REDDEDİLİR. */
export const SPEED_ALERT_MIN_KMH = 30;
export const SPEED_ALERT_MAX_KMH = 250;

/**
 * Histerezis bandı. Uyarı durumundan çıkmak için hız eşiğin bu kadar ALTINA
 * inmelidir — eşiğin tam üstünde salınan araç tekrar tekrar bildirim üretmez.
 */
export const SPEED_ALERT_HYSTERESIS_KMH = 8;

/** İki bildirim arasındaki en kısa süre (aynı aşım sürerken bile). */
export const SPEED_ALERT_COOLDOWN_MS = 5 * 60_000;

const STORAGE_KEY = 'caros_speed_alert_v1';

/* ── Sözleşme ─────────────────────────────────────────────────────────────── */

export interface SpeedAlertConfig {
  enabled:      boolean;
  thresholdKmh: number;
}

export interface SpeedAlertState {
  /** Araç şu an eşiğin üstünde mi (histerezisli). */
  over:          boolean;
  /** Son bildirim zamanı — cooldown bundan ölçülür. `null` = hiç bildirilmedi. */
  lastFiredAtMs: number | null;
}

export type SpeedAlertReason =
  | 'disabled'          // özellik kapalı
  | 'speed_unknown'     // hız ölçülmedi → karar YOK
  | 'below'             // eşiğin altında
  | 'still_over'        // aşım sürüyor ama cooldown dolmadı
  | 'fired';            // bildirim üretildi

export interface SpeedAlertDecision {
  fire:   boolean;
  state:  SpeedAlertState;
  reason: SpeedAlertReason;
}

export const INITIAL_SPEED_ALERT_STATE: SpeedAlertState = { over: false, lastFiredAtMs: null };

/* ── Saf katman ───────────────────────────────────────────────────────────── */

/**
 * Uzaktan gelen yapılandırmayı doğrular. **Zero-trust:** eşik aralık dışıysa,
 * sayı değilse veya nesne bozuksa `null` döner ve mevcut ayar KORUNUR —
 * bozuk bir komut hız uyarısını sessizce devre dışı bırakamaz.
 */
export function normalizeSpeedAlertConfig(raw: unknown): SpeedAlertConfig | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const enabled = o.enabled;
  if (typeof enabled !== 'boolean') return null;

  // Telefon `threshold_kmh` gönderir; `thresholdKmh` de kabul edilir (tolerans).
  const t = typeof o.threshold_kmh === 'number' ? o.threshold_kmh
          : typeof o.thresholdKmh  === 'number' ? o.thresholdKmh
          : null;
  if (t === null || !Number.isFinite(t)) return null;

  const threshold = Math.round(t);
  if (threshold < SPEED_ALERT_MIN_KMH || threshold > SPEED_ALERT_MAX_KMH) return null;

  return { enabled, thresholdKmh: threshold };
}

/**
 * Ölçülen hızın karar verilebilir olup olmadığını söyler. `undefined`/NaN/negatif
 * "ölçülmedi" demektir; **0 GEÇERLİ bir ölçümdür** (araç duruyor) — sahte sıfırla
 * karıştırılmaması için burada tek kapı vardır.
 */
export function isDecidableSpeed(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0;
}

/**
 * Hız uyarısı kararı — SAF. Histerezis: uyarı durumuna girmek için
 * `hız > eşik`, çıkmak için `hız < eşik − histerezis`. Cooldown aşım
 * SÜRERKEN de uygulanır; aşımdan çıkıp yeniden girmek cooldown'u BEKLEMEZ
 * (yeni bir olay gerçekten yeni bir bilgidir).
 */
export function evaluateSpeedAlert(
  cfg:      SpeedAlertConfig,
  state:    SpeedAlertState,
  speedKmh: number | null | undefined,
  nowMs:    number,
): SpeedAlertDecision {
  if (!cfg.enabled) {
    // Kapalıyken durum SIFIRLANIR — yeniden açılınca bayat "over" taşınmaz.
    return { fire: false, state: INITIAL_SPEED_ALERT_STATE, reason: 'disabled' };
  }

  if (!isDecidableSpeed(speedKmh)) {
    // Hız bilinmiyor → hiçbir hüküm verilmez, önceki durum AYNEN korunur.
    return { fire: false, state, reason: 'speed_unknown' };
  }

  const exitBand = cfg.thresholdKmh - SPEED_ALERT_HYSTERESIS_KMH;

  if (state.over) {
    if (speedKmh < exitBand) {
      // Aşımdan çıkıldı. `lastFiredAtMs` KORUNUR — cooldown penceresi bağımsızdır.
      return { fire: false, state: { ...state, over: false }, reason: 'below' };
    }
    // Aşım sürüyor: cooldown dolduysa hatırlatma gönderilir.
    const due = state.lastFiredAtMs === null
      || nowMs - state.lastFiredAtMs >= SPEED_ALERT_COOLDOWN_MS;
    if (due) {
      return { fire: true, state: { over: true, lastFiredAtMs: nowMs }, reason: 'fired' };
    }
    return { fire: false, state, reason: 'still_over' };
  }

  if (speedKmh > cfg.thresholdKmh) {
    return { fire: true, state: { over: true, lastFiredAtMs: nowMs }, reason: 'fired' };
  }

  return { fire: false, state, reason: 'below' };
}

/* ── Kalıcı ayar (araç tarafı otoritesi) ──────────────────────────────────── */

let _config: SpeedAlertConfig | null = null;
let _state:  SpeedAlertState = INITIAL_SPEED_ALERT_STATE;

/** Diskten okur (bir kez). Bozuk kayıt sessizce yok sayılır — fail-soft. */
function loadConfig(): SpeedAlertConfig | null {
  try {
    const raw = safeGetRaw(STORAGE_KEY);
    if (!raw) return null;
    return normalizeSpeedAlertConfig(JSON.parse(raw));
  } catch {
    return null;
  }
}

/**
 * Uzaktan gelen `set_speed_alert` komutunu uygular. Doğrulama BAŞARISIZSA
 * `false` döner ve mevcut ayar DEĞİŞMEZ (komut `failed` raporlanır — sessizce
 * "kaydedildi" denmez; telefondaki eski yalanın tekrarı olurdu).
 */
export function applySpeedAlertConfig(raw: unknown): boolean {
  const cfg = normalizeSpeedAlertConfig(raw);
  if (!cfg) return false;
  _config = cfg;
  _state  = INITIAL_SPEED_ALERT_STATE; // eşik değişti → bayat "over" taşınmaz
  try {
    safeSetRaw(STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // Disk yazılamadı: ayar bu oturumda GEÇERLİ, kalıcı DEĞİL. Uygulanmış
    // saymak yine de doğrudur — araç bu oturumda gerçekten uyarı üretecek.
  }
  return true;
}

/** LAB/tanılama için salt-okunur görünüm. Ayar hiç kurulmadıysa `null`. */
export function getSpeedAlertConfig(): SpeedAlertConfig | null {
  return _config;
}

/** LAB/tanılama için salt-okunur durum. */
export function getSpeedAlertState(): SpeedAlertState {
  return { ..._state };
}

/* ── Kanıt defteri (CAROS LAB) ────────────────────────────────────────────── */

export interface SpeedAlertEvidence {
  /** Runtime abone mi — `false` ise hız kapısı da beslenmiyordur. */
  running:          boolean;
  /** İşlenen hız örneği sayısı (kararın taban ölçüsü). */
  samples:          number;
  /** Hızın ölçülemediği örnekler — karar üretilmeyen anlar. */
  unknownSpeed:     number;
  /** Dış hız kapısına (lock/unlock koruması) kaç kez değer verildi. */
  gateFed:          number;
  /** Üretilen bildirim sayısı. */
  fired:            number;
  /** Aşım sürerken cooldown yüzünden BASTIRILAN bildirimler. */
  suppressedCooldown: number;
  /** Son karar gerekçesi — `null` = hiç örnek işlenmedi. */
  lastReason:       SpeedAlertReason | null;
  /** Son bildirim anı (epoch ms). */
  lastFiredAtMs:    number | null;
  /** Bildirim kanalı bağlı mı — `false` ise uyarı üretilse bile telefona GİTMEZ. */
  pushChannelBound: boolean;
}

const _evidence = {
  running: false, samples: 0, unknownSpeed: 0, gateFed: 0,
  fired: 0, suppressedCooldown: 0,
  lastReason: null as SpeedAlertReason | null,
};

export function getSpeedAlertEvidence(): SpeedAlertEvidence {
  return {
    running:            _evidence.running,
    samples:            _evidence.samples,
    unknownSpeed:       _evidence.unknownSpeed,
    gateFed:            _evidence.gateFed,
    fired:              _evidence.fired,
    suppressedCooldown: _evidence.suppressedCooldown,
    lastReason:         _evidence.lastReason,
    lastFiredAtMs:      _state.lastFiredAtMs,
    pushChannelBound:   _push !== null,
  };
}

/* ── Runtime ──────────────────────────────────────────────────────────────── */

type PushFn = (event: string, payload: Record<string, unknown>) => void;

let _push: PushFn | null = null;

/**
 * Bildirim kanalını bağlar. Ayrı tutulur ki bu modül Supabase/ağ katmanını
 * İMPORT ETMESİN (test edilebilirlik + hot-path'te sürpriz bağımlılık yok).
 */
export function setSpeedAlertPushChannel(fn: PushFn | null): void {
  _push = fn;
}

export interface SpeedAlertRuntimeDeps {
  /**
   * Ölçülen hızı tüketen dış kapı — üründe `commandListener.updateCurrentSpeed`.
   * Enjekte edilir: bu modül `commandListener`'ı import ederse dairesel
   * bağımlılık oluşur (o modül `applySpeedAlertConfig`i import ediyor).
   */
  onSpeed?: (speedKmh: number) => void;
}

/**
 * Hız akışına abone olur. İki iş yapar ve **ikisi de tek okumadan** türer:
 *  1. `onSpeed` — uzaktan lock/unlock'un sürüş kapısını besler.
 *  2. Hız uyarısı kararı — eşik aşımında telefona bildirim.
 *
 * Yeni timer KURMAZ; `onOBDData` zaten var olan akıştır. Cleanup döner.
 */
export function startSpeedAlertRuntime(deps: SpeedAlertRuntimeDeps = {}): () => void {
  _config = loadConfig();
  _state  = INITIAL_SPEED_ALERT_STATE;
  _evidence.running = true;

  const unsub = onOBDData((d: OBDData) => {
    const speed = d.speed;
    _evidence.samples++;

    // (1) Tehlikeli komut kapısının hız otoritesi — ölçüm yoksa BESLENMEZ
    //     (0 yazmak "araç duruyor" iddiasıdır ve kapıyı yanlışlıkla açar).
    if (isDecidableSpeed(speed)) {
      _evidence.gateFed++;
      try { deps.onSpeed?.(speed); } catch { /* kapı hatası akışı durdurmaz */ }
    } else {
      _evidence.unknownSpeed++;
    }

    // (2) Hız uyarısı
    if (!_config) return;
    const decision = evaluateSpeedAlert(_config, _state, speed, Date.now());
    _state = decision.state;
    _evidence.lastReason = decision.reason;
    if (decision.reason === 'still_over') _evidence.suppressedCooldown++;
    if (!decision.fire) return;
    _evidence.fired++;

    logInfo(`[SpeedAlert] Eşik aşıldı: ${Math.round(speed as number)} > ${_config.thresholdKmh} km/h`);
    try {
      _push?.('speed_alert', {
        speed_kmh:     Math.round(speed as number),
        threshold_kmh: _config.thresholdKmh,
      });
    } catch { /* bildirim hatası sürüşü etkilemez */ }
  });

  return () => {
    unsub();
    _push = null;
    _evidence.running = false;
  };
}

/** Yalnız test içindir — modül durumunu sıfırlar. */
export function _resetSpeedAlertForTest(): void {
  _config = null;
  _state  = INITIAL_SPEED_ALERT_STATE;
  _push   = null;
  Object.assign(_evidence, {
    running: false, samples: 0, unknownSpeed: 0, gateFed: 0,
    fired: 0, suppressedCooldown: 0, lastReason: null,
  });
}
