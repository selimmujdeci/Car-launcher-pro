/**
 * obdSignalBridge — P0-OBD-01/02 · OBD DATA BRIDGE + TAZELİK DAMGASI.
 *
 * ── TEK İŞİ ───────────────────────────────────────────────────────────────
 * ZATEN OKUNABİLEN OBD sinyallerini kanonik `UnifiedVehicleStore`a taşımak ve
 * her ölçüme KENDİ TAZELİK SÖZLEŞMESİNİ damgalamak.
 * Yeni PID İCAT ETMEZ · yeni sorgu ÜRETMEZ · araca komut GÖNDERMEZ.
 *
 * ── İKİ YOL ───────────────────────────────────────────────────────────────
 *  1) ÇEKİRDEK — `onOBDData`: `obdService`in FAST/SLOW poll grubu bu değerleri
 *     ZATEN okuyor. Köprü onları yalnız mağazaya taşır → EK ELM327 TRAFİĞİ SIFIR.
 *  2) GENİŞLETİLMİŞ — `watchPid`: katalog sırasıyla izleyici kurar. Hattı
 *     boğmamak için sözleşme DEĞİŞMEDİ: native turda EN FAZLA 1 PID okur
 *     (round-robin, POLL_SLOW) ve `extendedPidService._buildNativeList` yalnız
 *     KANITLI DESTEKLİ ilk `ELM_WATCH_CAP` (16) PID'i tele gönderir.
 *
 * ── TAZELİK: TIMER YOK, OKUMA ANINDA HESAPLANIR ───────────────────────────
 * Köprü hiçbir değeri "bayatlatmak" için timer kurmaz. Her ölçüme yazım anında
 * `staleMs` / `unavailableMs` penceresi damgalanır; kararı okuyan taraf
 * (`resolveCanonicalSignal`) yaşa bakarak `LIVE · STALE · UNAVAILABLE` der.
 * Bu sayede uygulama arka plandayken bile hiçbir zamanlayıcı çalışmaz ve
 * dönüşte değer SESSİZCE canlı görünmez.
 *
 * ── SAHTE VERİ YASAĞI (pazarlıksız) ───────────────────────────────────────
 *  · Kabul kapısı TEK yerde: `acceptCanonicalValue` (sentinel + FİZİKSEL bant).
 *    `-1` artık körlemesine değil TAM DEĞER olarak elenir → soğuk iklimde
 *    gerçek negatif sıcaklıklar KAYBOLMAZ.
 *  · Çekirdek değerler YALNIZ `isObdReadingLive` kapısından geçerse yazılır:
 *    kurtarılmış (bayat) snapshot ölçüm sayılmaz (kütük #427/#607 dersi).
 *  · Oturum (epoch) değişince mağaza yazma ucunda TÜM eski ölçümler DÜŞER.
 *
 * ── BÜTÇE (K24 / Mali-400) ────────────────────────────────────────────────
 *  · YENİ TIMER YOK. Köprü yalnız ZATEN olan iki olaya iliştirilir.
 *  · Çekirdek yol saniyede ~5 kez tetiklenir; mağazaya yazım en fazla
 *    `CORE_WRITE_MIN_MS`'de bir yapılır (yeni timer değil, damga kıyası).
 *  · Değişmeyen yama `set()` çağırmaz (mağaza tarafı garantisi).
 *  · Tüm abonelikler `stop()` ile bırakılır (zero-leak).
 */

import {
  onOBDData, onObdFreshnessTick,
  getObdSessionEpoch, getObdPollCadenceMs, getObdFreshWindowMs,
} from '../obdService';
import { watchPid, getExtendedGateState } from '../obd/extendedPidService';
import { isObdReadingLive } from '../vehicleStatusModel';
import {
  CANONICAL_CORE_SIGNALS, CANONICAL_EXTENDED_PID_ORDER, CANONICAL_OBD_BY_PID,
  acceptCanonicalValue, type CanonicalObdSignalDef,
} from '../obd/canonicalObdSignals';
import { computeFreshnessWindow } from '../obd/obdFreshnessPolicy';
import {
  useUnifiedVehicleStore, type ObdSignalPatch, type ObdSignalEntry,
} from './UnifiedVehicleStore';
import type { OBDData } from '../obdTypes';
import { logError } from '../crashLogger';

