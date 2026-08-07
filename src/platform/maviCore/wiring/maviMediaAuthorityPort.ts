/**
 * maviMediaAuthorityPort.ts — MÜZİK HUB PAKET A · Mavi'nin DÜRÜST medya portu.
 *
 * SORUN: eski hat `next()`/`play()` çağırıp `ok:true` dönüyordu. Komut hiçbir
 * ses üretmese bile Mavi "çalıyor" diyordu. Kullanıcı sessizlik duyuyor, asistan
 * başarı bildiriyordu.
 *
 * BU PORT: MediaCommandGateway'in typed `CommandTruth` çıktısını Mavi'nin
 * söyleyebileceği İDDİA sınıfına çevirir:
 *   PLAYING       → "çalıyor"                    (gözlendi)
 *   REQUEST_SENT  → "başlatma isteği gönderildi" (doğrulama YOK — uzak kaynak)
 *   FAILED        → gerçek hata nedeni
 *   NOT_ATTEMPTED → komut denenmedi (desteklenmiyor / kaynak yok)
 *
 * SAF/DI: platform servisi import EDİLMEZ; gerçek gateway wiring'de bağlanır.
 */

import type { CommandTruth, HonestClaim } from '../../media/authority/playbackTruth';

export interface MediaActionOutcome {
  /** Eylem gerçekten oldu mu — REQUEST_SENT de `true` sayılır ama iddia farklıdır. */
  readonly ok: boolean;
  readonly claim: HonestClaim;
  /** Kullanıcıya söylenebilecek Türkçe, DÜRÜST ifade. */
  readonly message: string;
  readonly failureCode: string | null;
  readonly verificationLevel: string;
}

/** Hata kodlarının kullanıcıya anlaşılır Türkçe karşılığı. */
const FAILURE_MESSAGES: Readonly<Record<string, string>> = {
  authority_unavailable: 'müzik altyapısı hazır değil',
  no_active_source: 'çalan medya yok',
  unsupported_capability: 'bu kaynak bu komutu desteklemiyor',
  focus_denied: 'ses odağı alınamadı',
  focus_delayed: 'ses odağı meşgul — başka bir kaynak konuşuyor',
  duplicate_command: 'aynı komut tekrar geldi',
  no_media: 'çalınacak parça yok',
  no_next_item: 'sırada başka parça yok',
  empty_queue: 'çalma listesi boş',
  source_stop_unverified: 'önceki kaynak durdurulamadı',
  handover_timeout: 'kaynak değişimi zaman aşımına uğradı',
  superseded: 'komut yeni bir istekle değiştirildi',
  spotify_not_connected: "Spotify'a bağlı değilsin",
  network_error: 'ağ hatası',
};

function failureMessage(code: string | null): string {
  if (!code) return 'bilinmeyen hata';
  return FAILURE_MESSAGES[code] ?? code;
}

/** `CommandTruth` → Mavi'nin söyleyebileceği dürüst sonuç. */
export function describeOutcome(truth: CommandTruth, claim: HonestClaim): MediaActionOutcome {
  switch (claim) {
    case 'PLAYING':
      return {
        ok: true,
        claim,
        message: 'çalıyor',
        failureCode: null,
        verificationLevel: truth.verificationLevel,
      };
    case 'REQUEST_SENT':
      return {
        ok: true,
        claim,
        // "çalıyor" DEMEZ: doğrulama yapılamadığı için iddia edilemez.
        message: 'başlatma isteği gönderildi',
        failureCode: null,
        verificationLevel: truth.verificationLevel,
      };
    case 'NOT_ATTEMPTED':
      return {
        ok: false,
        claim,
        message: failureMessage(truth.failureCode),
        failureCode: truth.failureCode,
        verificationLevel: truth.verificationLevel,
      };
    default:
      return {
        ok: false,
        claim: 'FAILED',
        message: `başarısız: ${failureMessage(truth.failureCode)}`,
        failureCode: truth.failureCode,
        verificationLevel: truth.verificationLevel,
      };
  }
}

