/**
 * serviceRoutineSources — Servis Fonksiyonları ekranının TEK OKUMA KATMANI (senkron).
 *
 * NEDEN VAR (V-04/5): `serviceFunctions` "araca yazan tek profesyonel yol"un KAPISI
 * olarak yazılmıştı ama üründe **hiç çağrılmıyordu** — yani kapının çalışıp çalışmadığı
 * cihazda hiç görülemiyordu. Bu katman kapıyı GERÇEK araç verisiyle besler.
 *
 * ⚠️ YAZMA YOK: burada hiçbir rutin ÇALIŞTIRILMAZ. Ne UDS 0x31, ne 0x2E, ne 0x27.
 * Okunan tek şey `obdService` anlık görüntüsüdür; çıktı "şu an izin verilir miydi"
 * sorusunun yanıtıdır — bir eylem DEĞİL.
 */
import { getOBDDataSnapshot } from '../obdService';
import type { WriteGateContext } from '../obd/writeGate';

export interface ServiceRoutineRawSnapshot {
  readonly readAt: number;
  /** Kapının kullanacağı KANIT — `null` = OBD anlık görüntüsü okunamadı. */
  readonly gate: WriteGateContext | null;
  /** Ham bağlantı/tazelik alanları (ekranda ayrıca gösterilir). */
  readonly connectionState: string | null;
  readonly dataFresh: boolean | null;
  readonly source: string | null;
  readonly error: string | null;
}

/**
 * Tek seferlik senkron okuma.
 *
 * `confirmed` BİLEREK `false` gelir: bu ekranda kullanıcı onayı YOKTUR ve
 * uydurulmaz. Model, araç önkoşullarını ayrı değerlendirirken bunu açıkça belirtir.
 */
export function readServiceRoutineSnapshot(): ServiceRoutineRawSnapshot {
  const readAt = Date.now();
  try {
    const obd = getOBDDataSnapshot();
    return {
      readAt,
      gate: {
        connectionState: obd.connectionState,
        speedKmh:        obd.speed,
        rpm:             obd.rpm,
        lastSeenMs:      obd.lastSeenMs,
        nowMs:           readAt,
        confirmed:       false,          // onay YOK — ekran komut göndermez
      },
      connectionState: obd.connectionState ?? null,
      dataFresh: typeof obd.dataFresh === 'boolean' ? obd.dataFresh : null,
      source: obd.source ?? null,
      error: null,
    };
  } catch (e) {
    return {
      readAt,
      gate: null,
      connectionState: null,
      dataFresh: null,
      source: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
