/**
 * semanticEndpointer.ts — **MAVİ F3 · KANIT TEMELLİ CÜMLE-SONU (ENDPOINT) KARARI.**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Bugün cümlenin bittiği kararı TAMAMEN AKUSTİKTİR: native RMS-VAD, konuşmadan
 * sonra `VOSK_VAD_SILENCE_MS = 1100 ms` sessizlik görürse oturumu bitirir. Bu
 * eşik bilinçli olarak 900'den 1100'e ÇIKARILMIŞTI — çünkü kullanıcı cümle
 * ortasında düşününce erken kesiliyordu. Yani tek sensörlü bir sistemde
 * "kesmemek" ile "hızlı olmak" birbirinin düşmanıdır ve hız feda edilmiştir:
 * ölçülen bütçede endpoint gecikmesi tek başına toplamın **~%32'si**.
 *
 * Bu modül o ikilemi **ikinci bir kanıt kaynağı** ekleyerek çözer: sessizliğin
 * yanında **cümlenin anlamca tamamlanmış olup olmadığına** bakar. "Beni eve
 * götür" tamamlanmıştır → kısa sessizlik yeter. "Beni eve götür ama" ya da
 * "Ankara'ya" tamamlanmamıştır → uzun sessizlik (bugünkü davranış) beklenir.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** I/O · timer · `Date.now` · global durum · React importu YOK.
 *    Hiçbir modülü import ETMEZ (yaprak modül). Zaman DIŞARIDAN verilir.
 *  · **KARAR ≠ YETKİ.** Bu modül yalnız "konuşma bitmiş olabilir" der. Hiçbir
 *    eylemi başlatmaz, hiçbir intent üretmez, `processTextCommand` çağırmaz.
 *    Kısmi transkript **hiçbir koşulda** eylem yetkisi taşımaz (spec K5/I4).
 *  · **ASİMETRİK GÜVENLİK.** Yanlış "bitti" kararı kullanıcının sözünü keser —
 *    ürünün EN KÖTÜ UX hatası. Yanlış "devam ediyor" kararı yalnız bugünkü
 *    davranışa döner (1100 ms). Bu yüzden her belirsizlik **DEVAM ETMEK**
 *    lehine çözülür ve semantik yol, akustik yolun eşiğini ASLA aşağı
 *    zorlamaz — yalnız KISALTABİLİR, hiçbir zaman akustik tabanın altına inmez.
 *  · **HİSTEREZİS ZORUNLU.** Tek bir tik "tamamlandı" dedi diye bitirilmez;
 *    karar `minAgreeingTicks` kez ÜST ÜSTE tekrarlanmalıdır.
 *
 * ── TÜRKÇE NEDEN ÖZEL ───────────────────────────────────────────────────────
 * Türkçe **fiil-sonu** ve **eklemeli** bir dildir: bir komut cümlesi tipik
 * olarak çekimli bir fiille BİTER ("aç", "götür", "çal", "arar mısın").
 * Bu, cümle-sonu tespiti için İngilizceden daha güçlü bir sinyaldir. Buna
 * karşılık askıda bırakan bağlaç/edatlar ("ama", "ve", "yani", "bir de") ve
 * fiilsiz ad öbekleri ("Ankara'ya") cümlenin SÜRDÜĞÜNÜ net biçimde gösterir.
 * Kendini düzeltme ("Ankara'ya… yok Mersin'e götür") bu sayede korunur:
 * "yok" askıda bir sözcüktür → erken bitirilmez; nihai metin bütün cümledir ve
 * doğru hedefi (Mersin) beyin çözer.
 */

/* ══════════════════════════════════════════════════════════════════════════
 * Sözleşmeler
 * ════════════════════════════════════════════════════════════════════════ */

