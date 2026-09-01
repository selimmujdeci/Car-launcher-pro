/**
 * oemProfileRegistry — P1-OBD-01 · OEM ECU PROFİL KAYIT DEFTERİ (SAF VERİ).
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ── İKİ RAF, TEK KAPI ─────────────────────────────────────────────────────
 * `OEM_ECU_PROFILES` tüm kayıtları taşır (taşınmış olanlar dâhil).
 * `getProductOemProfiles()` YALNIZ gerçek araçta doğrulanmış ECU kaydı olan
 * profilleri döndürür ve o profillerin de yalnız DOĞRULANMIŞ ECU'larını.
 * Ürün yolundaki (envanter zenginleştirme) tek giriş noktası budur.
 *
 * ── BU DEFTER ŞU AN NE İÇERİYOR ───────────────────────────────────────────
 * Mevcut Renault/Dacia · Trafic (KWP) · Zoe Ph2 verileri ortak sözleşmeye
 * TAŞINDI. Hiçbirinin ECU adresi BU ÜRÜNDE gerçek araçta doğrulanmadı, bu
 * yüzden `verifiedOn` alanlarının tamamı `null`'dır ve
 * `getProductOemProfiles()` şu an BOŞ döner — yani profil yolu üretimde HİÇBİR
 * davranışı değiştirmez. Bu bir eksiklik değil, sözleşmenin çalıştığının
 * kanıtıdır: kanıtsız adres araca komut adresleyemez.
 *
 * ── YENİ KAYIT NASIL EKLENİR ──────────────────────────────────────────────
 * Bkz. dosya sonundaki "SAHA PROSEDÜRÜ" bloğu. Kısaca: adres sahada okunur,
 * yanıt kanıtı kütüğe yazılır, sonra `verifiedOn` + `evidence` doldurulur.
 * Damgayı önce yazıp sonra doğrulamak, tam olarak bu sözleşmenin engellediği
 * şeydir.
 *
 * ── LİSANS (CLAUDE.md ticari satış kuralı) ────────────────────────────────
 * Zoe Ph2 kayıtlarının kaynağı OVMS3'tür (MIT) ve atıf `RENAULT_ZOE_PH2_SOURCE`
 * üzerinden "Açık Kaynak Lisansları" ekranında zaten yayınlanmaktadır. Telifli
 * üretici veritabanları (DDT2000/CLIP vb.) bu deftere KOPYALANAMAZ.
 */

import { RENAULT_ZOE_PH2_SOURCE } from '../profiles/renaultZoePh2Profile';
import { RENAULT_DACIA_SOURCE } from '../profiles/renaultDaciaProfile';
import { RENAULT_TRAFIC_KWP_SOURCE } from '../profiles/renaultTraficKwpProfile';
import {
  isProductEligibleProfile, selectProductEcus, validateOemEcuProfile,
  type OemEcuProfile,
} from './oemEcuProfile';

/* ── ISO 3779 WMI ─────────────────────────────────────────────────────────
 * Bu önekler ISO 3779 tahsisidir ve üründe zaten `core/val/VehicleProfile.decodeWMI`
 * tablosunda yaşar (VF1/VF6 = Renault). Dacia'nın UU1 öneki BU ÜRÜNDE HİÇBİR
 * ARAÇTA GÖZLENMEDİ — kayıtlar doğrulanmamış rafta olduğu için bu belirsizlik
 * ürün davranışına sızmaz, ama LAB'da UNKNOWN olarak görünür.
 */
const RENAULT_WMI = ['VF1', 'VF6'] as const;
const RENAULT_DACIA_WMI = ['VF1', 'VF6', 'UU1'] as const;

/* ══════════════════════════════════════════════════════════════════════════
 * TAŞINAN KAYIT 1/3 — Renault/Dacia, 11-bit CAN
 * `profiles/renaultDaciaProfile.ts` (Patch 12C) verisinin ortak sözleşmedeki
 * karşılığı. O profil yalnız ISO 14229 kimlik DID'lerini taşır ve motor ECU'su
 * için ISO 15765-4'ün STANDART adresini (7E0/7E8) kullanır — yani marka-özel
 * bir iddia İÇERMEZ. Bu adres zaten fonksiyonel `0100` keşfiyle bulunur; kayıt
 * burada tamlık ve kapsam raporu için durur, keşfe bir şey EKLEMEZ.
 * ════════════════════════════════════════════════════════════════════════ */
