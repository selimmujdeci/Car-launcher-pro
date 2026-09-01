/**
 * capabilityContract.ts — **MAVİ F5 · CAPABILITY FABRIC SÖZLEŞMESİ.**
 *
 * ── NE YAPAR ────────────────────────────────────────────────────────────────
 * Mavi'nin CarOS'ta "ne yapabileceğini" TİPLİ ve SINIRLI biçimde tanımlar.
 * Bu dosya **yalnız sözleşmedir**: katalog `carosCapabilityCatalog`, çözümleme
 * `capabilityResolver`, çalışma zamanı `capabilityFabric` dosyalarındadır.
 *
 * ── ÜÇ AYRI KAVRAM (F5'in en kritik ayrımı) ─────────────────────────────────
 *   **AVAILABILITY** ≠ **PERMISSION** ≠ **AUTHORITY**
 *   · Availability: cihaz/araç bunu FİZİKSEL olarak yapabiliyor mu
 *     (`capabilityRegistry` — kanıta dayalı, `unknown` ≠ available).
 *   · Permission: bu kurulumda/politikada Mavi'ye AÇIK mı (katalog + şalter).
 *   · Authority: bu turda GERÇEKTEN yürütme yetkisi var mı — bu kararı
 *     **YALNIZ** kanonik zincir verir (`maviActionAuthority` → `AiSafetyGate` →
 *     onay → `dispatchIntent`). Fabric bu zinciri ASLA ezmez, ATLAMAZ, taklit
 *     ETMEZ; yalnız KONTROLLÜ GİRİŞ KAPISIDIR.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** hiçbir modülü import ETMEZ · I/O · timer · `Date.now` · global
 *    durum YOK. Yalnız tip ve bounded enum taşır.
 *  · **LLM ÇIKTISI OTORİTE DEĞİLDİR.** `CapabilityActionRequest` bir ÖNERİDİR
 *    (`provenance` alanı bunu tip düzeyinde taşır); doğrulanmadan yürütülemez.
 *  · **BOUNDED:** her hata ve her gözlem seviyesi kapalı bir kümedir. Serbest
 *    hata metni authority kararında KULLANILMAZ.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Alan adları ve sınıflar
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Capability alanı. `capabilityRegistry.CapabilityDomain` ile bilinçli olarak
 * ÖRTÜŞÜR ama ONA EŞİT DEĞİLDİR: registry "cihazda ne VAR" (donanım/servis),
 * bu katman "Mavi ne YAPABİLİR" (işlem) sorusunu yanıtlar. İkisi ayrı eksendir;
 * birleştirmek registry'yi ikinci bir eylem defterine çevirirdi (yasak).
 */
export type FabricDomain =
  | 'navigation'
  | 'media'
  | 'settings'
  | 'vehicle'
  | 'diagnostics'
  | 'phone'
  | 'surface';

/**
 * Güvenlik sınıfı — **kanonik güvenlik kararının yerine GEÇMEZ**, yalnız
 * projeksiyon/telemetri için bounded etikettir. Gerçek karar `AiSafetyGate` +
 * `maviActionAuthority`ye aittir.
 */
export type CapabilitySafetyClass =
  /** Salt-okunur bilgi; araca/dünyaya etkisi yok. */
  | 'informational'
  /** Yalnız ekran/panel açar; geri alınabilir, dış etki yok. */
  | 'ui_surface'
  /** Rota/hedef değiştirir; sürücü dikkatini etkiler. */
  | 'navigation'
  /** Ses/medya durumunu değiştirir. */
  | 'media'
  /** Dış dünyaya ulaşır (arama başlatır) — geri alınamaz. */
  | 'communication'
  /** Araçtan OKUR (ECU sorgusu). */
  | 'vehicle_read'
  /** Araca YAZAR (DTC silme vb.) — en yüksek sınıf. */
  | 'vehicle_write'
  /** Sistem/cihaz ayarını değiştirir. */
  | 'system_setting';

