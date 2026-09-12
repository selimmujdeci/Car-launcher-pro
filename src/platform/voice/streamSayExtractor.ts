/**
 * streamSayExtractor.ts — **MAVİ F4 · YAPISAL ÇIKTI ile KONUŞULACAK METNİN AYRIMI.**
 *
 * ── NEDEN VAR (F4'ün en kritik güvenlik sınırı) ─────────────────────────────
 * Mavi'nin beyni **düz metin DEĞİL, JSON** döndürür:
 *   `{"type":"chat","say":"..."}` · `{"type":"action","intent":"...","feedback":"..."}`
 *   `{"type":"web","query":"..."}`
 * Dolayısıyla token akışını doğrudan TTS'e vermek felakettir: kullanıcı
 * `{"type":"chat","say":` diye bir ses duyar. Daha kötüsü, `action` gövdesinin
 * parçaları ("intent OPEN_NAVIGATION destination Kadıköy") seslendirilir ve
 * **model çıktısı bir yetki gibi konuşulmuş** olur.
 *
 * Bu modül akışı **yapısal olarak** ikiye ayırır:
 *   · `chat` → YALNIZ `say` alanının içeriği konuşulabilir metindir.
 *   · `action` / `web` / bilinmeyen → **HİÇBİR ŞEY konuşulmaz.** Karar ve
 *     seslendirme kanonik zincire (parse → planner → safety → executor) kalır.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **SAF:** hiçbir modülü import ETMEZ · I/O · timer · `Date.now` · global
 *    durum YOK. Durum yalnız fabrika kapanışında (closure) tutulur.
 *  · **LLM AKIŞI OTORİTE DEĞİLDİR.** Bu modül metin üretir; eylem üretmez.
 *  · **BELİRSİZLİKTE SUS.** `type` henüz okunmadıysa hiçbir şey yayınlanmaz —
 *    "muhtemelen chat'tir" varsayımı yapılmaz (fail-closed).
 *  · **KELİME ORTASINDA KESME YOK.** JSON kaçış dizisi (`\"`, `\n`, `\uXXXX`)
 *    yarım kaldıysa o parça tamamlanana kadar bekletilir.
 *  · **BOUNDED:** tampon ve yayınlanan metin tavanlıdır; bozuk/sonsuz akış
 *    belleği büyütemez.
 */

/** Akışın o ana kadar anlaşılan sınıfı. */
export type SayStreamState =
  /** `type` henüz görülmedi — hiçbir şey konuşulamaz (fail-closed). */
  | 'UNKNOWN'
  /** `type:"chat"` doğrulandı ve `say` içeriği akıyor — konuşulabilir. */
  | 'SPEAKABLE'
  /** `type` `action`/`web` ya da tanınmayan → bu akıştan HİÇBİR ŞEY konuşulmaz. */
  | 'STRUCTURED'
  /** `say` dizesi kapandı — sonrası (JSON kuyruğu) konuşulmaz. */
  | 'DONE';

export interface SayExtractor {
  /** Yeni token'ı yutar; **konuşulabilir yeni metin** varsa onu döndürür (yoksa ''). */
  push(token: string): string;
  /** Akış bitti — tamponda kalan güvenli metni döndürür. */
  finish(): string;
  state(): SayStreamState;
  /** Bounded tanı — METİN TAŞIMAZ. */
  stats(): { readonly chars: number; readonly emitted: number; readonly truncated: boolean };
}

/** Konuşulabilir metin tavanı (bir cevap için). Üstü sessizce kırpılır. */
export const SAY_MAX_CHARS = 4000;
/** Ham tampon tavanı — `type` hiç gelmezse bellek büyümesin. */
const RAW_MAX_CHARS = 8000;

/** `"type"` alanının değerini ham tampondan okur (henüz yoksa `null`). */
function readType(raw: string): string | null {
  const m = /"type"\s*:\s*"([a-z_]*)"/i.exec(raw);
  return m ? m[1].toLowerCase() : null;
}

/**
 * `"say"` dizesinin İÇERİK başlangıç indeksini bulur (açış tırnağından SONRASI).
 * Bulunamazsa -1.
 */
function findSayStart(raw: string): number {
  const m = /"say"\s*:\s*"/.exec(raw);
  return m ? m.index + m[0].length : -1;
}

