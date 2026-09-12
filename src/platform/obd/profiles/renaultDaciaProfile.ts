/**
 * renaultDaciaProfile — Patch 12C: Renault/Dacia için kamu-doğrulanabilir başlangıç seti.
 *
 * DÜRÜSTLÜK NOTU (CLAUDE.md ticari lisans kuralı): Renault/Dacia'ya ÖZGÜ, doğrulanabilir
 * kamu dokümantasyonu bulunan bir üretici-özel UDS DID'i (şanzıman yağı sıcaklığı, DPF
 * doluluk, enjektör düzeltme vb.) elimizde YOK — uydurma formül eklemek kesinlikle
 * yasak (lisans + dürüstlük, bkz. OBD_PATCH12_PLAN.md §Neden/Ne değil). Bu yüzden profil
 * şimdilik yalnız evrensel ISO 14229-1 kimlik DID'lerini barındırır (universalUdsProfile
 * ile AYNI DID'ler, AYNI kaynak) — Renault/Dacia motor ECU'sunun standart 11-bit CAN
 * adreslemesinde (7E0/7E8, ISO 15765-4) bu DID'lere yanıt vermesi beklenir çünkü araç
 * OBD-II/UDS uyumludur, marka-özel bir iddia İÇERMEZ.
 *
 * BÜYÜTME YOLU: Selim'in Dacia'sında (T507 ünite, bkz. proje hafızası) didDiscoveryService
 * ile 22xx aralığı taranıp ham yanıtlar bilinen gösterge değerleriyle eşleştirilerek bu
 * dosyaya GERÇEK, kaynağı olan Renault-özel DID'ler eklenecek. Şu an boş kalması KABUL —
 * hiç veri sahte veriden iyidir.
 */
import type { VehicleDidProfile } from '../vehicleDidProfile';

export const RENAULT_DACIA_SOURCE =
  'ISO 14229-1 Annex C.1 (standart DataIdentifier tablosu) + ISO 15765-4 (11-bit CAN adresleme) — ' +
  'Renault/Dacia\'ya ÖZGÜ doğrulanmış üretici DID\'i HENÜZ YOK, keşif aracıyla genişletilecek';

export const renaultDaciaProfile: VehicleDidProfile = {
  brand: 'Renault / Dacia',
  note:
    'Renault/Dacia\'ya ÖZGÜ üretici DID\'i (şanzıman/DPF/enjektör vb.) HENÜZ DOĞRULANMADI — ' +
    'yalnız evrensel ISO 14229-1 kimlik seti (universalUdsProfile ile aynı). ' +
    'DID keşif aracı ile sahada büyütülecek.',
  source: RENAULT_DACIA_SOURCE,
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
  ],
};
