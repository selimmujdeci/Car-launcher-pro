/**
 * cockpitReferenceState — Digital Cockpit GÖRSEL DOĞRULAMA fikstürü (TEST-ONLY).
 *
 * ⚠️ BU DEĞERLER ÜRÜN GERÇEĞİ DEĞİLDİR. Paketin `cockpit-ui-overlay.svg`
 * dosyasındaki ÖRNEK değerlerdir ve YALNIZ pixel-match karşılaştırması ile
 * birim testleri için vardır. Üretim yolunda hiçbir yerden import EDİLMEZ —
 * `vitest.config.ts` bu klasörü test toplamadan da hariç tutar
 * (`src/__tests__/fixtures/**`).
 *
 * Paket kuralı (CAROS_DIGITAL_COCKPIT_SPEC.md §Fail-closed UI):
 * "Ekran demo asset içindeki örnek `72 / 1.8 / 92 / 520` değerlerini production
 *  gerçeği olarak kullanmayacak."  → bu yüzden ayrı bir fikstür dosyasıdır.
 */

import type { CockpitState } from '../../components/cockpit/cockpitDataModel';

/** Referans görselindeki (gündüz/gece) tam durum — geometri karşılaştırması için. */
export const COCKPIT_REFERENCE_STATE: CockpitState = Object.freeze({
  speedKmh: 72,
  speedLimitKmh: 80,
  speedLimitDefinitive: true,
  rpm: 1800,
  rpmRedline: 8000,
  coolantTempC: 92,
  coolantFreshness: 'LIVE',
  rangeKm: 520,
  // Referans overlay'de yakıt çubuğu 240 px'in 155'i dolu → %64,6
  fuelLevelPct: 65,
  avgConsumptionL100: 6.1,
  odometerKm: 8326,
  ambientTempC: 24,
  maneuver: Object.freeze({
    distanceMeters: 300,
    label: 'Gazi Paşa Blv.',
    type: 'turn',
    modifier: 'right',
  }),
  media: Object.freeze({
    title: 'Leyla',
    artist: 'Mabel Matiz',
    artworkUrl: null,
    playing: true,
    available: true,
  }),
  gear: 'D',
  driveMode: 'ECO',
  // ADAS: üründe gerçek sinyal YOK — referansta rozet olsa bile UYDURULMAZ.
  laneAssist: null,
  followingAssist: null,
});

/** Referans üst şerit saati/tarihi (overlay: `21:11` · `Pazar, 13 Eyl`). */
export const COCKPIT_REFERENCE_CLOCK = Object.freeze({ time: '21:11', date: 'Pazar, 13 Eyl' });
