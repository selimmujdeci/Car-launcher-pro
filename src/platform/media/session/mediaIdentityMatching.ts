/**
 * mediaIdentityMatching.ts — F3 · Canonical media identity + kanıtlı eşleştirme (SAF).
 *
 * NEDEN VAR: kaynak değiştiğinde "aynı parça mı?" sorusuna isim karşılaştırmasıyla
 * cevap vermek YASAKTIR. "Yol" adlı iki farklı şarkı, aynı şarkının 3 dakikalık
 * radyo kurgusu ile 9 dakikalık albüm hâli, aynı başlığı taşıyan cover'lar — hepsi
 * string eşitliğinde AYNI görünür. Yanlış şarkıyı sürdürmek, sürekliliği
 * kaybetmekten DAHA KÖTÜDÜR; bu yüzden sonuç bir boolean değil, **kanıtı taşıyan
 * bir derecedir**.
 *
 * Bu modül karar VERMEZ, yalnız dereceler. Otomatik taşıma kararı
 * `sessionContinuity` içindedir ve YALNIZ EXACT/STRONG'a izin verir.
 *
 * SAFLIK: I/O · timer · Date.now · global durum · React importu YOKTUR.
 */

export type IdentityMatchGrade =
  /** Kararlı bir kimlik alanı (kütüphane · sağlayıcı · içerik URI) birebir tuttu. */
  | 'EXACT'
  /** Kimlik alanı yok ama metadata + süre birlikte doğruladı. */
  | 'STRONG'
  /** Kısmi benzerlik — doğrulanamadı. Otomatik taşıma İÇİN YETERSİZ. */
  | 'WEAK'
  /** Pozitif ÇELİŞKİ var (farklı sanatçı, maddi süre farkı). */
  | 'NO_MATCH'
  /** Karşılaştırılacak kanıt yok — "eşleşmedi" DEĞİL, "bilinmiyor". */
  | 'UNKNOWN';

export type IdentityField =
  | 'libraryId' | 'providerId' | 'contentUri'
  | 'title' | 'artist' | 'album' | 'duration' | 'trackNumber';

export type EvidenceOutcome = 'MATCH' | 'MISMATCH' | 'ABSENT';

export interface IdentityEvidence {
  readonly field: IdentityField;
  readonly outcome: EvidenceOutcome;
}

/**
 * Bir medya öğesinin taşıyabildiği TÜM kimlik kanıtları. Her alan bağımsız olarak
 * yok olabilir; `null` "bilinmiyor" demektir, "boş" veya "eşleşmedi" DEĞİL.
 */
export interface CanonicalMediaIdentity {
  /** F2 MusicIndex kimliği (`media:<volume>:<mediaStoreId>`). */
  readonly libraryId: string | null;
  /** Sağlayıcının kararlı kimliği (ör. YouTube videoId, Spotify trackId). */
  readonly providerId: string | null;
  /** Sağlayıcı ad alanı — farklı sağlayıcıların id'leri KARŞILAŞTIRILMAZ. */
  readonly providerNamespace: string | null;
  readonly contentUri: string | null;
  readonly title: string | null;
  readonly artist: string | null;
  readonly album: string | null;
  readonly durationMs: number | null;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
}

export interface IdentityMatch {
  readonly grade: IdentityMatchGrade;
  /** 0..1 — dereceyle tutarlı, ondan BAĞIMSIZ bir ikinci gerçek üretmez. */
  readonly confidence: number;
  /** Hangi alan neyi söyledi — provenance. Karar bu listeden okunabilir olmalı. */
  readonly evidence: readonly IdentityEvidence[];
  readonly reason: string;
}

export const EMPTY_MEDIA_IDENTITY: CanonicalMediaIdentity = Object.freeze({
  libraryId: null, providerId: null, providerNamespace: null, contentUri: null,
  title: null, artist: null, album: null, durationMs: null, trackNumber: null, discNumber: null,
});

