/**
 * maviAckPolicy — MAVİ F2 · **YAPAY ARA SÖZ (FILLER) ile SEMANTİK ACK ayrımı.**
 *
 * ── NEDEN VAR (I11'in koddaki karşılığı) ───────────────────────────────────
 * Mavi, seri hattın gecikmesini *"Bakıyorum… / Düşünüyorum… / Bir saniye…"*
 * diyerek örtüyordu. Bu bir UX tercihi değil, ölçülmüş bir kusurdur:
 * gecikme hakkında yalan söyler, hiçbir bilgi taşımaz ve saha kaydına göre geç
 * ateşleyip **başlamış cevabı kesiyordu** (bkz. `voiceService` KESİLME FIX notu).
 *
 * F2 bu sınıfı KAYNAKTAN kaldırır; bu modül ise kaldırmanın **yapısal** olmasını
 * sağlar: yeni bir çağrı yeri (ya da modelin ürettiği bir `feedback`) aynı sınıfı
 * geri getirirse `maviSpeech` onu KONUŞMADAN düşürür ve F0 izine yazar.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** I/O · timer · `Date.now` · global durum · React importu YOK.
 *    Hiçbir modülü import ETMEZ (yaprak modül).
 *  · **TAM EŞLEŞME (anchored):** bir metin ancak *tamamı* içeriksiz bekletme
 *    kalıbıysa filler sayılır. Bu, kuralın **semantik ACK'i asla yutamayacağını**
 *    garanti eder: *"Yakın restoranlar aranıyor"*, *"Hava durumunu alıyorum"*,
 *    *"Motor yağı sıcaklığı okunuyor"* — hiçbiri eşleşmez.
 *  · **BOUNDED:** kalıp listesi sabittir; öğrenme, sözlük büyütme, model çağrısı YOK.
 *  · **YALNIZ `progress` KATMANINDA UYGULANIR** (`maviSpeech`). Nihai cevap
 *    (`answer`) — gerçek hata mesajı, belirsizlik sorusu, yetenek reddi dahil —
 *    bu kapıdan GEÇMEZ; F2 bir susturma mekanizması DEĞİLDİR.
 *
 * ── FILLER ≠ SEMANTİK ACK (§9.6) ───────────────────────────────────────────
 * | Durum                                   | İzin | Örnek                      |
 * |-----------------------------------------|------|----------------------------|
 * | Uzun sürecek GERÇEK iş başladı          | ✅   | "Ev adresini arıyorum."    |
 * | Belirsizlik giderme                     | ✅   | "Annen mi, kayınvaliden mi?"|
 * | Yetenek yok / gerçek hata               | ✅   | "Şu an buna ulaşamadım."   |
 * | Sadece gecikmeyi örtmek                 | ❌   | "Bir saniye…"              |
 * | Model düşünüyor                         | ❌   | "Düşünüyorum…"             |
 *
 * **Kural:** Bir ACK ancak **kullanıcının davranışını değiştirebiliyorsa** meşrudur.
 * ACK ≠ BAŞARI: ACK yalnız işin BAŞLADIĞINI söyler, bittiğini İDDİA ETMEZ
 * (`maviActionAuthority` / `IntentExecutionResult` dürüstlük kapıları aynen geçerli).
 */

/**
 * Türkçe harfleri ASCII'ye katlar + noktalama/üç nokta/boşluk gürültüsünü atar.
 *
 * KATLAMA `toLowerCase()`'DEN **ÖNCEDİR** (bilinçli): JS `'İ'.toLowerCase()`'i
 * Türkçe yerele göre yapmaz, `i` + BİRLEŞTİREN NOKTA (U+0307) üretir. Sıra ters
 * olsaydı o nokta ASCII süzgecinde BOŞLUĞA dönüşür ve "İki saniye" → "i ki saniye"
 * olurdu; yani kalıp eşleşmez, filler kaçardı.
 */
function _normalize(text: string): string {
  return text
    .replace(/[İIı]/g, 'i')
    .replace(/[ÖöOo]/g, 'o')
    .replace(/[ÜüUu]/g, 'u')
    .replace(/[Ççc]/g, 'c')
    .replace(/[Şş]/g, 's')
    .replace(/[Ğğ]/g, 'g')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * İçeriksiz bekletme kalıpları — HEPSİ `^…$` ile ÇAPALIDIR (tam eşleşme).
 * Çapa bilinçlidir: kalıbın bir cümlenin İÇİNDE geçmesi filler yapmaz, çünkü
 * o cümle bir özne taşıyorsa artık bilgi taşıyor demektir.
 */
const FILLER_PATTERNS: readonly RegExp[] = Object.freeze([
  // "Bakıyorum" · "Bakıyorum hemen" · "Hemen bakıyorum" · "Şimdi bakayım"
  /^(hemen|simdi|peki|tamam|bir)?\s?(bakiyorum|bakayim|bakiyim|bakalim)\s?(hemen|simdi|bakalim)?$/,
  // "Bir saniye" · "İki saniye" · "Bir dakika" · "Bir saniye bekle"
  /^(bir|iki|uc|birkac)\s(saniye|saniyecik|dakika|dakka)(\s(bekle|lutfen|daha))?$/,
  // "Düşünüyorum" · "Bir düşüneyim" · "Düşüneyim"
  /^(bir\s)?(dusunuyorum|dusuneyim|dusunmem lazim)$/,
  // "Kontrol ediyorum" · "Kontrol edeyim"
  /^(bir\s)?kontrol\s(ediyorum|edeyim)$/,
  // "Anlıyorum" (saha 2026-06-12: anlama İMA eden içeriksiz ara söz)
  /^anliyorum$/,
  // "Bekle" · "Bekleyin" · "Birazdan" · "Az kaldı"
  /^(bekle|bekleyin|bekliyorum|birazdan|az kaldi)$/,
  // "Araştırıyorum" · "Arıyorum" — ÖZNESİZ hâli (öznesi varsa semantik ACK'tir)
  /^(arastiriyorum|ariyorum|inceliyorum|hesapliyorum)$/,
  // İngilizce eşdeğerleri (model karışık dil üretebilir)
  /^(thinking|checking|let me check|let me see|one moment|just a (sec|second|moment)|hold on|one sec|give me a second)$/,
]);

/**
 * Metin, **yalnızca gecikmeyi örten** içeriksiz bir ara söz mü?
 *
 * `true` → I11 ihlali; `maviSpeech` KONUŞMAZ ve F0 izine `filler_trigger` yazar.
 * Boş/geçersiz girdi `false` döner (boş metni zaten `speakMaviAnswer` düşürür).
 */
export function isGenericFiller(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  const n = _normalize(text);
  if (!n) return false;
  for (const re of FILLER_PATTERNS) {
    if (re.test(n)) return true;
  }
  return false;
}
