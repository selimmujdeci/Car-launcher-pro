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

import { useMemo } from 'react';
import { useOBDState } from '../../platform/obdService';
import { useDTCState } from '../../platform/dtcService';
import {
  deriveLinkState, deriveDtcState, readField, readMeasured, coverage,
  type LinkState, type DtcState, type Reading, type ReadCoverage,
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

  /* ── Gövde (CAN kaynaklı — OBD PID değil) ──────────────────────────── */
  /** `undefined` = CAN bu aracı desteklemiyor / hiç veri gelmedi. */
  readonly doorsAllClosed: boolean | null;
  readonly tpmsAvailable: boolean;

  /* ── Arıza kodları ─────────────────────────────────────────────────── */
  readonly dtc: DtcState;
  readonly dtcCount: number;
  readonly dtcReading: boolean;

  /** Kaç ölçüm gerçekten sayı gösterebiliyor (veri kalitesi). */
  readonly coverage: ReadCoverage;
}

export function useObdLiveData(): ObdLiveState {
  const obd = useOBDState();
  const dtc = useDTCState();

  return useMemo<ObdLiveState>(() => {
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

    const doors = obd.doors;
    const doorsAllClosed = doors === undefined || link === 'offline'
      ? null
      : !(doors.fl || doors.fr || doors.rl || doors.rr || doors.trunk);

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

      doorsAllClosed,
      tpmsAvailable: obd.tpms !== undefined && link !== 'offline',

      dtc:        dtcState,
      dtcCount:   dtc.codes.length,
      dtcReading: dtc.isReading,

      coverage: coverage([
        rpm, speed, throttle, fuelLevel, batteryVoltage,
        engineTemp, intakeTemp, boostPressure, egt,
      ]),
    };
  }, [obd, dtc]);
}