/** Süre toleransı: kodek/etiket yuvarlamaları için mutlak alt sınır. */
export const DURATION_TOLERANCE_MS = 2_000;
/** Uzun parçalarda oransal tolerans (%2) — 10 dk'lık bir parçada 2 sn çok dardır. */
export const DURATION_TOLERANCE_RATIO = 0.02;

const norm = (v: string | null): string | null => {
  if (v === null) return null;
  const out = v.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('tr-TR').replace(/ı/g, 'i')
    .replace(/[\s._-]+/g, ' ').trim();
  return out.length ? out : null;
};

const ev = (field: IdentityField, outcome: EvidenceOutcome): IdentityEvidence =>
  Object.freeze({ field, outcome });

function compareText(a: string | null, b: string | null): EvidenceOutcome {
  const na = norm(a); const nb = norm(b);
  if (na === null || nb === null) return 'ABSENT';
  return na === nb ? 'MATCH' : 'MISMATCH';
}

/** Süre eşitliği toleranslıdır; tolerans DIŞI fark pozitif bir ÇELİŞKİDİR. */
export function durationsAgree(a: number | null, b: number | null): boolean | null {
  if (a === null || b === null || !Number.isFinite(a) || !Number.isFinite(b) || a <= 0 || b <= 0) return null;
  const tolerance = Math.max(DURATION_TOLERANCE_MS, Math.min(a, b) * DURATION_TOLERANCE_RATIO);
  return Math.abs(a - b) <= tolerance;
}

const result = (
  grade: IdentityMatchGrade, confidence: number, evidence: IdentityEvidence[], reason: string,
): IdentityMatch => Object.freeze({ grade, confidence, evidence: Object.freeze(evidence), reason });

/**
 * İki kimliği kanıtla karşılaştırır.
 *
 * Sıra bilinçlidir: **kararlı kimlik alanları metadata'yı EZER.** Aynı
 * `libraryId` taşıyan iki kayıt, başlıkları farklı yazılmış olsa bile aynı
 * medyadır (etiket düzeltilmiş olabilir). Tersine, metadata ne kadar benzerse
 * benzesin, farklı sanatçı veya maddi süre farkı EXACT üretemez.
 */
