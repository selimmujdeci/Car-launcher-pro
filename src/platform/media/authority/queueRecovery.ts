/**
 * queueRecovery.ts — MÜZİK HUB PAKET B · Kuyruk sapmasından GÜVENLİ kurtarma (SAF).
 *
 * PAKET A yalnız sapmayı TESPİT ediyordu (`queueReconciliation`). Bu modül kararı
 * verir: sapma düzeltilebilir mi, ertelenmeli mi, yoksa reddedilmeli mi.
 *
 * PAZARLIKSIZ KURALLAR:
 *   1. **Native Media3 timeline oynatma gerçeğinin OTORİTESİDİR.** UI kuyruğu
 *      yalnız bir projeksiyondur; çelişkide UI düzeltilir, native DEĞİL.
 *   2. Kurtarma **çalan medyayı değiştirmez** — hiçbir karar "başka parçaya geç"
 *      demez. En fazla UI projeksiyonu native gerçeğe hizalanır.
 *   3. **Kullanıcı komutu her zaman önceliklidir**; komut uçarken kurtarma ERTELENİR.
 *   4. **Kaynak devri sürerken kurtarma BAŞLAMAZ** (yarım devir üstüne yazamaz).
 *   5. **Generation + revision kapısı:** karar anındaki dünya ile uygulama anındaki
 *      dünya farklıysa sonuç ATILIR (geç gelen kurtarma eski durumu geri YAZAMAZ).
 *   6. **Bounded:** aynı sapma imzası için deneme sayısı, cooldown ve devre kesici
 *      vardır — sonsuz kurtarma döngüsü yapısal olarak imkânsızdır.
 *   7. **Dış otorite (Spotify Connect · YouTube · harici oturum) FAIL-CLOSED:**
 *      native timeline sahipliğimiz yokken kurtarma YAPILMAZ.
 *   8. **Yıkıcı otomatik düzeltme YOK:** yinelenen öğe gibi belirsiz durumlarda
 *      kurtarma reddedilir ve tutarsızlık GÖRÜNÜR kılınır (sessizce silinmez).
 *
 * SAFLIK: I/O · timer · `Date.now` · global durum · React importu YOKTUR.
 * Zaman ve tüm dünya durumu parametreyle girer.
 */

import type { QueueDrift } from './queueReconciliation';

/* ── Sonuç sözleşmesi ────────────────────────────────────────────────────── */

export type RecoveryOutcome =
  /** Düzeltme uygulanabilir — `action` ne yapılacağını söyler. */
  | 'recovered'
  /** Sapma yok veya düzeltilecek bir şey yok. */
  | 'no_action'
  /** Şimdi olmaz (devir/komut sürüyor · cooldown) — sonra yeniden denenebilir. */
  | 'deferred'
  /** Politika gereği YAPILMAZ (dış otorite · yıkıcı düzeltme · bayat karar). */
  | 'rejected'
  /** Denendi ve başarısız oldu (devre kesici bunu sayar). */
  | 'failed';

/** Kurtarmanın UI katmanına söylediği TEK eylem — native'e komut YOKTUR. */
export type RecoveryAction =
  | 'NONE'
  /** UI projeksiyonunu native timeline'dan yeniden üret. */
  | 'REPROJECT_UI_FROM_NATIVE'
  /** Yalnız indeksi native gerçeğe hizala (kuyruk içeriği aynı). */
  | 'ALIGN_INDEX'
  /** UI kuyruğunu temizle — YALNIZ oynatma gerçekten durmuşken. */
  | 'CLEAR_UI_QUEUE';

export interface RecoveryDecision {
  readonly outcome: RecoveryOutcome;
  readonly action: RecoveryAction;
  /** Neden bu karar verildi — LAB'da gösterilir, teşhis için zorunludur. */
  readonly reason: string;
  /** Makine tarafından okunan sabit kod (bounded, PII yok). */
  readonly code: string;
}

/* ── Karar girdisi ───────────────────────────────────────────────────────── */

