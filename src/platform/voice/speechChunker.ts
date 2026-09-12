/**
 * speechChunker.ts — **MAVİ F4 · GÜVENLİ KONUŞMA PARÇALAYICI.**
 *
 * ── NEDEN VAR ───────────────────────────────────────────────────────────────
 * Streaming LLM token üretir; token bir konuşma birimi DEĞİLDİR. Ham token'ı
 * TTS'e vermek kelimeyi ortasından böler ("Kadı… köy"), yarım cümle konuşturur
 * ve sentez motorunu saniyede onlarca kez tetikler. Bu katman token akışını
 * **anlamlı, tamamlanmış, sırayla konuşulabilir** parçalara çevirir.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** hiçbir modülü import ETMEZ · I/O · timer · `Date.now` · global
 *    durum YOK. Zaman DIŞARIDAN verilir (maxWait kararı çağıranındır).
 *  · **KELİME ORTASINDA ASLA KESME.** Zorunlu boşaltmada bile son tam sözcük
 *    sınırına kadar verilir; kalanı tamponda bekler.
 *  · **YARIM YAPI KONUŞULMAZ.** Dengelenmemiş tırnak/parantez/JSON izi varsa
 *    parça yayınlanmaz (`streamSayExtractor` üstte zaten ayırır — bu ikinci kat).
 *  · **İLK PARÇA ANLAM TAŞIR.** İçeriksiz giriş kalıbı ("Tabii," / "Elbette,")
 *    TEK BAŞINA ilk parça olarak yayınlanmaz; arkasından gelen gerçek içerikle
 *    BİRLEŞTİRİLİR. Böylece "ilk ses" değil **ilk ANLAMLI ses** hızlanır.
 *  · **F2 KORUNUR:** bu katman metin ÜRETMEZ, yalnız BÖLER — dolayısıyla yapay
 *    ara söz ("Bakıyorum") burada doğamaz.
 */

/** Parçalama eşikleri — TEK KAYNAK. */
export interface ChunkPolicy {
  /**
   * İLK parça için asgari karakter. Küçük tutulur: ilk sesin erken çıkması
   * F4'ün bütün amacıdır. Ama 0 olamaz — tek harflik parça sentez motorunu
   * boşa tetikler ve "tık" sesi üretir.
   */
  readonly minFirstChars: number;
  /** Sonraki parçalar için asgari karakter (gereksiz bölme = sarsıntılı ses). */
  readonly minChars: number;
  /**
   * Sınır bulunamazsa zorunlu boşaltma tavanı. Aşılırsa SON TAM SÖZCÜK
   * sınırından bölünür — kelime ortasından ASLA.
   */
  readonly maxChars: number;
  /**
   * Yan tümce sınırı (`,` `;` `:`) parça sonu sayılsın mı. Cümle sınırı
   * (`.` `!` `?`) her hâlükârda sayılır.
   */
  readonly allowClauseBreak: boolean;
}

export const DEFAULT_CHUNK_POLICY: ChunkPolicy = Object.freeze({
  minFirstChars: 12,
  minChars: 40,
  maxChars: 180,
  allowClauseBreak: true,
});

export interface SpeechChunker {
  /** Metin deltası ekler; hazır olan parçaları SIRAYLA döndürür (yoksa boş dizi). */
  push(delta: string): string[];
  /**
   * Akış bitti — tamponda kalan her şeyi son parça olarak döndürür.
   * Burada asgari uzunluk kuralı UYGULANMAZ: cevabın kuyruğu YUTULAMAZ.
   */
  flush(): string[];
  /** Bounded tanı — METİN TAŞIMAZ. */
  stats(): { readonly chunks: number; readonly chars: number; readonly pendingChars: number };
}

/* ── İçeriksiz giriş kalıpları ────────────────────────────────────────────
 * "İlk ses" ile "ilk ANLAMLI ses" farkını kapatır. Liste BOUNDED ve yalnız
 * İLK parçaya, yalnız TAM EŞLEŞMEDE uygulanır (cümlenin içinde geçen aynı
 * sözcükler etkilenmez). Kalıp tek başına kalırsa yayınlanmaz — arkasından
 * gelen gerçek içerikle birleştirilir; hiçbir metin SİLİNMEZ.
 *
 * NOT: bu bir F2 filler'ı DEĞİLDİR (F2 gecikmeyi örten AYRI bir cümledir).
 * Buradaki kalıp modelin cevabının parçasıdır; yalnız BÖLÜNME NOKTASI değişir. */
const CONTENTLESS_OPENERS: readonly RegExp[] = Object.freeze([
  /^(tabii|tabi|elbette|memnuniyetle|olur|peki|tamam)( ki)?[ ,]*$/i,
  /^(hemen|simdi|şimdi) (soyleyeyim|söyleyeyim|bakalim|bakalım)[ ,]*$/i,
  /^(tabii|tabi|elbette)[ ,]+(hemen|simdi|şimdi)[ ,]*$/i,
  /^(evet|hayir|hayır)[ ,]*$/i,
]);

function isContentlessOpener(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  for (const re of CONTENTLESS_OPENERS) if (re.test(t)) return true;
  return false;
}

