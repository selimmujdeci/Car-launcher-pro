/**
 * renaultZoePh2Profile — Renault Zoe Faz 2 (ZE50, 2019+) üretici DID profili.
 *
 * KAYNAK (lisans dosya bazında doğrulandı, 2026-07-05): OVMS3 (Open Vehicle
 * Monitoring System v3) `vehicle_renaultzoe_ph2` bileşeni — MIT lisanslı
 * (rz2_pids_BCM.cpp + rz2_pids_HVAC.cpp başlıkları teyitli). Atıf:
 * SettingsPage "Açık Kaynak Lisansları" ekranında. Formüller OVMS kaynak
 * kodundaki decode ifadelerinden birebir alındı — uydurma formül YOK
 * (docs/OBD_DATA_SOURCES_LEGAL.md):
 *   TPMS basınç: raw16 * 7.5/10 = *0.75 kPa · TPMS sıcaklık: raw8 - 30 °C
 *   Kabin sıcaklığı: (raw16 - 400)/10 = raw*0.1 - 40 °C · VIN: 18 bayt ASCII
 *
 * KAPSAM KISITI (bilinçli): OVMS'in Zoe Ph2 tablosundaki EVC/BMS/inverter
 * ECU'ları (SOC 0x9002, odometre 0x2006, motor RPM 0x3064…) 29-bit genişletilmiş
 * adres kullanır (18DAxxxx) — native withEcuHeader şu an yalnız 11-bit ATSH/ATCRA
 * yapıyor (ATCP desteği yok, bkz. ElmProtocolTest Patch 12A). Bu yüzden profile
 * YALNIZ 11-bit ECU'lar alındı: BCM (745/765) + HVAC (744/764). 29-bit desteği
 * native'e eklenince (ROADMAP) SOC/odometre/RPM DID'leri buraya taşınacak.
 *
 * Kapı/kilit/kontak boolean DID'leri bilinçli dışarıda: gövde sinyalleri K24'te
 * zaten CAN broadcast'ten geliyor (VehicleTellTales) ve sensör-değeri sorgu
 * modeli sayısal/metin ölçümler için tasarlandı.
 */
import type { VehicleDidProfile } from '../vehicleDidProfile';

export const RENAULT_ZOE_PH2_SOURCE =
  'OVMS3 vehicle_renaultzoe_ph2 (MIT — github.com/openvehicles/Open-Vehicle-Monitoring-System-3, ' +
  'rz2_pids_BCM.cpp + rz2_pids_HVAC.cpp; formüller kaynak koddan birebir)';

export const renaultZoePh2Profile: VehicleDidProfile = {
  brand: 'Renault Zoe Ph2 (ZE50)',
  note:
    'Yalnız 11-bit ECU\'lar (BCM/HVAC) — SOC/odometre/RPM taşıyan EVC/BMS 29-bit ' +
    'adresleme ister, native destek eklenince genişletilecek. Kaynak: OVMS3 (MIT).',
  source: RENAULT_ZOE_PH2_SOURCE,
  ecus: [
    { id: 'bcm',  name: 'Gövde Kontrol Modülü (BCM)', tx: '745', rx: '765' },
    { id: 'hvac', name: 'Klima Modülü (HVAC)',        tx: '744', rx: '764' },
  ],
  dids: [
    {
      did: '4060', ecu: 'bcm', name: 'Şasi Numarası (VIN)', unit: '', bytes: 17,
      min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' },
    },
    {
      did: '6300', ecu: 'bcm', name: 'Lastik Basıncı Ön Sol', unit: 'kPa', bytes: 2,
      min: 0, max: 450, category: 'lastik', decode: { fn: 'linear', a: 0.75, b: 0 },
    },
    {
      did: '6301', ecu: 'bcm', name: 'Lastik Basıncı Ön Sağ', unit: 'kPa', bytes: 2,
      min: 0, max: 450, category: 'lastik', decode: { fn: 'linear', a: 0.75, b: 0 },
    },
    {
      did: '6302', ecu: 'bcm', name: 'Lastik Basıncı Arka Sol', unit: 'kPa', bytes: 2,
      min: 0, max: 450, category: 'lastik', decode: { fn: 'linear', a: 0.75, b: 0 },
    },
    {
      did: '6303', ecu: 'bcm', name: 'Lastik Basıncı Arka Sağ', unit: 'kPa', bytes: 2,
      min: 0, max: 450, category: 'lastik', decode: { fn: 'linear', a: 0.75, b: 0 },
    },
    {
      did: '6310', ecu: 'bcm', name: 'Lastik Sıcaklığı Ön Sol', unit: '°C', bytes: 1,
      min: -30, max: 120, category: 'lastik', decode: { fn: 'linear', a: 1, b: -30 },
    },
    {
      did: '6311', ecu: 'bcm', name: 'Lastik Sıcaklığı Ön Sağ', unit: '°C', bytes: 1,
      min: -30, max: 120, category: 'lastik', decode: { fn: 'linear', a: 1, b: -30 },
    },
    {
      did: '6312', ecu: 'bcm', name: 'Lastik Sıcaklığı Arka Sol', unit: '°C', bytes: 1,
      min: -30, max: 120, category: 'lastik', decode: { fn: 'linear', a: 1, b: -30 },
    },
    {
      did: '6313', ecu: 'bcm', name: 'Lastik Sıcaklığı Arka Sağ', unit: '°C', bytes: 1,
      min: -30, max: 120, category: 'lastik', decode: { fn: 'linear', a: 1, b: -30 },
    },
    {
      did: '4009', ecu: 'hvac', name: 'Kabin Sıcaklığı', unit: '°C', bytes: 2,
      min: -40, max: 90, category: 'konfor', decode: { fn: 'linear', a: 0.1, b: -40 },
    },
  ],
};
