/**
 * obdBridgeLabSources — OBD DATA BRIDGE GÖZLEMİ İÇİN TEK OKUMA KATMANI (P0-OBD-01).
 *
 * Desen A3–A8 ile birebir aynı: her getter SENKRON, kendi `try/catch`inde,
 * hata durumunda `null` döner (ekran `UNAVAILABLE` gösterir — sahte 0 YOK).
 *
 * ── NEDEN VAR ─────────────────────────────────────────────────────────────
 * Köprü SESSİZ bir katmandır: çalışmazsa hiçbir şey patlamaz, yalnız kararlar
 * veri görmez. Tam olarak bu yüzden gözlemlenmesi ZORUNLUDUR — "gözlemlenemeyen
 * özellik tamamlanmış değildir". Ekran üç soruyu ayrı ayrı cevaplar:
 *   1. Köprü ayakta mı ve yazıyor mu?          (bridge diagnostics)
 *   2. Hangi sinyal GERÇEKTEN akıyor, hangisi araç tarafından verilmiyor?
 *   3. Paylaşılan büyüklükte kim otorite — CAN mı OBD mi, yoksa hiç mi yok?
 *
 * ── BU KATMAN HİÇBİR ŞEY BAŞLATMAZ ────────────────────────────────────────
 * PID izlemez · sorgu göndermez · köprüyü başlatmaz/durdurmaz · timer kurmaz ·
 * mağazayı YAZMAZ. Yalnız mevcut anlık görüntüleri OKUR.
 *
 * ── GİZLİLİK ──────────────────────────────────────────────────────────────
 * Taşınan şey araç SENSÖR ÖLÇÜMÜDÜR (Faz A / Developer First: teknik değer ve
 * PID adı serbesttir). VIN · konum · kullanıcı verisi · anahtar · ham komut
 * bu katmana UĞRAMAZ.
 */

import {
  getObdBridgeDiagnostics, type ObdBridgeDiagnostics,
} from '../vehicleDataLayer/obdSignalBridge';
import { useUnifiedVehicleStore } from '../vehicleDataLayer/UnifiedVehicleStore';
import {
  resolveCanonicalSignal, CANONICAL_SHARED_SIGNALS,
  type CanonicalSharedSignal, type CanonicalSignalSource,
} from '../vehicleDataLayer/canonicalVehicleSignal';
import {
  classifyFreshness, type ObdFreshnessState, type ObdFreshnessClass,
} from '../obd/obdFreshnessPolicy';
import {
  CANONICAL_OBD_SIGNALS, type CanonicalObdPath, type CanonicalObdKey,
} from '../obd/canonicalObdSignals';
import { getPidStatus, getExtendedGateState } from '../obd/extendedPidService';

/** Her okuma bu kapıdan geçer: fırlatırsa `null` (fail-soft). */
function safe<T>(read: () => T): T | null {
  try {
    const v = read();
    return v === undefined ? null : v;
  } catch {
    return null;
  }
}

/* ── 1. Köprünün kendisi ───────────────────────────────────────────────── */

export function readBridgeDiagnostics(): ObdBridgeDiagnostics | null {
  return safe(() => getObdBridgeDiagnostics());
}

/* ── 2. Sinyal başına gerçeklik ────────────────────────────────────────── */

/** Bir kanonik sinyalin ÖLÇÜLEN durumu. Hiçbir alan tahmin edilmez. */
export interface CanonicalSignalObservation {
  readonly key:  string;
  readonly pid:  string;
  readonly name: string;
  readonly unit: string;
  readonly path: CanonicalObdPath;
  readonly safety: boolean;
  /** Tazelik sınıfı — eşiğin NEDEN bu kadar olduğunu açıklar. */
  readonly cls: ObdFreshnessClass;
  /** Mağazadaki değer; `null` = mağazada YOK (okunmadı ya da düşürüldü). */
  readonly value: number | null;
  /** Ölçümün yaşı (ms); değer yoksa `null` — sahte 0 YOK. */
  readonly ageMs: number | null;
  /** Son ölçüm anı (Unix ms); ölçüm yoksa `null` — sahte damga YOK. */
  readonly measuredAtMs: number | null;
  /** P0-OBD-02 tazelik hükmü: `LIVE` · `STALE` · `UNAVAILABLE`. */
  readonly freshness: ObdFreshnessState;
  /** `UNAVAILABLE` ise NEDEN: `no_measurement` · `session_changed` · `expired`. */
  readonly freshnessReason: string;
  /** Bu ölçüme YAZIM ANINDA damgalanan LIVE penceresi (ms). */
  readonly staleMs: number | null;
  /** STALE → UNAVAILABLE eşiği (ms). */
  readonly unavailableMs: number | null;
  /**
   * `extendedPidService` hükmü: `live` · `stale` · `no_data` · `unsupported` ·
   * `probing`. Çekirdek yoldaki sinyaller için `null` (o yol bu kaydı tutmaz).
   *
   * TAZELİK HÜKMÜYLE AYNI ŞEY DEĞİLDİR ve bilinçli olarak AYRI gösterilir:
   * bu alan "araç bu PID'i veriyor mu", `freshness` ise "elimizdeki ölçüm hâlâ
   * geçerli mi" sorusunu yanıtlar. İkisinin çelişmesi TEŞHİSTİR, gizlenmez.
   */
  readonly pidStatus: string | null;
}

/**
 * Tüm katalog sinyallerinin anlık durumu — katalog ÖNCELİK sırasında.
 *
 * @param nowMs Çağıranın damgası — bu katman `Date.now()` ÇAĞIRMAZ.
 */