/**
 * Çekirdek yolun mağazaya EN SIK yazım aralığı (ms).
 *
 * `onOBDData` sıcak sinyalde ~5 Hz tetiklenir; gaz kelebeği her tetikte değişir.
 * Bunu olduğu gibi mağazaya yansıtmak tüm aboneleri 5 Hz uyandırırdı. 1 sn,
 * bu sinyallerin KARARININ gerektirdiği tazelikten (en sıkısı `hot` = 10 s)
 * çok daha kısadır; hız/devir gibi HOT-PATH sinyalleri bu köprüden GEÇMEZ
 * (onların yolu SAB kanalıdır, DEĞİŞMEDİ).
 */
export const CORE_WRITE_MIN_MS = 1_000;

/** `OBDData` alanı → kanonik anahtar. Çekirdek yolun TEK eşleme yeri. */
const CORE_FIELD_BY_KEY: Readonly<Record<string, keyof OBDData>> = {
  coolantTemp:      'engineTemp',
  throttle:         'throttle',
  intakeTemp:       'intakeTemp',
  manifoldPressure: 'boostPressure',
};

/* ── Modül durumu ─────────────────────────────────────────────────────────── */

let _unsubs: Array<() => void> = [];
let _lastCoreWriteMs = 0;
let _started = false;

/* Gözlem sayaçları (salt-okunur; hiçbir karar bunları OKUMAZ). */
let _coreWrites = 0;
let _extWrites  = 0;
let _rejected   = 0;   // sentinel / bant dışı / bozuk yüzünden elenen değer adedi
let _sessionDrops = 0; // oturum değişimi yüzünden düşürülen önbellek sayısı
let _lastWriteAtMs = 0;
let _lastEpoch = -1;

/** Doygun artış — sayaç taşması yok (SystemBoot B-1 deseni). */
const COUNTER_MAX = 1_000_000;
function _sat(n: number): number { return n >= COUNTER_MAX ? COUNTER_MAX : n + 1; }

/* ── Tazelik penceresi (yazım anında damgalanır) ──────────────────────────── */

/**
 * Bu sinyalin ŞU ANKİ kadansına göre tazelik penceresi.
 *
 * Pencere YAZIM ANINDA hesaplanır çünkü kadans oturum içinde DEĞİŞİR
 * (RuntimeMode POWER_SAVE'e düşerse tur 15 s olur; izlenen PID sayısı keşif
 * ilerledikçe artar). Okuma anında hesaplasaydık, eski bir ölçüm YENİ kadansa
 * göre değerlendirilirdi — hızlı moda geçildiği an tüm eski ölçümler haksız
 * yere "bayat" olurdu.
 */
function _windowFor(def: CanonicalObdSignalDef): { staleMs: number; unavailableMs: number } {
  let coreWindowMs = 0;
  let cadenceMs = 0;
  let watchedCount = 0;
  try { coreWindowMs = getObdFreshWindowMs(); } catch { /* fail-soft: politika tabanı */ }
  try { cadenceMs = getObdPollCadenceMs(); } catch { /* fail-soft */ }
  try { watchedCount = getExtendedGateState().nativeListCount; } catch { /* fail-soft */ }
  return computeFreshnessWindow({
    cls: def.freshness, path: def.path, coreWindowMs, cadenceMs, watchedCount,
  });
}

function _entry(def: CanonicalObdSignalDef, value: number, atMs: number, epoch: number): ObdSignalEntry {
  const w = _windowFor(def);
  // Alan sırası SABİT (hidden-class kararlılığı) — bkz. ObdSignalEntry.
  return { value, atMs, epoch, staleMs: w.staleMs, unavailableMs: w.unavailableMs };
}

/** Şu anki OBD oturum numarası; okunamazsa son bilinen (fail-soft). */
function _epochNow(): number {
  try { return getObdSessionEpoch(); } catch { return _lastEpoch; }
}

/* ── Çekirdek yol ─────────────────────────────────────────────────────────── */

