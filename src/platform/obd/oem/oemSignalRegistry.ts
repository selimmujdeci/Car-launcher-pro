/**
 * oemSignalRegistry — OEM DISCOVERY FAZ 1 · SİNYAL DEFTERİ (SAF VERİ).
 *
 * `oemEcuProfile` / `oemProfileRegistry` ikilisiyle AYNI ayrım: sözleşme + doğrulayıcı
 * `oemSignalCatalog.ts`te, VERİ burada.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DEFTER ŞU AN NE İÇERİYOR (dürüst durum) ────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Faz 1 önceliği olan motor/dizel sinyallerinin ANLAM kimlikleri tanımlıdır.
 * Hiçbirinin hex kimliği (`identifier`) BU ÜRÜNDE KANITLANMADI — hepsi
 * `'UNKNOWN'`. Sebep, repo forensic'inde ölçüldü:
 *
 *   · `profiles/renaultDaciaProfile.ts`   → yalnız ISO 14229 kimlik DID'leri (F190/F187/F18C)
 *   · `profiles/renaultTraficKwpProfile.ts` → aynı; Renault Servis 21 LID haritası DDT2000
 *     telifidir, kopyalanamaz
 *   · `profiles/renaultZoePh2Profile.ts`  → OVMS3 (MIT) kaynaklı GERÇEK DID'ler var ama
 *     araç ELEKTRİKLİ: DPF/turbo/rail/enjeksiyon karşılığı YOKTUR
 *   · `oemProfileRegistry` → `getProductOemProfiles()` şu an BOŞ döner (doğrulanmış ECU yok)
 *
 * Yani DPF/turbo/rail için elimizde tek bir doğrulanabilir hex kimlik yok. UYDURULMADI.
 * `identifier: 'UNKNOWN'` olan kayıt `isOemSignalProbeable()` kapısından geçmez → araca
 * TEK BAYT gönderilmez. Defterin bugünkü işlevi: hedefi, birimi, fiziksel makullük bandını
 * ve ECU rolünü SABİTLEMEK; sahada kimlik bulununca yalnız 3 alan dolar
 * (`identifier` · `service`/`addressing` · `decode`/`bytes` + `identifierEvidence`).
 *
 * ── MAKULLÜK BANDI NEDEN ŞİMDİ DOLU ───────────────────────────────────────
 * Band FİZİKTİR, marka iddiası değildir: yalnız değer ELER, asla değer ÜRETMEZ.
 * Kimlik bilinmezken de yazılabilir ve yarın kimlik gelince çözücü çıktısının
 * saçma olup olmadığını ilk günden yakalar.
 */

import type { OemSignalDef } from './oemSignalCatalog';
import { validateOemSignalCatalog, type OemSignalCatalogValidation } from './oemSignalCatalog';
import type { OemProvenance } from './oemEcuProfile';

/* ── Ortak kaynak damgaları ───────────────────────────────────────────────── */

/** Sinyalin TANIMININ kaynağı (hex kimliğin kaynağı DEĞİL — o `identifierEvidence`tedir). */
const DIESEL_CONCEPT_SOURCE: OemProvenance = {
  kind: 'iso_standard',
  source:
    'ISO 14229-1 (ReadDataByIdentifier) + ISO 14230-3 (ReadDataByLocalIdentifier) taşıyıcı ' +
    'sözleşmesi; fiziksel büyüklük tanımları ve makullük bantları genel dizel motor/DPF ' +
    'mühendislik aralıklarıdır — üreticiye özgü hex kimlik İDDİASI İÇERMEZ',
  license: 'ISO standardı — referans; üretici veritabanı kopyası içermez',
};

/** Kimliği henüz kanıtlanmamış her kayıt için TEK boş kanıt damgası. */
const NO_IDENTIFIER_EVIDENCE = { verifiedOn: null, evidence: null } as const;

