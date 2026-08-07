/**
 * vehicleIdentityCoordinator.ts — ARAÇ KİMLİĞİNİN TEK YAYIN NOKTASI.
 *
 * ── SÖZLEŞME (BAĞLAYICI) ──────────────────────────────────────────────
 * **Hiçbir modül `telemetryService.reportVehicleIdentity()`'yi DOĞRUDAN
 * çağırmaz.** Tüm kimlik yayını buradan geçer. Sebep: doğrudan çağrı
 * yapan her modül kendi dedupe'unu, kendi retry'ını ve kendi çakışma
 * yorumunu getirir — bu da "ikinci otorite" demektir.
 *
 * Akış:
 *   OBD handshake → VID store → Fingerprint store
 *        ↓
 *   observe()  ─ kanonik gözlem kurulur (saf)
 *        ↓
 *   Validation ─ evaluatePublishable() · kanıtsız gözlem GÖNDERİLMEZ
 *        ↓
 *   Dedupe     ─ identitySignature() · aynı kimlik TEKRAR GÖNDERİLMEZ
 *        ↓
 *   Publish    ─ tek çağrı noktası (fail-soft, backoff'lu retry)
 *        ↓
 *   Sunucu hükmü ─ CREATED · UPDATED · UNCHANGED · IDENTITY_CONFLICT
 *
 * ── HOT-PATH DİSİPLİNİ ────────────────────────────────────────────────
 * `observe()` SENKRON ve ALLOCATION-CIMRIDIR; ağ çağrısı yapmaz. Yayın
 * `queueMicrotask` ile abonelik yolundan ÇIKARILIR (zustand subscribe
 * içinde `await` YOK). 3 Hz telemetri tick'i kimlik yayını TETİKLEMEZ:
 * imza değişmedikçe hiçbir iş yapılmaz.
 *
 * ── ZERO-LEAK ─────────────────────────────────────────────────────────
 * Tek retry timer'ı; `stop()` onu temizler. Kapatıldıktan sonra gelen
 * yanıt durumu DEĞİŞTİRMEZ (generation guard).
 */

import {
  buildIdentityObservation,
  evaluatePublishable,
  classifyIdentityChange,
  shouldPublishChange,
  /* NOT: `isConflictChange` BİLEREK kullanılmıyor — çakışma hükmünü SUNUCU
     verir (`ack.conflict`). İstemcinin yerel sınıflandırması yalnız yayın
     KARARI içindir; "çakışma var" demek sunucunun yetkisidir. */
  identitySignature,
  type VehicleIdentityObservation,
  type BuildIdentityInput,
  type IdentityChange,
  type IdentityStatus,
  type PublishRejection,
} from './vehicleIdentityObservation';
import type { IdentityAck } from './vehicleIdentityReport';

/* ── Yayıncı durumu ────────────────────────────────────────────────────── */

export const PUBLISHER_STATES = [
  'IDLE',        // henüz gözlem yok
  'SKIPPED',     // gözlem var ama yayına değmez (kanıtsız veya değişmemiş)
  'PUBLISHING',  // çağrı uçuşta
  'PUBLISHED',   // sunucu kabul etti
  'CONFLICT',    // sunucu çakışma bildirdi
  'RETRY_WAIT',  // hata → backoff bekliyor
  'FAILED',      // deneme bütçesi tükendi
  'STOPPED',
] as const;
export type PublisherState = (typeof PUBLISHER_STATES)[number];

/** Yayın denemesi bütçesi — sonsuz retry YASAK (batarya + sunucu yükü). */
export const MAX_PUBLISH_ATTEMPTS = 4;
/** Backoff basamakları (ms) — son basamak tekrar kullanılır. */
export const PUBLISH_BACKOFF_MS = [5_000, 20_000, 60_000] as const;
/** Gözlem bu süreden eskiyse kimlik `STALE` sayılır. */
export const IDENTITY_STALE_AFTER_MS = 24 * 60 * 60_000;

/* ── Bağımlılıklar (DI — test edilebilirlik) ───────────────────────────── */

export interface IdentityCoordinatorDeps {
  /** Tek yayın ucu. Fail-soft: fırlatmamalı, ama fırlatırsa yakalanır. */
  readonly publish: (obs: VehicleIdentityObservation) => Promise<IdentityAck | null>;
  readonly now: () => number;
  /** Retry zamanlayıcı — testte sahte zamanlayıcıyla değiştirilir. */
  readonly setTimer: (fn: () => void, ms: number) => unknown;
  readonly clearTimer: (handle: unknown) => void;
}

/* ── Gözlemlenebilir durum (LAB salt-okur) ─────────────────────────────── */

