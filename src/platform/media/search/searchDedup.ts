/**
 * searchDedup.ts — F5 · Kaynaklar arası tekilleştirme (SAF).
 *
 * PAZARLIKSIZ KURAL: **yanlış birleştirme, çift göstermekten daha kötüdür.**
 * Aynı adı taşıyan iki farklı şarkı, bir parçanın radyo kurgusu ile albüm hâli,
 * cover'lar — hepsi metin düzeyinde AYNI görünür. Bu yüzden birleştirme kararı
 * F3 `mediaIdentityMatching` kanıt derecelerine dayanır ve YALNIZ `EXACT` /
 * `STRONG` kabul edilir. `WEAK` · `NO_MATCH` · `UNKNOWN` AYRI sonuç kalır.
 *
 * Birleştirilen sonuçta alternatif kaynakların erişilebilirliği KORUNUR
 * (`alternates`) — kullanıcı aynı parçanın başka kaynakta da olduğunu görebilir,
 * ama liste ikizlerle dolmaz.
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */
import { matchMediaIdentity } from '../session/mediaIdentityMatching';
import { searchKey } from './searchNormalize';
import type { SearchResult } from './searchResult';

export interface DedupOutcome {
  readonly results: readonly SearchResult[];
  /** Kaç sonuç bir başkasının içinde birleştirildi. */
  readonly mergedCount: number;
  /**
   * Metin olarak benzeyip kimlik kanıtı YETMEDİĞİ için AYRI bırakılanlar.
   * Bu bir hata değil, kasıtlı dürüstlüktür; LAB'da görünür.
   */
  readonly ambiguousKept: number;
}

/** Aday kümesini daraltan ucuz anahtar — karşılaştırma maliyeti O(n²) olmasın. */
function bucketKey(r: SearchResult): string {
  const title = searchKey(r.title);
  // Süre 2 sn kovalarına yuvarlanır: aynı parçanın farklı kaynaktaki süresi
  // birebir tutmayabilir, ama yakın olmalıdır.
  const durationBucket = r.identity.durationMs === null
    ? 'x' : String(Math.round(r.identity.durationMs / 2000));
  return `${r.kind}|${title}|${durationBucket}`;
}

/**
 * Aynı içeriği tek sonuçta toplar.
 *
 * Giriş sırası KORUNUR: ilk gelen sonuç "birincil" olur ve sonrakiler onun
 * `alternates` listesine iner. Çağıran sıralamayı dedup'tan SONRA yapmalıdır ki
 * birincil seçimi sıralamanın kendisini değiştirmesin.
 */
export function dedupeResults(input: readonly SearchResult[]): DedupOutcome {
  const buckets = new Map<string, SearchResult[]>();
  const order: SearchResult[] = [];
  let mergedCount = 0;
  let ambiguousKept = 0;

  input.forEach((candidate) => {
    const key = bucketKey(candidate);
    const bucket = buckets.get(key);
    if (!bucket) {
      buckets.set(key, [candidate]);
      order.push(candidate);
      return;
    }

    // Kovadaki mevcut sonuçlarla KİMLİK kanıtı karşılaştırılır (metinle değil).
    const target = bucket.find((existing) => {
      // Aynı kaynak sınıfının iki ayrı öğesi birleştirilmez: sağlayıcı kendi
      // kataloğunda gerçekten iki kayıt sunuyorsa bu bir ikiz değildir.
      if (existing.provenance.sourceClass === candidate.provenance.sourceClass) return false;
      const grade = matchMediaIdentity(existing.identity, candidate.identity).grade;
      return grade === 'EXACT' || grade === 'STRONG';
    });

    if (!target) {
      bucket.push(candidate);
      order.push(candidate);
      // Metinsel olarak aynı kovaya düştü ama kanıt yetmedi → AYRI kalır.
      ambiguousKept += 1;
      return;
    }

    // Birleştir: hedefin alternatifleri arasına adayın kanıtı eklenir.
    const index = order.indexOf(target);
    const merged: SearchResult = Object.freeze({
      ...target,
      alternates: Object.freeze([...target.alternates, candidate.provenance]),
    });
    order[index] = merged;
    const bucketIndex = bucket.indexOf(target);
    if (bucketIndex >= 0) bucket[bucketIndex] = merged;
    mergedCount += 1;
  });

  return Object.freeze({
    results: Object.freeze(order), mergedCount, ambiguousKept,
  });
}
