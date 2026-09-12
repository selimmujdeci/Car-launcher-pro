/**
 * contextGrammarModel.ts — MAVI-STT-CONTEXT-GRAMMAR: bağlama göre gramer SEÇİMİ (SAF).
 *
 * SAF: I/O yok · timer yok · `Date.now()` yok · global durum yok · React importu yok ·
 * servis importu yok. Girdi YAPISALDIR (mock'suz test edilir).
 *
 * ── BU MODEL NE YAPAR / NE YAPMAZ ───────────────────────────────────────────
 * YAPAR: hangi gramer SINIFININ dinleneceğine karar verir ve o sınıfın sözcük
 *        listesini (enjekte edilen sözlük üreticisiyle) kurar.
 * YAPMAZ: intent kararı · eylem kararı · onay kabul/ret kararı ÜRETMEZ. Gramer
 *        YALNIZ tanıma adaylarını daraltır. Onay otoritesi M4'tür (bu dosya onun
 *        durumunu OKUR, üretmez); kabul/ret kuralları `voiceService`te kalır.
 *        Yeni durum makinesi KURULMAZ — karar her seferinde girdi anlık görüntüsünden
 *        yeniden TÜRETİLİR (saklanan bağlam yok).
 *
 * ── ÖNCELİK (bağlayıcı) ─────────────────────────────────────────────────────
 *   confirmation > açık kullanıcı akışı (navigasyon) > özellik bağlamı (medya →
 *   araç) > general_command. Kaynak okunamayan bağlam TAHMİN EDİLMEZ → general.
 *
 * ── ⚠️ ÇAPRAZ-BAĞLAM KAÇIŞ SETİ (bilinçli, gerekçeli) ───────────────────────
 * Vosk gramer kipinde liste dışı her söz `[unk]`a düşer ve offline'da onu
 * kurtaracak bir beyin YOKTUR → dar gramerde bağlam dışı komut KAYBOLUR.
 * Navigasyon bir yolculuk boyunca AÇIK kalır; o süre boyunca "müziği aç"ın ölmesi
 * kabul edilemez bir regresyondur. Bu yüzden confirmation DIŞINDAKİ sınıflara
 * diğer sınıfların BİRİNCİL tetikleyicileri "güvenli kontrol sözcüğü" olarak
 * eklenir (bounded, `PATTERNS` kaynaklı). Confirmation'da kaçış seti YOKTUR:
 * orada kullanıcıya doğrudan bir soru sorulmuştur ve daralma meşrudur.
 */

import type { CommandType } from '../commandParser';

/* ══════════════════════════════════════════════════════════════════════════
 * Sınıflar
 * ════════════════════════════════════════════════════════════════════════ */

export const GRAMMAR_CLASSES = [
  'confirmation', 'navigation', 'media', 'vehicle', 'general_command', 'wake_word',
] as const;

export type GrammarClass = (typeof GRAMMAR_CLASSES)[number];

export const GRAMMAR_CLASS_LABEL: Readonly<Record<GrammarClass, string>> = {
  confirmation:    'confirmation (bekleyen onay)',
  navigation:      'navigation (rota aktif)',
  media:           'media (çalma aktif)',
  vehicle:         'vehicle (araç oturumu hazır)',
  general_command: 'general_command (tam komut sözlüğü)',
  wake_word:       'wake_word (pasif — AYRI hat)',
} as const;

/** Sabit gerekçe kodları — serbest metin YOK. */
export const GRAMMAR_REASON_CODES = [
  'PENDING_CONFIRMATION',
  'NAVIGATION_ACTIVE',
  'MEDIA_PLAYING',
  'VEHICLE_SESSION_READY',
  'NO_CONTEXT_EVIDENCE',
  'CONTEXT_SOURCE_UNREADABLE',
  'ONLINE_FULL_DICTATION',
  'APPLY_FAILED_FALLBACK',
  'INITIAL',
] as const;

export type GrammarReasonCode = (typeof GRAMMAR_REASON_CODES)[number];