const renaultDaciaCanProfile: OemEcuProfile = {
  id: 'renault-dacia-can',
  note:
    'Renault/Dacia 11-bit CAN. Motor ECU adresi ISO 15765-4 STANDARDIDIR (marka iddiası değil) ve ' +
    'fonksiyonel 0100 keşfiyle zaten bulunur. Marka-ÖZEL doğrulanmış ECU adresi HENÜZ YOK. ' +
    'WMI listesi bu üründe hiçbir araçta doğrulanmadı.',
  provenance: {
    kind: 'iso_standard',
    source: RENAULT_DACIA_SOURCE,
    license: 'ISO standardı — referans; kod/veri kopyası içermez',
  },
  vehicle: {
    manufacturer: 'Renault / Dacia',
    modelFamily: 'UNKNOWN',
    wmi: [...RENAULT_DACIA_WMI],
    vdsPattern: null,
    protocols: ['can'],
  },
  ecus: [
    {
      ecuId: 'engine',
      name: "Motor ECU'su",
      role: 'engine',
      addressing: 'can11',
      tx: '7E0',
      rx: '7E8',
      kwpTarget: null,
      session: 'default',
      readServices: ['01', '03', '07', '09', '0A', '19', '22'],
      dids: [
        { id: 'F190', service: '22', name: 'Şasi Numarası (VIN)', verifiedOn: null, evidence: null },
        { id: 'F187', service: '22', name: 'Yedek Parça Numarası', verifiedOn: null, evidence: null },
        { id: 'F18C', service: '22', name: 'ECU Seri Numarası', verifiedOn: null, evidence: null },
      ],
      provenance: {
        kind: 'iso_standard',
        source: 'ISO 15765-4 (11-bit CAN adresleme) + ISO 14229-1 Annex C.1',
        license: 'ISO standardı — referans',
      },
      verifiedOn: null,
      evidence: null,
    },
  ],
};

/* ══════════════════════════════════════════════════════════════════════════
 * TAŞINAN KAYIT 2/3 — Renault Trafic II, KWP2000 (ISO 14230)
 * `profiles/renaultTraficKwpProfile.ts` (PR-OBD-KWP-1) verisinin karşılığı.
 * KWP hedef baytı ve gerekli oturum SAHADA ÖLÇÜLMEDİ → ikisi de UNKNOWN.
 * `tx`/`rx` boş: native header'a HİÇ dokunulmaz (mevcut init'li oturumdan gider).
 * ════════════════════════════════════════════════════════════════════════ */
const renaultTraficKwpEcuProfile: OemEcuProfile = {
  id: 'renault-trafic-kwp',
  note:
    'KWP2000 (ISO 14230) hattı. İstekler mevcut init edilmiş oturumdan gider (header değişimi YOK). ' +
    'KWP hedef baytı ve gerekli tanı oturumu SAHADA ÖLÇÜLMEDİ — ikisi de UNKNOWN bırakıldı; ' +
    'Renault-özel Servis 21 LID haritası telifli (DDT2000) olduğundan KOPYALANMAZ.',
  provenance: {
    kind: 'iso_standard',
    source: RENAULT_TRAFIC_KWP_SOURCE,
    license: 'ISO standardı — referans; üretici veritabanı kopyası içermez',
  },
  vehicle: {
    manufacturer: 'Renault',
    modelFamily: 'Trafic II / KWP2000 sınıfı',
    wmi: [...RENAULT_WMI],
    vdsPattern: null,
    protocols: ['kwp', 'iso9141'],
  },
  ecus: [
    {
      ecuId: 'engine',
      name: "Motor ECU'su (mevcut oturum)",
      role: 'engine',
      addressing: 'kwp',
      tx: '',
      rx: '',
      kwpTarget: 'UNKNOWN',
      session: 'UNKNOWN',
      readServices: ['01', '03', '07', '18', '21', '22'],
      dids: [
        { id: 'F190', service: '22', name: 'Şasi Numarası (VIN)', verifiedOn: null, evidence: null },
        { id: 'F187', service: '22', name: 'Yedek Parça Numarası', verifiedOn: null, evidence: null },
        { id: 'F18C', service: '22', name: 'ECU Seri Numarası', verifiedOn: null, evidence: null },
      ],
      provenance: {
        kind: 'iso_standard',
        source: 'ISO 14230-2/-3 (KWP2000 taşıyıcı) + ISO 14229-1 Annex C.1',
        license: 'ISO standardı — referans',
      },
      verifiedOn: null,
      evidence: null,
    },
  ],
};