/**
 * Faz 1 kapsamı: motor ECU'su, CAN ve KWP hatlarının İKİSİ de (Doblo/Trafic sınıfı
 * araçlar KWP; yeni Renault/Dacia CAN). WMI filtresi BOŞ bırakıldı — bu, "her markaya
 * uygula" demek DEĞİLDİR: kimlik zaten UNKNOWN olduğu için hiçbir kayıt sorgulanamaz.
 * Kimlik sahada bulunduğunda WMI listesi O ARAÇLA birlikte doldurulur.
 */
const ENGINE_DIESEL_SCOPE = {
  manufacturer: 'UNKNOWN',
  modelFamily: 'UNKNOWN',
  wmi: [] as readonly string[],
  protocols: ['can', 'kwp'] as const,
} as const;

/** Ortak alanları tekrar yazmamak için küçük kurucu — yeni soyutlama değil, yerel kısaltma. */
function unknownDieselSignal(
  input: Pick<OemSignalDef, 'signalId' | 'name' | 'group' | 'unit' | 'plausibility' | 'standardEquivalent' | 'note'>,
): OemSignalDef {
  return {
    ...input,
    scope: { ...ENGINE_DIESEL_SCOPE, protocols: [...ENGINE_DIESEL_SCOPE.protocols] },
    ecuRole: 'engine',
    service: 'UNKNOWN',
    identifier: 'UNKNOWN',
    addressing: 'UNKNOWN',
    session: 'UNKNOWN',
    decode: null,
    bytes: null,
    provenance: DIESEL_CONCEPT_SOURCE,
    identifierEvidence: NO_IDENTIFIER_EVIDENCE,
    access: 'read_only',
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * DEFTER
 * ════════════════════════════════════════════════════════════════════════ */

export const OEM_SIGNAL_CATALOG: readonly OemSignalDef[] = Object.freeze([
  /* ── DPF ──────────────────────────────────────────────────────────────── */
  unknownDieselSignal({
    signalId: 'DPF_SOOT_LOAD',
    name: 'DPF kurum yükü',
    group: 'dpf',
    unit: '%',
    // Üstü %100'ü aşabilir (zorunlu rejenerasyon eşiği üstü) — 200 tavanı bilinçli geniş.
    plausibility: { min: 0, max: 200 },
    standardEquivalent: null,
    note:
      'Standart OBD-II bu büyüklüğü TAŞIMAZ; yalnız üretici kimliğiyle okunur. Hex kimlik ' +
      'bu üründe kanıtlanmadı — gerçek dizel araçta Servis 22/21 salt-okuma keşfiyle bulunup ' +
      'gösterge/servis aleti değeriyle eşleştirilmeli.',
  }),
  unknownDieselSignal({
    signalId: 'DPF_DIFFERENTIAL_PRESSURE',
    name: 'DPF fark basıncı',
    group: 'dpf',
    unit: 'kPa',
    plausibility: { min: -10, max: 200 },
    standardEquivalent: null,
    note:
      'Kurum yükünün fiziksel göstergesi. Kimlik UNKNOWN; bulunduğunda DPF_SOOT_LOAD ile ' +
      'ÇAPRAZ DOĞRULAMA için kullanılabilir (biri diğerini türetmez — iki ayrı ölçüm).',
  }),
  unknownDieselSignal({
    signalId: 'DPF_INLET_TEMP',
    name: 'DPF giriş sıcaklığı',
    group: 'dpf',
    unit: '°C',
    plausibility: { min: -40, max: 1000 },
    // Standart PID 7C (dpfTempBank1) aynı fiziksel büyüklüğü ZATEN sahiplenir.
    standardEquivalent: 'dpfTempBank1',
    note:
      'SAE J1979 PID 7C (canonicalObdSignals.dpfTempBank1) destekleniyorsa KANONİK SAHİP ODUR; ' +
      'OEM kimliği yalnız standart yol desteklenmediğinde poll edilebilir (çift otorite yasağı).',
  }),
  unknownDieselSignal({
    signalId: 'DPF_OUTLET_TEMP',
    name: 'DPF çıkış sıcaklığı',
    group: 'dpf',
    unit: '°C',
    plausibility: { min: -40, max: 1000 },
    standardEquivalent: 'dpfTempBank1',
    note:
      'Giriş sıcaklığıyla AYNI standart kapı kuralı geçerlidir. Giriş/çıkış ayrımı üreticiye ' +
      'göre değişir; hangi kimliğin hangi uç olduğu SAHADA kanıtlanmadan yazılmaz.',
  }),
  unknownDieselSignal({
    signalId: 'DPF_REGEN_STATUS',
    name: 'DPF rejenerasyon durumu',
    group: 'dpf',
    unit: '',
    // Ham durum baytı; ANLAM haritası (0=yok, 1=aktif…) üreticiye özgüdür ve UYDURULMAZ.
    plausibility: { min: 0, max: 255 },
    standardEquivalent: null,
    note:
      'Ham durum baytıdır. Bayt→anlam haritası (yok/hazırlık/aktif/kesildi) ÜRETİCİYE ÖZGÜDÜR; ' +
      'kanıtsız enum yazmak sahte durum üretmek olurdu. Kimlik bulunsa bile harita ayrı kanıt ister.',
  }),
  unknownDieselSignal({
    signalId: 'DPF_DISTANCE_SINCE_REGEN',
    name: 'Son rejenerasyondan bu yana mesafe',
    group: 'dpf',
    unit: 'km',
    plausibility: { min: 0, max: 20000 },
    standardEquivalent: null,
    note:
      'Rejenerasyon sıklığı teşhisinin ana girdisi. Kimlik UNKNOWN; sahada bulunduğunda ' +
      'odometre ile tutarlılık kontrolü yapılabilir.',
  }),

  /* ── Turbo / dolgu ────────────────────────────────────────────────────── */
  unknownDieselSignal({
    signalId: 'TURBO_BOOST_PRESSURE',
    name: 'Turbo dolgu basıncı',
    group: 'boost',
    unit: 'kPa',
    // Mutlak basınç olarak; atmosfer (~100 kPa) dâhil üst sınır geniş tutuldu.
    plausibility: { min: 0, max: 400 },
    standardEquivalent: null,
    note:
      'Standart PID 0B (manifoldPressure) emme manifoldu MUTLAK basıncıdır ve turbo dolgu ' +
      'basıncıyla AYNI BÜYÜKLÜK DEĞİLDİR — bu yüzden standardEquivalent null bırakıldı ' +
      '(yanlış eşdeğerlik, sessiz çift otoriteden daha tehlikelidir).',
  }),

  /* ── Yakıt ────────────────────────────────────────────────────────────── */
  unknownDieselSignal({
    signalId: 'FUEL_RAIL_PRESSURE_OEM',
    name: 'Yakıt rampası basıncı (üretici)',
    group: 'fuel',
    unit: 'bar',
    plausibility: { min: 0, max: 3000 },
    standardEquivalent: null,
    note:
      'canonicalObdSignals.fuelPressure (PID 0A) DEPO/BESLEME basıncıdır, common-rail basıncı ' +
      'DEĞİLDİR; eşdeğer sayılmadı. Birim bar seçildi (kPa dönüşümü çözücü katsayısında olur).',
  }),
  unknownDieselSignal({
    signalId: 'FUEL_TEMPERATURE_OEM',
    name: 'Yakıt sıcaklığı (üretici)',
    group: 'fuel',
    unit: '°C',
    plausibility: { min: -40, max: 150 },
    standardEquivalent: null,
    note: 'Kimlik UNKNOWN. Sahada bulunduğunda soğuk çalıştırma teşhisinde kullanılır.',
  }),
  unknownDieselSignal({
    signalId: 'INJECTION_QUANTITY',
    name: 'Enjeksiyon miktarı',
    group: 'injection',
    unit: 'mg/str',
    plausibility: { min: 0, max: 200 },
    standardEquivalent: null,
    note: 'Strok başına püskürtülen yakıt. Kimlik UNKNOWN; üreticiye özgüdür.',
  }),

  /* ── Silindir düzeltmeleri ────────────────────────────────────────────── */
  unknownDieselSignal({
    signalId: 'CYLINDER_CORRECTION_CYL1',
    name: 'Silindir 1 yakıt düzeltmesi',
    group: 'injection',
    unit: 'mg/str',
    plausibility: { min: -20, max: 20 },
    standardEquivalent: null,
    note: 'Enjektör dengesizliği teşhisi. Kimlik UNKNOWN; işaretli (signed) çözücü gerektirir.',
  }),
  unknownDieselSignal({
    signalId: 'CYLINDER_CORRECTION_CYL2',
    name: 'Silindir 2 yakıt düzeltmesi',
    group: 'injection',
    unit: 'mg/str',
    plausibility: { min: -20, max: 20 },
    standardEquivalent: null,
    note: 'Enjektör dengesizliği teşhisi. Kimlik UNKNOWN; işaretli (signed) çözücü gerektirir.',
  }),
  unknownDieselSignal({
    signalId: 'CYLINDER_CORRECTION_CYL3',
    name: 'Silindir 3 yakıt düzeltmesi',
    group: 'injection',
    unit: 'mg/str',
    plausibility: { min: -20, max: 20 },
    standardEquivalent: null,
    note: 'Enjektör dengesizliği teşhisi. Kimlik UNKNOWN; işaretli (signed) çözücü gerektirir.',
  }),
  unknownDieselSignal({
    signalId: 'CYLINDER_CORRECTION_CYL4',
    name: 'Silindir 4 yakıt düzeltmesi',
    group: 'injection',
    unit: 'mg/str',
    plausibility: { min: -20, max: 20 },
    standardEquivalent: null,
    note: 'Enjektör dengesizliği teşhisi. Kimlik UNKNOWN; işaretli (signed) çözücü gerektirir.',
  }),
]);

/** Kimlik → tanım (O(1) erişim; LAB ve koordinatör bunu kullanır). */
export const OEM_SIGNAL_BY_ID: ReadonlyMap<string, OemSignalDef> =
  new Map(OEM_SIGNAL_CATALOG.map((d) => [d.signalId, d] as const));

/** Defterin yapısal doğrulaması — kilit testi bunu çağırır. */
export function validateOemSignalRegistry(): OemSignalCatalogValidation {
  return validateOemSignalCatalog(OEM_SIGNAL_CATALOG);
}

/**
 * ══════════════════════════════════════════════════════════════════════════
 * SAHA PROSEDÜRÜ — bir kimlik buraya NASIL yazılır
 * ══════════════════════════════════════════════════════════════════════════
 * 1. Araç DURUYORKEN (`discoverySafetyPolicy.canStartDeepScan` zaten zorlar) salt-okuma
 *    keşfi çalıştırılır; pozitif yanıt veren kimlikler ham hex ile kaydedilir.
 * 2. Ham hex, BİLİNEN bir gösterge/servis aleti değeriyle eşleştirilir (en az iki farklı
 *    çalışma noktasında — tek nokta çözücüyü kanıtlamaz).
 * 3. Gözlem `docs/DEVICE_VALIDATION_LEDGER.md`e yazılır.
 * 4. Ancak bundan SONRA bu dosyada `identifier` · `service` · `addressing` · `decode`/`bytes`
 *    doldurulur ve `identifierEvidence` = { verifiedOn, evidence } yazılır.
 * 5. ECU ADRESİ buraya YAZILMAZ — o `oemProfileRegistry`nin doğrulanmış ECU kaydına gider.
 *
 * Damgayı önce yazıp sonra doğrulamak, tam olarak bu sözleşmenin engellediği şeydir.
 */