export interface MediaAuthorityPortDeps {
  /** voiceService.cancelAssistantDuck — eski hat paritesi (idempotent). */
  readonly cancelAssistantDuck: () => void;
  readonly play: () => Promise<CommandTruth>;
  readonly pause: () => Promise<CommandTruth>;
  readonly stop: () => Promise<CommandTruth>;
  readonly next: () => Promise<CommandTruth>;
  readonly previous: () => Promise<CommandTruth>;
  readonly seek: (positionSec: number) => Promise<CommandTruth>;
  /** playbackTruth.honestClaim — enjekte edilir (saflık korunur). */
  readonly claimOf: (t: CommandTruth) => HonestClaim;
}

export interface MediaAuthorityPort {
  play(): Promise<MediaActionOutcome>;
  pause(): Promise<MediaActionOutcome>;
  stop(): Promise<MediaActionOutcome>;
  next(): Promise<MediaActionOutcome>;
  previous(): Promise<MediaActionOutcome>;
  seek(positionSec: number): Promise<MediaActionOutcome>;
}

/**
 * Mavi medya portunu üretir. Her eylem önce `cancelAssistantDuck` çağırır
 * (eski hat paritesi: asistan ducking-resume'u komutu ezmesin), sonra tek
 * kapıdan geçer ve DÜRÜST sonuç döndürür.
 */
export function createMediaAuthorityPort(deps: MediaAuthorityPortDeps): MediaAuthorityPort {
  async function run(fn: () => Promise<CommandTruth>): Promise<MediaActionOutcome> {
    try { deps.cancelAssistantDuck(); } catch { /* fail-soft — parite */ }
    try {
      const truth = await fn();
      return describeOutcome(truth, deps.claimOf(truth));
    } catch (e) {
      return {
        ok: false,
        claim: 'FAILED',
        message: `başarısız: ${e instanceof Error ? e.message : 'bilinmeyen hata'}`,
        failureCode: 'port_threw',
        verificationLevel: 'NONE',
      };
    }
  }

  return {
    play:     () => run(deps.play),
    pause:    () => run(deps.pause),
    stop:     () => run(deps.stop),
    next:     () => run(deps.next),
    previous: () => run(deps.previous),
    seek:     (sec: number) => run(() => deps.seek(sec)),
  };
}

/* ── Yönlendirilmiş port (otorite ↔ eski hat) ────────────────────────────── */

/** Medya komutu başarısız olduğunda fırlatılır → handler `ok:false` üretir. */
export class MediaCommandFailedError extends Error {
  readonly code: string;
  constructor(message: string, code: string | null) {
    super(message);
    this.name = 'MediaCommandFailedError';
    this.code = code ?? 'media_command_failed';
  }
}

/** Handler'a taşınan dürüst iddia (maviPilotHandlers.MediaCommandFeedback ile aynı şekil). */
export interface RoutedMediaFeedback {
  readonly claim: 'PLAYING' | 'REQUEST_SENT';
  readonly message: string;
}

/**
 * PAKET B · Kurtarma belirsizliği. Kuyruk kurtarması ERTELENDİ/REDDEDİLDİ ise
 * UI ile native gerçek arasında bilinen bir sapma vardır: Mavi "sonraki parçaya
 * geçtim" gibi KESİN bir ifade kuramaz, belirsizliği açıkça söylemelidir.
 */
export interface RecoveryUncertainty {
  readonly uncertain: boolean;
  /** Kısa Türkçe açıklama (ör. "kuyruk hizalaması bekliyor"). */
  readonly note: string;
}

export const NO_UNCERTAINTY: RecoveryUncertainty = { uncertain: false, note: '' };