function _onCore(d: OBDData): void {
  try {
    // Bayat/kurtarılmış snapshot ölçüm DEĞİLDİR — mağazaya yazılmaz.
    if (!isObdReadingLive({ source: d.source, dataFresh: d.dataFresh, lastSeenMs: d.lastSeenMs })) {
      return;
    }
    const epoch = _epochNow();
    if (epoch !== _lastEpoch) {
      // Yeni oturum: yazım kısıtı damgası da sıfırlanır, yoksa ilk ölçüm 1 sn gecikirdi.
      _lastEpoch = epoch;
      _lastCoreWriteMs = 0;
      _sessionDrops = _sat(_sessionDrops);
    }

    const now = Date.now();
    if (now - _lastCoreWriteMs < CORE_WRITE_MIN_MS) return;   // yazım kısıtı (yeni timer YOK)

    const patch: ObdSignalPatch = {};
    let any = false;
    for (const def of CANONICAL_CORE_SIGNALS) {
      const field = CORE_FIELD_BY_KEY[def.key];
      if (field === undefined) continue;
      const raw = acceptCanonicalValue(def, d[field] as number | undefined);
      if (raw === null) { _rejected = _sat(_rejected); continue; }
      patch[def.key] = _entry(def, raw, now, epoch);
      any = true;
    }
    if (!any) return;

    _lastCoreWriteMs = now;
    useUnifiedVehicleStore.getState().updateObdSignals(patch, epoch);
    _coreWrites = _sat(_coreWrites);
    _lastWriteAtMs = now;
  } catch (e) {
    logError('OBD:BridgeCore', e);   // fail-soft: köprü ürünü ASLA düşürmez
  }
}

/* ── Genişletilmiş yol ────────────────────────────────────────────────────── */

function _onExtended(def: CanonicalObdSignalDef, value: number, updatedAt: number): void {
  try {
    /* Kabul kapısı burada da UYGULANIR. `decodeStandardPid` zaten FORMÜLÜN teorik
       bandını denetler; bu kapı ise sinyalin BU ARAÇTAKİ fiziksel bandını denetler
       (ör. modül voltajı 6–18 V: teorik 0–65,5 V bandı bir adaptör glitch'ini
       geçirirdi ve akü kararı onunla verilirdi). */
    const raw = acceptCanonicalValue(def, value);
    if (raw === null) { _rejected = _sat(_rejected); return; }

    const epoch = _epochNow();
    if (epoch !== _lastEpoch) { _lastEpoch = epoch; _sessionDrops = _sat(_sessionDrops); }

    const patch: ObdSignalPatch = { [def.key]: _entry(def, raw, updatedAt, epoch) };
    useUnifiedVehicleStore.getState().updateObdSignals(patch, epoch);
    _extWrites = _sat(_extWrites);
    _lastWriteAtMs = updatedAt;
  } catch (e) {
    logError('OBD:BridgeExt', e);
  }
}

/* ── Çürüme tiki ──────────────────────────────────────────────────────────── */

function _onFreshnessTick(): void {
  try {
    const epoch = _epochNow();
    if (epoch !== _lastEpoch) { _lastEpoch = epoch; _sessionDrops = _sat(_sessionDrops); }
    useUnifiedVehicleStore.getState().dropExpiredObdSignals(Date.now());
  } catch (e) {
    logError('OBD:BridgeTick', e);   // fail-soft: çürüme hatası ürünü düşürmez
  }
}

/* ── Yaşam döngüsü ────────────────────────────────────────────────────────── */

/**
 * Köprüyü başlatır. İdempotent: ikinci çağrı NO-OP (çift abonelik yok).
 *
 * @returns dispose fonksiyonu (tekrar çağrılabilir; ikincisi NO-OP).
 */
export function startObdSignalBridge(): () => void {
  if (_started) return stopObdSignalBridge;
  _started = true;
  _lastCoreWriteMs = 0;
  _lastEpoch = _epochNow();

  // 1) Çekirdek yol — ek trafik yok.
  try {
    _unsubs.push(onOBDData(_onCore));
  } catch (e) {
    logError('OBD:BridgeCoreSub', e);
  }

  /* 1b) ÇÜRÜME TİKİ — `obdService`in ZATEN çalışan bayatlık gözcüsüne iliştirilir
     (YENİ TIMER YOK). Süresi dolan ölçümleri mağazadan düşürür; böylece OBD
     kopunca arayüz son değeri "LIVE" göstermeye DEVAM EDEMEZ. Okuma-anı kapısı
     tek başına yetmiyordu: React yalnız abone olduğu referans değişince çizer,
     yazım durunca da hiçbir referans değişmiyordu. */
  try {
    _unsubs.push(onObdFreshnessTick(_onFreshnessTick));
  } catch (e) {
    logError('OBD:BridgeTickSub', e);
  }

  /* 2) Genişletilmiş yol — KATALOG SIRASIYLA izleyici kur.
     Sıra ÖNEMLİDİR: `extendedPidService._buildNativeList` izleyici EKLENME
     sırasında gezer ve KANITLI DESTEKLİ ilk 16'sını tele gönderir. Katalog
     öncelik sırası burada tele giden listeye DÖNÜŞÜR — 5C/42/46 gibi karar
     üreten sinyaller, düşük numaralı ama düşük değerli PID'lerin (O2 voltajı
     14-1B) ARKASINDA kalmaz. Araç desteklemiyorsa PID slot HARCAMAZ. */
  for (const pid of CANONICAL_EXTENDED_PID_ORDER) {
    const def = CANONICAL_OBD_BY_PID.get(pid);
    if (def === undefined) continue;            // katalog tutarsızlığı → sessiz atla
    try {
      _unsubs.push(watchPid(pid, (v) => _onExtended(def, v.value, v.updatedAt)));
    } catch (e) {
      logError('OBD:BridgeExtSub', e);          // tek PID düşerse diğerleri yaşar
    }
  }

  return stopObdSignalBridge;
}

