/**
 * renaultZoePh2Profile — Renault Zoe Faz 2 (ZE50, 2019+) üretici DID profili.
 *
 * KAYNAK (lisans dosya bazında doğrulandı, 2026-07-05): OVMS3 (Open Vehicle
 * Monitoring System v3) `vehicle_renaultzoe_ph2` bileşeni — MIT lisanslı
 * (rz2_pids_BCM.cpp + rz2_pids_HVAC.cpp + rz2_pids_EVC.cpp + rz2_pids_LBC.cpp
 * başlıkları teyitli — hepsi "(C) 2022 Carsten Schmiemann" + MIT permission
 * notice). Atıf: SettingsPage "Açık Kaynak Lisansları" ekranında. Formüller
 * OVMS kaynak kodundaki decode ifadelerinden birebir alındı — uydurma formül
 * YOK (docs/OBD_DATA_SOURCES_LEGAL.md):
 *   TPMS basınç: raw16 * 7.5/10 = *0.75 kPa · TPMS sıcaklık: raw8 - 30 °C
 *   Kabin sıcaklığı: (raw16 - 400)/10 = raw*0.1 - 40 °C · VIN: 18 bayt ASCII
 *   [Patch 13 — EVC/LBC, CAN_UINT=büyük-uçlu 16-bit, CAN_UINT24=büyük-uçlu 24-bit]:
 *   Odometre: CAN_UINT24*1 km · 12V akü: CAN_UINT*0.01 V · Dış sıcaklık: CAN_UINT*0.1-273 °C
 *   Motor devri: CAN_UINT*1 rpm · SOC: CAN_UINT*0.01 % · SOH: CAN_UINT*0.01 %
 *   Batarya voltajı: CAN_UINT*0.1 V · Batarya sıcaklığı: CAN_UINT*0.0625-40 °C
 *   Kullanılabilir enerji: CAN_UINT24*0.001 kWh
 *
 * PATCH 13 GENİŞLEMESİ: native withEcuHeader artık 29-bit genişletilmiş UDS
 * adresleme destekliyor (ATCP öncelik baytı + ATSP7 protokol geçişi, bkz.
 * ElmProtocol.withEcuHeader29Bit) — bu yüzden OVMS'in Zoe Ph2 tablosundaki
 * EVC (motor/şasi) ve LBC (batarya/BMS) ECU'ları (18DAxxxx) artık profile
 * EKLENDİ. Kapsam dışı kalanlar (inverter durumu, şarj gücü, hücre bazlı
 * gerilim/sıcaklık dizileri vb.) — sensör sorgu modeli TEK skaler DID/tur
 * varsayar, dizi/karmaşık alanlar ayrı bir DID keşif+parse iş kalemi.
 *
 * Kapı/kilit/kontak boolean DID'leri bilinçli dışarıda: gövde sinyalleri K24'te
 * zaten CAN broadcast'ten geliyor (VehicleTellTales) ve sensör-değeri sorgu
 * modeli sayısal/metin ölçümler için tasarlandı.
 */
import type { VehicleDidProfile } from '../vehicleDidProfile';

export const RENAULT_ZOE_PH2_SOURCE =
  'OVMS3 vehicle_renaultzoe_ph2 (MIT — github.com/openvehicles/Open-Vehicle-Monitoring-System-3, ' +
  'rz2_pids_BCM.cpp + rz2_pids_HVAC.cpp + rz2_pids_EVC.cpp + rz2_pids_LBC.cpp; formüller kaynak koddan birebir)';