/**
 * JSON dize gövdesini çözer ve **GÜVENLİ ÖN EK**i döndürür.
 *
 * Güvenli ön ek = kaçış dizisi yarım kalmamış en uzun parça. Örn. tampon
 * `Merhaba\` ile bitiyorsa ters eğik çizgi sonraki token'da tamamlanacaktır →
 * o karakter DIŞARIDA bırakılır (yarım kaçış konuşulmaz).
 *
 * @returns `{ text, closed, consumed }` — `closed` dizenin kapandığını,
 *          `consumed` ham tampondan tüketilen karakter sayısını bildirir.
 */
function decodeJsonStringPrefix(body: string): { text: string; closed: boolean; consumed: number } {
  let out = '';
  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '"') return { text: out, closed: true, consumed: i + 1 };
    if (c !== '\\') { out += c; i += 1; continue; }
    // Kaçış dizisi — tamamlanmamışsa BURADA dur (yarım kaçış yayınlanmaz).
    if (i + 1 >= body.length) break;
    const e = body[i + 1];
    if (e === 'u') {
      if (i + 6 > body.length) break;                       // \uXXXX henüz tam değil
      const hex = body.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) { out += e; i += 2; continue; }
      out += String.fromCharCode(parseInt(hex, 16));
      i += 6;
      continue;
    }
    switch (e) {
      case 'n': out += '\n'; break;
      case 't': out += ' ';  break;   // sekme konuşmada boşluktur
      case 'r': break;                // satır başı sesli karşılığı YOK
      case 'b': case 'f': break;
      case '"': out += '"'; break;
      case '\\': out += '\\'; break;
      case '/': out += '/'; break;
      default: out += e; break;
    }
    i += 2;
  }
  return { text: out, closed: false, consumed: i };
}

/**
 * Yeni bir çıkarıcı üretir. **Fabrika deseni bilinçlidir:** modül düzeyinde
 * mutable durum tutulsaydı iki eşzamanlı akış birbirinin metnini kirletirdi.
 */
export function createSayExtractor(): SayExtractor {
  let raw = '';
  let state: SayStreamState = 'UNKNOWN';
  /** `say` gövdesinin ham tampondaki başlangıcı (-1 = henüz yok). */
  let sayStart = -1;
  /** Şimdiye dek YAYINLANMIŞ çözülmüş metnin uzunluğu (delta hesabı). */
  let emittedLen = 0;
  let truncated = false;

  const advance = (): string => {
    if (state === 'STRUCTURED' || state === 'DONE') return '';

    /* 1) Sınıflandırma — `type` görülene kadar KESİNLİKLE sessiz kalınır. */
    if (state === 'UNKNOWN') {
      const t = readType(raw);
      if (t === null) return '';
      if (t !== 'chat') { state = 'STRUCTURED'; return ''; }   // action/web/bilinmeyen → SUS
      state = 'SPEAKABLE';
    }

    /* 2) `say` gövdesinin başlangıcı. Model alanları sırasız üretebilir; gelene
     *    kadar beklenir (uydurma yapılmaz). */
    if (sayStart < 0) {
      sayStart = findSayStart(raw);
      if (sayStart < 0) return '';
    }

    /* 3) Gövdeyi güvenli ön ek olarak çöz ve YALNIZ yeni kısmı döndür. */
    const { text, closed } = decodeJsonStringPrefix(raw.slice(sayStart));
    let full = text;
    if (full.length > SAY_MAX_CHARS) { full = full.slice(0, SAY_MAX_CHARS); truncated = true; }
    const delta = full.slice(emittedLen);
    emittedLen = full.length;
    if (closed) state = 'DONE';
    return delta;
  };

  return {
    push(token: string): string {
      if (typeof token !== 'string' || !token) return '';
      if (raw.length >= RAW_MAX_CHARS) { truncated = true; return ''; }
      raw += token;
      return advance();
    },
    finish(): string {
      // Akış kapanışında kalan güvenli metin (dize kapanmamış olabilir — model
      // yarıda kesildi; o hâlde bile YARIM KAÇIŞ yayınlanmaz).
      return advance();
    },
    state: () => state,
    stats: () => ({ chars: raw.length, emitted: emittedLen, truncated }),
  };
}