export interface IdentityCoordinatorSnapshot {
  readonly status: IdentityStatus;
  readonly publisherState: PublisherState;
  /** Son kurulan gözlem (ham parmak izi girdisi TAŞIMAZ). */
  readonly observation: VehicleIdentityObservation | null;
  readonly lastChange: IdentityChange | null;
  readonly lastRejection: PublishRejection | null;
  readonly attemptCount: number;
  readonly retryCount: number;
  readonly conflictCount: number;
  readonly publishedCount: number;
  readonly dedupeSkipCount: number;
  /** Sunucudan gelen son hüküm. */
  readonly lastAckState: string | null;
  readonly lastAckConfidence: number | null;
  readonly lastConflictReason: string | null;
  /** Epoch ms; hiç olmadıysa `null` (uydurma tarih YOK). */
  readonly lastSuccessAtMs: number | null;
  readonly lastFailureAtMs: number | null;
  readonly identityRevision: number | null;
}

const EMPTY_SNAPSHOT: IdentityCoordinatorSnapshot = Object.freeze({
  status: 'UNKNOWN', publisherState: 'IDLE', observation: null,
  lastChange: null, lastRejection: null,
  attemptCount: 0, retryCount: 0, conflictCount: 0,
  publishedCount: 0, dedupeSkipCount: 0,
  lastAckState: null, lastAckConfidence: null, lastConflictReason: null,
  lastSuccessAtMs: null, lastFailureAtMs: null, identityRevision: null,
});

/* ── Koordinatör ───────────────────────────────────────────────────────── */

export class VehicleIdentityCoordinator {
  private readonly _deps: IdentityCoordinatorDeps;

  private _stopped = false;
  /** Kapatma/yeniden başlatma sonrası eski yanıtları yok saymak için. */
  private _generation = 0;

  private _observation: VehicleIdentityObservation | null = null;
  /** SUNUCUYA GİTMİŞ son kimliğin imzası — dedupe otoritesi. */
  private _publishedSignature: string | null = null;
  /** Son gözlemin imzası (yayınlanmamış olabilir). */
  private _lastSignature: string | null = null;

  private _publisherState: PublisherState = 'IDLE';
  private _status: IdentityStatus = 'UNKNOWN';
  private _lastChange: IdentityChange | null = null;
  private _lastRejection: PublishRejection | null = null;

  private _attemptCount = 0;
  private _retryCount = 0;
  private _conflictCount = 0;
  private _publishedCount = 0;
  private _dedupeSkipCount = 0;

  private _lastAckState: string | null = null;
  private _lastAckConfidence: number | null = null;
  private _lastConflictReason: string | null = null;
  private _lastSuccessAtMs: number | null = null;
  private _lastFailureAtMs: number | null = null;
  private _identityRevision: number | null = null;

  private _timer: unknown = null;
  /** Uçuşta yayın varken ikinci yayın başlatılmaz (single-flight). */
  private _inFlight = false;
  /** Uçuş sırasında gelen daha yeni gözlem. */
  private _pending: VehicleIdentityObservation | null = null;

  constructor(deps: IdentityCoordinatorDeps) {
    this._deps = deps;
  }

  /* ── Giriş noktası ──────────────────────────────────────────────────── */

  /**
   * Yeni kimlik kanıtı bildirir. SENKRON, ağ çağrısı YOK.
   *
   * Aynı kimlik tekrar bildirildiğinde HİÇBİR İŞ YAPILMAZ (dedupe) — bu,
   * `useVidStore` aboneliğinin telemetri tick'lerinde tetiklenmesine karşı
   * asıl korumadır.
   */
  observe(input: BuildIdentityInput): void {
    if (this._stopped) return;
    try {
      const next = buildIdentityObservation(input);
      const signature = identitySignature(next);

      /* Gözlem hep saklanır (LAB gözlemi ve tazelik için) ama yayın kararı ayrı. */
      const prev = this._observation;
      this._observation = next;
      this._identityRevision = next.identityRevision ?? this._identityRevision;

      /* 1) Kanıt kapısı — kanıtsız gözlem sunucuya GİTMEZ. */
      const decision = evaluatePublishable(next);
      if (!decision.publishable) {
        this._lastRejection = decision.rejection;
        this._lastChange = null;
        this._publisherState = 'SKIPPED';
        this._status = this._deriveStatus(next);
        return;
      }
      this._lastRejection = null;

      /* 2) Değişim sınıflandırması (§4 politikası). */
      const change = classifyIdentityChange(prev, next);
      this._lastChange = change;

      /* 3) Dedupe — imza SUNUCUYA GİTMİŞ olanla aynıysa gönderme.
         `change` UNCHANGED olmasa bile (ör. yalnız confidence oynadı)
         imza aynıysa yayın YAPILMAZ: imza kimliğin kendisidir. */
      if (signature === this._publishedSignature) {
        this._dedupeSkipCount += 1;
        this._publisherState = 'SKIPPED';
        this._status = this._deriveStatus(next);
        this._lastSignature = signature;
        return;
      }
      if (!shouldPublishChange(change)) {
        this._dedupeSkipCount += 1;
        this._publisherState = 'SKIPPED';
        this._status = this._deriveStatus(next);
        this._lastSignature = signature;
        return;
      }
      this._lastSignature = signature;

      /* Yeni kimlik → önceki deneme bütçesi sıfırlanır (yeni gerçek, yeni şans). */
      this._attemptCount = 0;
      this._clearTimer();

      /* 4) Yayın — abonelik yolundan ÇIKARILIR (zustand subscribe içinde await YOK). */
      this._schedulePublish(next);
    } catch {
      /* FAIL-SOFT: kimlik hatası OBD/telemetri akışını ASLA bozmaz. */
    }
  }

