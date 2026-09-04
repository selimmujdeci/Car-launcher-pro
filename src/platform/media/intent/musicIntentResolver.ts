/**
 * musicIntentResolver.ts — MUSIC F9 · Doğal dil → kanonik `MusicIntent` (SAF).
 *
 * TAMAMEN YEREL VE DETERMİNİSTİK: bulut/LLM GEREKTİRMEZ (§13). Bulut varsa
 * yalnız YORUM yardımcısı olabilir; bu dosya olmadan da temel taşıma · arama ·
 * kuyruk · devam komutları ÇALIŞIR.
 *
 * SINIR: burada RANKING YOKTUR. "Hangi parça" sorusunun cevabı F5'indir; bu
 * modül yalnız "ne istendi"yi çıkarır ve sorgu metnini AYNEN taşır.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

import type { ProviderId } from '../providers';
import { makeIntent, type MusicIntent, type SourceQualifier } from './musicIntent';

/** Türkçe küçültme + aksan/şapka sadeleştirme (arama katmanıyla aynı ilke). */
function normalize(raw: string): string {
  return (raw ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Kaynak niteleyicileri ────────────────────────────────────────────────
 * Kullanıcı kaynağı SÖYLEDİYSE bu bir FİLTREdir; sıralamayı değiştirmez. */
const SOURCE_PATTERNS: readonly (readonly [ProviderId, readonly string[]])[] = Object.freeze([
  ['spotify', ['spotifyden', 'spotify dan', 'spotifyda', 'spotify da', 'spotify']],
  ['youtube', ['youtubedan', 'youtube dan', 'youtubeda', 'youtube da', 'youtube', 'yutub']],
  ['radio', ['radyodan', 'radyoda', 'radyo']],
  ['local', ['cihazdan', 'cihazdaki', 'cihazda', 'telefondan', 'hafizadan',
    'yerelden', 'yerel', 'kendi muziklerimden', 'indirdiklerimden']],
]);

export function detectSourceQualifier(utterance: string): SourceQualifier | null {
  const n = normalize(utterance);
  for (const [providerId, tokens] of SOURCE_PATTERNS) {
    for (const token of tokens) {
      if (n.includes(token)) return Object.freeze({ providerId, spoken: token });
    }
  }
  return null;
}

/** Kaynak ifadesini sorgudan çıkarır — "spotify'dan sezen aksu" → "sezen aksu". */
function stripSource(text: string): string {
  let out = text;
  for (const [, tokens] of SOURCE_PATTERNS) {
    for (const token of tokens) {
      out = out.replace(new RegExp(`\\b${token}\\b`, 'g'), ' ');
    }
  }
  return out.replace(/\s+/g, ' ').trim();
}

/** Komut fiillerini sorgudan temizler — sorgu metni İÇERİK olmalıdır. */
const PLAY_VERBS = [
  'calar misin', 'calsana', 'calar mısın', 'aciver', 'ac bakalim',
  'dinlemek istiyorum', 'dinleyelim', 'baslat', 'oynat', 'calmaya basla',
  'cal', 'ac',
];

function stripPlayVerbs(text: string): string {
  let out = ` ${text} `;
  for (const verb of PLAY_VERBS) {
    out = out.replace(new RegExp(`\\s${verb}\\s`, 'g'), ' ');
  }
  return out.replace(/\s+/g, ' ').trim();
}

const has = (n: string, ...tokens: readonly string[]): boolean =>
  tokens.some((t) => n.includes(t));

/* ── MUSIC F15 · Playlist adı çıkarma kalıpları ─────────────────────────── */
const PLAYLIST_ADD_RE = /(?:bunu\s+)?(.+?)\s+liste(?:m|me|min|mine|sine)\s+ekle/;
const PLAYLIST_CREATE_RE = /(?:yeni\s+(?:bir\s+)?)?(.+?)\s+(?:adinda\s+(?:yeni\s+)?bir\s+liste|listesi)\s+(?:oluştur|olustur)/;
const PLAYLIST_OPEN_RE = /(.+?)\s+liste(?:m|min)i\s+(?:aç|ac|çal|cal)/;
const PLAYLIST_PLAY_FROM_RE = /(.+?)\s+listemden\s+(?:çal|cal)/;
const PLAYLIST_REMOVE_RE = /(?:bunu\s+)?(.+?)\s+listemden\s+(?:çikar|cikar)/;

/** Türkçe sayı sözcükleri — "iki şarkı ileri". */
const NUMBER_WORDS: Readonly<Record<string, number>> = Object.freeze({
  bir: 1, iki: 2, uc: 3, dort: 4, bes: 5, alti: 6, yedi: 7, sekiz: 8, dokuz: 9, on: 10,
});

function readCount(n: string): number | null {
  const digits = /(\d{1,2})/.exec(n);
  if (digits) {
    const v = Number(digits[1]);
    return Number.isFinite(v) && v > 0 && v <= 50 ? v : null;
  }
  for (const [word, value] of Object.entries(NUMBER_WORDS)) {
    if (new RegExp(`\\b${word}\\b`).test(n)) return value;
  }
  return null;
}

/**
 * Söylenen ifadeyi kanonik niyete çevirir.
 *
 * `null` = bu bir müzik niyeti DEĞİL. Emin olmadığında niyet UYDURULMAZ:
 * yanlış niyet, araçta yanlış şarkı çalmak demektir.
 *
 * SIRA ÖNEMLİDİR: en dar/kesin kalıplar önce denenir; genel "çal" en sonda.
 */
export function resolveMusicIntent(utterance: string): MusicIntent | null {
  const n = normalize(utterance);
  if (n.length === 0) return null;

  const source = detectSourceQualifier(n);

  /* ── 1 · Kuyruk (en dar kalıplar) ───────────────────────────────────── */
  if (has(n, 'sonraki cal', 'siradaki cal', 'bunu sonraki', 'bundan sonra cal')) {
    return makeIntent('PLAY_NEXT');
  }
  if (has(n, 'siraya ekle', 'listeye ekle', 'kuyruga ekle')) {
    return makeIntent('ADD_TO_QUEUE', { query: stripPlayVerbs(stripSource(n)) || null, source });
  }
  if (has(n, 'siradan cikar', 'siradakini kaldir', 'kuyruktan cikar', 'bunu listeden cikar')) {
    return makeIntent('REMOVE_CURRENT');
  }
  if (has(n, 'sirayi temizle', 'listeyi temizle', 'kuyrugu temizle')) {
    return makeIntent('CLEAR_UPCOMING');
  }
  if (has(n, 'sarki ileri', 'parca ileri', 'sarki atla')) {
    return makeIntent('JUMP_TO', { amount: readCount(n) });
  }

  /* ── 1.5 · Koleksiyon (MUSIC F13) ──────────────────────────────────────
   * Yürütücü `musicCollectionAuthority`dir — bu SAF çözümleyici hiçbir
   * favori state'i BİLMEZ/OKUMAZ, yalnız niyeti çıkarır. */
  if (has(n, 'beğendim', 'begendim')) {
    return makeIntent('ADD_FAVORITE');
  }
  if (has(n, 'favorilere ekle', 'favorime ekle', 'favorilerime ekle')) {
    return makeIntent('ADD_FAVORITE');
  }
  if (has(n,
    'favorilerden çikar', 'favorilerden cikar',
    'favoriden çikar', 'favoriden cikar',
    'favorilerimden çikar', 'favorilerimden cikar',
    'favorilerden sil', 'favorilerimden sil',
  )) {
    return makeIntent('REMOVE_FAVORITE');
  }
  if (has(n,
    'favorilerimi aç', 'favorilerimi ac',
    'favorilerimden çal', 'favorilerimden cal',
    'favorilerden çal', 'favorilerden cal',
    'favorilerimden bir şey çal', 'favorilerimden bir sey cal',
  )) {
    return makeIntent('PLAY_FAVORITES');
  }

  /* ── 1.6 · Playlist (MUSIC F15) ─────────────────────────────────────────
   * Yürütücü `musicPlaylistAuthority`dir — bu SAF çözümleyici hiçbir
   * playlist state'i BİLMEZ/OKUMAZ, yalnız niyeti VE (varsa) playlist ADINI
   * çıkarır (`playlistName`). F13'ün favori kalıplarından BİLİNÇLİ olarak
   * AYRIDIR (favoriler ↔ playlist BİRBİRİNE dönüşmez).
   *
   * ÇAKIŞMA NOTU (ÖLÇÜLDÜ, §1'de zaten var — DEĞİŞTİRİLMEDİ): adsız
   * "bunu listeden çıkar" ZATEN F3 kuyruk anlamına sahiptir (REMOVE_CURRENT
   * — "sıradan çıkar"). Bu yüzden playlist'ten çıkarma HER ZAMAN adlı bir
   * kalıp gerektirir ("X listemden çıkar"); adsız kalıp playlist'e ASLA
   * yönlendirilmez — iki kavram arasında sessiz bir kayma OLUŞMAZ. */
  const nameOf = (re: RegExp): string | null => {
    const raw = re.exec(n)?.[1]?.trim();
    if (!raw) return null;
    // Yanlışlıkla yakalanmış başlangıç dolgu sözcükleri (regex ilk eşleşme
    // konumunu HER ZAMAN "bunu"nun SONRASINA sabitleyemez) — temizlenir.
    const cleaned = raw.replace(/^(?:bunu|şunu|sunu|lütfen|lutfen)\s+/, '').trim();
    return cleaned.length > 0 ? cleaned : null;
  };

  const addMatch = nameOf(PLAYLIST_ADD_RE);
  if (addMatch) return makeIntent('ADD_TO_PLAYLIST', { playlistName: addMatch });

  const removeMatch = nameOf(PLAYLIST_REMOVE_RE);
  if (removeMatch) return makeIntent('REMOVE_FROM_PLAYLIST', { playlistName: removeMatch });

  if (PLAYLIST_CREATE_RE.test(n)) {
    return makeIntent('CREATE_PLAYLIST', { playlistName: nameOf(PLAYLIST_CREATE_RE) });
  }
  // Adsız kısayol: "yeni bir liste oluştur" — router adı SONRADAN sorar
  // (kanıtsız isim UYDURULMAZ, bkz. runPlaylist).
  if (has(n, 'yeni liste olustur', 'yeni bir liste olustur', 'liste olustur')) {
    return makeIntent('CREATE_PLAYLIST');
  }

  const playFromMatch = nameOf(PLAYLIST_PLAY_FROM_RE);
  if (playFromMatch) return makeIntent('PLAY_MY_PLAYLIST', { playlistName: playFromMatch });

  const openMatch = nameOf(PLAYLIST_OPEN_RE);
  if (openMatch) return makeIntent('PLAY_MY_PLAYLIST', { playlistName: openMatch });

  /* ── 1.7 · Sözler (MUSIC F16) ─────────────────────────────────────────
   * Yürütücü `musicLyricsAuthority`dir — bu SAF çözümleyici hiçbir lyrics
   * state'i BİLMEZ/OKUMAZ, yalnız niyeti çıkarır. "Kapat" ÖNCE denenir:
   * "sözlerini kapat" içinde "aç" GEÇMEZ ama sıra bilinçli — SHOW/HIDE
   * kalıpları birbirini asla tetiklemez. Bölüm 6'nın genel `isPlayish`
   * yakalayıcısından (" ac" içerir) ÖNCE çalışır — "sözleri aç" oraya
   * asla düşmez (aksi hâlde bu bir arama sorgusu SANILIRDI). */
  if (has(n, 'sozleri kapat', 'sozlerini kapat', 'soz panelini kapat', 'sarki sozlerini kapat')) {
    return makeIntent('HIDE_LYRICS');
  }
  if (has(n,
    'sarki sozlerini goster', 'sozlerini goster', 'sozleri goster',
    'sozleri ac', 'sozlerini ac', 'lyrics goster', 'lyrics ac',
  )) {
    return makeIntent('SHOW_LYRICS');
  }
  if (has(n,
    'sozleri var mi', 'sozu var mi', 'sarkinin sozu var mi',
    'bu sarkinin sozleri var mi', 'bunun sozu var mi',
  )) {
    return makeIntent('QUERY_LYRICS_AVAILABILITY');
  }

  /* ── 1.8 · Kesintisiz akış (MUSIC F18) ─────────────────────────────────
   * Yürütücü `smartRadioRuntime`dır — bu SAF çözümleyici hiçbir kütüphane/
   * kanıt durumu BİLMEZ, yalnız niyeti çıkarır. Sıra F13'ün "favorilerimden
   * çal"ından ÖNCE gelemez (o TEK favoriyi çalar): bu yüzden F18 kalıpları
   * "karışık/devam" sözcüğünü ZORUNLU kılar — iki kavram arasında sessiz bir
   * kayma OLUŞMAZ. */
  if (has(n,
    'favorilerimden karisik', 'favorilerden karisik',
    'favorilerimden devam', 'favorilerden devam',
    'favori karisik cal',
  )) {
    return makeIntent('PLAY_FAVORITES_MIX');
  }
  if (has(n,
    'bunun gibi devam', 'buna benzer devam', 'boyle devam et',
    'bu tarzda devam', 'benzerlerini cal', 'bunun gibilerini cal',
  )) {
    return makeIntent('CONTINUE_LIKE_THIS');
  }
  if (has(n,
    'radyo olustur', 'bundan radyo', 'bu sarkidan radyo',
    'radyo baslat', 'bir radyo ac',
  )) {
    return makeIntent('START_RADIO');
  }
  if (has(n,
    'uzun yol icin', 'uzun yolculuk icin', 'uzun sure calsin',
    'kesintisiz calsin', 'devam eden bir sira',
  )) {
    return makeIntent('LONG_DRIVE_MIX');
  }

  /* ── 2 · Bağlamsal istekler ─────────────────────────────────────────── */
  if (has(n, 'yola uygun', 'yolculuga uygun', 'yol icin', 'sürüşe uygun', 'surus icin')) {
    return makeIntent('PLAY_SOMETHING_FOR_DRIVE');
  }
  if (has(n, 'daha sakin', 'sakin bir sey', 'yavas bir sey', 'gece icin sakin')) {
    return makeIntent('PLAY_SOMETHING_CALMER');
  }
  if (has(n, 'daha hareketli', 'hareketli bir sey', 'hizli bir sey', 'enerjik')) {
    return makeIntent('PLAY_SOMETHING_MORE_ENERGETIC');
  }
  if (has(n, 'onerdigini cal', 'onerini ac', 'sen sec')) {
    return makeIntent('CONTINUE_SUGGESTED');
  }

  /* ── 3 · Devam / süreklilik ─────────────────────────────────────────── */
  if (has(n, 'kaldigim yerden', 'kaldigi yerden', 'devam et', 'devam ettir')) {
    return makeIntent('CONTINUE_LISTENING');
  }
  if (has(n, 'az once dinledigim', 'demin dinledigim', 'onceki dinledigim')) {
    return makeIntent('RESUME_CONTEXT');
  }
  if (has(n, 'bu albumden devam', 'albumden devam')) {
    return makeIntent('RESUME_CONTEXT');
  }

  /* ── 4 · Taşıma ─────────────────────────────────────────────────────── */
  if (has(n, 'bastan al', 'basa sar', 'bastan basla', 'sarkiyi bastan')) {
    return makeIntent('RESTART_TRACK');
  }
  if (has(n, 'sonraki', 'siradaki', 'gec sonraki', 'next')) return makeIntent('NEXT');
  if (has(n, 'onceki', 'bir onceki', 'geri al sarkiyi', 'previous')) return makeIntent('PREVIOUS');
  if (has(n, 'duraklat', 'durdur', 'bunu durdur', 'muzigi kes', 'sustur muzigi')) {
    return makeIntent(has(n, 'muzigi kes') ? 'STOP' : 'PAUSE');
  }
  if (has(n, 'devam ettir muzigi', 'muzigi surdur')) return makeIntent('PLAY');

  /* ── 5 · Ses ────────────────────────────────────────────────────────── */
  if (has(n, 'sesi ac', 'sesi yukselt', 'sesi artir', 'biraz daha yuksek')) {
    return makeIntent('VOLUME_UP', { amount: readCount(n) });
  }
  if (has(n, 'sesi kis', 'sesi azalt', 'muzigi biraz kis', 'biraz kis')) {
    return makeIntent('VOLUME_DOWN', { amount: readCount(n) });
  }
  if (has(n, 'sesi kapat', 'sessize al')) return makeIntent('MUTE');
  if (has(n, 'sesi geri ac', 'sessizden cikar')) return makeIntent('UNMUTE');

  /* ── 6 · Arama / çalma ──────────────────────────────────────────────── */
  const isPlayish = has(n, 'cal', ' ac', 'ac ', 'oynat', 'dinle', 'baslat', 'muzik');
  if (!isPlayish) return null;

  const query = stripPlayVerbs(stripSource(n))
    .replace(/\b(muzik|muzigi|sarki|sarkiyi|parca|parcayi|album|albumu|sanatci)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  /* Sorgu metni yoksa bu "genel müzik aç" isteğidir: yeni arama YAPILMAZ,
     kanonik devam yolu kullanılır (rastgele bir şey çalmak bir tercih değildir). */
  if (query.length === 0) {
    return source
      ? makeIntent('PLAY_PROVIDER', { source })
      : makeIntent('CONTINUE_LISTENING', { evidence: 'DERIVED' });
  }

  if (has(n, 'albumu', 'albumunu', 'albumden')) {
    return makeIntent('PLAY_ALBUM', { query, source });
  }
  if (has(n, 'calma listesi', 'playlist')) {
    return makeIntent('PLAY_PLAYLIST', { query, source });
  }
  if (has(n, 'sarkilarini', 'parcalarini', 'sanatcisini')) {
    return makeIntent('PLAY_ARTIST', { query, source });
  }
  if (source?.providerId === 'local') {
    return makeIntent('PLAY_LOCAL', { query, source });
  }
  return makeIntent('PLAY_QUERY', { query, source });
}
