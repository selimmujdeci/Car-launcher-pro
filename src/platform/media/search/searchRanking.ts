/**
 * searchRanking.ts — F5 · Deterministik, AÇIKLANABİLİR sıralama (SAF).
 *
 * PAZARLIKSIZ KURALLAR:
 *   · Sağlayıcı POPÜLERLİĞİ puan vermez. "YouTube her zaman üstte" gibi bir
 *     taban puanı kullanıcıyı yanıltır ve aradığını gizler.
 *   · `LOCAL` sırf yerel olduğu için birinci YAPILMAZ; sağlayıcı da sırf
 *     çevrimiçi olduğu için öne ÇIKARILMAZ.
 *   · AI tahmini, öğrenme, kişiselleştirme YOKTUR — aynı sorgu ve aynı girdi
 *     her zaman aynı sırayı üretir.
 *   · Her puanın bir GEREKÇESİ vardır (`signals`) ve LAB'da incelenebilir.
 *
 * Kaynak yalnız EŞİTLİK BOZUCU olarak kullanılır: metin kanıtı aynıysa
 * ERİŞİLEBİLİR olan (çevrimdışı çalınabilen yerel parça) öne geçer — bu bir
 * popülerlik tercihi değil, kullanılabilirlik gerçeğidir.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */
import { normalizeQuery, searchKey, searchTokens, tokenOverlap } from './searchNormalize';
import type { SearchMatchEvidence, SearchResult } from './searchResult';

/** Metin sinyalleri — büyükten küçüğe, çakışmayan aralıklarda. */
const SCORE = {
  EXACT_TITLE: 1000,
  TITLE_PREFIX: 700,
  ARTIST_TITLE: 560,
  EXACT_ARTIST: 420,
  ALBUM_CONTEXT: 300,
  TOKEN_FULL: 260,
  TITLE_SUBSTRING: 180,
  ARTIST_SUBSTRING: 120,
  TOKEN_PARTIAL: 40,      // her eşleşen kelime başına
  AVAILABLE: 25,          // erişilebilirlik — popülerlik DEĞİL
  STALE_PENALTY: -200,    // şu an çalınamayan sonuç aşağı iner, GİZLENMEZ
} as const;

export interface RankableFields {
  readonly title: string;
  readonly artist: string | null;
  readonly album: string | null;
  readonly availability: SearchResult['availability'];
}

/**
 * Tek sonucun eşleşme kanıtını üretir. Boş sorguda hiçbir metin sinyali yoktur;
 * bu durumda sıralama çağıranın (ör. kütüphane listesi) doğal sırasına bırakılır.
 */
export function scoreResult(query: string, fields: RankableFields): SearchMatchEvidence {
  const q = normalizeQuery(query);
  if (!q) {
    return Object.freeze({
      score: 0, signals: Object.freeze(['empty_query']), matchKind: 'NONE' as const,
    });
  }

  const titleKey = searchKey(fields.title);
  const artistKey = searchKey(fields.artist);
  const albumKey = searchKey(fields.album);
  const qTokens = searchTokens(q);

  const signals: string[] = [];
  let score = 0;
  let matchKind: SearchMatchEvidence['matchKind'] = 'NONE';

  const bump = (points: number, signal: string, kind?: SearchMatchEvidence['matchKind']): void => {
    score += points;
    signals.push(signal);
    if (kind && matchKind === 'NONE') matchKind = kind;
  };

  /* 1) Tam başlık eşleşmesi — kullanıcının aradığı şey büyük olasılıkla budur. */
  if (titleKey && titleKey === q) bump(SCORE.EXACT_TITLE, 'exact_title', 'EXACT_TITLE');
  /* 2) Başlık ön eki — yazmaya devam ederken doğru sonuç üstte kalsın. */
  else if (titleKey && titleKey.startsWith(q)) bump(SCORE.TITLE_PREFIX, 'title_prefix', 'TITLE_PREFIX');

  /* 3) "sanatçı + parça" birlikte yazıldı mı (iki alan da sorguda geçiyor). */
  if (artistKey && titleKey) {
    const combined = `${artistKey} ${titleKey}`;
    const reversed = `${titleKey} ${artistKey}`;
    if (combined === q || reversed === q) {
      bump(SCORE.ARTIST_TITLE, 'artist_title_exact', 'ARTIST_TITLE');
    } else if (qTokens.length > 1
      && tokenOverlap(qTokens, searchTokens(artistKey)) > 0
      && tokenOverlap(qTokens, searchTokens(titleKey)) > 0) {
      bump(SCORE.ARTIST_TITLE, 'artist_and_title_tokens', 'ARTIST_TITLE');
    }
  }

  if (artistKey === q && artistKey) bump(SCORE.EXACT_ARTIST, 'exact_artist', 'ARTIST_TITLE');
  if (albumKey && (albumKey === q || albumKey.startsWith(q))) {
    bump(SCORE.ALBUM_CONTEXT, 'album_context', 'ALBUM_CONTEXT');
  }

  /* 4) Kelime kapsaması — sorgunun TÜM kelimeleri metinde geçiyor mu. */
  const haystackTokens = searchTokens(`${titleKey} ${artistKey} ${albumKey}`);
  const overlap = tokenOverlap(qTokens, haystackTokens);
  if (overlap > 0 && overlap === qTokens.length) {
    bump(SCORE.TOKEN_FULL, 'all_query_tokens', 'TOKEN_MATCH');
  } else if (overlap > 0) {
    bump(overlap * SCORE.TOKEN_PARTIAL, `token_overlap_${overlap}`, 'TOKEN_MATCH');
  }

  /* 5) Serbest alt dizge — en zayıf metin kanıtı. */
  if (matchKind === 'NONE' || matchKind === 'TOKEN_MATCH') {
    if (titleKey.includes(q)) bump(SCORE.TITLE_SUBSTRING, 'title_substring', 'SUBSTRING');
    else if (artistKey.includes(q)) bump(SCORE.ARTIST_SUBSTRING, 'artist_substring', 'SUBSTRING');
  }

  /* 6) Erişilebilirlik — eşitlik bozucu. Çalınamayan sonuç gizlenmez, iner. */
  if (fields.availability === 'AVAILABLE') bump(SCORE.AVAILABLE, 'available');
  else if (fields.availability === 'STALE') bump(SCORE.STALE_PENALTY, 'stale_penalty');

  return Object.freeze({
    score, signals: Object.freeze(signals), matchKind,
  });
}

/**
 * Kararlı sıralama: puan → başlık anahtarı → sonuç kimliği.
 *
 * İkinci ve üçüncü ölçüt sağlayıcıdan BAĞIMSIZ olduğundan aynı girdi her zaman
 * aynı sırayı üretir (deterministiklik testte kilitlidir).
 */
export function rankResults(results: readonly SearchResult[]): readonly SearchResult[] {
  return results.slice().sort((a, b) => {
    if (b.evidence.score !== a.evidence.score) return b.evidence.score - a.evidence.score;
    const at = searchKey(a.title);
    const bt = searchKey(b.title);
    if (at !== bt) return at < bt ? -1 : 1;
    return a.resultId < b.resultId ? -1 : a.resultId > b.resultId ? 1 : 0;
  });
}