  /** Retry timer'ını temizler ve daha fazla yayın yapmaz (zero-leak). */
  stop(): void {
    this._stopped = true;
    this._generation += 1;
    this._clearTimer();
    this._pending = null;
    this._publisherState = 'STOPPED';
  }

  /**
   * LAB için salt-okunur anlık görüntü — hiçbir şey BAŞLATMAZ.
   *
   * ASLA FIRLATMAZ: bu, CAROS LAB ekranının okuma yüzeyidir; buradan çıkan
   * bir istisna gözlem ekranını çökertir (gözlemlenebilirlik kaybı).
   * Durum türetimi `now()` çağırdığı için tam muhafaza gerekir.
   */
  getSnapshot(): IdentityCoordinatorSnapshot {
    try {
      return this._buildSnapshot();
    } catch {
      /* Türetim düşerse ham sayaçlar yine de gösterilir; durum UYDURULMAZ. */
      return { ...EMPTY_SNAPSHOT, publisherState: this._publisherState };
    }
  }

  private _buildSnapshot(): IdentityCoordinatorSnapshot {
    if (this._observation === null && this._publisherState === 'IDLE') {
      return EMPTY_SNAPSHOT;
    }
    return {
      status: this._observation ? this._deriveStatus(this._observation) : this._status,
      publisherState: this._publisherState,
      observation: this._observation,
      lastChange: this._lastChange,
      lastRejection: this._lastRejection,
      attemptCount: this._attemptCount,
      retryCount: this._retryCount,
      conflictCount: this._conflictCount,
      publishedCount: this._publishedCount,
      dedupeSkipCount: this._dedupeSkipCount,
      lastAckState: this._lastAckState,
      lastAckConfidence: this._lastAckConfidence,
      lastConflictReason: this._lastConflictReason,
      lastSuccessAtMs: this._lastSuccessAtMs,
      lastFailureAtMs: this._lastFailureAtMs,
      identityRevision: this._identityRevision,
    };
  }

  /* ── İç akış ────────────────────────────────────────────────────────── */

  /** Durum türetimi — sunucu onayı YOKSA `VERIFIED` DENMEZ. */
  private _deriveStatus(obs: VehicleIdentityObservation): IdentityStatus {
    if (this._conflictCount > 0 && this._publisherState === 'CONFLICT') return 'CONFLICT';
    if (obs.vin === null && obs.fingerprintHash === null) return 'UNKNOWN';
    if (this._publishedSignature === null) return 'PENDING';
    /* Sunucuya gitmiş kimlik bayatladı mı? */
    if (obs.observedAt !== null) {
      const age = this._deps.now() - obs.observedAt;
      if (age > IDENTITY_STALE_AFTER_MS) return 'STALE';
    }
    /* Son gözlem henüz yayınlanmadıysa PENDING. */
    if (this._lastSignature !== null && this._lastSignature !== this._publishedSignature) {
      return 'PENDING';
    }
    return 'VERIFIED';
  }

  private _schedulePublish(obs: VehicleIdentityObservation): void {
    if (this._inFlight) {
      /* Uçuşta çağrı var — en yeni gözlemi bekletir (kuyruk büyütmez). */
      this._pending = obs;
      return;
    }
    this._publisherState = 'PUBLISHING';
    this._inFlight = true;
    const generation = this._generation;
    /* Mikrotask: abonelik yolundan çıkar, aynı tick'te ağ çağrısı başlatmaz.
       `_guardedPublish` ASLA reddetmez → yakalanmayan promise reddi olmaz. */
    queueMicrotask(() => { void this._guardedPublish(obs, generation); });
  }

