/**
 * hardwareSpeechActGuard.ts — DONANIM SÖZ EDİMİ (speech-act) KAPISI · P0 GÜVENLİK
 *
 * ── ONARILAN KUSUR (ölçüldü) ────────────────────────────────────────────────
 * `matchExplicitCommand` girdinin komuta EŞİT olmasını değil, çok kelimeli komut
 * kalıbının cümle İÇİNDE geçmesini kabul ediyordu. Sonuç: gömülü bağlamda gerçek
 * donanım intent'i üretiliyordu —
 *   "eve varınca aracı kilitle" · "şu an değil sonra kornaya bas" ·
 *   "kapıları kilitle demedim" · "«aracı kilitle» cümlesini tekrar et" ·
 *   "kullanıcı aracı kilitle dedi" · "örnek komut: farları aç"
 * Kelime-sınırı kuralı yalnız EK biçimlerini (kilitleme/kilitledim) eliyordu;
 * cümle düzeyinde SÖZ EDİMİ hiç sınanmıyordu.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 * Donanım/yıkıcı intent YALNIZ **açık · doğrudan · ŞİMDİ** uygulanması istenen
 * emirden üretilebilir. Aşağıdaki beş söz edimi sınıfından biri saptanırsa kapı
 * KAPANIR ve sonuç UNKNOWN/NULL olur (fail-closed) — en yakın tahmine düşülmez:
 *   1. negation  — cümle düzeyi olumsuzlama   ("kapıları kilitle demedim")
 *   2. quotation — alıntı / tekrar / örnek    ("örnek komut: farları aç")
 *   3. reported  — dolaylı/aktarılmış konuşma ("kullanıcı aracı kilitle dedi")
 *   4. deferred  — ertelenmiş / koşullu       ("eve varınca aracı kilitle")
 *   5. question  — soru / yetenek sorgusu     ("kapıları kilitleyebilir misin")
 *
 * ⚠️ FAİL-CLOSED TERCİHİ: doğal soru biçimlerini ("farları açar mısın") gerçek
 * komut sayma politikası AYRI bir atomik görevdir. Bu turda soru = RET.
 *
 * SAF MODÜL: I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 * Yan etkisiz, deterministik, tek girdi → tek karar.
 */

/** Kapının uygulandığı söz edimi sınıfları. */
export type HardwareSpeechActClass =
  | 'negation'
  | 'quotation'
  | 'reported'
  | 'deferred'
  | 'question';

export interface HardwareSpeechActVerdict {
  /** true → donanım intent'i ÜRETİLEMEZ. */
  readonly blocked: boolean;
  /** Hangi sınıf kapattı (gözlemlenebilirlik). Açıkken null. */
  readonly speechClass: HardwareSpeechActClass | null;
  /** Kararı doğuran kanıt etiketi — uydurma yok, eşleşen kural adı. */
  readonly cue: string;
}

const ALLOW: HardwareSpeechActVerdict = { blocked: false, speechClass: null, cue: '' };

/**
 * Kapının KAPSADIĞI komut türleri — gerçek aktüatöre dokunan / geri alınamayan
 * işler. Tür adları string'tir: `commandParser` bu modülü import eder, ters yönde
 * bir tip bağımlılığı kurulmaz (döngüsel import yok).
 *
 * Görev listesi 7 tür veriyordu; aynı fiziksel-aktüasyon ailesinden ve AYNI
 * `EXACT_COMMAND_ONLY` kusurunu paylaşan üç tür (`hw_lights_off`,
 * `hw_rear_camera`, `hw_screen_off`) bilinçli olarak EKLENDİ — aksi hâlde
 * "farları kapat demedim" özdeş açığı açık kalırdı.
 */
export const HARDWARE_SPEECH_ACT_TYPES: ReadonlySet<string> = new Set<string>([
  'hw_lock_doors',
  'hw_unlock_doors',
  'hw_honk_horn',
  'hw_flash_lights',
  'hw_alarm_on',
  'hw_alarm_off',
  'vehicle_clear_dtc',
  'hw_lights_off',
  'hw_rear_camera',
  'hw_screen_off',
]);