export const GRAMMAR_REASON_LABEL: Readonly<Record<GrammarReasonCode, string>> = {
  PENDING_CONFIRMATION:      'Bekleyen açık onay var (M4)',
  NAVIGATION_ACTIVE:         'Navigasyon aktif',
  MEDIA_PLAYING:             'Medya çalıyor',
  VEHICLE_SESSION_READY:     'Araç oturumu hazır (OBD)',
  NO_CONTEXT_EVIDENCE:       'Bağlam kanıtı yok — tam sözlük',
  CONTEXT_SOURCE_UNREADABLE: 'Bağlam kaynağı okunamadı — tam sözlük',
  ONLINE_FULL_DICTATION:     'Çevrimiçi — gramer uygulanmaz (bulut tam dikte)',
  APPLY_FAILED_FALLBACK:     'Gramer kurulamadı — genele düşüldü',
  INITIAL:                   'Henüz gramer uygulanmadı',
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Confirmation grameri — SABİT ve KAPALI liste
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Yalnız bu yanıtlar + `[unk]`. Her biri `voiceService`teki GERÇEK onay
 * ayrıştırıcılarınca (AFFIRM_RE / NEGATE_RE) TANINIR — gramer parser'ın
 * göremeyeceği bir sözcük ÖNERMEZ (kilit testi bunu doğrular).
 */
export const CONFIRMATION_GRAMMAR: readonly string[] = Object.freeze([
  'evet', 'hayır', 'tamam', 'onayla', 'iptal', 'vazgeç', '[unk]',
]);

/* ══════════════════════════════════════════════════════════════════════════
 * Sınıf → GERÇEK komut türleri
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * ⚠️ Bu listeler YALNIZ `PATTERNS` karşılığı OLAN türleri içerir — yüzey TAHMİN
 * EDİLMEDİ, `countGrammarBackedTypes` ile ÖLÇÜLDÜ (kilit testi her türü tek tek
 * doğrular). Grammar'a eklenip de parser'ın eşleştiremeyeceği bir sözcük YENİ
 * KULLANICI KOMUTU icat etmek olurdu; görev bunu yasaklıyor.
 *
 * Görev metnindeki örneklerden offline yüzeyi GERÇEKTEN OLMAYANLAR (açık borç,
 * kütüğe yazıldı — bu görevde icat EDİLMEZ):
 *   · `akaryakıt bul` → `find_nearby_gas` PATTERNS'te YOK (başka yoldan üretilir;
 *     sözcükleri bugün TAM sözlükte de yok, yani daralma bir şey KAYBETTİRMEZ).
 *   · `navigasyonu iptal et` / `rotayı durdur` → karşılık gelen `CommandType` HİÇ YOK.
 *
 * Buna karşılık `arıza kodlarını oku/sil`, `araç durumu`, `bakım durumu` yüzeyi
 * `vehicleIntents.ts` üzerinden AYNI `PATTERNS` dizisinde GERÇEKTEN VARDIR →
 * araç sınıfına dahil edilir (dışarıda bırakılsalardı dar gramerde DESTEKLENEN
 * komutlar ölürdü = regresyon).
 */
export const NAVIGATION_TYPES: readonly CommandType[] = Object.freeze([
  'navigate_home', 'navigate_work', 'open_maps',
  'find_nearby_restaurant', 'find_nearby_hospital', 'show_traffic',
]);

export const MEDIA_TYPES: readonly CommandType[] = Object.freeze([
  'open_music', 'open_radio', 'stop_music', 'music_next', 'music_prev',
  'media_video_mode', 'volume_up', 'volume_down',
  'music_spotify', 'music_youtube', 'add_music_favorite',
]);

export const VEHICLE_TYPES: readonly CommandType[] = Object.freeze([
  'hw_lock_doors', 'hw_unlock_doors', 'hw_honk_horn', 'hw_flash_lights',
  'hw_alarm_on', 'hw_alarm_off', 'hw_rear_camera', 'hw_lights_off', 'hw_screen_off',
  'vehicle_speed', 'vehicle_fuel', 'vehicle_temp',
  /* Tanı yüzeyi (`vehicleIntents.ts` → aynı `PATTERNS` dizisi). Gramer YALNIZ
     tanımayı açar; `vehicle_clear_dtc` gibi yıkıcı niyetin onay/yetki kapısı
     M4'tedir ve bu dosya ona DOKUNMAZ. */
  'vehicle_status', 'vehicle_maintenance', 'vehicle_health_check', 'vehicle_clear_dtc',
]);

/**
 * ÇAPRAZ-BAĞLAM KAÇIŞ SETİ — her sınıfın BİRİNCİL tetikleyicisi. Dar gramerde
 * bile kullanıcı bağlam değiştirebilsin diye eklenir (bkz. dosya başlığı).
 * Bounded ve `PATTERNS` kaynaklıdır; confirmation'a UYGULANMAZ.
 */
export const ESCAPE_TYPES: readonly CommandType[] = Object.freeze([
  'navigate_home', 'open_maps', 'open_music', 'stop_music', 'hw_lock_doors',
]);

/** Sınıfın komut türleri (confirmation/general/wake bu haritada YOKTUR). */
export const CLASS_TYPES: Readonly<Partial<Record<GrammarClass, readonly CommandType[]>>> = {
  navigation: NAVIGATION_TYPES,
  media:      MEDIA_TYPES,
  vehicle:    VEHICLE_TYPES,
} as const;

/* ══════════════════════════════════════════════════════════════════════════
 * Bağlam anlık görüntüsü — YAPISAL girdi
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Her alan ÜÇ DURUMLUDUR: `true`/`false` = kaynak okundu · `null` = kaynak
 * OKUNAMADI. `null` ASLA `false`a indirgenmez (okunamayan bağlam "yok" DEĞİLDİR).
 */
export interface GrammarContextSnapshot {
  /** M4 bekleyen açık onay (MUTASYONSUZ kaynaktan). */
  readonly pendingConfirmation: boolean | null;
  readonly navigationActive: boolean | null;
  readonly mediaPlaying: boolean | null;
  readonly vehicleSessionReady: boolean | null;
  /** Çevrimiçi tam dikte yolu — gramer HİÇ uygulanmaz (mevcut davranış). */
  readonly online: boolean;
}

export interface GrammarSelection {
  readonly grammarClass: GrammarClass;
  readonly reasonCode: GrammarReasonCode;
  /**
   * `false` = gramer HİÇ uygulanmaz (yalnız çevrimiçi tam dikte yolu).
   *
   * ⚠️ Bu bayrak AYRI durur çünkü "gramer verme" ile "tür süzgeci yok" AYNI ŞEY
   * DEĞİLDİR: `general_command` offline'da süzgeçsizdir ama gramer UYGULANIR
   * (tam sözlük). İkisi tek bir `null` sentinel'ine bindirilirse offline genel
   * yolda gramer sessizce DÜŞER ve mevcut offline doğruluğu kaybedilir.
   */
  readonly applies: boolean;
  /** `null` = TÜR SÜZGECİ YOK (tam sözlük). Gramerin uygulanıp uygulanmamasıyla ilgisizdir. */
  readonly types: readonly CommandType[] | null;
  /** Confirmation sabit listesi; diğer sınıflarda `null` (sözlükten üretilir). */
  readonly fixedWords: readonly string[] | null;
}

/**
 * SAF seçim. Öncelik sırası bağlayıcıdır ve tek yerde durur.
 *
 * Kaynak okunamadıysa (`null`) o bağlam KANIT SAYILMAZ ve sıradaki kurala geçilir;
 * hiçbir kanıt yoksa `general_command` seçilir — TAHMİN YAPILMAZ.
 */
export function selectGrammar(ctx: GrammarContextSnapshot): GrammarSelection {
  /* 0. Çevrimiçi: mevcut davranış aynen korunur — gramer verilmez. */
  if (ctx.online) {
    return {
      grammarClass: 'general_command', reasonCode: 'ONLINE_FULL_DICTATION',
      applies: false, types: null, fixedWords: null,
    };
  }

  /* 1. confirmation — EN YÜKSEK öncelik, kaçış seti YOK. */
  if (ctx.pendingConfirmation === true) {
    return {
      grammarClass: 'confirmation', reasonCode: 'PENDING_CONFIRMATION',
      applies: true, types: [], fixedWords: CONFIRMATION_GRAMMAR,
    };
  }

  /* 2. açık kullanıcı akışı — navigasyon. */
  if (ctx.navigationActive === true) {
    return {
      grammarClass: 'navigation', reasonCode: 'NAVIGATION_ACTIVE',
      applies: true, types: NAVIGATION_TYPES, fixedWords: null,
    };
  }

  /* 3. özellik bağlamı — medya. */
  if (ctx.mediaPlaying === true) {
    return {
      grammarClass: 'media', reasonCode: 'MEDIA_PLAYING',
      applies: true, types: MEDIA_TYPES, fixedWords: null,
    };
  }

  /* 4. özellik bağlamı — araç oturumu. */
  if (ctx.vehicleSessionReady === true) {
    return {
      grammarClass: 'vehicle', reasonCode: 'VEHICLE_SESSION_READY',
      applies: true, types: VEHICLE_TYPES, fixedWords: null,
    };
  }

  /* 5. Kanıt yok → tam sözlük. Kaynakların HİÇBİRİ okunamadıysa bunu AYRI
     gerekçeyle bildir (sessiz "bağlam yok" ile karıştırılmasın). */
  const unreadable = ctx.pendingConfirmation === null && ctx.navigationActive === null
    && ctx.mediaPlaying === null && ctx.vehicleSessionReady === null;
  return {
    grammarClass: 'general_command',
    reasonCode: unreadable ? 'CONTEXT_SOURCE_UNREADABLE' : 'NO_CONTEXT_EVIDENCE',
    /* GRAMER YİNE UYGULANIR: offline'da tam sözlük mevcut davranıştır (Yol A).
       `applies:false` yapılsaydı bağlamsız her offline dinleme full-vocab dikteye
       düşer, yani bu görev mevcut doğruluğu ARTIRMAK yerine DÜŞÜRÜRDÜ. */
    applies: true, types: null, fixedWords: null,
  };
}

/* ══════════════════════════════════════════════════════════════════════════
 * Sözcük listesinin kurulması
 * ════════════════════════════════════════════════════════════════════════ */

/** Sözlük üreticileri ENJEKTE edilir → model saf kalır, testte mock gerekmez. */
export interface GrammarVocabulary {
  /** Tam sözlük (`commandParser.buildCommandGrammar`). */
  readonly buildGeneral: () => string[];
  /** Tür-süzgeçli sözlük (`commandParser.buildCommandGrammarFor`). */
  readonly buildFor: (types: readonly CommandType[]) => string[];
}

export interface GrammarPlan {
  readonly grammarClass: GrammarClass;
  readonly reasonCode: GrammarReasonCode;
  /** `null` = gramer uygulanmaz (çevrimiçi). */
  readonly words: readonly string[] | null;
  readonly entryCount: number;
  /** Değişim tespiti için kararlı anahtar (sözcük METNİ değil — uzunluk + karma). */
  readonly key: string;
}

/** `[unk]` TEK ve SONDA olacak şekilde normalize eder (gramer sözleşmesi). */
export function normalizeGrammarWords(words: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const w of Array.isArray(words) ? words : []) {
    if (typeof w !== 'string') continue;
    const t = w.trim();
    if (!t || t === '[unk]' || seen.has(t)) continue;
    seen.add(t);
    out.push(t);
  }
  out.push('[unk]');
  return out;
}

