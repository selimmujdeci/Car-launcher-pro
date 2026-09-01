/**
 * carosCapabilityCatalog.ts — **MAVİ F5 · CarOS İŞLEM KATALOĞU (TEK KAYNAK).**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Denetim (2026-08-29) Mavi'nin "ne yapabilirim" bilgisinin **ÜÇ ayrı sabit
 * listede** tutulduğunu ve üçünün de BİRBİRİNDEN FARKLI olduğunu ölçtü:
 *   · `companionChatProvider.BRAIN_INTENTS`   → 29 intent (canlı yol)
 *   · `ai/semanticAiService.VALID_INTENTS`    → 29 intent (5'i beyinde var, burada YOK)
 *   · `aiVoiceService.VALID_INTENTS`          → 26 intent (8'i beyinde var, burada YOK)
 * Bu dosya o üç listenin TEK KAYNAĞIDIR: prompt listesi buradan TÜRETİLİR,
 * elle yazılmaz.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** yalnız `capabilityContract` TİPLERİNİ import eder; I/O · timer ·
 *    `Date.now` · global durum · React YOK.
 *  · **YENİ YÜRÜTÜCÜ YOK.** Her giriş `legacyIntent` ile kanonik
 *    `commandExecutor.dispatchIntent`e köprülenir → ikinci gerçeklik kaynağı
 *    DOĞMAZ (F5 §6/§7).
 *  · **UYDURMA YOK.** `requiredCapabilities` yalnız `capabilityRegistry`de
 *    GERÇEKTEN bulunan kimliklerle doldurulur; emin olunmayan işlem BOŞ bırakılır
 *    ve kütüğe borç yazılır (sahte kapı, kapı olmamasından daha tehlikelidir).
 *  · **`observationCeiling` DÜRÜSTLÜK ALANIDIR.** Yürütücü kanıt döndürmüyorsa
 *    tavan `ACCEPTED`tir ve sistem o işlem için ASLA "doğrulandı" diyemez.
 */

import type {
  CapabilityOperationDef, CapabilityParams,
} from './capabilityContract';

/* ── Sık kullanılan parametre şemaları ──────────────────────────────────── */

const NO_PARAMS: CapabilityParams = Object.freeze({});

const QUERY_PARAM = Object.freeze({
  type: 'string' as const,
  description: 'Aranacak terim (normalize edilmiş).',
  required: true,
  maxLength: 120,
});

/**
 * POI kategorileri — `ai/semanticAiService.PoiCategory` birliğiyle BİREBİR aynı
 * küme. Ayrışırlarsa kilit testi düşer (kopya sessizce kaymasın).
 */
export const POI_CATEGORIES: readonly string[] = Object.freeze([
  'RESTAURANT', 'CAFE', 'FAST_FOOD', 'BAKERY',
  'GAS_STATION', 'PARKING', 'CAR_WASH', 'MECHANIC',
  'HOSPITAL', 'PHARMACY', 'CLINIC',
  'HOTEL', 'MOTEL',
  'SHOPPING', 'SUPERMARKET', 'ATM', 'BANK',
  'GENERAL',
]);

/* ══════════════════════════════════════════════════════════════════════════
 * KATALOG
 * ════════════════════════════════════════════════════════════════════════ */