/**
 * Tamponun yapısal olarak YAYINLANABİLİR olup olmadığı.
 *
 * İkinci savunma katmanı: `streamSayExtractor` yapısal çıktıyı zaten ayırır,
 * ama model `say` içinde tırnak/parantez açıp kapatmadıysa yarım yapı
 * konuşulmamalıdır. Dengesizlik varsa parça BEKLETİLİR.
 */
function isStructurallySafe(text: string): boolean {
  let quotes = 0, paren = 0, brace = 0, bracket = 0;
  for (const c of text) {
    if (c === '"') quotes += 1;
    else if (c === '(') paren += 1;
    else if (c === ')') paren -= 1;
    else if (c === '{') brace += 1;
    else if (c === '}') brace -= 1;
    else if (c === '[') bracket += 1;
    else if (c === ']') bracket -= 1;
  }
  return quotes % 2 === 0 && paren === 0 && brace === 0 && bracket === 0;
}

/** Cümle sonu sınırının tampondaki SON konumu (+1) — yoksa -1. */
function lastSentenceBoundary(buf: string): number {
  for (let i = buf.length - 1; i >= 0; i--) {
    const c = buf[i];
    if (c !== '.' && c !== '!' && c !== '?' && c !== '…') continue;
    /* Sınır ancak ARDINDAN boşluk gelirse GÜVENLİDİR: aksi halde "3.5" ya da
     * henüz tamamlanmamış "Ankara." (sonrası gelecek) yanlış bölünür. */
    if (i + 1 < buf.length && /\s/.test(buf[i + 1])) return i + 1;
  }
  return -1;
}

/** Yan tümce sınırının tampondaki SON konumu (+1) — yoksa -1. */
function lastClauseBoundary(buf: string): number {
  for (let i = buf.length - 1; i >= 0; i--) {
    const c = buf[i];
    if (c !== ',' && c !== ';' && c !== ':') continue;
    if (i + 1 < buf.length && /\s/.test(buf[i + 1])) return i + 1;
  }
  return -1;
}

/** Son TAM sözcük sınırı (+1) — kelime ortasından bölmeyi imkânsız kılar. */
function lastWordBoundary(buf: string, limit: number): number {
  for (let i = Math.min(limit, buf.length) - 1; i > 0; i--) {
    if (/\s/.test(buf[i])) return i + 1;
  }
  return -1;
}

export function createSpeechChunker(policy: ChunkPolicy = DEFAULT_CHUNK_POLICY): SpeechChunker {
  let buf = '';
  let chunks = 0;
  let chars = 0;
  /** İlk parça henüz verilmedi mi (eşik ve giriş kalıbı kuralı buna bağlı). */
  let first = true;

  const take = (cut: number): string => {
    const out = buf.slice(0, cut).trim();
    buf = buf.slice(cut);
    return out;
  };

  const tryEmit = (): string | null => {
    if (!buf.trim()) return null;
    const minChars = first ? policy.minFirstChars : policy.minChars;

    let cut = lastSentenceBoundary(buf);
    if (cut < 0 && policy.allowClauseBreak && buf.trim().length >= minChars) {
      cut = lastClauseBoundary(buf);
    }
    /* ZORUNLU BOŞALTMA: sınır yok ama tampon tavanı aştı → SON TAM SÖZCÜKten böl.
     * Kelime ortasından bölme burada da imkânsızdır. */
    if (cut < 0 && buf.length >= policy.maxChars) {
      cut = lastWordBoundary(buf, policy.maxChars);
    }
    if (cut <= 0) return null;

    const candidate = buf.slice(0, cut).trim();
    if (candidate.length < minChars) return null;
    if (!isStructurallySafe(candidate)) return null;      // yarım yapı KONUŞULMAZ

    /* İLK PARÇA ANLAM TAŞIMALI: içeriksiz giriş kalıbı tek başına konuşulmaz —
     * tamponda BEKLETİLİR ve arkasından gelen gerçek içerikle birleşir.
     * Metin silinmez, yalnız bölünme noktası ötelenir. */
    if (first && isContentlessOpener(candidate)) return null;

    const out = take(cut);
    if (!out) return null;
    first = false;
    chunks += 1;
    chars += out.length;
    return out;
  };

  return {
    push(delta: string): string[] {
      if (typeof delta !== 'string' || !delta) return [];
      buf += delta;
      const out: string[] = [];
      for (;;) {
        const c = tryEmit();
        if (c === null) break;
        out.push(c);
      }
      return out;
    },
    flush(): string[] {
      const out: string[] = [];
      for (;;) {
        const c = tryEmit();
        if (c === null) break;
        out.push(c);
      }
      /* Kuyruk KOŞULSUZ verilir: asgari uzunluk kuralı burada uygulanmaz, aksi
       * halde cevabın son cümlesi sessizce yutulurdu. Yapısal güvenlik kontrolü
       * de burada GEVŞETİLİR — akış bitti, beklenecek devam yok. */
      const tail = buf.trim();
      buf = '';
      if (tail) {
        first = false;
        chunks += 1;
        chars += tail.length;
        out.push(tail);
      }
      return out;
    },
    stats: () => ({ chunks, chars, pendingChars: buf.length }),
  };
}
