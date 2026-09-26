/**
 * useObdLiveData — OBD CANLI VERİLERİ sayfasının KANONİK VERİ ADAPTÖRÜ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── EN ÖNEMLİ KURAL: BU DOSYA HİÇBİR ŞEY BAŞLATMAZ ───────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Yeni OBD poll turu · yeni PID keşfi · yeni ECU taraması · yeni CAN
 * dinleyici · yeni timer · yeni store AÇILMAZ. Sayfa bir PROJEKSİYONDUR;
 * ikinci bir araç gerçeği üretmez (CLAUDE.md §6).
 *
 * Okunan otoriteler (hepsi mevcut, hiçbiri bu tur eklenmedi):
 *   canlı OBD alanları → `useOBDState()`      (obdService'in TEK dış yüzeyi)
 *   arıza kodları      → `useDTCState()`      (DTC defterinin TEK sahibi)
 *
 * `useOBDState` bir `useSyncExternalStore` aboneliğidir: aynı modül-düzeyi
 * dinleyici kümesine bağlanır, bu yüzden sayfa kaç kez mount edilirse
 * edilsin ikinci bir veri kaynağı OLUŞMAZ ve unmount'ta kendi dinleyicisini
 * bırakır.
 *
 * ── FAIL-CLOSED ───────────────────────────────────────────────────────────
 * Ölçülmemiş her alan `Reading`'e çevrilir ve sayı DEĞİL durum taşır.
 * Karar mantığı `obdLiveModel.ts` içinde saf ve test edilebilirdir; burada
 * yalnız kanonik alanlar o modele BAĞLANIR.
 */

import { useEffect, useMemo, useState } from 'react';
import { useOBDState, getFuelCalibrationState } from '../../platform/obdService';
import { useDTCState } from '../../platform/dtcService';
/* Genişletilmiş PID kanalı: KANONİK okuma yüzeyi. `watchPid` yeni bir poll
   döngüsü KURMAZ — native `AdaptivePidScheduler`a ilgi bildirir ve unmount'ta
   listeyi küçültür (`ObdLiveTestPanel` ile AYNI sözleşme). */
import { watchPid, getPidValue, getPidStatus } from '../../platform/obd/extendedPidService';
import { WATCHED_EXTENDED_PIDS } from './obdPidCatalog';
import {
  deriveLinkState, deriveDtcState, readField, readMeasured, coverage, deriveFuelProvenance,
  fromExtendedStatus,
  type LinkState, type DtcState, type Reading, type ReadCoverage, type FuelProvenance,
} from './obdLiveModel';

export interface ObdLiveState {
  /** Üst düzey bağlantı/tazelik durumu. */
  readonly link: LinkState;
  /** Son GEÇERLİ ECU frame'inin zamanı (ms) — 0 ise hiç ölçüm yok. */
  readonly lastSeenMs: number;
  /** Adaptör adı — boşsa UI "Bilinmiyor" der, uydurmaz. */
  readonly deviceName: string;
  /** `'real' | 'mock' | 'none'`. */
  readonly source: string;
  /** Aktif araç tipi (ice/diesel/hybrid/ev). */
  readonly vehicleType: string;

  /* ── Kahraman ölçümler ─────────────────────────────────────────────── */
  readonly rpm: Reading;
  readonly speed: Reading;

  /* ── Anlık yük ─────────────────────────────────────────────────────── */
  readonly throttle: Reading;
  readonly fuelLevel: Reading;
  readonly batteryVoltage: Reading;

  /* ── İkincil ölçümler ──────────────────────────────────────────────── */
  readonly engineTemp: Reading;
  readonly intakeTemp: Reading;
  readonly boostPressure: Reading;
  readonly egt: Reading;

  /**
   * Yakıt okumasının KAYNAĞI. `OBDData.fuelLevel` ham 2F değil, kalibrasyon
   * uygulanmış GÖSTERİM değeridir — ekran bunu ham ECU gibi sunmaz.
   */
  readonly fuelProvenance: FuelProvenance;

  /* ── EV / Hibrit (yalnız araç bu tipteyse anlamlı) ─────────────────── */
  readonly isElectrified: boolean;
  readonly batteryLevel: Reading;
  readonly batteryTemp: Reading;
  readonly motorPower: Reading;

  /* ── Arıza kodları ─────────────────────────────────────────────────── */
  readonly dtc: DtcState;
  readonly dtcCount: number;
  readonly dtcReading: boolean;

  /* ── Hesaplanan değerler (ECU PID'i DEĞİL — ekran bunu açıkça söyler) ─ */
  readonly fuelRemainingL: Reading;
  readonly estimatedRangeKm: Reading;

  /** Genişletilmiş PID okumaları — anahtar 2 haneli PID ('04', '10'…). */
  readonly extended: Readonly<Record<string, Reading>>;

  /** Kaç ölçüm gerçekten sayı gösterebiliyor (veri kalitesi). */
  readonly coverage: ReadCoverage;
}