export const CAROS_CAPABILITY_CATALOG: readonly CapabilityOperationDef[] = Object.freeze([

  /* ── NAVİGASYON ────────────────────────────────────────────────────────
   * Availability `navigation.gps`e bağlıdır: GPS'i KANITLA olmayan cihazda
   * rota başlatmak sahte bir vaattir. Kanıt YOKSA (unknown) yol KAPANMAZ. */
  Object.freeze({
    capabilityId: 'navigation.route', operation: 'start', version: 1,
    domain: 'navigation',
    description: 'Haritayı açar ve verilen hedefe rota kurar. Hedef verilmezse yalnız haritayı açar.',
    parameters: Object.freeze({
      destination: Object.freeze({
        type: 'string', description: 'Hedef adı ya da "home"/"work".',
        required: false, maxLength: 160,
      }),
    }),
    safetyClass: 'navigation', requiresConfirmation: false, cancellable: true,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze(['navigation.gps']),
    legacyIntent: 'OPEN_NAVIGATION', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'navigation.route', operation: 'startAddress', version: 1,
    domain: 'navigation',
    description: 'Açık bir adres metnine rota kurar.',
    /* `destination` ZORUNLU DEĞİL: kanonik yürütücü adres yoksa haritayı açar
       (`else ctx.launch(ctx.defaultNav)`). Zorunlu işaretlemek, yürütücünün
       sorunsuz çalıştıracağı bir öneriyi kapıda öldürürdü. */
    parameters: Object.freeze({
      destination: Object.freeze({
        type: 'string', description: 'Tam adres metni.', required: false, maxLength: 200,
      }),
    }),
    safetyClass: 'navigation', requiresConfirmation: false, cancellable: true,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze(['navigation.gps']),
    legacyIntent: 'NAVIGATE_ADDRESS', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'navigation.poi', operation: 'search', version: 1,
    domain: 'navigation',
    description: 'Yakında bir kategori ya da terim için yer arar.',
    /* `query` ZORUNLU DEĞİL: yürütücü terim yoksa "yakın yer" araması yapar
       ve beyin kategori tek başına da dönebilir. */
    parameters: Object.freeze({
      query: Object.freeze({ ...QUERY_PARAM, required: false }),
      category: Object.freeze({
        type: 'enum', description: 'POI kategorisi.', required: false, values: POI_CATEGORIES,
      }),
    }),
    safetyClass: 'navigation', requiresConfirmation: false, cancellable: true,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze(['navigation.gps']),
    legacyIntent: 'SEARCH_POI', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'navigation.poi', operation: 'findGasStation', version: 1,
    domain: 'navigation', description: 'Yakındaki benzinlikleri arar.',
    parameters: NO_PARAMS,
    safetyClass: 'navigation', requiresConfirmation: false, cancellable: true,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze(['navigation.gps']),
    legacyIntent: 'FIND_NEARBY_GAS', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'navigation.poi', operation: 'findParking', version: 1,
    domain: 'navigation', description: 'Yakındaki otoparkları arar.',
    parameters: NO_PARAMS,
    safetyClass: 'navigation', requiresConfirmation: false, cancellable: true,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze(['navigation.gps']),
    legacyIntent: 'FIND_NEARBY_PARKING', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'navigation.poi', operation: 'findRestArea', version: 1,
    domain: 'navigation', description: 'Yakındaki dinlenme tesislerini arar.',
    parameters: NO_PARAMS,
    safetyClass: 'navigation', requiresConfirmation: false, cancellable: true,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze(['navigation.gps']),
    legacyIntent: 'FIND_NEARBY_REST_AREA', exposedToBrain: true,
  }),

  /* ── MEDYA ─────────────────────────────────────────────────────────────
   * Availability kaydı YOK: medya yürütücüsü platform içidir ve
   * `capabilityRegistry`de karşılığı olan bir kimlik BULUNMUYOR. Uydurma
   * bağ kurulmadı — borç kütüğe yazıldı.
   *
   * MAVI-F7 · TAVAN YÜKSELTMESİ: transport işlemleri (`resume`/`pause`/`next`/
   * `previous`) artık `playbackTruth` üzerinden GERÇEK kanıt üretebiliyor
   * (`mediaCommandGateway` → `CommandTruth.outcome`). Tavan bir GARANTİ değil
   * bir ÜST SINIRDIR: kanıt gelmediğinde seviye yine `ACCEPTED` kalır. Arama
   * (`searchAndPlay`) ve uygulama açma (`media.app#open`) bu kanıtı
   * ÜRETMEDİĞİ için `ACCEPTED` tavanında BIRAKILDI — sahte yükseltme YOK. */
  Object.freeze({
    capabilityId: 'media.playback', operation: 'searchAndPlay', version: 1,
    domain: 'media', description: 'Verilen sanatçı/şarkı için müzik arar ve çalar.',
    /* `query` ZORUNLU DEĞİL: `fromSemanticResult` boş sorguya izin verir
       (`result.query ?? ''`) ve yürütücü o hâlde müzik çaları açar. */
    parameters: Object.freeze({ query: Object.freeze({ ...QUERY_PARAM, required: false }) }),
    safetyClass: 'media', requiresConfirmation: false, cancellable: true,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'PLAY_MUSIC_SEARCH', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'media.playback', operation: 'resume', version: 1,
    domain: 'media', description: 'Duraklatılmış medyayı devam ettirir.',
    parameters: NO_PARAMS,
    safetyClass: 'media', requiresConfirmation: false, cancellable: false,
    /* `playbackTruth` VERIFIED derse OBSERVED; demezse ACCEPTED kalır. */
    observationCeiling: 'OBSERVED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'PLAY_MEDIA', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'media.playback', operation: 'pause', version: 1,
    domain: 'media', description: 'Çalan medyayı duraklatır.',
    parameters: NO_PARAMS,
    safetyClass: 'media', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'OBSERVED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'PAUSE_MEDIA', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'media.playback', operation: 'next', version: 1,
    domain: 'media', description: 'Sonraki parçaya geçer.',
    parameters: NO_PARAMS,
    safetyClass: 'media', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'OBSERVED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'MEDIA_NEXT', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'media.playback', operation: 'previous', version: 1,
    domain: 'media', description: 'Önceki parçaya döner.',
    parameters: NO_PARAMS,
    safetyClass: 'media', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'OBSERVED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'MEDIA_PREV', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'media.volume', operation: 'increase', version: 1,
    domain: 'media', description: 'Sesi artırır.',
    parameters: NO_PARAMS,
    safetyClass: 'media', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'VOLUME_UP', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'media.volume', operation: 'decrease', version: 1,
    domain: 'media', description: 'Sesi azaltır.',
    parameters: NO_PARAMS,
    safetyClass: 'media', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'VOLUME_DOWN', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'media.app', operation: 'open', version: 1,
    domain: 'media', description: 'Müzik çaları açar.',
    parameters: NO_PARAMS,
    safetyClass: 'ui_surface', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'OPEN_MUSIC', exposedToBrain: true,
  }),

  /* ── AYARLAR ───────────────────────────────────────────────────────────
   * MAVI-F7 · F5 BORCU KAPANDI: `ctx.applySetting` portu artık KANIT döner
   * (`SettingApplyEvidence`). Depoya yazılıp **geri okunan** ayar bağımsız bir
   * gözlemdir → tavan `OBSERVED`. Tavan yükseldi diye her ayar doğrulanmış
   * SAYILMAZ: WiFi/Bluetooth native köprüsü kanıt döndürmediği için
   * `DELIVERED` (→ `ACCEPTED`), yalnız sekme açan ayarlar `SURFACE_OPENED`
   * (→ `ACCEPTED`), port hiç bağlı değilse `FAILED` olur. */
  Object.freeze({
    capabilityId: 'settings.value', operation: 'set', version: 1,
    domain: 'settings',
    description: 'Bir cihaz ayarını değiştirir (parlaklık, wifi, bluetooth, ses).',
    parameters: Object.freeze({
      settingKey: Object.freeze({
        type: 'string', description: 'Ayar anahtarı (brightness · wifi · bluetooth · volume).',
        required: true, maxLength: 40,
      }),
      settingAction: Object.freeze({
        type: 'enum', description: 'Uygulanacak işlem.',
        required: true, values: Object.freeze(['on', 'off', 'inc', 'dec', 'set', 'toggle', 'open']),
      }),
      settingKind: Object.freeze({
        type: 'enum', description: 'Ayarın türü.',
        required: false, values: Object.freeze(['bool', 'enum', 'number', 'openTab']),
      }),
      settingValue: Object.freeze({
        type: 'string', description: 'Hedef değer (enum adı ya da yüzde).',
        required: false, maxLength: 40,
      }),
    }),
    safetyClass: 'system_setting', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'OBSERVED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'SET_SETTING', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'settings.theme', operation: 'cycle', version: 1,
    domain: 'settings', description: 'Bir sonraki temaya geçer.',
    parameters: NO_PARAMS,
    safetyClass: 'system_setting', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'CYCLE_THEME', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'settings.theme', operation: 'enableNightMode', version: 1,
    domain: 'settings', description: 'Gece modunu açar.',
    parameters: NO_PARAMS,
    safetyClass: 'system_setting', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'ENABLE_NIGHT_MODE', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'settings.surface', operation: 'open', version: 1,
    domain: 'settings', description: 'Ayarlar ekranını açar.',
    parameters: NO_PARAMS,
    safetyClass: 'ui_surface', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'OPEN_SETTINGS', exposedToBrain: true,
  }),

  /* ── ARAÇ (SALT-OKUNUR) ────────────────────────────────────────────────
   * Availability GERÇEKTEN bağlıdır: OBD kanıtla yoksa sensör sorgusu
   * kullanıcıya sahte bir bekleyiş yaratır. `QUERY_SENSOR` yürütücüsü GERÇEK
   * değeri okur ve döndürür → tavanı `OBSERVED`tir (kataloğun en yüksek
   * dürüstlük seviyesi). */
  Object.freeze({
    capabilityId: 'vehicle.sensor', operation: 'query', version: 1,
    domain: 'vehicle',
    description: 'Araçtan tek bir sensör değeri okur (motor suyu, yağ, akü, şasi no).',
    parameters: Object.freeze({
      sensorQuery: Object.freeze({
        type: 'string', description: 'Sorulan sensörün adı.', required: true, maxLength: 80,
      }),
    }),
    /* Yürütücü gerçeği: `sensorQuery ?? query ?? sourceText`. */
    parameterAliases: Object.freeze({ sensorQuery: Object.freeze(['query']) }),
    safetyClass: 'vehicle_read', requiresConfirmation: false, cancellable: true,
    observationCeiling: 'OBSERVED',
    requiredCapabilities: Object.freeze(['vehicle.obd', 'vehicle.live_pid']),
    legacyIntent: 'QUERY_SENSOR', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'vehicle.health', operation: 'check', version: 1,
    domain: 'vehicle', description: 'Aracın genel sağlık özetini üretir.',
    parameters: NO_PARAMS,
    safetyClass: 'vehicle_read', requiresConfirmation: false, cancellable: true,
    observationCeiling: 'OBSERVED',
    requiredCapabilities: Object.freeze(['vehicle.obd']),
    legacyIntent: 'CHECK_VEHICLE_HEALTH', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'vehicle.maintenance', operation: 'check', version: 1,
    domain: 'vehicle', description: 'Yaklaşan bakım durumunu bildirir.',
    parameters: NO_PARAMS,
    safetyClass: 'informational', requiresConfirmation: false, cancellable: true,
    observationCeiling: 'EXECUTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'CHECK_MAINTENANCE', exposedToBrain: true,
  }),

  /* ── TANILAMA (ARACA YAZAR) ────────────────────────────────────────────
   * **AVAILABILITY ≠ PERMISSION ≠ AUTHORITY'nin CANLI ÖRNEĞİ.**
   * Bu işlem katalogda GÖRÜNÜR ve availability'si AVAILABLE olabilir; buna
   * rağmen `exposedToBrain:false`tur → Mavi bunu ÖNEREMEZ. Önerse bile
   * `maviActionAuthority` açık onay ister. Üç kapı da AYRIDIR. */
  Object.freeze({
    capabilityId: 'diagnostics.dtc', operation: 'clear', version: 1,
    domain: 'diagnostics',
    description: 'Araçtaki arıza kayıtlarını siler. Geri alınamaz.',
    parameters: NO_PARAMS,
    safetyClass: 'vehicle_write', requiresConfirmation: true, cancellable: false,
    observationCeiling: 'OBSERVED',
    requiredCapabilities: Object.freeze(['vehicle.obd']),
    legacyIntent: 'CLEAR_DTC_CODES', exposedToBrain: false,
  }),

  /* ── TELEFON ───────────────────────────────────────────────────────────
   * Availability BİLİNÇLİ olarak BOŞ: arama hem hücresel hem Bluetooth HFP
   * üzerinden kurulabilir ve `capabilityRegistry`de bu ayrımı KANITLAYAN bir
   * kimlik YOK. `device.cellular`a bağlamak HFP ile arayan aracı yanlışlıkla
   * kapatırdı → sahte kapı kurulmadı, borç yazıldı. */
  Object.freeze({
    capabilityId: 'phone.call', operation: 'start', version: 1,
    domain: 'phone',
    description: 'Rehberdeki bir kişiyi arar. Ad verilmezse telefon uygulamasını açar.',
    parameters: Object.freeze({
      contactName: Object.freeze({
        type: 'string', description: 'Aranacak kişinin adı.', required: false, maxLength: 80,
      }),
    }),
    safetyClass: 'communication', requiresConfirmation: true, cancellable: true,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'OPEN_PHONE', exposedToBrain: true,
  }),

  /* ── YÜZEY (uygulama / iç ekran) ───────────────────────────────────────── */
  Object.freeze({
    capabilityId: 'surface.app', operation: 'open', version: 1,
    domain: 'surface', description: 'Yüklü bir Android uygulamasını adıyla açar.',
    parameters: Object.freeze({
      appName: Object.freeze({
        type: 'string', description: 'Uygulamanın görünen adı.', required: true, maxLength: 80,
      }),
    }),
    /* Yürütücü gerçeği: `appName ?? query`. */
    parameterAliases: Object.freeze({ appName: Object.freeze(['query']) }),
    safetyClass: 'ui_surface', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'OPEN_APP', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'surface.screen', operation: 'open', version: 1,
    domain: 'surface', description: 'CarOS iç ekranını/panelini açar veya kapatır.',
    parameters: Object.freeze({
      screen: Object.freeze({
        type: 'string', description: 'İç ekran adı.', required: true, maxLength: 60,
      }),
      screenAction: Object.freeze({
        type: 'enum', description: 'Aç ya da kapat.',
        required: false, values: Object.freeze(['open', 'close']),
      }),
    }),
    /* Yürütücü gerçeği: `screen ?? query` (ve `screenAction ?? 'open'`). */
    parameterAliases: Object.freeze({ screen: Object.freeze(['query']) }),
    safetyClass: 'ui_surface', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'OPEN_SCREEN', exposedToBrain: true,
  }),
  Object.freeze({
    capabilityId: 'surface.favorites', operation: 'open', version: 1,
    domain: 'surface', description: 'Favoriler ekranını açar.',
    parameters: NO_PARAMS,
    safetyClass: 'ui_surface', requiresConfirmation: false, cancellable: false,
    observationCeiling: 'ACCEPTED',
    requiredCapabilities: Object.freeze([]),
    legacyIntent: 'OPEN_FAVORITES', exposedToBrain: true,
  }),
]) as readonly CapabilityOperationDef[];

