/**
 * companionAnswerShaping.ts — **MAVI-F13/3 · CEVAP ŞEKİLLENDİRME (SAF).**
 *
 * ── NE İÇİN VAR ─────────────────────────────────────────────────────────────
 * `companionChatProvider` bir DEEP sağlayıcıdır: sağlayıcı seçer, prompt kurar,
 * modeli çağırır, cevabı ayrıştırır. Cevabın **kaç token isteneceği** ve
 * **kaç karakterde, nerede kırpılacağı** ise bir sağlayıcı işi değil, bir
 * **dikkat bütçesi politikasıdır** (ISO 15008 · §2.1). Durum tutmaz, ağa
 * çıkmaz, sağlayıcı bilmez.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF.** Modül seviyesinde mutable durum YOK · timer YOK · I/O YOK ·
 *    `Date.now` YOK. Aynı girdi → aynı çıktı.
 *  · **OTORİTE DEĞİL.** Konuşmaz, tur açmaz, sağlayıcı seçmez. Yalnız SAYI ve
 *    KIRPILMIŞ METİN döner.
 *  · **DAVRANIŞ DEĞİŞMEDİ.** Bütçeler, tavanlar ve kırpma kuralı
 *    `companionChatProvider`dan **birebir** taşındı.
 */

export const ANSWER_TOKENS = {
  /** Tek-beyin karar/sohbet cevabı (JSON modu). */
  brain:    { driving: 320, parked: 2600 },
  /** Klasik companion sohbeti (serbest metin). */
  chat:     { driving: 220, parked: 2000 },
  /** Google Search destekli güncel-bilgi cevabı. */
  grounded: { driving: 300, parked:  900 },
  /** Arama sonuçlarından sentezlenen cevap. */
  synth:    { driving: 260, parked:  800 },
} as const;

/** Bağlama göre token bütçesi (tek kapı — dağınık sabit YOK). */
export function answerTokens(kind: keyof typeof ANSWER_TOKENS, isDriving: boolean): number {
  const b = ANSWER_TOKENS[kind];
  return isDriving ? b.driving : b.parked;
}

/**
 * SESLENDİRME KARAKTER TAVANI — token bütçesinin İKİZ kusuru (SAHA 2026-07-24).
 *
 * Token bütçesi açılsa bile cevap metni burada **300 karakterde** kırpılıyordu
 * (sabit 297 karakter + "..." kırpması). Ölçülen 970-1058 karakterlik TAM cevap
 * üçte birine iniyordu → kullanıcı yine "yarıda kesildi" yaşıyordu.
 *
 * SÜRÜŞTE 300 KORUNUR: sürücünün dikkat bütçesi sınırlıdır (§2.1) — uzun
 * anlatım sürüş güvenliğine aykırıdır. PARK halinde böyle bir gerekçe YOKTUR;
 * kullanıcı bilinçli olarak detaylı anlatım istiyor.
 */
/* SAHA 2026-08-30 (kütük #1049 · gerçek cihaz): "Türkiye'nin coğrafi bölgelerini
 * detaylıca anlat" sorusunda Mavi 7 bölgenin yalnız 4'ünü anlatıp SUSTU —
 * cümleyi tamamlayarak, yani token bütçesi değil BU TAVAN kesiyordu; üstelik
 * kullanıcıya kısaltıldığı SÖYLENMİYORDU. Ses zinciri sağlıklıydı (26,3 sn
 * kesintisiz konuşma, tur `completed`). Park tavanı 2400 → 5000.
 * SÜRÜŞ DEĞERİ (300) DEĞİŞMEDİ: dikkat bütçesi · ISO 15008 pazarlıksızdır. */
export const ANSWER_CHAR_LIMIT = { driving: 300, parked: 5000 } as const;

export function answerCharLimit(isDriving: boolean): number {
  return isDriving ? ANSWER_CHAR_LIMIT.driving : ANSWER_CHAR_LIMIT.parked;
}

/**
 * Seslendirilecek metni tek satıra indirir ve tavanı aşarsa CÜMLE SINIRINDA
 * kırpar (yarıda kesilen cümle robotik algı yaratır). Tavan bağlama duyarlıdır.
 */
export function trimForSpeech(raw: string, isDriving: boolean): string {
  return trimToLimit(raw, answerCharLimit(isDriving));
}

/** Tek satıra indir + verilen tavanı aşarsa CÜMLE SINIRINDA kırp. Tavan çağırandan. */
export function trimToLimit(raw: string, limit: number): string {
  const flat = raw.replace(/\s+/g, ' ').trim();
  if (flat.length <= limit) return flat;
  const head = flat.slice(0, limit - 3);
  const lastSentenceEnd = Math.max(
    head.lastIndexOf('. '), head.lastIndexOf('! '), head.lastIndexOf('? '),
  );
  // Cümle sınırı çok başta kalıyorsa kırpma yerine "..." ile bitir.
  return lastSentenceEnd > limit * 0.4 ? head.slice(0, lastSentenceEnd + 1) : `${head}...`;
}