/** Konuşmanın neden bittiğine karar verildiği — bounded (serbest metin YOK). */
export type EndpointReason =
  /** Sağlayıcı kendi nihai sonucunu verdi (Vosk endpoint · Google `onResults`). */
  | 'FINAL_PROVIDER'
  /** Anlam + kararlılık + sessizlik birlikte "cümle bitti" dedi. */
  | 'SEMANTIC_CONFIDENT'
  /** Yalnız akustik sessizlik eşiği doldu (bugünkü davranış). */
  | 'ACOUSTIC_TIMEOUT'
  /** Azami söz süresi doldu — güvenlik ağı (sonsuz dinleme yok). */
  | 'MAX_DURATION_FAILSAFE'
  /** Kullanıcı/sistem turu iptal etti (barge-in · yeni komut · durdur). */
  | 'CANCELLED';

/** Kısmi transkriptin anlamca ne kadar tamamlandığı. */
export type SemanticCompleteness =
  /** Konuşma henüz başlamadı ya da anlamlı sözcük yok. */
  | 'EMPTY'
  /** Cümle AÇIKÇA sürüyor — askıda bağlaç/edat ya da fiilsiz ad öbeği. */
  | 'DANGLING'
  /** Ne tamamlanmış ne askıda — karar veremiyoruz (bilinmeyen → DEVAM). */
  | 'UNKNOWN'
  /** Çekimli fiille biten, kendi başına anlamlı bir istek. */
  | 'COMPLETE';

/** Endpointer'ın gördüğü kanıt. Hepsi ÇAĞIRAN tarafından ölçülür (bu modül ölçmez). */
export interface EndpointEvidence {
  /** En son kısmi transkript (ham metin — bu modül dışına ASLA çıkmaz). */
  readonly partialText: string;
  /** Bu oturumda gelen kısmi sonuç adedi. */
  readonly partialCount: number;
  /** Kısmi metnin en son DEĞİŞTİĞİ andan bu yana geçen süre (ms). */
  readonly stableForMs: number;
  /** Akustik olarak sessizliğin sürdüğü süre (ms). Bilinmiyorsa `null`. */
  readonly silenceMs: number | null;
  /** Konuşmanın başlangıcından bu yana geçen süre (ms). */
  readonly speechDurationMs: number;
  /** Dinleme oturumunun açılışından bu yana geçen süre (ms). */
  readonly sessionElapsedMs: number;
  /** Sağlayıcı nihai sonucu verdi mi (verdiyse karar zaten alınmıştır). */
  readonly providerFinal: boolean;
  /** Tur iptal edildi mi (barge-in · yeni komut · kullanıcı durdurdu). */
  readonly cancelled: boolean;
}

/** Eşikler — TEK KAYNAK. Native akustik taban (1100 ms) burada AŞILAMAZ. */
export interface EndpointThresholds {
  /**
   * Anlamca TAMAMLANMIŞ cümlede beklenecek sessizlik (ms).
   *
   * Spec kademeleri: 1100 → 900 → 700 → 500 → 350. **Her kademe cihazda
   * ölçülmeden bir sonrakine geçilmez** ve `prematureEndpointRate` yükselirse
   * eşik GERİ ALINIR. Varsayılan ilk kademedir (900).
   */
  readonly semanticSilenceMs: number;
  /** Kısmi metnin kaç ms değişmeden durması gerektiği (ASR kararlılığı). */
  readonly stableMs: number;
  /** Bu süreden kısa konuşma ASLA semantik olarak bitirilmez (yanlış tetik kalkanı). */
  readonly minSpeechMs: number;
  /** Kararın kaç TİK üst üste aynı çıkması gerektiği (histerezis). */
  readonly minAgreeingTicks: number;
  /** Akustik taban — semantik yol bunun ALTINA inemez; native ile hizalı. */
  readonly acousticSilenceMs: number;
  /** Azami söz süresi — güvenlik ağı (native `maxListenMs` ile hizalı olmalı). */
  readonly maxUtteranceMs: number;
}

/**
 * Varsayılan eşikler — **spec'in ilk kademesi (900 ms)**.
 *
 * `acousticSilenceMs` native `VOSK_VAD_SILENCE_MS` ile BİREBİRDİR: JS burada
 * native'den daha sabırsız davranamaz, yalnız anlam kanıtı varken daha erken
 * karar verebilir. `maxUtteranceMs`, `VOICE_TUNING.maxListenMs` (12 000) ile
 * hizalıdır ve ondan KÜÇÜK tutulur ki failsafe native tavana çarpmadan çalışsın.
 */