/** FNV-1a — sözcükleri SAKLAMADAN değişim tespiti (gizlilik: metin taşınmaz). */
export function grammarFingerprint(words: readonly string[]): string {
  let h = 0x811c9dc5;
  for (const w of words) {
    for (let i = 0; i < w.length; i++) {
      h ^= w.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x2c; h = Math.imul(h, 0x01000193) >>> 0;   // ayraç
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Seçim + sözlük → uygulanacak plan. Sözlük üreticisi patlarsa `null` döner ve
 * çağıran GENEL sözlüğe düşer (fail-soft; bu dosya throw ETMEZ).
 */
export function buildGrammarPlan(
  selection: GrammarSelection,
  vocab: GrammarVocabulary,
): GrammarPlan | null {
  try {
    if (!selection.applies) {
      // YALNIZ çevrimiçi tam dikte yolu — gramer uygulanmaz.
      return {
        grammarClass: selection.grammarClass, reasonCode: selection.reasonCode,
        words: null, entryCount: 0, key: `${selection.grammarClass}:none`,
      };
    }

    let raw: string[];
    if (selection.fixedWords !== null) {
      raw = selection.fixedWords.slice();
    } else if (selection.types === null) {
      // Tür süzgeci YOK → tam sözlük (offline genel yol).
      raw = vocab.buildGeneral();
    } else {
      /* Sınıf sözcükleri + ÇAPRAZ-BAĞLAM KAÇIŞ SETİ (bkz. dosya başlığı). */
      raw = vocab.buildFor([...(selection.types ?? []), ...ESCAPE_TYPES]);
    }

    const words = normalizeGrammarWords(raw);
    if (words.length <= 1) return null; // yalnız `[unk]` kaldıysa gramer anlamsızdır

    return {
      grammarClass: selection.grammarClass,
      reasonCode: selection.reasonCode,
      words,
      entryCount: words.length,
      key: `${selection.grammarClass}:${words.length}:${grammarFingerprint(words)}`,
    };
  } catch {
    return null; // fail-soft — çağıran genele düşer
  }
}

/**
 * Genel sözlüğe düşüş planı (apply hatası yolu). Genel sözlük de kurulamazsa
 * `null` döner → çağıran gramer HİÇ vermez ve native full-vocab'da kalır
 * (mikrofon zinciri ASLA kapanmaz).
 */
export function generalFallbackPlan(vocab: GrammarVocabulary): GrammarPlan | null {
  try {
    const words = normalizeGrammarWords(vocab.buildGeneral());
    if (words.length <= 1) return null;
    return {
      grammarClass: 'general_command',
      reasonCode: 'APPLY_FAILED_FALLBACK',
      words,
      entryCount: words.length,
      key: `general_command:${words.length}:${grammarFingerprint(words)}`,
    };
  } catch {
    return null;
  }
}
