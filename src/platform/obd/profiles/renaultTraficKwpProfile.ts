/**
 * renaultTraficKwpProfile — PR-OBD-KWP-1: Renault Trafic II (2001-2014) ve benzeri
 * KWP2000 (ISO 14230) araçlar için kanıt-dürüst başlangıç profili.
 *
 * NEDEN AYRI PROFİL: mevcut `renaultDaciaProfile` CAN (11-bit 7E0/7E8) adresleme varsayar —
 * Trafic KWP hattındadır; o profil bu araçta her DID'de COMM_ERROR üretir (sahada gözlenen
 * "Mode 22 yolu başarısız"). Bu profil:
 *  - `protocols: ['kwp', 'iso9141']` → CAN araçta YÜKLÜYSE BİLE sorgu yapılmaz (kapı ters
 *    yönde de çalışır; protokol uyumsuzluğu dürüstçe raporlanır).
 *  - ECU adresi BOŞ ('') → native header'a HİÇ dokunmaz; istekler K-line'ın MEVCUT init'li
 *    oturumundan gider (KWP'de en olası başarı yolu — header değiştirmek yeniden bus-init
 *    riski taşır, ilk sürümde alınmaz).
 *
 * DÜRÜSTLÜK NOTU (CLAUDE.md ticari lisans + kanıtsız-eşleme yasağı): Renault'nun KWP Servis 21
 * LocalIdentifier haritası (DDT2000 veritabanı) TELİFLİDİR ve kamu-doğrulanabilir değildir —
 * buraya KOPYALANAMAZ/uydurulamaz. Bu yüzden profil yalnız ISO 14229-1'in kendisinde tanımlı
 * kimlik DID'lerini (F190 VIN, F187, F18C — Servis 22 KWP taşıyıcıda da tanımlıdır) içerir.
 * Araca özgü GERÇEK veri LID'leri, keşif aracının Servis 21 taramasıyla (didDiscoveryService,
 * salt-okuma) sahada bulunur; pozitif yanıtlar Car Scanner/gösterge değerleriyle eşleştirilip
 * KANITLANDIKTAN sonra bu dosyaya isimli kayıt olarak eklenir. Boş kalması kabul —
 * hiç veri, sahte veriden iyidir.
 */
import type { VehicleDidProfile } from '../vehicleDidProfile';

export const RENAULT_TRAFIC_KWP_SOURCE =
  'ISO 14229-1 Annex C.1 (standart DataIdentifier tablosu) + ISO 14230-2/-3 (KWP2000 taşıyıcı) — ' +
  'Renault-özel Servis 21 LID\'leri keşif aracıyla sahada kanıtlanıp eklenecek (DDT2000 kopyalanamaz)';

export const renaultTraficKwpProfile: VehicleDidProfile = {
  brand: 'Renault Trafic / KWP2000',
  note:
    'KWP (ISO 14230) araçlar için: istekler mevcut oturumdan gider (header değişimi yok). ' +
    'Renault-özel LID\'ler henüz kanıtlanmadı — Servis 21 keşif taramasıyla sahada büyütülecek.',
  source: RENAULT_TRAFIC_KWP_SOURCE,
  protocols: ['kwp', 'iso9141'],
  ecus: [
    // tx/rx boş: varsayılan oturum adreslemesi (native header'a dokunmaz — PR-OBD-KWP-1).
    { id: 'engine', name: "Motor ECU'su (mevcut oturum)", tx: '', rx: '' },
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