export function matchMediaIdentity(
  a: CanonicalMediaIdentity, b: CanonicalMediaIdentity,
): IdentityMatch {
  const evidence: IdentityEvidence[] = [];

  /* ── 1. Kararlı kimlik alanları ─────────────────────────────────────── */
  if (a.libraryId !== null && b.libraryId !== null) {
    const same = a.libraryId === b.libraryId;
    evidence.push(ev('libraryId', same ? 'MATCH' : 'MISMATCH'));
    if (same) return result('EXACT', 1, evidence, 'Aynı kütüphane kimliği.');
  } else {
    evidence.push(ev('libraryId', 'ABSENT'));
  }

  const sameNamespace = a.providerNamespace !== null && a.providerNamespace === b.providerNamespace;
  if (sameNamespace && a.providerId !== null && b.providerId !== null) {
    const same = a.providerId === b.providerId;
    evidence.push(ev('providerId', same ? 'MATCH' : 'MISMATCH'));
    if (same) return result('EXACT', 1, evidence, 'Aynı sağlayıcı ad alanında aynı kararlı kimlik.');
  } else {
    // Farklı sağlayıcıların id'leri karşılaştırılamaz — bu bir "uyuşmazlık" DEĞİLDİR.
    evidence.push(ev('providerId', 'ABSENT'));
  }

  if (a.contentUri !== null && b.contentUri !== null) {
    const same = a.contentUri === b.contentUri;
    evidence.push(ev('contentUri', same ? 'MATCH' : 'MISMATCH'));
    if (same) return result('EXACT', 1, evidence, 'Aynı içerik URI.');
  } else {
    evidence.push(ev('contentUri', 'ABSENT'));
  }

  /* ── 2. Metadata kanıtı ─────────────────────────────────────────────── */
  const title = compareText(a.title, b.title);
  const artist = compareText(a.artist, b.artist);
  const album = compareText(a.album, b.album);
  evidence.push(ev('title', title), ev('artist', artist), ev('album', album));

  if (title === 'ABSENT') {
    evidence.push(ev('duration', 'ABSENT'));
    return result('UNKNOWN', 0, evidence,
      'Başlık kanıtı yok — eşleşme DEĞERLENDİRİLEMEDİ (eşleşmedi demek DEĞİLDİR).');
  }
  if (title === 'MISMATCH') {
    evidence.push(ev('duration', 'ABSENT'));
    return result('NO_MATCH', 0, evidence, 'Başlıklar çelişiyor.');
  }

  // Sanatçı çelişkisi tek başına yeterli bir REDDİR: aynı adlı farklı eserler.
  if (artist === 'MISMATCH') {
    evidence.push(ev('duration', 'ABSENT'));
    return result('NO_MATCH', 0, evidence, 'Başlık aynı, sanatçı çelişiyor — farklı eser.');
  }

  const durationAgrees = durationsAgree(a.durationMs, b.durationMs);
  evidence.push(ev('duration', durationAgrees === null ? 'ABSENT' : durationAgrees ? 'MATCH' : 'MISMATCH'));

  if (durationAgrees === false) {
    return result('NO_MATCH', 0, evidence,
      'Başlık uyuşuyor ama süreler maddi olarak farklı — büyük olasılıkla farklı kayıt (canlı · remix · radyo kurgusu).');
  }

  const trackAgrees = a.trackNumber !== null && b.trackNumber !== null
    ? a.trackNumber === b.trackNumber : null;
  evidence.push(ev('trackNumber', trackAgrees === null ? 'ABSENT' : trackAgrees ? 'MATCH' : 'MISMATCH'));

  if (artist === 'MATCH' && durationAgrees === true) {
    const strong = album === 'MATCH' || trackAgrees === true;
    return result('STRONG', strong ? 0.95 : 0.85, evidence,
      strong
        ? 'Başlık, sanatçı, süre ve albüm/parça numarası birlikte doğruladı.'
        : 'Başlık, sanatçı ve süre birlikte doğruladı.');
  }

  return result('WEAK', artist === 'MATCH' ? 0.5 : 0.35, evidence,
    durationAgrees === null
      ? 'Süre kanıtı yok — benzerlik doğrulanamadı.'
      : 'Sanatçı kanıtı yok — benzerlik doğrulanamadı.');
}

/** Otomatik kaynak taşımaya YETEN tek derece kümesi. */
export function isCarryGrade(grade: IdentityMatchGrade): boolean {
  return grade === 'EXACT' || grade === 'STRONG';
}

/**
 * Adaylar arasından en iyi eşleşmeyi seçer. Beraberlikte ilk aday kazanır
 * (deterministik); hiçbir aday taşımaya yetmiyorsa en iyi derece yine döner —
 * karar çağırana aittir, bu fonksiyon eşiği KENDİ UYGULAMAZ.
 */
export function bestIdentityMatch(
  target: CanonicalMediaIdentity, candidates: readonly CanonicalMediaIdentity[],
): { readonly index: number; readonly match: IdentityMatch } {
  let bestIndex = -1;
  let best: IdentityMatch = result('UNKNOWN', 0, [], 'Aday yok.');
  for (let i = 0; i < candidates.length; i += 1) {
    const m = matchMediaIdentity(target, candidates[i]!);
    if (m.grade === 'EXACT') return { index: i, match: m };
    // Katı büyüklük: beraberlikte İLK aday kazanır (deterministik sıralama).
    if (m.confidence > best.confidence) { best = m; bestIndex = i; }
  }
  // Hiçbir aday pozitif kanıt üretmediyse indeks YOKTUR; "en az kötü" seçilmez.
  return best.confidence > 0 ? { index: bestIndex, match: best } : { index: -1, match: best };
}
