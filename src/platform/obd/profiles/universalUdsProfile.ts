/**
 * universalUdsProfile — Patch 12C: ISO 14229-1 (UDS) standart kimlik DID'leri.
 *
 * KAYNAK: ISO 14229-1 Annex C.1 (standart DataIdentifier tablosu). Marka BAĞIMSIZ —
 * Mode 22 (ReadDataByIdentifier) destekleyen HERHANGİ bir ECU'da çalışması beklenir.
 * Bu profil boru hattının (native readObdDid → vehicleDidProfile decode →
 * manufacturerPidService → sensorQueryService) UÇTAN UCA kanıtıdır: VIN'i hem Mode 09
 * (0902) hem F190'dan okuyup karşılaştırmak (bkz. manufacturerPidService.verifyVinAgainstMode09)
 * header/ECU adreslemenin doğruluğunu gösterir.
 *
 * ECU adresi 7E0 (istek) / 7E8 (yanıt) — standart 11-bit ISO 15765-4 CAN adreslemesi
 * (motor ECU'su, OBD-II uyumlu araçlarda en yaygın durum). Farklı adresleme kullanan
 * araçlarda (29-bit / gateway'li mimari) didDiscoveryService ile doğru tx/rx bulunmalı —
 * bu profil varsayılanı kapsar, GARANTİ değildir.
 *
 * Tüm DID'ler METİN (ASCII, decode.fn:'ascii') döner: VIN 17 bayt SABİT (ISO 14229-1
 * zorunlu kılar); diğer dördü (parça no/seri no/versiyon) OEM'e göre DEĞİŞKEN uzunlukta
 * olabilir — `bytes` alanı bu yüzden yalnız asgari/dokümantasyon amaçlı (decodeCompiledDid
 * metin DID'lerinde gelen TÜM veriyi tüketir, bkz. vehicleDidProfile.ts `isText` dalı).
 * `min`/`max` metin DID'lerinde KULLANILMAZ (yalnız şema zorunluluğu için 0/0).
 */
import type { VehicleDidProfile } from '../vehicleDidProfile';

export const UNIVERSAL_UDS_SOURCE = 'ISO 14229-1 Annex C.1 (standart DataIdentifier tablosu)';

export const universalUdsProfile: VehicleDidProfile = {
  brand: 'Evrensel UDS (ISO 14229-1)',
  note:
    'Marka bağımsız — TÜM Mode 22 destekleyen ECU\'larda çalışması beklenir. ' +
    'Motor ECU\'su 7E0/7E8 varsayılan (11-bit CAN). Boru hattının uçtan uca kanıtı ' +
    'olarak kullanılır (VIN çapraz doğrulama: F190 ↔ Mode 09).',
  source: UNIVERSAL_UDS_SOURCE,
  // PR-OBD-KWP-1: bu profil 11-bit CAN (7E0/7E8) adresleme varsayar — KWP/ISO9141
  // hattinda sorgulanmasi COMM_ERROR firtinasi uretir (Trafic sahasi); kapi ile kapatilir.
  protocols: ['can'],
  ecus: [
    { id: 'engine', name: "Motor ECU'su", tx: '7E0', rx: '7E8' },
  ],
  dids: [
    {
      did: 'F190', ecu: 'engine', name: 'Şasi Numarası (VIN)', unit: '', bytes: 17,
      min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' },
    },
    {
      did: 'F187', ecu: 'engine', name: 'Yedek Parça Numarası', unit: '', bytes: 1,
      min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' },
    },
    {
      did: 'F18C', ecu: 'engine', name: 'ECU Seri Numarası', unit: '', bytes: 1,
      min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' },
    },
    {
      did: 'F195', ecu: 'engine', name: 'Yazılım Versiyonu', unit: '', bytes: 1,
      min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' },
    },
    {
      did: 'F191', ecu: 'engine', name: 'Donanım Versiyonu', unit: '', bytes: 1,
      min: 0, max: 0, category: 'kimlik', decode: { fn: 'ascii' },
    },
  ],
};
