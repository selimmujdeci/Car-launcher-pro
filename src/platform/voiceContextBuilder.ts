/**
 * voiceContextBuilder.ts — AI bağlam zenginleştirme.
 *
 * Anlık sensör verilerini (OBD/CAN, DTC, bakım) tek bir VehicleContext'e toplar.
 * voiceService.ts'deki processTextCommand tarafından AI çağrısından önce çağrılır.
 *
 * §2 Sensor Resiliency: her veri kaynağı bağımsız try-catch ile sarılıdır;
 * bir kaynaktan hata gelse dahi diğerleri ve base context bozulmaz.
 */
import type { VehicleContext } from './voiceTypes';
import { onDTCState } from './dtcService';
import { getMaintenanceAssessment } from './vehicleMaintenanceService';
import { onOBDData } from './obdService';

/**
 * Base VehicleContext'e DTC, bakım ve OBD anlık snapshot'unu ekler.
 * AI çağrısından önce enrichedCtx olarak iletilir; AI dosyalarına dokunmaz.
 */
export async function buildEnrichedCtx(ctx?: VehicleContext): Promise<VehicleContext> {
  const base: VehicleContext = ctx ?? { speedKmh: 0, drivingMode: 'idle', isDriving: false };

  // ── DTC kodları ──────────────────────────────────────────
  let dtcCodes: VehicleContext['activeDTCCodes'] = base.activeDTCCodes;
  try {
    let snap: { codes: VehicleContext['activeDTCCodes'] } | undefined;
    const unsub = onDTCState((s) => { snap = s; });
    unsub();
    if (snap) dtcCodes = snap.codes;
  } catch { /* ignore */ }

  // ── Bakım değerlendirmesi ─────────────────────────────────
  let maintenanceAssessments: VehicleContext['maintenanceAssessments'] = base.maintenanceAssessments;
  try {
    maintenanceAssessments = await getMaintenanceAssessment();
  } catch { /* ignore */ }

  // ── T-12: CAN-BUS / OBD canlı verisi ─────────────────────
  // "Arabanın durumu nasıl?" sorusuna AI güncel hız/yakıt/sıcaklık bilgisiyle cevap verebilsin.
  // §2 Sensor Resiliency: veri alınamazsa mevcut context'i bozmaz.
  let canSpeed: number | undefined;
  let canFuel:  number | undefined;
  let canTemp:  number | undefined;
  try {
    let obdSnap: { speedKmh: number; fuelLevel: number; engineTemp: number } | undefined;
    const unsub = onOBDData((d) => {
      obdSnap = { speedKmh: d.speed, fuelLevel: d.fuelLevel, engineTemp: d.engineTemp };
    });
    unsub(); // tek anlık snapshot — sürekli abone olmuyoruz
    if (obdSnap) {
      canSpeed = obdSnap.speedKmh;
      canFuel  = obdSnap.fuelLevel;
      canTemp  = obdSnap.engineTemp;
    }
  } catch { /* CAN verisi yoksa zarifçe devam et */ }

  // speedKmh: ctx'ten gelen değer varsa öncelikli, yoksa CAN
  const speedKmh  = base.speedKmh || canSpeed || 0;
  const isDriving = speedKmh > 2;

  return {
    ...base,
    speedKmh,
    isDriving,
    activeDTCCodes:        dtcCodes,
    maintenanceAssessments,
    // CAN verisini AI sistem mesajına gömülü gönder (VehicleContext'e extra alan)
    ...(canFuel  !== undefined ? { fuelLevelPct:   canFuel  } : {}),
    ...(canTemp  !== undefined ? { engineTempC:     canTemp  } : {}),
  };
}