export function useObdLiveData(): ObdLiveState {
  const obd = useOBDState();
  const dtc = useDTCState();

  /* Genişletilmiş PID'ler round-robin okunur (turda en fazla 1 PID), bu
     yüzden geri çağırım sıklığı düşüktür; sayaç bumplamak yeterli, ayrı bir
     zamanlayıcı ya da önbellek katmanı gerekmez. */
  const [extTick, setExtTick] = useState(0);
  useEffect(() => {
    const bump = (): void => { setExtTick((t) => (t + 1) % 1_000_000); };
    const stops = WATCHED_EXTENDED_PIDS.map((pid) => watchPid(pid, bump));
    return () => { for (const stop of stops) stop(); };
  }, []);

  return useMemo<ObdLiveState>(() => {
    /* `extTick` yalnız YENİDEN HESAPLAMA tetikleyicisidir: genişletilmiş
       değerler servisin kendi önbelleğinden okunur, bu yüzden bağımlılık
       listesinde durur ama gövdede kullanılmaz. Açıkça tüketiliyor ki
       niyet görünür olsun. */
    void extTick;

    const link = deriveLinkState({
      transportConnected: obd.transportConnected,
      dataFresh:          obd.dataFresh,
      lastSeenMs:         obd.lastSeenMs,
      source:             obd.source,
    });

    /* `speed` ve `rpm`: `speed`in `-1` nöbetçisi YOKTUR (başlangıç değeri 0),
       bu yüzden "ölçülmüş mü" ayrımı link üzerinden yapılır. */
    const speed = readMeasured(obd.speed, link);
    const rpm   = readField(obd.rpm, link);

    const throttle       = readField(obd.throttle, link);
    const fuelLevel      = readField(obd.fuelLevel, link);
    const batteryVoltage = readField(obd.batteryVoltage, link);
    const engineTemp     = readField(obd.engineTemp, link);
    const intakeTemp     = readField(obd.intakeTemp, link);
    const boostPressure  = readField(obd.boostPressure, link);
    const egt            = readField(obd.egt, link);

    /* EV/hibrit alanları kanonik tipte VARDIR; ICE'de `-1` gelir ve
       zaten `unsupported` olur. Kapasiteye göre gösterilir. */
    const batteryLevel = readField(obd.batteryLevel, link);
    const batteryTemp  = readField(obd.batteryTemp, link);
    const motorPower   = readField(obd.motorPower, link);
    const isElectrified = obd.vehicleType === 'ev' || obd.vehicleType === 'hybrid';

    /* Yakıt kaynağı: kalibrasyon ölçeği 1 değilse değer HAM DEĞİLDİR. */
    let fuelScale = 1;
    try { fuelScale = getFuelCalibrationState().scale; } catch { fuelScale = 1; }
    const fuelProvenance = deriveFuelProvenance({ reading: fuelLevel, scale: fuelScale });

    /* Genişletilmiş kanal: değer + durum AYNI otoriteden okunur. */
    const extended: Record<string, Reading> = {};
    for (const pid of WATCHED_EXTENDED_PIDS) {
      let status: ReturnType<typeof getPidStatus> = 'probing';
      let value: number | undefined;
      try {
        status = getPidStatus(pid);
        value = getPidValue(pid)?.value;
      } catch { /* okunamazsa fail-closed: aşağıda `probing` → henüz okunmadı */ }
      extended[pid] = fromExtendedStatus(status, value, link);
    }

    /* Hesaplanan yakıt metrikleri: ECU PID'i DEĞİL, depo yapılandırmasından
       türetilir (`obdMetrics.computeFuelMetrics`). Ekran bunu etiketler. */
    const fuelRemainingL   = readField(obd.fuelRemainingL, link);
    const estimatedRangeKm = readField(obd.estimatedRangeKm, link);

    /* DTC: `lastReadAt` bu oturumda GERÇEKTEN bir okuma yapıldığının
       kanıtıdır. `codes.length === 0` tek başına "arıza yok" DEMEZ. */
    const dtcState = deriveDtcState({
      scanRan: dtc.lastReadAt !== null,
      count:   dtc.codes.length,
      link,
    });

    return {
      link,
      lastSeenMs:  obd.lastSeenMs,
      deviceName:  obd.deviceName,
      source:      obd.source,
      vehicleType: obd.vehicleType,

      rpm, speed,
      throttle, fuelLevel, batteryVoltage,
      engineTemp, intakeTemp, boostPressure, egt,

      fuelProvenance,
      isElectrified,
      batteryLevel, batteryTemp, motorPower,

      fuelRemainingL, estimatedRangeKm,
      extended,

      dtc:        dtcState,
      dtcCount:   dtc.codes.length,
      dtcReading: dtc.isReading,

      /* Kapsam YALNIZ OBD ölçümlerini sayar — gövde/CAN verisi bu sayfanın
         kimliğine ait değildir ve kaliteyi şişirmez. */
      coverage: coverage([
        rpm, speed, throttle, fuelLevel, batteryVoltage, engineTemp, intakeTemp, boostPressure,
        ...Object.values(extended),
      ]),
    };
  }, [obd, dtc, extTick]);
}