export const DEFAULT_ENDPOINT_THRESHOLDS: EndpointThresholds = Object.freeze({
  semanticSilenceMs: 900,
  stableMs:          420,
  minSpeechMs:       600,
  minAgreeingTicks:  2,
  acousticSilenceMs: 1100,
  maxUtteranceMs:    11_500,
});

/** Endpointer kararı — `endpoint:false` ise `reason` YOKTUR (uydurulmaz). */
export interface EndpointDecision {
  readonly endpoint: boolean;
  readonly reason: EndpointReason | null;
  readonly completeness: SemanticCompleteness;
  /** Kaç tik üst üste aynı yönde karar verildiği (histerezis sayacı). */
  readonly agreeingTicks: number;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Türkçe anlam tamamlanmışlığı — SAF sınıflandırma
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Türkçe harf katlaması. `toLowerCase()`'DEN ÖNCE yapılır: JS `'İ'.toLowerCase()`
 * Türkçe yerele göre çalışmaz ve `i` + BİRLEŞTİREN NOKTA (U+0307) üretir; sıra
 * ters olsaydı o nokta ASCII süzgecinde boşluğa dönüşüp sözcüğü İKİYE bölerdi.
 */
function _fold(text: string): string {
  return text
    .replace(/[İIı]/g, 'i')
    .replace(/[Öö]/g, 'o')
    .replace(/[Üü]/g, 'u')
    .replace(/[Çç]/g, 'c')
    .replace(/[Şş]/g, 's')
    .replace(/[Ğğ]/g, 'g')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * ASKIDA BIRAKAN son sözcükler — bunlardan biriyle biten cümle SÜRÜYOR demektir.
 *
 * Kapsam bilinçli olarak GENİŞ: burada yanılmanın bedeli yalnız bugünkü
 * davranışa (1100 ms) dönmektir; ters yönde yanılmanın bedeli kullanıcının
 * sözünü kesmektir. Bağlaçlar · bağlama edatları · doldurucular · kendini
 * düzeltme işaretleri ("yok", "hayir", "pardon") burada toplanır.
 */
const DANGLING_TAIL: ReadonlySet<string> = new Set([
  // bağlaçlar / bağlama edatları
  'ama', 'ancak', 'fakat', 've', 'veya', 'ya', 'yada', 'ile', 'ki', 'cunku',
  'ayrica', 'hem', 'hatta', 'ragmen', 'ise', 'de', 'da', 'ne',
  // sıralama / zaman bağlayıcıları (cümle sürüyor)
  'sonra', 'once', 'ondan', 'bundan', 'simdi', 'birde', 'bir',
  // doldurucular / duraksama
  /* NOT: "şöyle"/"böyle" BİLİNÇLİ olarak DIŞARIDA. Türkçe harf katlamasında
   * "şöyle" → `soyle` olur ve **"söyle" (emir: anlat)** ile ÇAKIŞIR. Çakışmanın
   * bedeli asimetriktir: doldurucu olarak yakalamak "yağ sıcaklığını söyle"
   * komutunu kalıcı olarak askıda bırakırdı. Gerçek bir komut fiilini bloke
   * etmektense nadir bir doldurucuyu kaçırmak DOĞRU tercihtir. */
  'yani', 'sey', 'seyy', 'hani', 'iste', 'falan', 'filan',
  // kendini düzeltme işaretleri — EN KRİTİK grup
  'yok', 'hayir', 'pardon', 'affedersin', 'duzeltiyorum', 'degil',
  // eksik nesne/hedef beklendiğini gösteren belirteçler
  'bana', 'beni', 'bize', 'bizi', 'sana', 'seni', 'ona', 'onu',
  'su', 'bu', 'o', 'sunu', 'bunu', 'onun', 'benim', 'senin',
]);

/**
 * Cümleyi TAMAMLAYABİLEN çekimli fiil sonları (Türkçe fiil-sonu dizilimi).
 *
 * Bu bir sözlük DEĞİL, son-ek örüntüsüdür: emir kipi ("aç", "götür"), geniş
 * zaman soru ("arar mısın"), şimdiki zaman ("açıyorum"), istek ("gidelim"),
 * gereklilik ("gitmeliyim"). Örüntü yaklaşımı yeni fiilleri kendiliğinden
 * kapsar — sabit liste her yeni komutta güncellenmek zorunda kalırdı.
 */
const VERB_TAIL_PATTERNS: readonly RegExp[] = Object.freeze([
  // soru ekleri: "açar mısın", "çalar mı", "gider miyiz"
  /\b(mi|mi̇|mu|mu|mü|mısın|misin|musun|musun|miyiz|miyim|mıyım)$/,
  // şimdiki/geniş/gelecek zaman çekimleri: açıyorum · gidiyoruz · alırım · gelecek
  /(iyorum|iyorsun|iyor|iyoruz|iyorsunuz|iyorlar)$/,
  /(irim|irsin|iriz|arim|arsin|ariz|erim|ersin|eriz)$/,
  /(acagim|acaksin|acak|ecegim|eceksin|ecek)$/,
  // istek/emir çoğul: gidelim · bakalim · açalım
  /(elim|alim|sin|sun|siniz|sunuz)$/,
  // geçmiş zaman: açtım · gittik (bilgi cümlesi de tam sayılır)
  /(dim|din|di|dik|diniz|tim|tin|ti|tik|tiniz)$/,
  // gereklilik: gitmeliyim · almalıyız
  /(meliyim|maliyim|meliyiz|maliyiz)$/,
]);

/**
 * Sık kullanılan KISA emir fiilleri — örüntülerin yakalayamadığı tek heceliler.
 * ("aç", "kap", "dur", "çal", "ara", "git", "gel", "sus", "bak")
 */
const SHORT_IMPERATIVES: ReadonlySet<string> = new Set([
  'ac', 'kapat', 'kapa', 'dur', 'durdur', 'cal', 'ara', 'git', 'gel', 'sus',
  'bak', 'goster', 'soyle', 'anlat', 'baslat', 'bitir', 'getir', 'gotur',
  'sus', 'devam', 'gec', 'atla', 'yukselt', 'azalt', 'artir', 'kis', 'oku',
  'kaydet', 'sil', 'tara', 'bul', 'unut', 'hatirla', 'yaz', 'cevir', 'kur',
]);

/**
 * Kısmi transkriptin anlamca tamamlanmışlığını sınıflandırır. **SAF.**
 *
 * Sıra ÖNEMLİDİR ve güvenlik gereğidir: önce ASKIDA kontrolü yapılır. "Beni eve
 * götür ama" cümlesinde "götür" bir fiildir ve fiil kontrolü önce yapılsaydı
 * cümle TAMAMLANMIŞ sanılıp kullanıcının sözü kesilirdi.
 */
export function classifyCompleteness(partialText: unknown): SemanticCompleteness {
  if (typeof partialText !== 'string') return 'EMPTY';
  const n = _fold(partialText);
  if (!n) return 'EMPTY';
  const words = n.split(' ').filter(Boolean);
  if (words.length === 0) return 'EMPTY';

  const last = words[words.length - 1];

  /* 1) ASKIDA — cümle AÇIKÇA sürüyor. Fiil kontrolünden ÖNCE gelir (bkz. üstteki not). */
  if (DANGLING_TAIL.has(last)) return 'DANGLING';

  /* 2) Tek sözcüklük söz — "aç"/"dur" gibi gerçek bir emir DEĞİLSE tamamlanmamıştır.
   *    "Ankara'ya" tek başına bir istek değildir; fiili henüz gelmemiştir. */
  if (words.length === 1) return SHORT_IMPERATIVES.has(last) ? 'COMPLETE' : 'DANGLING';

  /* 3) Çekimli fiille bitiyor mu? */
  if (SHORT_IMPERATIVES.has(last)) return 'COMPLETE';
  for (const re of VERB_TAIL_PATTERNS) {
    if (re.test(last)) return 'COMPLETE';
  }

  /* 4) Karar veremedik. BİLİNMEYEN "tamamlandı" DEĞİLDİR — akustik yol karar verir. */
  return 'UNKNOWN';
}

/* ══════════════════════════════════════════════════════════════════════════
 * Karar
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Kanıtı karara çevirir. **SAF** — `prevAgreeingTicks` histerezis durumunu
 * çağırandan alır ve yenisini döndürür (modül durum TUTMAZ).
 *
 * Öncelik sırası bilinçlidir:
 *  1. `cancelled` — her şeyi ezer (eski tur karar üretemez).
 *  2. `providerFinal` — sağlayıcı zaten bitirdi; tartışma yok.
 *  3. `MAX_DURATION_FAILSAFE` — sonsuz dinleme yok.
 *  4. `ACOUSTIC_TIMEOUT` — bugünkü davranış; anlam BİLİNMESE de çalışır.
 *  5. `SEMANTIC_CONFIDENT` — yalnız TÜM koşullar sağlanınca.
 */
export function decideEndpoint(
  evidence: EndpointEvidence,
  thresholds: EndpointThresholds = DEFAULT_ENDPOINT_THRESHOLDS,
  prevAgreeingTicks = 0,
): EndpointDecision {
  const completeness = classifyCompleteness(evidence.partialText);
  const none = (reason: EndpointReason | null, ticks: number): EndpointDecision =>
    ({ endpoint: reason !== null, reason, completeness, agreeingTicks: ticks });

  if (evidence.cancelled) return none('CANCELLED', 0);
  if (evidence.providerFinal) return none('FINAL_PROVIDER', 0);

  if (evidence.sessionElapsedMs >= thresholds.maxUtteranceMs) {
    return none('MAX_DURATION_FAILSAFE', 0);
  }

  const silence = evidence.silenceMs;

  /* Akustik yol — anlam BİLİNMESE de çalışır ve bugünkü davranışı korur.
   * Semantik yoldan ÖNCE değerlendirilir: eşik zaten dolduysa "semantik karar
   * verdi" demek ÖLÇÜMÜ YALAN söyler (sebep dağılımı yanlış okunurdu). */
  if (silence !== null && silence >= thresholds.acousticSilenceMs) {
    return none('ACOUSTIC_TIMEOUT', 0);
  }

  /* Semantik yol — HEPSİ sağlanmalı. Tek bir koşul bile eksikse DEVAM edilir. */
  const semanticReady =
    completeness === 'COMPLETE' &&
    evidence.partialCount > 0 &&
    evidence.speechDurationMs >= thresholds.minSpeechMs &&
    evidence.stableForMs >= thresholds.stableMs &&
    silence !== null &&
    silence >= thresholds.semanticSilenceMs;

  if (!semanticReady) return none(null, 0);   // histerezis SIFIRLANIR (debounce)

  const ticks = prevAgreeingTicks + 1;
  return ticks >= thresholds.minAgreeingTicks
    ? none('SEMANTIC_CONFIDENT', ticks)
    : { endpoint: false, reason: null, completeness, agreeingTicks: ticks };
}

/**
 * Eşiklerin İÇSEL TUTARLILIĞI — yapılandırma hatasını yapısal olarak yakalar.
 *
 * `semanticSilenceMs` akustik tabanı AŞAMAZ (aşarsa semantik yol hiç çalışmaz,
 * sessizce ölü kod olurdu) ve `maxUtteranceMs` her ikisinden BÜYÜK olmalıdır.
 */
export function areThresholdsConsistent(t: EndpointThresholds): boolean {
  return (
    t.semanticSilenceMs > 0 &&
    t.semanticSilenceMs <= t.acousticSilenceMs &&
    t.stableMs > 0 &&
    t.minSpeechMs > 0 &&
    t.minAgreeingTicks >= 2 &&
    t.maxUtteranceMs > t.acousticSilenceMs &&
    t.maxUtteranceMs > t.minSpeechMs
  );
}