/** Parametre tipleri — `ai/tools/toolTypes.ToolParamType` ile HİZALI (kopya değil, aynı küme). */
export type CapabilityParamType = 'string' | 'number' | 'boolean' | 'enum';

export interface CapabilityParamSchema {
  readonly type: CapabilityParamType;
  /** İnsan-okur açıklama — LLM projeksiyonunda kullanılır. */
  readonly description: string;
  readonly required?: boolean;
  /** `enum` için izinli değerler (ALLOWLIST). */
  readonly values?: readonly string[];
  /** `string` için azami uzunluk (bounded girdi). */
  readonly maxLength?: number;
  /** `number` için sınırlar. */
  readonly min?: number;
  readonly max?: number;
}

export type CapabilityParams = Readonly<Record<string, CapabilityParamSchema>>;

/** Doğrulanmış parametre değerleri — yalnız ilkel tipler. */
export type CapabilityArguments = Readonly<Record<string, string | number | boolean>>;

/* ══════════════════════════════════════════════════════════════════════════
 * Gözlem (observation) sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir eylemin ne kadar KANITLANDIĞI. Sıralıdır: her seviye bir öncekini içerir.
 *
 * **"Yaptım" DENEBİLECEK tek seviye `EXECUTED` ve `OBSERVED`tir.**
 * `REQUESTED`/`ACCEPTED`/`UNKNOWN` bir başarı iddiası DEĞİLDİR — bu ayrım
 * `intentExecutionResult`ün "intent seçildi ≠ eylem başladı ≠ eylem tamamlandı"
 * sözleşmesinin capability düzeyindeki karşılığıdır (paralel sistem DEĞİL).
 */
export type CapabilityObservation =
  /** İstek üretildi; henüz hiçbir yürütücüye ulaşmadı. */
  | 'REQUESTED'
  /** Kapılardan geçti ve yürütücüye teslim edildi; sonuç bilinmiyor. */
  | 'ACCEPTED'
  /** Yürütücü BAŞARI KANITI döndürdü. */
  | 'EXECUTED'
  /** Sonuç bağımsız bir gerçeklik kaynağından DOĞRULANDI (ör. playbackTruth). */
  | 'OBSERVED'
  /** Yürütücü hata/ret döndürdü. */
  | 'FAILED'
  /** Çağrıldı ama sonuç doğrulanamadı (fire-and-forget, boş dönüş). */
  | 'UNKNOWN'
  /** Kullanıcı/tur iptali. */
  | 'CANCELLED';

/**
 * Bir işlemin ULAŞABİLECEĞİ EN ÜST gözlem seviyesi. Dürüstlük alanıdır:
 * `ACCEPTED` tavanı olan bir işlem için sistem ASLA "doğrulandı" diyemez.
 */
export type ObservationCeiling = Extract<
  CapabilityObservation, 'ACCEPTED' | 'EXECUTED' | 'OBSERVED'
>;