export interface RecoveryContext {
  readonly drift: QueueDrift;
  /**
   * Native timeline BİZE mi ait? Spotify Connect / YouTube / harici MediaSession
   * aktifken `false` → fail-closed (kurtarma yok).
   */
  readonly nativeAuthoritative: boolean;
  /** Kaynak devri sürüyor mu (sourceCoordinator in-flight). */
  readonly handoverInFlight: boolean;
  /** Kullanıcı/Mavi komutu uçuyor mu — komut kurtarmayı EZER. */
  readonly userCommandInFlight: boolean;
  /** Native oynatma fiilen sürüyor mu (EMPTY_NATIVE kararının kilidi). */
  readonly playbackActive: boolean;
  /** Bu sapma imzası için bugüne kadarki deneme sayısı. */
  readonly attempts: number;
  readonly nowMs: number;
  /** Son denemenin zamanı (yoksa null). */
  readonly lastAttemptAtMs: number | null;
  /** Devre kesici bu ana kadar KAPALI (yoksa null). */
  readonly breakerOpenUntilMs: number | null;
}

/** Aynı sapma için en fazla deneme — aşılırsa devre kesici açılır. */
export const MAX_RECOVERY_ATTEMPTS = 3;
/** İki deneme arasındaki en az süre. */
export const RECOVERY_COOLDOWN_MS = 5_000;
/** Devre kesici kapalı kalma süresi — bu sürede hiç denenmez. */
export const RECOVERY_BREAKER_MS = 60_000;

function decision(
  outcome: RecoveryOutcome, action: RecoveryAction, code: string, reason: string,
): RecoveryDecision {
  return { outcome, action, code, reason };
}

/**
 * Kurtarma kararı — SAF. Hiçbir şey uygulamaz, yalnız NE YAPILMASI gerektiğini
 * söyler. Sıra ÖNEMLİDİR: politika redleri, bounded kapılar ve sapma tablosu.
 */
