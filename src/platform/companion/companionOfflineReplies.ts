/**
 * companionOfflineReplies.ts — **MAVI-F13/3 · DETERMİNİSTİK OFFLINE SINIFLAMA.**
 *
 * ── NE İÇİN VAR ─────────────────────────────────────────────────────────────
 * `companionChatProvider` bir DEEP sağlayıcıdır. Ama içinde model, prompt ve ağ
 * ile HİÇ ilgisi olmayan bir katman vardı: **anahtar kelime tabanlı smalltalk
 * sınıflaması + hazır offline cevap tablosu**. Bu bir sağlayıcı işi değil,
 * ağ yokken konuşulacak deterministik yedektir.
 *
 * ── ANA YOL DEĞİLDİR (mimari sözleşme) ──────────────────────────────────────
 * `classifySmalltalk` **ROTA KARARI VERMEZ**: companion açıkken cümle içeriğine
 * bakılmaz, her şey beyne gider (modül başlığı §AI-FIRST). Bu tablo yalnız
 * ağ/kota kapandığında konuşur. Buraya yeni bir "niyet motoru" büyütmek
 * ikinci bir sınıflandırma otoritesi doğurur — YASAK.
 *
 * ── SÖZLEŞME ────────────────────────────────────────────────────────────────
 *  · **IMPORT YOK.** Yaprak modül: hiçbir platform modülüne bağlanmaz.
 *  · **AĞ/ZAMAN/I/O YOK.** `Date.now` · `fetch` · `localStorage` kullanmaz.
 *  · **Math.random YOK.** Rotasyon deterministik sayaçladır → testler kararlı,
 *    kullanıcı da art arda aynı cümleyi duymaz.
 *  · **DAVRANIŞ DEĞİŞMEDİ.** Anahtar kelimeler, cevap metinleri ve sürüş/park
 *    ayrımı `companionChatProvider`dan **birebir** taşındı.
 */

export type SmalltalkKind = 'greeting' | 'howareyou' | 'bored' | 'chat' | 'fatigue' | 'thanks';

/**
 * Anahtar kelime eşleşmesi için Türkçe katlama (aksan/noktalama düşer).
 * `offlineConversationEngine.norm` ile aynı kural — bağımlılık almadan.
 * Dışa verilir çünkü aynı deterministik katlamayı sağlayıcıdaki hava-sorgusu
 * kalıbı da kullanır: İKİ ayrı normalize kuralı = iki ayrı eşleşme gerçeği.
 */
export function normalizeKeywordText(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

const SMALLTALK: ReadonlyArray<{ kind: SmalltalkKind; kw: readonly string[] }> = [
  { kind: 'howareyou', kw: ['nasilsin', 'nasil misin', 'naber', 'ne haber', 'ne var ne yok',
                            'iyi misin', 'keyifler nasil', 'keyfin nasil', 'gunun nasil'] },
  { kind: 'greeting',  kw: ['merhaba', 'selam', 'gunaydin', 'iyi aksamlar', 'iyi geceler'] },
  { kind: 'bored',     kw: ['canim sikildi', 'sikildim', 'cok sikici', 'moralim bozuk',
                            'kotu hissediyorum', 'can sikiyor'] },
  { kind: 'chat',      kw: ['sohbet edelim', 'sohbet et', 'muhabbet edelim', 'konusalim',
                            'bir sey anlat', 'bana bir sey anlat', 'hikaye anlat', 'anlat bana',
                            'benimle konus'] },
  { kind: 'fatigue',   kw: ['yorgunum', 'yoruldum', 'uykum geldi', 'uykum var'] },
  { kind: 'thanks',    kw: ['tesekkurler', 'tesekkur ederim', 'sagol', 'eyvallah'] },
];

/** Offline fallback kategori ipucu; eşleşme yoksa null. ROUTE KARARI DEĞİLDİR. */
export function classifySmalltalk(raw: string): SmalltalkKind | null {
  const n = normalizeKeywordText(raw);
  if (!n) return null;
  for (const { kind, kw } of SMALLTALK) {
    for (const k of kw) {
      if (n === k || n.includes(k)) return kind;
    }
  }
  return null;
}

/* ── Offline fallback yanıtları ─────────────────────────────── */

// Deterministik rotasyon (Math.random yok → testler kararlı, tekrar hissi az)
let _offlineCounter = 0;

const OFFLINE_REPLIES: Record<SmalltalkKind, { full: string[]; short: string }> = {
  greeting: {
    full: ['Merhaba! Yolculuk boyunca buradayım.', 'Selam! Hazırsan yola devam.'],
    short: 'Merhaba!',
  },
  howareyou: {
    full: ['İyiyim, teşekkürler. Sen nasılsın, yolculuk nasıl gidiyor?',
           'Gayet iyiyim. Bir şeye ihtiyacın olursa söylemen yeter.'],
    short: 'İyiyim, teşekkürler!',
  },
  bored: {
    full: ['Anlıyorum. İstersen biraz müzik açalım, yol daha keyifli geçer.',
           'Olur öyle. Müzik ya da kısa bir mola iyi gelebilir.'],
    short: 'İstersen müzik açalım.',
  },
  chat: {
    full: ['Tabii, buradayım. Aklında ne var?',
           'Seve seve. Ne konuşmak istersin?'],
    short: 'Buradayım, dinliyorum.',
  },
  fatigue: {
    full: ['Yorgunluk yolun doğası. İlk uygun yerde kısa bir mola iyi gelir.',
           'Kendini ağır hissediyorsan mola verelim, acele etme.'],
    short: 'Uygun yerde mola verelim.',
  },
  thanks: {
    full: ['Rica ederim, her zaman.', 'Ne demek, iyi yolculuklar!'],
    short: 'Rica ederim!',
  },
};

/**
 * Kategoriye karşılık gelen offline cevap. SÜRÜŞTE kısa hâl konuşulur
 * (dikkat bütçesi · ISO 15008); park hâlinde uzun hâller sırayla döner.
 */
export function offlineCategoryReply(kind: SmalltalkKind, isDriving: boolean): string {
  const entry = OFFLINE_REPLIES[kind];
  if (isDriving) return entry.short;
  const reply = entry.full[_offlineCounter % entry.full.length];
  _offlineCounter++;
  return reply;
}

/** @internal — testler arası izolasyon (üretim yolunda çağrılmaz). */
export function _resetOfflineRepliesForTest(): void {
  _offlineCounter = 0;
}