/* ══════════════════════════════════════════════════════════════════════════
 * TAŞINAN KAYIT 3/3 — Renault Zoe Ph2 (ZE50), 11-bit + 29-bit CAN
 * `profiles/renaultZoePh2Profile.ts` (Patch 13) verisinin karşılığı. Bu, defterin
 * asıl varlık sebebine örnektir: BCM/HVAC/EVC/LBC fonksiyonel `0100` isteğine
 * yanıt VERMEZ — yalnız fiziksel adresle ulaşılır.
 *
 * KAYNAK: OVMS3 `vehicle_renaultzoe_ph2` (MIT). Adresler o kaynaktan alındı;
 * BU ÜRÜNDE gerçek bir Zoe'de HİÇ denenmedi → tüm damgalar `null` (karantina).
 * ════════════════════════════════════════════════════════════════════════ */
const OVMS_PROVENANCE = {
  kind: 'oss_licensed',
  source: RENAULT_ZOE_PH2_SOURCE,
  license: 'MIT — atıf "Açık Kaynak Lisansları" ekranında yayınlanır',
} as const;

const renaultZoePh2EcuProfile: OemEcuProfile = {
  id: 'renault-zoe-ph2',
  note:
    'BCM/HVAC (11-bit) ve EVC/LBC (29-bit) fonksiyonel 0100 keşfine YANIT VERMEZ — profil yolunun ' +
    'asıl hedefi bu sınıf ECU\'lardır. Adresler OVMS3 (MIT) kaynağından; BU ÜRÜNDE gerçek Zoe\'de ' +
    'hiç denenmedi, bu yüzden tamamı doğrulanmamış raftadır.',
  provenance: OVMS_PROVENANCE,
  vehicle: {
    manufacturer: 'Renault',
    modelFamily: 'Zoe Ph2 (ZE50, 2019+)',
    wmi: [...RENAULT_WMI],
    /* Model ayrımı ZORUNLU: bu adresler Zoe Ph2'ye özgüdür ve aynı WMI'yi taşıyan
       başka bir Renault'ta yanlış birimi adreslerdi. Desen SAHADA ÖLÇÜLMEDİĞİ için
       `null` bırakıldı — yani bugün eşleşme kapısı MARKA düzeyindedir ve kayıt
       zaten doğrulanmamış rafta olduğu için ürün yoluna çıkamaz. Desen, ilk gerçek
       Zoe gözleminde VIN'in VDS alanı okunarak doldurulur. */
    vdsPattern: null,
    protocols: ['can'],
  },
  ecus: [
    {
      ecuId: 'bcm',
      name: 'Gövde Kontrol Modülü (BCM)',
      role: 'body_bcm',
      addressing: 'can11',
      tx: '745',
      rx: '765',
      kwpTarget: null,
      session: 'UNKNOWN',
      readServices: ['22'],
      dids: [
        { id: '4060', service: '22', name: 'Şasi Numarası (VIN)', verifiedOn: null, evidence: null },
        { id: '6300', service: '22', name: 'Lastik Basıncı Ön Sol', verifiedOn: null, evidence: null },
        { id: '6301', service: '22', name: 'Lastik Basıncı Ön Sağ', verifiedOn: null, evidence: null },
        { id: '6302', service: '22', name: 'Lastik Basıncı Arka Sol', verifiedOn: null, evidence: null },
        { id: '6303', service: '22', name: 'Lastik Basıncı Arka Sağ', verifiedOn: null, evidence: null },
        { id: '6310', service: '22', name: 'Lastik Sıcaklığı Ön Sol', verifiedOn: null, evidence: null },
        { id: '6311', service: '22', name: 'Lastik Sıcaklığı Ön Sağ', verifiedOn: null, evidence: null },
        { id: '6312', service: '22', name: 'Lastik Sıcaklığı Arka Sol', verifiedOn: null, evidence: null },
        { id: '6313', service: '22', name: 'Lastik Sıcaklığı Arka Sağ', verifiedOn: null, evidence: null },
      ],
      provenance: OVMS_PROVENANCE,
      verifiedOn: null,
      evidence: null,
    },
    {
      ecuId: 'hvac',
      name: 'Klima Modülü (HVAC)',
      role: 'hvac',
      addressing: 'can11',
      tx: '744',
      rx: '764',
      kwpTarget: null,
      session: 'UNKNOWN',
      readServices: ['22'],
      dids: [
        { id: '4009', service: '22', name: 'Kabin Sıcaklığı', verifiedOn: null, evidence: null },
      ],
      provenance: OVMS_PROVENANCE,
      verifiedOn: null,
      evidence: null,
    },
    {
      ecuId: 'evc',
      name: 'Elektrikli Araç Kontrol Ünitesi (EVC)',
      /* EVC bir motor/tahrik kontrol birimidir; rol sözlüğünde en yakın karşılığı
         `engine`'dir. Rol sözlüğüne yeni değer eklemek `ecuRoleModel` sözleşmesini
         değiştirmek olurdu — bu tur kapsamı DIŞI. */
      role: 'engine',
      addressing: 'can29',
      tx: '18DADAF1',
      rx: '18DAF1DA',
      kwpTarget: null,
      session: 'UNKNOWN',
      readServices: ['22'],
      dids: [
        { id: '2006', service: '22', name: 'Kilometre (Odometre)', verifiedOn: null, evidence: null },
        { id: '2005', service: '22', name: '12V Akü Voltajı', verifiedOn: null, evidence: null },
        { id: '2218', service: '22', name: 'Dış Ortam Sıcaklığı', verifiedOn: null, evidence: null },
        { id: '3064', service: '22', name: 'Motor Devri', verifiedOn: null, evidence: null },
      ],
      provenance: OVMS_PROVENANCE,
      verifiedOn: null,
      evidence: null,
    },
    {
      ecuId: 'lbc',
      name: 'Batarya Yönetim Sistemi (LBC/BMS)',
      /* Rol sözlüğünde batarya yönetimi için ayrı bir değer YOK; en yakın dürüst
         karşılık `instrument` değil `engine` de değildir — bu yüzden `gateway`
         gibi yanlış bir rol UYDURULMADI: LBC tahrik zincirinin kontrol birimidir
         ve `engine` rolüyle taşınır. Sözlük genişletmesi ayrı bir iş kalemidir. */
      role: 'engine',
      addressing: 'can29',
      tx: '18DADBF1',
      rx: '18DAF1DB',
      kwpTarget: null,
      session: 'UNKNOWN',
      readServices: ['22'],
      dids: [
        { id: '9002', service: '22', name: 'Batarya Şarj Durumu (SOC)', verifiedOn: null, evidence: null },
        { id: '9003', service: '22', name: 'Batarya Sağlık Durumu (SOH)', verifiedOn: null, evidence: null },
        { id: '9005', service: '22', name: 'Batarya Voltajı', verifiedOn: null, evidence: null },
        { id: '9012', service: '22', name: 'Batarya Ortalama Sıcaklığı', verifiedOn: null, evidence: null },
        { id: '91C8', service: '22', name: 'Kullanılabilir Enerji', verifiedOn: null, evidence: null },
      ],
      provenance: OVMS_PROVENANCE,
      verifiedOn: null,
      evidence: null,
    },
  ],
};