export function decideQueueRecovery(ctx: RecoveryContext): RecoveryDecision {
  /* ── 0) Sapma yok ────────────────────────────────────────────────────── */
  if (ctx.drift === 'IN_SYNC') {
    return decision('no_action', 'NONE', 'in_sync', 'Kuyruklar uyumlu.');
  }

  /* ── 1) Karşılaştırılamadı → düzeltilecek bilinen bir şey YOK ────────── */
  if (ctx.drift === 'UNKNOWN') {
    return decision(
      'rejected', 'NONE', 'drift_unknown',
      'Sapma karşılaştırılamadı; bilinmeyen durum üzerine düzeltme YAPILMAZ.',
    );
  }

  /* ── 2) Dış otorite → FAIL-CLOSED ────────────────────────────────────── */
  if (!ctx.nativeAuthoritative) {
    return decision(
      'rejected', 'NONE', 'external_authority',
      'Native timeline sahipliği bizde değil (dış kaynak); otomatik kurtarma YAPILMAZ.',
    );
  }

  /* ── 3) Kullanıcı komutu her zaman önceliklidir ──────────────────────── */
  if (ctx.userCommandInFlight) {
    return decision(
      'deferred', 'NONE', 'user_command_priority',
      'Kullanıcı komutu uçuyor; kurtarma ERTELENDİ (komut ezilmez).',
    );
  }

  /* ── 4) Kaynak devri sürerken yarım duruma yazılmaz ──────────────────── */
  if (ctx.handoverInFlight) {
    return decision(
      'deferred', 'NONE', 'handover_in_flight',
      'Kaynak devri sürüyor; devir bitmeden kurtarma BAŞLAMAZ.',
    );
  }

  /* ── 5) Devre kesici açık mı ─────────────────────────────────────────── */
  if (ctx.breakerOpenUntilMs !== null && ctx.nowMs < ctx.breakerOpenUntilMs) {
    return decision(
      'rejected', 'NONE', 'breaker_open',
      'Devre kesici kapalı: tekrarlayan başarısızlık sonrası kurtarma durduruldu.',
    );
  }

  /* ── 6) Deneme tavanı ────────────────────────────────────────────────── */
  if (ctx.attempts >= MAX_RECOVERY_ATTEMPTS) {
    return decision(
      'rejected', 'NONE', 'attempts_exhausted',
      `Bu sapma için deneme sınırı doldu (${MAX_RECOVERY_ATTEMPTS}); sonsuz döngü ÖNLENDİ.`,
    );
  }

  /* ── 7) Cooldown ─────────────────────────────────────────────────────── */
  if (
    ctx.lastAttemptAtMs !== null
    && ctx.nowMs - ctx.lastAttemptAtMs < RECOVERY_COOLDOWN_MS
  ) {
    return decision(
      'deferred', 'NONE', 'cooldown',
      'Son denemeden bu yana yeterli süre geçmedi.',
    );
  }

  /* ── 8) Sapma türüne göre eylem ──────────────────────────────────────── */
  switch (ctx.drift) {
    case 'UI_AHEAD':
      // UI daha yeni bir kuyruk yazdığını sanıyor ama native uygulamamış.
      // ÇALAN parçaya dokunulmaz; UI native gerçeğe göre yeniden üretilir.
      return decision(
        'recovered', 'REPROJECT_UI_FROM_NATIVE', 'ui_ahead_reprojected',
        'UI projeksiyonu native timeline\'dan yeniden üretildi (çalan medya değişmedi).',
      );

    case 'NATIVE_AHEAD':
      // Bildirim/medya tuşuyla dışarıdan değişmiş olabilir — native gerçektir.
      return decision(
        'recovered', 'REPROJECT_UI_FROM_NATIVE', 'native_ahead_applied',
        'Native timeline projeksiyonu UI\'ye uygulandı.',
      );

    case 'INDEX_DRIFT':
      return decision(
        'recovered', 'ALIGN_INDEX', 'index_aligned',
        'İndeks native gerçeğe hizalandı (kuyruk içeriği korundu).',
      );

    case 'ITEM_MISMATCH':
      // Aktif ÇALAN native öğe korunur; UI ona hizalanır.
      return decision(
        'recovered', 'REPROJECT_UI_FROM_NATIVE', 'item_mismatch_aligned',
        'Çalan native öğe KORUNDU; UI projeksiyonu ona hizalandı.',
      );

    case 'LENGTH_DRIFT':
      return decision(
        'recovered', 'REPROJECT_UI_FROM_NATIVE', 'length_drift_reprojected',
        'Uzunluk sapması: UI projeksiyonu native timeline\'dan yeniden üretildi.',
      );

    case 'ITEM_UNAVAILABLE':
      // Native kuyruk boş. Oynatma HÂLÂ aktif görünüyorsa bu bir TUTARSIZLIKTIR:
      // temizlemek çalan sesi görünmez yapardı → reddet ve görünür kıl.
      if (ctx.playbackActive) {
        return decision(
          'rejected', 'NONE', 'empty_native_while_playing',
          'Native kuyruk boş görünürken oynatma sürüyor — TUTARSIZLIK; otomatik temizleme YAPILMAZ.',
        );
      }
      return decision(
        'recovered', 'CLEAR_UI_QUEUE', 'empty_native_cleared',
        'Native kuyruk boş ve oynatma durmuş; UI kuyruğu temizlendi.',
      );

    case 'SOURCE_MISMATCH':
      // İki taraf farklı kaynak diyor: devir yarım kalmış olabilir. UI'yi
      // native'e hizalamak güvenlidir (native ses üreten taraftır).
      return decision(
        'recovered', 'REPROJECT_UI_FROM_NATIVE', 'source_mismatch_realigned',
        'Kaynak çelişkisi: UI, ses üreten native kaynağa hizalandı.',
      );

    default:
      // Bilinmeyen sapma → fail-closed (yeni bir sapma türü sessizce "düzeltilmez").
      return decision(
        'rejected', 'NONE', 'unhandled_drift',
        'Bu sapma türü için tanımlı güvenli kurtarma YOK.',
      );
  }
}