  /**
   * `_doPublish`'in üst düzey muhafızı.
   *
   * NEDEN GEREKLİ: `_doPublish` içindeki HER adım (yalnız `publish` değil;
   * `now()`, durum hesabı, timer kurulumu) fırlatabilir. Muhafız olmadan bu
   * bir YAKALANMAYAN PROMISE REDDİ olur — `observe()`'un senkron try/catch'i
   * mikrotask sınırını GEÇEMEZ. Üretimde bu, kimlik yayınının çökmesi ve
   * `_inFlight`'ın sonsuza dek `true` kalması (yayının tamamen durması)
   * anlamına gelir.
   */
  private async _guardedPublish(
    obs: VehicleIdentityObservation,
    generation: number,
  ): Promise<void> {
    try {
      await this._doPublish(obs, generation);
    } catch {
      /* FAIL-SOFT: uçuş kilidi HER durumda serbest bırakılır — aksi halde
         koordinatör kalıcı olarak sessizleşir. */
      this._inFlight = false;
      try { this._publisherState = 'FAILED'; } catch { /* yok sayılır */ }
    }
  }

  private async _doPublish(obs: VehicleIdentityObservation, generation: number): Promise<void> {
    this._attemptCount += 1;
    let ack: IdentityAck | null = null;
    try {
      ack = await this._deps.publish(obs);
    } catch {
      ack = null;   // fail-soft: fırlatan yayıncı da hata sayılır
    }

    /* Kapatıldıysa veya yeni bir nesil başladıysa bu yanıt YOK SAYILIR. */
    if (this._stopped || generation !== this._generation) {
      this._inFlight = false;
      return;
    }
    this._inFlight = false;

    if (ack === null) {
      this._onFailure(obs, generation);
      return;
    }

    this._lastAckState = ack.state;
    this._lastAckConfidence = ack.identityConfidence;

    if (ack.conflict) {
      /* ÇAKIŞMA: sunucu eski kaydı korudu. Bu bir AĞ HATASI DEĞİL →
         retry YAPILMAZ (aynı çakışan kimliği tekrar göndermek anlamsız).
         İmza "gönderilmiş" sayılır ki sonsuz döngü olmasın. */
      this._conflictCount += 1;
      this._lastConflictReason = ack.reason;
      this._publisherState = 'CONFLICT';
      this._status = 'CONFLICT';
      this._publishedSignature = identitySignature(obs);
      this._lastSuccessAtMs = this._deps.now();   // sunucu YANITLADI
      this._drainPending();
      return;
    }

    /* Başarı — dedupe otoritesi güncellenir. */
    this._publishedSignature = identitySignature(obs);
    this._publishedCount += 1;
    this._publisherState = 'PUBLISHED';
    this._lastSuccessAtMs = this._deps.now();
    this._lastConflictReason = null;
    if (ack.identityRevision !== null && ack.identityRevision !== undefined) {
      this._identityRevision = ack.identityRevision;
    }
    this._status = this._deriveStatus(obs);
    this._drainPending();
  }

  private _onFailure(obs: VehicleIdentityObservation, generation: number): void {
    this._lastFailureAtMs = this._deps.now();

    if (this._attemptCount >= MAX_PUBLISH_ATTEMPTS) {
      /* Bütçe tükendi — sessizce vazgeçilir. Kimlik `PENDING` KALIR:
         "VERIFIED" DENMEZ (kanıtsız başarı iddiası YASAK). */
      this._publisherState = 'FAILED';
      this._status = 'PENDING';
      this._drainPending();
      return;
    }

    const idx = Math.min(this._attemptCount - 1, PUBLISH_BACKOFF_MS.length - 1);
    const delay = PUBLISH_BACKOFF_MS[idx];
    this._retryCount += 1;
    this._publisherState = 'RETRY_WAIT';
    this._status = 'PENDING';

    this._clearTimer();
    this._timer = this._deps.setTimer(() => {
      this._timer = null;
      if (this._stopped || generation !== this._generation) return;
      /* Bu arada daha yeni gözlem geldiyse ONU yayınla. */
      const target = this._pending ?? obs;
      this._pending = null;
      this._inFlight = true;
      this._publisherState = 'PUBLISHING';
      void this._guardedPublish(target, generation);
    }, delay);
  }

  /** Uçuş sırasında biriken en yeni gözlemi yayınlar. */
  private _drainPending(): void {
    const pending = this._pending;
    this._pending = null;
    if (pending === null || this._stopped) return;
    if (identitySignature(pending) === this._publishedSignature) return;
    this._attemptCount = 0;
    this._schedulePublish(pending);
  }

  private _clearTimer(): void {
    if (this._timer !== null) {
      this._deps.clearTimer(this._timer);
      this._timer = null;
    }
  }
}