/* ── Normalizasyon ───────────────────────────────────────────────────────────
 * `commandParser.normalizeText` ile AYNI Türkçe aksan sözleşmesi (ı→i, ö→o,
 * ü→u, ç→c, ş→s, ğ→g). Fark: noktalama TAMAMEN boşluğa indirgenir, böylece
 * `\b` sınırları ASCII üzerinde güvenle çalışır. Guard kendi normalizasyonunu
 * yapar çünkü parser'ın `stripFiller` katmanı tam da guard'ın ihtiyaç duyduğu
 * ipuçlarını ('şimdi', 'nasıl', 'misin') siliyor. */
function normalizeGuard(input: string): string {
  return input
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')      // 'İ'.toLowerCase() birleşik nokta bırakır
    .replace(/ı/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ü/g, 'u')
    .replace(/ç/g, 'c')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/**
 * Tırnak İŞARETİ sayacı. TEK bir kesme işareti Türkçe ek ayracıdır
 * ("Ahmet'i ara") → alıntı SAYILMAZ. Alıntı kararı için EN AZ İKİ işaret şarttır
 * (açan + kapayan).
 */
const QUOTE_MARKS = /["«»“”„‟‘’]/g;

interface SpeechActRule {
  readonly speechClass: HardwareSpeechActClass;
  readonly cue: string;
  readonly re: RegExp;   // ⚠️ `g` bayrağı YOK — .test() durum taşımamalı
}

/**
 * Kurallar. Her biri NORMALİZE edilmiş metne uygulanır ve tek bir söz edimi
 * kanıtı arar. Sıra = kanıt önceliği (raporlanan sınıf); karar aynıdır.
 *
 * ⚠️ POZİTİF KOMUT GÜVENLİĞİ: hiçbir kural, kapsam içindeki türlerin GERÇEK
 * komut kalıplarında geçen bir sözcüğü yakalamaz — "alarmı iptal", "çocuk
 * kilidini aç", "geri vitese aldım kamerayı aç", "farları da aç" gibi meşru
 * ifadeler bilinçli olarak DIŞARIDA bırakıldı (bkz. kilit testleri).
 */
const RULES: readonly SpeechActRule[] = [
  /* 1 ── Cümle düzeyi olumsuzlama ─────────────────────────────────────────── */
  { speechClass: 'negation', cue: 'degil',
    re: /\b(degil|degildi|degildir)\b/ },
  { speechClass: 'negation', cue: 'demedim',
    re: /\b(demedim|demedin|demedi|demedik|dememis|demediler|demiyorum|demiyoruz|demiyorsun|demiyor)\b/ },
  { speechClass: 'negation', cue: 'soylemedim',
    re: /\b(soylemedim|soylemedin|soylemedi)\b/ },
  { speechClass: 'negation', cue: 'istemiyorum',
    re: /\b(istemiyorum|istemiyoruz|istemedim|istemem|istemez)\b/ },
  { speechClass: 'negation', cue: 'yapma',
    re: /\b(yapma|yapmayin|yapmasin|yapmayalim|etme|etmeyin)\b/ },
  { speechClass: 'negation', cue: 'ret',
    re: /\b(hayir|olmasin|bosver|vazgectim|sakin)\b|\bgerek yok\b|\bbos ver\b/ },

  /* 2 ── Alıntı / tekrar / örnek (metalinguistik kullanım) ─────────────────── */
  { speechClass: 'quotation', cue: 'cumle',
    re: /\b(cumle|cumlesi|cumlesini|cumleyi|cumlesiyle)\b/ },
  { speechClass: 'quotation', cue: 'kelime',
    re: /\b(kelime|kelimesi|kelimesini|kelimeyi|sozcuk|sozcugu|sozcugunu|ifade|ifadesi|ifadesini|lafi|lafini|sozunu)\b/ },
  { speechClass: 'quotation', cue: 'tekrar-et',
    re: /\btekrar (et|eder|edin|etsene|ediyor|edebilir)\b|\b(tekrarla|tekrarlar|tekrarlasana|yinele|yineler)\b/ },
  { speechClass: 'quotation', cue: 'ornek',
    re: /\b(ornek|ornegin|ornekle|mesela|misal)\b/ },
  { speechClass: 'quotation', cue: 'ne-demek',
    re: /\bne demek\b|\bne demektir\b|\bne anlama\b|\b(anlami|anlamini)\b/ },
  { speechClass: 'quotation', cue: 'yaz-hecele',
    re: /\b(yaz|yazar|yazsana|yazin|hecele|heceler)\b/ },
  { speechClass: 'quotation', cue: 'diye-de',
    re: /\bdiye\b|\bde$/ },

  /* 3 ── Dolaylı / aktarılmış konuşma ─────────────────────────────────────── */
  { speechClass: 'reported', cue: 'dedi',
    re: /\b(dedi|dedim|dedin|dedik|dediler|demis|demisti|demisler|diyor|diyordu)\b/ },
  { speechClass: 'reported', cue: 'soyledi',
    re: /\b(soyledi|soyledim|soyledin|soylediler|soylemis|soylemisti|soyluyor|soyluyordu)\b/ },
  { speechClass: 'reported', cue: 'istedi',
    re: /\b(istedi|istemis|emretti)\b|\brica etti\b/ },
  { speechClass: 'reported', cue: 'ucuncu-sahis',
    re: /\b(kullanici|esim)\b/ },
  { speechClass: 'reported', cue: 'az-once',
    re: /\baz once\b/ },

  /* 4 ── Ertelenmiş / koşullu komut ───────────────────────────────────────── */
  /* Ek-tabanlı kurallar: gövde EN AZ 2 harf ister — "inmeden", "varınca",
     "binince" gibi kısa gövdeli zarf-fiiller de yakalanır; "ince"/"arsa" gibi
     BAĞIMSIZ sözcükler (gövdesiz) yakalanmaz. */
  { speechClass: 'deferred', cue: 'zarf-fiil-inca',
    re: /\b\w{2,}(inca|ince|unca|unce)\b/ },
  { speechClass: 'deferred', cue: 'zaman-sonra',
    re: /\b(sonra|sonradan|birazdan|yarin|ileride|ilerde|once)\b/ },
  { speechClass: 'deferred', cue: 'kosul-eger',
    re: /\b(eger|sayet|varsa|yoksa|olursa|olmazsa)\b/ },
  { speechClass: 'deferred', cue: 'kosul-sa-se',
    re: /\b\w{2,}(irsa|irse|arsa|erse|ursa|urse|orsa|orse|ysa|yse)\b/ },
  { speechClass: 'deferred', cue: 'oncelik-madan',
    re: /\b\w{2,}(madan|meden)\b/ },

  /* 5 ── Soru / açıklama / yetenek sorgusu ─────────────────────────────────── */
  { speechClass: 'question', cue: 'soru-eki',
    re: /\b(mi|mu|misin|musun|misiniz|musunuz|miyim|muyum|miyiz|muyuz|midir|mudur|miydi|muydu)\b/ },
  { speechClass: 'question', cue: 'yetenek-ebilir',
    re: /\b\w{3,}(ebilir|abilir|ebilecek|abilecek)\b/ },
  { speechClass: 'question', cue: 'soru-sozcugu',
    re: /\b(nedir|nasil|neden|niye|hangi|kac|kim|nerede|guvenli)\b|\bne yapar\b|\bne zaman\b|\bne ise yarar\b/ },
];

/**
 * Girdinin söz edimini sınıflandırır. Donanım kalıbı İÇERİP içermediğine
 * BAKMAZ — bu kararı çağıran verir (kapı yalnız donanım eşleşmesinde sorulur).
 * Fail-soft: geçersiz girdi → ALLOW (kapı yeni bir kırılma noktası yaratmaz).
 */
export function classifyHardwareSpeechAct(input: string): HardwareSpeechActVerdict {
  if (typeof input !== 'string' || input.length === 0) return ALLOW;

  // Tırnak içine alınmış ifade = kullanım değil, ZİKİR (mention).
  if ((input.match(QUOTE_MARKS) ?? []).length >= 2) {
    return { blocked: true, speechClass: 'quotation', cue: 'tirnak' };
  }

  const normalized = normalizeGuard(input);
  if (!normalized) return ALLOW;

  for (const rule of RULES) {
    if (rule.re.test(normalized)) {
      return { blocked: true, speechClass: rule.speechClass, cue: rule.cue };
    }
  }
  return ALLOW;
}

/** Kısa yol — karar dışındaki alanlara ihtiyaç duymayan çağrılar için. */
export function isHardwareSpeechActBlocked(input: string): boolean {
  return classifyHardwareSpeechAct(input).blocked;
}