/** Köprüyü durdurur ve TÜM abonelikleri bırakır (zero-leak). İdempotent. */
export function stopObdSignalBridge(): void {
  if (!_started) return;
  _started = false;
  for (const u of _unsubs) { try { u(); } catch { /* zaten gitti */ } }
  _unsubs = [];
  _lastCoreWriteMs = 0;
  /* Mağazayı DÜŞÜR: köprü yoksa OBD ölçümü de yoktur. Değerleri bırakmak
     "araçtan hâlâ veri geliyor" yalanı olurdu (sahte tazelik). */
  try { useUnifiedVehicleStore.getState().resetObdSignals(); } catch { /* fail-soft */ }
}

/* ── Gözlem yüzeyi (CAROS LAB okur — hiçbir karar OKUMAZ) ─────────────────── */

export interface ObdBridgeDiagnostics {
  /** Köprü ayakta mı. */
  readonly active: boolean;
  /** Kurulu abonelik sayısı (1 çekirdek + izlenen PID adedi). */
  readonly subscriptions: number;
  /** Çekirdek yoldan yapılan mağaza yazımı adedi. */
  readonly coreWrites: number;
  /** Genişletilmiş yoldan yapılan mağaza yazımı adedi. */
  readonly extendedWrites: number;
  /** Sentinel/bant dışı/bozuk olduğu için ELENEN değer adedi (sahte veri yazılmadı). */
  readonly rejected: number;
  /** Oturum değişimi yüzünden önbelleğin düşürüldüğü kez sayısı (reconnect kapısı). */
  readonly sessionDrops: number;
  /** Köprünün bildiği güncel OBD oturum numarası. */
  readonly sessionEpoch: number;
  /** Son yazımın anı (ms); hiç yazılmadıysa `null` — sahte 0 YOK. */
  readonly lastWriteAtMs: number | null;
  /** Katalogda tanımlı genişletilmiş PID adedi (tele gidenle AYNI DEĞİL). */
  readonly catalogExtendedCount: number;
  /** Sayaç doygunluk sınırı. */
  readonly counterMax: number;
}

/** Senkron, yan etkisiz, bounded anlık görüntü. */
export function getObdBridgeDiagnostics(): ObdBridgeDiagnostics {
  return Object.freeze({
    active:               _started,
    subscriptions:        _unsubs.length,
    coreWrites:           _coreWrites,
    extendedWrites:       _extWrites,
    rejected:             _rejected,
    sessionDrops:         _sessionDrops,
    sessionEpoch:         _lastEpoch,
    lastWriteAtMs:        _lastWriteAtMs > 0 ? _lastWriteAtMs : null,
    catalogExtendedCount: CANONICAL_EXTENDED_PID_ORDER.length,
    counterMax:           COUNTER_MAX,
  });
}

/** @internal — testler arası izolasyon. Üretim kodu ÇAĞIRMAZ. */
export const _bridgeInternals = {
  reset(): void {
    stopObdSignalBridge();
    _lastCoreWriteMs = 0;   // yazım kısıtı damgası da sıfırlanır (testler arası izolasyon)
    _coreWrites = 0;
    _extWrites  = 0;
    _rejected   = 0;
    _sessionDrops = 0;
    _lastWriteAtMs = 0;
    _lastEpoch = -1;
  },
  onCore: _onCore,
  onExtended: _onExtended,
  onFreshnessTick: _onFreshnessTick,
};