/* ── Defter ───────────────────────────────────────────────────────────────── */

/** TÜM kayıtlar (doğrulanmış + doğrulanmamış). LAB kapsam raporu bunu okur. */
export const OEM_ECU_PROFILES: readonly OemEcuProfile[] = [
  renaultDaciaCanProfile,
  renaultTraficKwpEcuProfile,
  renaultZoePh2EcuProfile,
];

/**
 * ÜRÜN YOLU KAPISI. Yalnız gerçek araçta doğrulanmış ECU kaydı olan profiller
 * ve o profillerin yalnız doğrulanmış ECU'ları döner. Envanter zenginleştirme
 * bu fonksiyonu kullanır — `OEM_ECU_PROFILES`'ı DEĞİL.
 *
 * Şu an BOŞ döner (hiçbir kayıt sahada doğrulanmadı) → profil yolu üretimde
 * hiçbir davranışı değiştirmez.
 */
export function getProductOemProfiles(
  all: readonly OemEcuProfile[] = OEM_ECU_PROFILES,
): readonly OemEcuProfile[] {
  const out: OemEcuProfile[] = [];
  for (const p of all) {
    if (!isProductEligibleProfile(p)) continue;
    out.push({ ...p, ecus: selectProductEcus(p) });
  }
  return out;
}