/* ══════════════════════════════════════════════════════════════════════════
 * MAVI-F13/4 · PERSONA'YA BAĞLI DETERMİNİSTİK CEVAPLAR
 *
 * Bu tablolar bir SAĞLAYICI işi değildir: hangi modelin konuştuğuna bakmazlar,
 * ağa çıkmazlar, durum tutmazlar. Yaptıkları tek şey **seçili kişiliğe uygun
 * deterministik metni seçmektir** — yani cevap şekillendirme.
 * `companionChatProvider`dan birebir taşındı.
 * ════════════════════════════════════════════════════════════════════════ */

/** Bilinen kişilikler; tanınmayan değer daima `samimi`ye düşer (fail-soft). */
const FALLBACK_PERSONALITY = 'samimi';

/* Faz 3 — Persona Integration: kişilik beynin EN TEPESİNDE durur; hem sohbet
 * cevabının ("say") hem komut onayının ("feedback") tonunu belirler.
 * resolveCompanionIdentity dört değerden birini garanti eder; bilinmeyen
 * değer samimi'ye düşer (fail-soft). */
const BRAIN_PERSONA_ROLE: Record<string, string> = {
  sessiz:      'KİŞİLİĞİN (en öncelikli ton kuralı): SESSİZ YARDIMCI — az ve öz konuşursun, yalnız gerekeni söylersin.',
  samimi:      'KİŞİLİĞİN (en öncelikli ton kuralı): MAHALLE ARKADAŞI — sıcak, senli benli, eski dost rahatlığında konuşursun.',
  neseli:      'KİŞİLİĞİN (en öncelikli ton kuralı): NEŞELİ YOL ARKADAŞI — enerjik ve pozitifsin, yeri gelince espri yaparsın.',
  profesyonel: 'KİŞİLİĞİN (en öncelikli ton kuralı): MAKAM ASİSTANI — kısa, net ve saygılı konuşursun; argo ve laubalilik asla.',
};

/** Prompt'un EN TEPESİNE giren ton kuralı. Bilinmeyen kişilik → `samimi`. */
export function brainPersonaRole(personality: string): string {
  return BRAIN_PERSONA_ROLE[personality] ?? BRAIN_PERSONA_ROLE[FALLBACK_PERSONALITY];
}

/* Faz 3 — No Dead-Ends: beyin/ağ tamamen başarısız olsa bile kullanıcı "Hata"
 * duymaz; seçili kişiliğe uygun deterministik "tekrar rica" cümlesi söylenir
 * (yalnız ONLINE deneme başarısızken — offline'da null = eski dürüst zincir). */
const REASK_BY_PERSONALITY: Record<string, string> = {
  sessiz:      'Anlayamadım, tekrar eder misin?',
  samimi:      'Kusura bakma, tam yakalayamadım — bir daha söylesene.',
  neseli:      'Of, orayı kaçırdım! Hadi bir daha söyle.',
  profesyonel: 'Tam anlayamadım, tekrar alabilir miyim?',
};
const REASK_DEFAULT = 'Tam anlayamadım, bir daha söyler misin?';

/** "Tekrar söyle" cümlesi. **Yalnız STT belirsizliği için** — ağ ölümünde DEĞİL. */
export function reaskReply(personality: string): string {
  return REASK_BY_PERSONALITY[personality] ?? REASK_DEFAULT;
}

/* SAHA (#669): kullanıcı telefonda da *"Mavi cevap vermiyor, 'of orayı
   kaçırdım' diyor"* dedi. O cümle REASK'tır ve "seni duyamadım, TEKRAR SÖYLE"
   anlamına gelir — oysa tetikleyen şey çoğu kez STT değil, AĞIN ÖLMÜŞ
   olmasıdır. Tekrar söylemek işe yaramaz; kullanıcı aynı cümleyi tekrarlayıp
   aynı yanıtı alarak DÖNGÜYE girer.

   Sağlayıcı zinciri ağ ölümünü ZATEN ölçüyordu (`sawNetFailure` +
   `!sawHttpResponse`, yani hiçbir sunucudan HTTP yanıtı gelmemiş) ama bu bilgi
   REASK dalına HİÇ TAŞINMIYORDU — bilgi var, besleyen yok. Artık taşınıyor ve
   kullanıcı gerçek nedeni duyuyor. Kota ve geçersiz anahtar için zaten dürüst
   cevaplar vardı; eksik olan üçüncü hâlin karşılığıydı. */
const NET_DOWN_BY_PERSONALITY: Record<string, string> = {
  sessiz:      'İnternete ulaşamıyorum. Bağlantı gelince tekrar dene.',
  samimi:      'Kusura bakma, şu an internete çıkamıyorum — bağlantı gelince hallederiz.',
  neseli:      'Eyvah, internet yok! Bağlantı gelince yine buradayım.',
  profesyonel: 'Şu anda internet bağlantısı kurulamıyor. Bağlantı sağlandığında tekrar deneyebilirsiniz.',
};
const NET_DOWN_DEFAULT = 'Şu an internete ulaşamıyorum. Bağlantı gelince tekrar dene.';

/** Ağ ÖLÜ iken dürüst cevap — REASK'ın yerine geçer (#669). */
export function netDownReply(personality: string): string {
  return NET_DOWN_BY_PERSONALITY[personality] ?? NET_DOWN_DEFAULT;
}