/* ══════════════════════════════════════════════════════════════════════════
 * Türetilmiş görünümler — **elle liste YAZILMAZ**
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Beyne (LLM) açık intent adları. `companionChatProvider.BRAIN_INTENTS` bu
 * fonksiyondan TÜRETİLİR — sabit liste artık YAZILMAZ.
 *
 * NOT: katalog HENÜZ tüm eski intentleri kapsamaz (REMEMBER · FORGET ·
 * SHOW_WEATHER · ENABLE_DRIVING_MODE · TOGGLE_SLEEP_MODE …). Onlar prompt'ta
 * eski yolla kalır ve `LEGACY_FALLBACK` sayılır — kapsam DÜRÜSTÇE ölçülür,
 * sessizce kaybedilmez.
 */
export function brainExposedIntents(): readonly string[] {
  const out: string[] = [];
  for (const d of CAROS_CAPABILITY_CATALOG) {
    if (!d.exposedToBrain || d.legacyIntent === null) continue;
    if (!out.includes(d.legacyIntent)) out.push(d.legacyIntent);
  }
  return Object.freeze(out);
}

/**
 * Capability kataloğunda HENÜZ karşılığı olmayan ama beynin üretebildiği
 * intentler. **AÇIKÇA listelenir** ki "kapsam dışı" ile "unutulmuş" ayrımı
 * görünür kalsın: bunlar `LEGACY_FALLBACK` sayılır ve eski yol AYNEN çalışır.
 *
 * Buradan bir ad silinirse Mavi o komutu üretemez hâle gelir — bu yüzden liste
 * kapsam kilidiyle korunur (`capabilityFabric.test` #35).
 */
