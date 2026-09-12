/**
 * maviCore/wiring/maviMediaPort.ts — MAVİ ÇEKİRDEĞİ Faz-3 · MAVI3-4c media.next PORT PARİTESİ.
 *
 * AMAÇ: TAKEOVER açıldığında `media.next`in davranışı eski hatla (useVoiceCommandHandler →
 * routeIntent.nextTrack) BİREBİR aynı olmalıdır. Eski hat şunu yapar:
 *     cancelAssistantDuck();  next();      // next = carosMediaLayer (KUYRUK-FARKINDA)
 * Mavi portu Faz-2'de yalnız `next()` çağırıyordu → `cancelAssistantDuck` EKSİKTİ; asistan
 * ducking-resume'u komuttan sonra müziği yeniden başlatarak eylemi ezebilirdi. Bu modül pariteyi
 * kurar ve üstüne DÜRÜSTLÜK ön-koşulu ekler.
 *
 * DÜRÜSTLÜK ÖN-KOŞULU (CLAUDE.md · "başarısız eylem yapılmış gibi cevap verilmez"):
 * `carosMediaLayer.next()` `void` döner ve kuyruk da oturum da yoksa SESSİZ NO-OP'tur. Bu durumda
 * `ok:true` dönmek YALAN olurdu. Bu yüzden `hasQueue() || hasSession()` sağlanmıyorsa `next()`
 * ÇAĞRILMAZ ve port typed bir hata fırlatır → handler `ok:false` üretir (feedback dürüst kalır).
 *
 * SIRA (eski hatla aynı): cancelAssistantDuck() → ön-koşul → next().
 * `cancelAssistantDuck` ön-koşuldan ÖNCE çağrılır çünkü eski hat da onu koşulsuz çağırır (parite);
 * idempotenttir ve tek başına hiçbir medya durumunu değiştirmez.
 *
 * SAF/DI: hiçbir platform servisi import EDİLMEZ — gerçek portlar wiring'de bağlanır.
 *
 * PR-DIAG-2 · KANIT ÜRETİCİSİ: port her çağrıda zaten hesapladığı olguları (duck çağrıldı mı ·
 * queue/session · next çağrıldı mı · kümülatif çağrı sayısı · servis sonucu) kanıt deposuna yazar.
 * YENİ ÖLÇÜM/POLLING/TIMER YOK — yalnız var olan gerçekler kaydedilir. Kayıt FAIL-SOFT'tur:
 * tanı yazımı hiçbir koşulda medya akışını bozamaz.
 */

import { recordMediaNext, getCurrentCorrelation } from './maviEvidence';

/** Ön-koşul sağlanmadığında fırlatılan typed hata (handler bunu ok:false'a çevirir). */
export class MediaUnavailableError extends Error {
  readonly code = 'media_unavailable' as const;
  constructor(message = 'çalan medya yok') {
    super(message);
    this.name = 'MediaUnavailableError';
  }
}

export interface MediaNextPortDeps {
  /** voiceService.cancelAssistantDuck — ducking-resume'u iptal eder (eski hat paritesi). */
  readonly cancelAssistantDuck: () => void;
  /** carosMediaLayer.hasQueue — uygulama-içi kuyrukta >1 parça var mı. */
  readonly hasQueue: () => boolean;
  /** mediaService.getMediaState().hasSession — gerçek Android MediaSession var mı. */
  readonly hasSession: () => boolean;
  /** carosMediaLayer.next — KUYRUK-FARKINDA sonraki parça (eski hattın kullandığı fonksiyonun aynısı). */
  readonly next: () => void;
}

/**
 * Eski hatla parite kuran `media.next` portunu üretir. Ön-koşul sağlanmazsa `next()` ÇAĞRILMAZ ve
 * `MediaUnavailableError` fırlatılır. Ön-koşul okuması fail-soft'tur: hasQueue/hasSession throw
 * ederse o kaynak "yok" sayılır (uydurma başarı üretmemek için fail-closed okuma).
 */
export function createMediaNextPort(deps: MediaNextPortDeps): () => void {
  // Bu port örneğinin kümülatif next() çağrı sayısı — tanı kanıtı (çift atlama tespiti).
  // Tek sayı: bounded, timer yok, davranışa etkisi YOK.
  let nextCallCount = 0;

  return function mediaNextPort(): void {
    let duckCalled = false;
    let queue = false;
    let session = false;
    let nextCalled = false;

    // 1. Parite: eski hat da bunu KOŞULSUZ çağırır (idempotent, medya durumunu değiştirmez).
    try { deps.cancelAssistantDuck(); duckCalled = true; } catch { /* fail-soft */ }

    // 2. Dürüstlük ön-koşulu — okuma hatası "yok" sayılır (fail-closed).
    try { queue = deps.hasQueue() === true; } catch { queue = false; }
    try { session = deps.hasSession() === true; } catch { session = false; }

    if (!queue && !session) {
      recordPort('unavailable', 'media_unavailable');
      throw new MediaUnavailableError();
    }

    // 3. Gerçek eylem. Servis throw ederse yukarı taşınır → handler ok:false üretir.
    try {
      deps.next();
      nextCalled = true;
      nextCallCount++;
      recordPort('ok', null);
    } catch (e) {
      nextCalled = true; // çağrıldı ama düştü — kanıt olarak ayrılır
      nextCallCount++;
      recordPort('throw', e instanceof Error ? e.name : 'unknown_error');
      throw e;
    }

    /** Kanıt kaydı — FAIL-SOFT: tanı yazımı ASLA medya akışını bozmaz. */
    function recordPort(serviceResult: 'ok' | 'unavailable' | 'throw', errorReason: string | null): void {
      try {
        recordMediaNext({
          atMs: Date.now(),
          correlationId: getCurrentCorrelation(),
          port: 'mavi',
          nextCallCount,
          cancelAssistantDuckCalled: duckCalled,
          hasQueue: queue,
          hasSession: session,
          nextCalled,
          serviceResult,
          typedFeedback: null, // feedback kodu üst katmanda üretilir (köprü yazar)
          errorReason,
        });
      } catch { /* fail-soft */ }
    }
  };
}