/* ── Bayat (stale) sonuç kapısı ──────────────────────────────────────────── */

export interface StalenessCheck {
  /** Karar verilirken geçerli olan generation. */
  readonly decidedAtGeneration: number;
  /** Uygulama anındaki generation. */
  readonly currentGeneration: number;
  /** Karar verilirken gözlenen native kuyruk revizyonu. */
  readonly decidedAtNativeRevision: number;
  /** Uygulama anındaki native kuyruk revizyonu. */
  readonly currentNativeRevision: number;
}

/**
 * Kurtarma sonucu UYGULANABİLİR mi? Karar ile uygulama arasında dünya
 * değiştiyse (yeni devir · yeni kuyruk) sonuç ATILIR — geç gelen kurtarma
 * yeni durumu ESKİYE çeviremez.
 */
export function isRecoveryApplicable(c: StalenessCheck): boolean {
  return c.decidedAtGeneration === c.currentGeneration
    && c.decidedAtNativeRevision === c.currentNativeRevision;
}

/* ── Bounded deneme defteri (saf reducer) ────────────────────────────────── */

export interface RecoveryLedgerEntry {
  readonly signature: string;
  readonly attempts: number;
  readonly lastAttemptAtMs: number;
  readonly breakerOpenUntilMs: number | null;
}

export interface RecoveryLedger {
  readonly entries: readonly RecoveryLedgerEntry[];
}

export const EMPTY_RECOVERY_LEDGER: RecoveryLedger = { entries: [] };

/** Defterde tutulan en fazla sapma imzası — sınırsız büyüme YOK. */
export const MAX_LEDGER_ENTRIES = 8;

/** Sapma imzası — PII taşımaz, yalnız sapma türü + kaynak sınıfı. */
export function recoverySignature(drift: QueueDrift, sourceId: string): string {
  return `${drift}:${sourceId}`;
}

export function readLedger(ledger: RecoveryLedger, signature: string): RecoveryLedgerEntry | null {
  return ledger.entries.find((e) => e.signature === signature) ?? null;
}

/**
 * Deneme kaydeder. Başarısızlık tavanı aşarsa devre kesiciyi AÇAR.
 * Saf: yeni defter döner, girdiyi mutasyona uğratmaz.
 */
export function recordAttempt(
  ledger: RecoveryLedger,
  input: { signature: string; nowMs: number; failed: boolean },
): RecoveryLedger {
  const existing = readLedger(ledger, input.signature);
  const attempts = (existing?.attempts ?? 0) + 1;
  const breakerOpenUntilMs = input.failed && attempts >= MAX_RECOVERY_ATTEMPTS
    ? input.nowMs + RECOVERY_BREAKER_MS
    : (existing?.breakerOpenUntilMs ?? null);

  const entry: RecoveryLedgerEntry = {
    signature: input.signature,
    attempts,
    lastAttemptAtMs: input.nowMs,
    breakerOpenUntilMs,
  };

  const others = ledger.entries.filter((e) => e.signature !== input.signature);
  // En eski kayıt düşer (bounded halka).
  const next = [...others, entry].slice(-MAX_LEDGER_ENTRIES);
  return { entries: next };
}

/** Sapma çözüldüğünde sayaç sıfırlanır — geçmiş yeni sapmayı cezalandırmaz. */
export function clearSignature(ledger: RecoveryLedger, signature: string): RecoveryLedger {
  const entries = ledger.entries.filter((e) => e.signature !== signature);
  return entries.length === ledger.entries.length ? ledger : { entries };
}

/** Kurtarma sonucunun kullanıcıya/Mavi'ye söylenebilecek belirsizlik düzeyi. */
export function isUncertainOutcome(outcome: RecoveryOutcome): boolean {
  return outcome === 'deferred' || outcome === 'rejected' || outcome === 'failed';
}
