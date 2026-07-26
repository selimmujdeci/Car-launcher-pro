/**
 * controlChars — C0/C1 kontrol karakteri tespiti ve temizliği (REGEX'SİZ).
 *
 * NİYET (değişmedi): AI hattına giren serbest metinden görünmez kontrol
 * karakterlerini ayıklamak. Bunlar iki ayrı riski taşır:
 *   1. PROMPT ENJEKSİYONU — kontrol karakteriyle blok sınırı taklit edilip
 *      "araç çıktısı" bölümünden talimat sızdırılabilir.
 *   2. BOZUK KOPYALA/YAPIŞTIR — API anahtarına karışan `\r`/`‎` benzeri
 *      görünmez baytlar sessiz kimlik doğrulama hatası üretir.
 *
 * KAPSAM: U+0000–U+001F (C0), U+007F (DEL), U+0080–U+009F (C1).
 * Daha önce her çağrı yerinde `new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]')`
 * ile ifade edilen kümenin BİREBİR AYNISI — genişletilmedi, daraltılmadı.
 *
 * ⚠️ NEDEN REGEX YOK — üç gerekçe (2026-07-26):
 *
 *  (a) `no-control-regex` kaçınılmaz olarak tetikleniyordu. Kuralın amacı
 *      "regex'e KAZAYLA kontrol karakteri kaçmasın"dır; burada kasıtlıydı, ama
 *      kuralı 7 dosyada tek tek susturmak (eslint-disable) kök nedeni gizlerdi.
 *
 *  (b) Kuralın önerdiği modern karşılık `\p{Cc}` (Unicode property escape)
 *      KULLANILAMAZ: `vite.config.ts` `build.target: 'es2015'` +
 *      `targets: ['Chrome >= 50', 'Android >= 6']`. Property escape Chrome 64+
 *      ister ve transpile EDİLMEZ → eski head unit WebView'ında REGEX SÖZDİZİMİ
 *      HATASI = modül hiç yüklenmez. Satılan cihazlarda kabul edilemez risk.
 *
 *  (c) Yedi çağrı yerinin dördü `new RegExp(...)`i HER ÇAĞRIDA yeniden derliyordu
 *      (sanitize fonksiyonunun İÇİNDE). Kod-noktası taraması hem tahsis üretmez
 *      hem de temiz metinde (baskın durum) girdiyi olduğu gibi döndürür —
 *      CLAUDE.md "Zero-Allocation Hot-Paths" ilkesiyle uyumlu.
 *
 * Saf, yan etkisiz, ES5-güvenli. Yeni servis/abonelik/timer YOK.
 */

/** Kod birimi C0/C1 kontrol aralığında mı? (tek karşılaştırma noktası) */
function isControlCode(c: number): boolean {
  return c <= 0x1f || (c >= 0x7f && c <= 0x9f);
}

/**
 * Metinde en az bir C0/C1 kontrol karakteri var mı?
 * Eski `CONTROL_CHARS_RE.test(s)` ile aynı sonucu verir.
 */
export function hasControlChars(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    if (isControlCode(text.charCodeAt(i))) return true;
  }
  return false;
}

/**
 * Her C0/C1 kontrol karakterini `replacement` ile değiştirir.
 * Eski `text.replace(CONTROL_g, ' ')` ile aynı sonucu verir (karakter başına
 * TEK değiştirme). Kontrol karakteri yoksa girdi AYNEN döner (tahsis yok).
 */
export function stripControlChars(text: string, replacement = ' '): string {
  let first = -1;
  for (let i = 0; i < text.length; i++) {
    if (isControlCode(text.charCodeAt(i))) { first = i; break; }
  }
  if (first === -1) return text;            // baskın durum: temiz metin, tahsis yok

  let out = text.slice(0, first);
  for (let i = first; i < text.length; i++) {
    const c = text.charCodeAt(i);
    out += isControlCode(c) ? replacement : text[i];
  }
  return out;
}