export interface RoutedMediaPortDeps {
  /**
   * Komut otoriteye mi gitmeli — YALNIZ native platformda ve otoritenin
   * sahiplendiği kaynak (LOCAL · STREAM · INTERNET_RADIO) aktifken true.
   * Okuma hatası `false` sayılır: bilinmiyorsa ESKİ hat kullanılır (fail-soft).
   *
   * `Promise` DÖNEBİLİR: composition root otorite modüllerini **dinamik**
   * yükler (ana paket düşük-uç bütçesinde kalsın diye) ve karar o yüklemeden
   * sonra verilir.
   */
  readonly isAuthorityRoute: () => boolean | Promise<boolean>;
  readonly authority: MediaAuthorityPort;
  /** Eski hat — otorite yokken davranış AYNEN korunur (geriye uyumluluk). */
  readonly legacyPlay: () => void;
  readonly legacyPause: () => void;
  /** maviMediaPort.createMediaNextPort çıktısı (dürüstlük ön-koşullu). */
  readonly legacyNext: () => void;
  /**
   * Kuyruk kurtarma belirsizliği okuyucusu (opsiyonel). Verilmezse belirsizlik
   * YOK sayılır — eski davranış birebir korunur (geriye uyumluluk).
   * Okuma hatası da "belirsizlik yok" sayılmaz: fail-soft olarak yok sayılır
   * ama iddia yükseltilmez (aşağıdaki `toFeedback` yalnız DÜŞÜRME yapar).
   */
  readonly readRecoveryUncertainty?: () => RecoveryUncertainty;
}

export interface RoutedMediaPort {
  play(): Promise<RoutedMediaFeedback | void>;
  pause(): Promise<RoutedMediaFeedback | void>;
  next(): Promise<RoutedMediaFeedback | void>;
}

/**
 * Mavi medya komutlarını TEK kapıya yönlendirir.
 *
 * - Otorite sahibi kaynak aktifse → MediaCommandGateway (typed truth).
 *   Başarısızlıkta THROW eder; sessiz "tamam" ÜRETİLMEZ.
 * - Aksi halde → eski hat (Spotify/YouTube/harici oturum davranışı korunur).
 *
 * `isAuthorityRoute` throw ederse eski hat seçilir: yönlendirme okuması
 * hiçbir koşulda komutu düşürmez.
 */
export function createRoutedMediaPort(deps: RoutedMediaPortDeps): RoutedMediaPort {
  async function shouldRouteToAuthority(): Promise<boolean> {
    try { return (await deps.isAuthorityRoute()) === true; } catch { return false; }
  }

  function readUncertainty(): RecoveryUncertainty {
    if (!deps.readRecoveryUncertainty) return NO_UNCERTAINTY;
    try { return deps.readRecoveryUncertainty() ?? NO_UNCERTAINTY; }
    catch { return NO_UNCERTAINTY; }
  }

  function toFeedback(outcome: MediaActionOutcome): RoutedMediaFeedback {
    if (!outcome.ok) throw new MediaCommandFailedError(outcome.message, outcome.failureCode);

    const claim = outcome.claim === 'PLAYING' ? 'PLAYING' : 'REQUEST_SENT';
    const u = readUncertainty();
    /* PAKET B · DÜRÜSTLÜK: bilinen bir kuyruk sapması varken "çalıyor" gibi
       KESİN iddia kurulamaz. İddia YALNIZ DÜŞÜRÜLÜR (asla yükseltilmez):
       PLAYING → REQUEST_SENT + belirsizlik notu. */
    if (u.uncertain) {
      return {
        claim: 'REQUEST_SENT',
        message: claim === 'PLAYING'
          ? `çalıyor ama ${u.note}`
          : `${outcome.message} (${u.note})`,
      };
    }
    return { claim, message: outcome.message };
  }

  return {
    async play(): Promise<RoutedMediaFeedback | void> {
      if (!await shouldRouteToAuthority()) { deps.legacyPlay(); return; }
      return toFeedback(await deps.authority.play());
    },
    async pause(): Promise<RoutedMediaFeedback | void> {
      if (!await shouldRouteToAuthority()) { deps.legacyPause(); return; }
      return toFeedback(await deps.authority.pause());
    },
    async next(): Promise<RoutedMediaFeedback | void> {
      if (!await shouldRouteToAuthority()) { deps.legacyNext(); return; }
      return toFeedback(await deps.authority.next());
    },
  };
}