/** Defterin tamamının yapısal doğrulama sonucu — kilit testi bunu çağırır. */
export function validateOemProfileRegistry(
  all: readonly OemEcuProfile[] = OEM_ECU_PROFILES,
): readonly string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  all.forEach((p, i) => {
    const r = validateOemEcuProfile(p);
    if (!r.valid) r.errors.forEach((e) => errors.push(`[${i}:${String(p.id)}] ${e}`));
    if (seen.has(p.id)) errors.push(`[${i}] yinelenen profil kimliği '${p.id}'`);
    seen.add(p.id);
  });
  return errors;
}

/* ══════════════════════════════════════════════════════════════════════════
 * SAHA PROSEDÜRÜ — gerçek araçta yeni profil/ECU nasıl eklenir
 *
 * 1) ARAÇ KİMLİĞİ: CAROS LAB → Araç → "Araç Kimliği (VIN)" ekranında VIN'in
 *    okunduğu doğrulanır. VIN yoksa profil eşleşmesi HİÇ denenmez (`no_vin`).
 *    WMI (ilk 3 hane) ve gerekiyorsa VDS (4-9) not edilir.
 *
 * 2) PROTOKOL: LAB → İletişim → "Oturum Denetçisi"nde aktif protokol hanesi
 *    (ATDPN) okunur; profilin `protocols` listesi bu sınıfı içermelidir.
 *
 * 3) ADRESİN GERÇEKTEN CEVAP VERDİĞİ ÖLÇÜLÜR: LAB → Araç → "ECU Envanteri"nde
 *    TARA çalıştırılır. Aday adres fonksiyonel keşifte GÖRÜNMÜYORSA (beklenen
 *    durum) ISO 14229 kimlik DID'i (F197/F18C/F191) o adrese okunur ve HAM
 *    yanıt kaydedilir. Yanıt yoksa adres YAZILMAZ.
 *
 * 4) KWP HEDEFİ / OTURUM: KWP hattında `kwpTarget` ve `session` ancak gerçek
 *    pozitif yanıtla (ör. 10 81 → 50 81) doldurulur; aksi hâlde `UNKNOWN` KALIR.
 *
 * 5) KÜTÜK: `docs/DEVICE_VALIDATION_LEDGER.md` içine 🔴 madde açılır, ölçülebilir
 *    kabul ölçütü yazılır; ölçüt gözlendiğinde 🟢'ya taşınır.
 *
 * 6) DAMGA: ANCAK bundan sonra ilgili ECU kaydına `verifiedOn` (gözlem tarihi)
 *    ve `evidence` (ne gözlendi — ham yanıt özeti) yazılır. Damga yazıldığı anda
 *    kayıt ürün yoluna girer; bu yüzden 3. adım atlanamaz.
 * ════════════════════════════════════════════════════════════════════════ */
