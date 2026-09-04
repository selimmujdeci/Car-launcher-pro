/**
 * recoveryModel.ts — MUSIC F21 · Süreklilik / kurtarma KARARLARI (SAF).
 *
 * ── ÖLÇÜLEN GERÇEK (F21 denetimi) ────────────────────────────────────────
 * Kurtarma mimarisi ZATEN vardı ve iyiydi:
 *   · `restoreListeningSession` bağlamı geri yükler ama **ASLA ÇALMAZ**
 *     (`playbackClaim: 'NONE'`) → phantom PLAYING yok.
 *   · Süreklilik `UNKNOWN` başlar; kayıt canlı gözlem SAYILMAZ (§13).
 *   · YouTube kuyrukta `piped://<id>` **sentinel**i taşır; gerçek akış URL'si
 *     çalma anında çözülür → süresi dolan URL kuyruğa YAZILMAZ.
 *   · Bayat kütüphane girdileri `revalidateAgainstLibrary` ile düşürülür.
 *
 * ── KAPATILAN GERÇEK AÇIK ────────────────────────────────────────────────
 * Sağlayıcı girdileri arasında **doğrudan `http(s)` akış URL'si taşıyanlar**
 * (Jamendo · Audius · doğrudan akış) kalıcı kayda GİRİYORDU. Böyle bir URL
 * saatler sonra geri yüklendiğinde **süresi dolmuş olabilir** ve o hâliyle
 * "canlı" muamelesi görüyordu. F21 bunu sınıflandırır ve geri yüklemede
 * düşürür — sahte bir "çalınabilir" iddiası kurulmaz.
 *
 * BU DOSYA YENİ BİR KURTARMA OTORİTESİ DEĞİLDİR: politika üretir, yürütme
 * F3 (`restoreListeningSession`) ve F0'dadır (Cross-Domain §18).
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 */

/** Bir kuyruk girdisinin geri yükleme sonrası GÜVENİLİRLİK sınıfı. */
export type EntryFreshness =
  /** Yerel dosya — varlığı kütüphane doğrulamasıyla ayrıca kontrol edilir. */
  | 'LOCAL'
  /** Sentinel/kimlik taşır; gerçek adres ÇALMA ANINDA çözülür → bayatlamaz. */
  | 'RESOLVE_AT_PLAY'
  /** Doğrudan uzak URL taşır; süresi DOLMUŞ olabilir → canlı sayılmaz. */
  | 'EXPIRING_REMOTE'
  /** Adres okunamadı — kanıt yok. */
  | 'UNKNOWN';

/** Çalma anında çözülen (bayatlamayan) şemalar. */
const RESOLVE_AT_PLAY_SCHEMES: readonly string[] = Object.freeze([
  'piped://', 'archive://', 'spotify:',
]);

/** Yerel içerik şemaları. */
const LOCAL_SCHEMES: readonly string[] = Object.freeze(['content://', 'file://']);

/**
 * Bir adresin geri yükleme sınıfını belirler.
 *
 * Bilinmeyen şema `UNKNOWN`tır — "muhtemelen çalışır" DEMEK DEĞİLDİR.
 */
export function classifyEntryFreshness(uri: string | null | undefined): EntryFreshness {
  if (typeof uri !== 'string' || uri.length === 0) return 'UNKNOWN';
  const u = uri.toLowerCase();
  if (LOCAL_SCHEMES.some((s) => u.startsWith(s))) return 'LOCAL';
  if (RESOLVE_AT_PLAY_SCHEMES.some((s) => u.startsWith(s))) return 'RESOLVE_AT_PLAY';
  if (u.startsWith('http://') || u.startsWith('https://')) return 'EXPIRING_REMOTE';
  return 'UNKNOWN';
}

/**
 * Bu girdi geri yüklemede DÜŞÜRÜLMELİ mi.
 *
 * `EXPIRING_REMOTE` düşürülür: süresi dolmuş bir adresi kuyrukta tutmak,
 * kullanıcıya "çalınabilir" diye gösterilen ama basınca ölen bir satır
 * üretir. `UNKNOWN` da düşürülür (fail-closed).
 *
 * `LOCAL` ve `RESOLVE_AT_PLAY` KORUNUR — birincisi kütüphane doğrulamasına,
 * ikincisi çalma anındaki çözüme tabidir.
 */
export function shouldDropOnRestore(freshness: EntryFreshness): boolean {
  return freshness === 'EXPIRING_REMOTE' || freshness === 'UNKNOWN';
}

/* ── Otomatik devam kararı ────────────────────────────────────────────────── */

/** Kontak (ignition) kanıtının ÖLÇÜLEN durumu. */
export type IgnitionEvidence =
  /** Araç elektriği çalışır durumda (OBD gerilim bandı / motor kanıtı). */
  | 'RUNNING'
  /** Kontak kapalı/çok düşük gerilim. */
  | 'OFF'
  /** Ölçülemiyor (OBD yok · gerilim okunamıyor) — UYDURULMAZ. */
  | 'UNKNOWN';