export const LEGACY_ONLY_BRAIN_INTENTS: readonly string[] = Object.freeze([
  'SHOW_WEATHER',
  'ENABLE_DRIVING_MODE',
  'TOGGLE_SLEEP_MODE',
  'REMEMBER',
  'FORGET',
]);

/**
 * **Beynin üretebileceği intentlerin TEK KAYNAĞI.**
 * `companionChatProvider.BRAIN_INTENTS` bundan türetilir; prompt listesi ve
 * doğrulayıcı ARTIK ELLE YAZILMAZ. Kilit testleri de kaynak metnini kazımak
 * yerine bu fonksiyonu çağırır (kazıma, türetmeye geçince körleşirdi).
 */
export function brainIntentAllowlist(): readonly string[] {
  const out: string[] = [...brainExposedIntents()];
  for (const i of LEGACY_ONLY_BRAIN_INTENTS) if (!out.includes(i)) out.push(i);
  return Object.freeze(out);
}

/** Eski intent adından katalog girişini bulur (`null` → capability yolu YOK). */
export function findByLegacyIntent(intent: string): CapabilityOperationDef | null {
  if (typeof intent !== 'string' || intent.length === 0) return null;
  for (const d of CAROS_CAPABILITY_CATALOG) if (d.legacyIntent === intent) return d;
  return null;
}

/** Katalogdaki farklı capability kimlikleri. */
export function catalogCapabilityIds(): readonly string[] {
  const out: string[] = [];
  for (const d of CAROS_CAPABILITY_CATALOG) if (!out.includes(d.capabilityId)) out.push(d.capabilityId);
  return Object.freeze(out);
}
