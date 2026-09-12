/**
 * localSearchIndex.ts — F5 · Yerel kütüphane için TÜRETİLMİŞ arama indeksi.
 *
 * PAZARLIKSIZ SINIR: bu **ikinci bir library truth DEĞİLDİR**. Kütüphane
 * otoritesi F2 `musicIndex`'tir; burada tutulan tek şey, o otoritenin ürettiği
 * anlık görüntüden hesaplanan arama ANAHTARLARIdır. Parça verisi kopyalanmaz,
 * yalnız `trackId` + normalize metin saklanır; sonuçlar her zaman kanonik
 * anlık görüntüden çözülür.
 *
 * NEDEN VAR: `searchMusicLibrary` her tuş vuruşunda 5.000+ parçanın başlık,
 * sanatçı ve albümünü YENİDEN normalize ediyordu (parça başına üç `normalize
 * ('NFD')` + üç `toLocaleLowerCase`). Bu, düşük-uç head unit'te her karakterde
 * onbinlerce string ayırma demekti. İndeks bu işi kütüphane revizyonu BAŞINA
 * bir kez yapar.
 *
 * GEÇERLİLİK: indeks `revision` taşır. `musicIndex` revizyonu değişince indeks
 * BAYATtır ve ilk okumada yeniden kurulur — bayat indeksten sonuç DÖNMEZ.
 */
import { getMusicLibrarySnapshot } from '../musicIndex';
import { searchKey } from './searchNormalize';
import { noteIndexBuild, noteIndexLookup } from './searchTelemetry';

interface IndexRow {
  readonly trackId: string;
  readonly titleKey: string;
  readonly artistKey: string;
  readonly albumKey: string;
  /** Tek birleşik anahtar — alt dizge taraması tek geçişte yapılır. */
  readonly haystack: string;
}

interface BuiltIndex {
  readonly revision: number;
  readonly rows: readonly IndexRow[];
}

let index: BuiltIndex | null = null;

function build(): BuiltIndex {
  const startedAt = performance.now();
  const snapshot = getMusicLibrarySnapshot();
  const rows: IndexRow[] = [];
  snapshot.tracks.forEach((t) => {
    const titleKey = searchKey(t.title);
    const artistKey = searchKey(t.artist);
    const albumKey = searchKey(t.album);
    rows.push({
      trackId: t.id, titleKey, artistKey, albumKey,
      haystack: `${titleKey} ${artistKey} ${albumKey}`,
    });
  });
  const built: BuiltIndex = Object.freeze({ revision: snapshot.revision, rows: Object.freeze(rows) });
  noteIndexBuild(performance.now() - startedAt, rows.length);
  return built;
}

/** Kütüphane revizyonu ilerlediyse indeksi yeniden kurar (bayat sonuç dönmez). */
export function ensureLocalSearchIndex(): BuiltIndex {
  const revision = getMusicLibrarySnapshot().revision;
  if (!index || index.revision !== revision) index = build();
  return index;
}

export interface LocalIndexHit {
  readonly trackId: string;
  readonly titleKey: string;
  readonly artistKey: string;
  readonly albumKey: string;
}

/**
 * Normalize edilmiş sorgu için aday parça kimlikleri.
 *
 * Sıralama BURADA yapılmaz — indeks yalnız ADAY üretir, hüküm `searchRanking`
 * içindedir (tek sıralama otoritesi). `limit` bounded tarama için üst sınırdır.
 */
export function lookupLocalIndex(normalizedQuery: string, limit: number): readonly LocalIndexHit[] {
  const startedAt = performance.now();
  const built = ensureLocalSearchIndex();
  const hits: LocalIndexHit[] = [];

  if (!normalizedQuery) {
    for (let i = 0; i < built.rows.length && hits.length < limit; i += 1) {
      const r = built.rows[i]!;
      hits.push({ trackId: r.trackId, titleKey: r.titleKey, artistKey: r.artistKey, albumKey: r.albumKey });
    }
    noteIndexLookup(performance.now() - startedAt, hits.length);
    return hits;
  }

  const tokens = normalizedQuery.split(' ').filter(Boolean);
  for (let i = 0; i < built.rows.length; i += 1) {
    const r = built.rows[i]!;
    // Tüm sorgu kelimeleri birleşik anahtarda geçmeli — "sezen aksu" yazınca
    // yalnız "sezen" içeren alakasız parça listeyi doldurmasın.
    let all = true;
    for (let k = 0; k < tokens.length; k += 1) {
      if (!r.haystack.includes(tokens[k]!)) { all = false; break; }
    }
    if (!all) continue;
    hits.push({ trackId: r.trackId, titleKey: r.titleKey, artistKey: r.artistKey, albumKey: r.albumKey });
    // Bounded: aday havuzu sıralama için yeterince büyük ama sınırsız değil.
    if (hits.length >= limit) break;
  }

  noteIndexLookup(performance.now() - startedAt, hits.length);
  return hits;
}

/** İndeksin şu anki durumu — LAB gözlemi (salt okuma, yeniden kurmaz). */
export function peekLocalSearchIndex(): Readonly<{ revision: number; rows: number }> | null {
  return index ? Object.freeze({ revision: index.revision, rows: index.rows.length }) : null;
}

export function _resetLocalSearchIndexForTest(): void { index = null; }