export const renaultZoePh2Profile: VehicleDidProfile = {
  brand: 'Renault Zoe Ph2 (ZE50)',
  note:
    '11-bit ECU\'lar (BCM/HVAC) + Patch 13 ile eklenen 29-bit ECU\'lar (EVC/LBC — ' +
    'odometre/12V akü/dış sıcaklık/motor devri + SOC/SOH/batarya voltajı-sıcaklığı/' +
    'kullanılabilir enerji). Kaynak: OVMS3 (MIT).',
  source: RENAULT_ZOE_PH2_SOURCE,
  // PR-OBD-KWP-1: bu profil 11-bit CAN (7E0/7E8) adresleme varsayar — KWP/ISO9141
  // hattinda sorgulanmasi COMM_ERROR firtinasi uretir (Trafic sahasi); kapi ile kapatilir.
  protocols: ['can'],
  ecus: [
    { id: 'bcm',  name: 'Gövde Kontrol Modülü (BCM)', tx: '745', rx: '765' },
    { id: 'hvac', name: 'Klima Modülü (HVAC)',        tx: '744', rx: '764' },
    // Patch 13 — 29-bit genişletilmiş adresleme (native ATCP/ATSP7 desteğiyle).
    { id: 'evc',  name: "Elektrikli Araç Kontrol Ünitesi (EVC)", tx: '18DADAF1', rx: '18DAF1DA' },
    { id: 'lbc',  name: 'Batarya Yönetim Sistemi (LBC/BMS)',     tx: '18DADBF1', rx: '18DAF1DB' },
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
    // ── Patch 13: EVC (29-bit, tx 18DADAF1) — rz2_pids_EVC.cpp (MIT) ────────
    {
      // OVMS: StandardMetrics.ms_v_pos_odometer->SetValue((float)CAN_UINT24(0), Kilometers);
      did: '2006', ecu: 'evc', name: 'Kilometre (Odometre)', unit: 'km', bytes: 3,
      min: 0, max: 999999, category: 'kilometre', decode: { fn: 'linear', a: 1, b: 0 },
    },
    {
      // OVMS: StandardMetrics.ms_v_charge_12v_voltage->SetValue((float)(CAN_UINT(0) * 0.01), Volts);
      did: '2005', ecu: 'evc', name: '12V Akü Voltajı', unit: 'V', bytes: 2,
      min: 0, max: 20, category: 'akü', decode: { fn: 'linear', a: 0.01, b: 0 },
    },
    {
      // OVMS: temp = (float)(CAN_UINT(0) * 0.1 - 273); (geçerli aralık -39..80)
      did: '2218', ecu: 'evc', name: 'Dış Ortam Sıcaklığı', unit: '°C', bytes: 2,
      min: -40, max: 85, category: 'dış-ortam', decode: { fn: 'linear', a: 0.1, b: -273 },
    },
    {
      // OVMS: StandardMetrics.ms_v_mot_rpm->SetValue((float)(CAN_UINT(0)));
      did: '3064', ecu: 'evc', name: 'Motor Devri', unit: 'rpm', bytes: 2,
      min: 0, max: 15000, category: 'motor', decode: { fn: 'linear', a: 1, b: 0 },
    },
    // ── Patch 13: LBC/BMS (29-bit, tx 18DADBF1) — rz2_pids_LBC.cpp (MIT) ────
    {
      // OVMS: float bat_soc = CAN_UINT(0) * 0.01; (100 üstü OVMS'te sensör gürültüsü sayılıp atlanır)
      did: '9002', ecu: 'lbc', name: 'Batarya Şarj Durumu (SOC)', unit: '%', bytes: 2,
      min: 0, max: 100, category: 'batarya', decode: { fn: 'linear', a: 0.01, b: 0 },
    },
    {
      // OVMS: StandardMetrics.ms_v_bat_soh->SetValue((float)(CAN_UINT(0) * 0.01), Percentage);
      did: '9003', ecu: 'lbc', name: 'Batarya Sağlık Durumu (SOH)', unit: '%', bytes: 2,
      min: 0, max: 100, category: 'batarya', decode: { fn: 'linear', a: 0.01, b: 0 },
    },
    {
      // OVMS: StandardMetrics.ms_v_bat_voltage->SetValue((float)(CAN_UINT(0) * 0.1), Volts);
      did: '9005', ecu: 'lbc', name: 'Batarya Voltajı', unit: 'V', bytes: 2,
      min: 0, max: 500, category: 'batarya', decode: { fn: 'linear', a: 0.1, b: 0 },
    },
    {
      // OVMS: StandardMetrics.ms_v_bat_temp->SetValue((float)(CAN_UINT(0) * 0.0625 - 40), Celcius);
      did: '9012', ecu: 'lbc', name: 'Batarya Ortalama Sıcaklığı', unit: '°C', bytes: 2,
      min: -40, max: 80, category: 'batarya', decode: { fn: 'linear', a: 0.0625, b: -40 },
    },
    {
      // OVMS: StandardMetrics.ms_v_bat_capacity->SetValue(float(CAN_UINT24(0) * 0.001), kWh);
      did: '91C8', ecu: 'lbc', name: 'Kullanılabilir Enerji', unit: 'kWh', bytes: 3,
      min: 0, max: 70, category: 'batarya', decode: { fn: 'linear', a: 0.001, b: 0 },
    },
  ],
};