export function readCanonicalSignals(nowMs: number): readonly CanonicalSignalObservation[] | null {
  return safe(() => {
    const s = useUnifiedVehicleStore.getState();
    const out: CanonicalSignalObservation[] = [];
    for (const def of CANONICAL_OBD_SIGNALS) {
      const e = s.obdSignals[def.key];
      /* Hüküm ÜRETİLMEZ, tüketilir: ekran ile karar yolu AYNI politikayı çağırır
         (`classifyFreshness`), böylece LAB'ın gösterdiği "LIVE" ile Guardian'ın
         gördüğü "LIVE" ayrışamaz — ikinci otorite kurulmaz. */
      const v = e === undefined
        ? { state: 'UNAVAILABLE' as ObdFreshnessState, ageMs: null, reason: 'no_measurement' as const }
        : classifyFreshness({
            hasValue: true, measuredAtMs: e.atMs, nowMs,
            window: { staleMs: e.staleMs, unavailableMs: e.unavailableMs },
            valueEpoch: e.epoch, currentEpoch: s.obdSessionEpoch,
          });
      out.push({
        key:  def.key,
        pid:  def.pid,
        name: def.name,
        unit: def.unit,
        path: def.path,
        safety: def.safety,
        cls:  def.freshness,
        value: e === undefined ? null : e.value,
        ageMs: v.ageMs,
        measuredAtMs: e === undefined ? null : e.atMs,
        freshness: v.state,
        freshnessReason: v.reason,
        staleMs: e === undefined ? null : e.staleMs,
        unavailableMs: e === undefined ? null : e.unavailableMs,
        pidStatus: def.path === 'extended' ? safe(() => getPidStatus(def.pid)) : null,
      });
    }
    return out;
  });
}

/* ── 3. Paylaşılan büyüklükte OTORİTE ──────────────────────────────────── */

export interface AuthorityObservation {
  readonly signal: CanonicalSharedSignal;
  /** Kararı KİM verdi: `CAN` · `OBD` · `NONE`. */
  readonly source: CanonicalSignalSource;
  /** Otoriter değer; `NONE` iken her zaman `null`. */
  readonly value:  number | null;
  /** Otoriter okumanın tazelik durumu (`STALE` iken değer GÖSTERİLİR, karara GİRMEZ). */
  readonly state:  ObdFreshnessState;
  /** CAN tarafında ham değer var mı (otorite kıyası için). */
  readonly canPresent: boolean;
  /** OBD tarafında ham değer var mı. */
  readonly obdPresent: boolean;
}

const _CAN_FIELD: Readonly<Record<CanonicalSharedSignal, string>> = {
  coolantTemp: 'canCoolantTemp',
  oilTemp:     'canOilTemp',
  throttle:    'canThrottle',
  batteryVolt: 'canBatteryVolt',
  ambientTemp: 'canAmbientTemp',
};

const _OBD_KEY: Readonly<Record<CanonicalSharedSignal, CanonicalObdKey>> = {
  coolantTemp: 'coolantTemp',
  oilTemp:     'oilTemp',
  throttle:    'throttle',
  batteryVolt: 'moduleVoltage',
  ambientTemp: 'ambientTemp',
};

export function readAuthorities(nowMs: number): readonly AuthorityObservation[] | null {
  return safe(() => {
    const s = useUnifiedVehicleStore.getState();
    return CANONICAL_SHARED_SIGNALS.map((signal) => {
      const r = resolveCanonicalSignal(s, signal, nowMs);
      const canRaw = (s as unknown as Record<string, unknown>)[_CAN_FIELD[signal]];
      const obdEntry = s.obdSignals[_OBD_KEY[signal] as keyof typeof s.obdSignals];
      return {
        signal,
        source:     r.source,
        value:      r.value,
        state:      r.state,
        canPresent: typeof canRaw === 'number' && Number.isFinite(canRaw),
        obdPresent: obdEntry !== undefined && Number.isFinite(obdEntry.value),
      };
    });
  });
}

/* ── 4. Hat bütçesi (kaç PID GERÇEKTEN tele gidiyor) ───────────────────── */

export interface WireBudgetObservation {
  /** Destek kanıtı var mı — `false` iken extended kapı KAPALIDIR (fail-closed). */
  readonly supportedKnown: boolean;
  /** Kanıtlı destekli PID adedi. */
  readonly supportedCount: number;
  /** Kaç PID için izleyici var (köprü + panel + asistan toplamı). */
  readonly watchedCount: number;
  /** İzleniyor ama tele GİTMİYOR (kanıt yok ya da araç desteklemiyor). */
  readonly gatedCount: number;
  /** Şu an native'e giden liste boyutu (keşif + izlenen) — GERÇEK hat yükü. */
  readonly nativeListCount: number;
  /** P0-OBD-CORE-06: 'complete' | 'incomplete' | 'not_run'. */
  readonly discoveryCompleteness: string;
  /** Bekleyen bitmask keşif sorgusu adedi. */
  readonly discoveryPending: number;
  /** Tanı BURST modu açık mı (Canlı Test ekranı) — hat yükünü ARTIRIR. */
  readonly burst: boolean;
}

export function readWireBudget(): WireBudgetObservation | null {
  return safe(() => {
    const g = getExtendedGateState();
    return {
      supportedKnown:   g.supportedKnown,
      supportedCount:   g.supportedCount,
      watchedCount:     g.watchedCount,
      gatedCount:       g.gatedCount,
      nativeListCount:  g.nativeListCount,
      /* P0-OBD-CORE-06: kanıtın bütünlüğü — "desteklemiyor" hükmünün şartı. */
      discoveryCompleteness:
        g.discoveryCompleteness === 'complete' || g.discoveryCompleteness === 'incomplete'
          ? g.discoveryCompleteness
          : 'not_run',
      discoveryPending: g.discoveryPending,
      burst:            g.burst,
    };
  });
}