/** Gözlem seviyesi bir BAŞARI İDDİASI taşıyor mu ("yaptım" denebilir mi). */
export function isSuccessObservation(o: CapabilityObservation): boolean {
  return o === 'EXECUTED' || o === 'OBSERVED';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Hata taksonomisi — BOUNDED
 * ════════════════════════════════════════════════════════════════════════ */

export type CapabilityFailure =
  /** Katalogda böyle bir capability/operation yok. */
  | 'CAPABILITY_NOT_FOUND'
  /** Cihaz/araç bunu yapamıyor (registry KANITLI olumsuz). */
  | 'UNAVAILABLE'
  /** Parametre şeması düştü (eksik/tip/sınır/enum). */
  | 'INVALID_ARGUMENT'
  /** Bu kurulumda Mavi'ye kapalı. */
  | 'PERMISSION_DENIED'
  /** Açık kullanıcı onayı gerekiyor — yürütülmedi. */
  | 'CONFIRMATION_REQUIRED'
  /** Güvenlik/politika reddi (hareket hâli, güvenlik kapsamı). */
  | 'SAFETY_BLOCKED'
  /** Yürütücü hata döndürdü. */
  | 'EXECUTION_FAILED'
  /** Yürütüldü ama sonuç doğrulanamadı. */
  | 'OBSERVATION_UNKNOWN'
  | 'TIMEOUT'
  | 'CANCELLED';

/* ══════════════════════════════════════════════════════════════════════════
 * Yönlendirme (route) — gözlemlenebilirlik için
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Bir eylemin HANGİ yoldan geçtiği. F5'in ölçülebilir çıktısıdır: eski yol
 * silinmez, ama hangi eylemin yeni yoldan geçtiği SAYILABİLİR olur.
 */
export type CapabilityRoute =
  /** Katalogdan çözüldü ve tipli doğrulamadan geçti. */
  | 'CAPABILITY'
  /** Katalogda yok ya da çözülemedi → bugünkü eski yol AYNEN çalıştı. */
  | 'LEGACY_FALLBACK';

/* ══════════════════════════════════════════════════════════════════════════
 * Katalog tanımı
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Tek bir işlem (capability + operation). Katalog bunlardan oluşur.
 *
 * **`legacyIntent` NEDEN VAR:** F5 yeni bir yürütücü KURMAZ (§6/§7). Fabric
 * yalnız çözer ve doğrular; yürütmeyi kanonik `dispatchIntent` yapar. Bu alan
 * o köprüdür — capability yolu ile eski yolun AYNI yürütücüye çıkmasını ve
 * ikinci bir gerçeklik kaynağı doğmamasını garanti eder.
 */
export interface CapabilityOperationDef {
  /** `alan.nesne` biçiminde kararlı kimlik (ör. `navigation.route`). */
  readonly capabilityId: string;
  /** Bu capability üzerindeki işlem adı (ör. `start`). */
  readonly operation: string;
  /** Sözleşme sürümü — imza değişirse ARTAR (tüketici eskimeyi görebilsin). */
  readonly version: number;
  readonly domain: FabricDomain;
  /** LLM projeksiyonunda görünen kısa açıklama. */
  readonly description: string;
  readonly parameters: CapabilityParams;
  readonly safetyClass: CapabilitySafetyClass;
  /**
   * Açık kullanıcı onayı gerekiyor mu. **Bilgilendirmedir, kapı DEĞİLDİR:**
   * gerçek onay kararını `maviActionAuthority` verir. İkisi çelişirse
   * KANONİK olan kazanır (kilitli).
   */
  readonly requiresConfirmation: boolean;
  /** Yürütme başladıktan sonra iptal edilebilir mi. */
  readonly cancellable: boolean;
  /** Bu işlemin ulaşabileceği EN ÜST gözlem seviyesi (dürüstlük tavanı). */
  readonly observationCeiling: ObservationCeiling;
  /**
   * `capabilityRegistry` kimlikleri — availability KANITI buradan okunur.
   * Boş dizi = bu işlem donanım kanıtı GEREKTİRMEZ (platform işlemi).
   * Uydurma bağ KURULMAZ: emin olunmayan işlem boş bırakılır ve borç yazılır.
   */
  readonly requiredCapabilities: readonly string[];
  /**
   * Kanonik yürütücüye köprü. `null` → bu işlem HENÜZ capability yolundan
   * yürütülemez (yalnız keşif/projeksiyon için tanımlıdır).
   */
  readonly legacyIntent: string | null;
  /**
   * **YÜRÜTÜCÜ GERÇEĞİNİ AYNALAYAN alan takma adları.** `fromSemanticResult`
   * bazı alanlar için sessiz bir yedeğe düşer (ör. `OPEN_APP` için
   * `appName ?? query`). Katalog bu yedeği BİLMEZSE, kapı yürütücünün SORUNSUZ
   * çalıştıracağı bir öneriyi `INVALID_ARGUMENT` sayar → zorlayıcı kipte
   * ÇALIŞAN bir komut ölür. Katalog idealize edilmiş bir sözleşme değil,
   * yürütücünün GERÇEK sözleşmesidir.
   */
  readonly parameterAliases?: Readonly<Record<string, readonly string[]>>;
  /**
   * Mavi'nin beynine (LLM) AÇIK mı. `false` → keşfedilebilir ama ÖNERİLEMEZ
   * (ör. DTC silme: registry'de görünür, availability olabilir, ama Mavi'nin
   * teklif etme yetkisi YOKTUR — availability ≠ permission).
   */
  readonly exposedToBrain: boolean;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Eylem isteği (LLM önerisi) ve çözümleme sonucu
 * ════════════════════════════════════════════════════════════════════════ */

/** Bir eylem isteğinin KAYNAĞI. Tip düzeyinde otorite ayrımı taşır. */
export type CapabilityProvenance =
  /** LLM önerisi — **otorite DEĞİL**, doğrulanmadan yürütülemez. */
  | 'llm_proposal'
  /** Cihaz-içi deterministik ayrıştırıcı. */
  | 'local_parser'
  /** Kullanıcının doğrudan dokunuşu (UI). */
  | 'user_direct';

/** Onay durumu — istekle birlikte taşınır. */
export type ConfirmationState = 'not_required' | 'pending' | 'confirmed';

/** Kanonik eylem isteği (§4). LLM bu alanları üretse bile AUTHORITY KAZANMAZ. */
export interface CapabilityActionRequest {
  readonly capabilityId: string;
  readonly operation: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  /** 0..1 — çözümleme güveni. Sınır dışı değer `INVALID_ARGUMENT` üretir. */
  readonly confidence: number;
  readonly provenance: CapabilityProvenance;
  readonly confirmationState: ConfirmationState;
}

/** Çözümleme sonucu — SAF VERİ. */
export type CapabilityResolution =
  | {
      readonly ok: true;
      readonly def: CapabilityOperationDef;
      /** Şemadan geçmiş, tipi daraltılmış parametreler. */
      readonly args: CapabilityArguments;
      readonly route: 'CAPABILITY';
    }
  | {
      readonly ok: false;
      readonly failure: CapabilityFailure;
      /** Makine-okur gerekçe kodu — kullanıcıya GÖSTERİLMEZ, PII TAŞIMAZ. */
      readonly reason: string;
      readonly route: CapabilityRoute;
    };

/* ══════════════════════════════════════════════════════════════════════════
 * Availability kanıtı
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * `capabilityRegistry`den okunan availability kanıtının BOUNDED özeti.
 *
 * **POLİTİKA (bilinçli ve kilitli):** yalnız **KANITLI OLUMSUZ** sonuç yolu
 * kapatır. `UNKNOWN` kapatmaz — registry'nin henüz kanıt toplamamış olması
 * bir yeteneğin yokluğu DEĞİLDİR ve bugünkü çalışan davranışı kırmak
 * (fail-closed) kullanıcı için gerçek bir regresyon olurdu. Bu, registry'nin
 * kendi "`unknown` ≠ available" ilkesiyle çelişmez: registry `available`
 * DEMİYOR, biz de `available` DEMİYORUZ — yalnız eski yolu engellemiyoruz ve
 * bunu `UNKNOWN` olarak DÜRÜSTÇE bildiriyoruz.
 */
export type AvailabilityEvidence =
  /** Registry KANITLA available diyor. */
  | 'AVAILABLE'
  /** Registry KANITLA olumsuz (unavailable/unsupported/restricted) → yol kapanır. */
  | 'UNAVAILABLE'
  /** Kanıt yok / bayat / registry okunamadı → yol KAPANMAZ, dürüstçe bildirilir. */
  | 'UNKNOWN';