export interface AutoResumeInput {
  /** Bağlam gerçekten geri yüklendi mi. */
  readonly sessionRestored: boolean;
  /** Geri yüklenen kuyrukta çalınabilir girdi kaldı mı. */
  readonly playableEntries: number;
  /** Kullanıcı en son AÇIKÇA duraklattı mı (niyet korunur). */
  readonly userPaused: boolean;
  readonly ignition: IgnitionEvidence;
  /** Ağ gerekiyor mu ve var mı. */
  readonly requiresNetwork: boolean;
  readonly online: boolean;
  /** Mevcut politika UI'sız otomatik devama izin veriyor mu (F8 kapısı). */
  readonly policyAllowsAutoResume: boolean;
}

export type AutoResumeDecision = 'HOLD' | 'OFFER' | 'RESUME';

export interface AutoResumeOutcome {
  readonly decision: AutoResumeDecision;
  readonly reason:
  | 'NOT_RESTORED' | 'NO_PLAYABLE' | 'USER_PAUSED' | 'IGNITION_UNKNOWN'
  | 'IGNITION_OFF' | 'OFFLINE' | 'POLICY_DENIED' | 'EVIDENCE_COMPLETE';
}

const hold = (reason: AutoResumeOutcome['reason']): AutoResumeOutcome =>
  Object.freeze({ decision: 'HOLD' as const, reason });

/**
 * Kontak/geri yükleme sonrası ne yapılacağına karar verir.
 *
 * **FAIL-CLOSED.** `RESUME` yalnız HER kanıt tamamsa çıkar:
 *   · bağlam geri yüklendi ve çalınabilir girdi VAR,
 *   · kullanıcı açıkça duraklatmamış,
 *   · **kontak GERÇEKTEN ölçülmüş** ve çalışıyor (UNKNOWN → asla RESUME),
 *   · ağ gerekiyorsa VAR,
 *   · politika UI'sız devama izin veriyor.
 * Aksi hâlde en fazla `OFFER` (kullanıcı dokunursa çalar) veya `HOLD`.
 *
 * Bu, F8'in #1121 kuralının F21 karşılığıdır: **kullanıcı dokunmadan
 * kendiliğinden ses BAŞLAMAZ** — `RESUME` yalnız politika AÇIKÇA izin
 * verdiğinde mümkündür ve o izin varsayılan olarak KAPALIDIR.
 */
export function decideAutoResume(input: AutoResumeInput): AutoResumeOutcome {
  if (!input.sessionRestored) return hold('NOT_RESTORED');
  if (input.playableEntries <= 0) return hold('NO_PLAYABLE');
  /* Kullanıcı niyeti KORUNUR: duraklatılmış oturum kendiliğinden açılmaz. */
  if (input.userPaused) return hold('USER_PAUSED');
  if (input.requiresNetwork && !input.online) {
    return Object.freeze({ decision: 'OFFER' as const, reason: 'OFFLINE' as const });
  }
  if (input.ignition === 'OFF') return hold('IGNITION_OFF');
  if (input.ignition === 'UNKNOWN') {
    /* Kontak UYDURULMAZ: ölçüm yoksa otomatik devam YOK, yalnız teklif. */
    return Object.freeze({ decision: 'OFFER' as const, reason: 'IGNITION_UNKNOWN' as const });
  }
  if (!input.policyAllowsAutoResume) {
    return Object.freeze({ decision: 'OFFER' as const, reason: 'POLICY_DENIED' as const });
  }
  return Object.freeze({ decision: 'RESUME' as const, reason: 'EVIDENCE_COMPLETE' as const });
}

/* ── Önbellek bozulması ───────────────────────────────────────────────────── */

/** Bir önbelleğin ÖLÇÜLEN sağlık durumu. */
export type CacheHealth = 'HEALTHY' | 'SCHEMA_MISMATCH' | 'CORRUPT' | 'UNKNOWN';

export interface CacheHealthInput {
  readonly present: boolean;
  readonly schemaMatches: boolean;
  readonly parseFailures: number;
}

/**
 * Önbellek sağlığı — bozulma OYNATMAYI ÇÖKERTMEZ.
 *
 * Kural: bozuk/yabancı şemalı önbellek REDDEDİLİR (kullanılmaz), silinir ya da
 * yeniden üretilir; ama hiçbir durumda çalma yolunu düşürmez. Bu fonksiyon
 * yalnız SINIFLANDIRIR — temizleme ilgili önbelleğin SAHİBİNDEDİR.
 */
export function classifyCacheHealth(input: CacheHealthInput): CacheHealth {
  if (!input.present) return 'UNKNOWN';
  if (!input.schemaMatches) return 'SCHEMA_MISMATCH';
  return input.parseFailures > 0 ? 'CORRUPT' : 'HEALTHY';
}
