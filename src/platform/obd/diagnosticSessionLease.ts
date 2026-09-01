/**
 * diagnosticSessionLease — P0-VDK-F1B · TANI OTURUMU YAŞAM DÖNGÜSÜ (SAF ÇEKİRDEK).
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (ölçülen legacy borç) ───────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * `ElmProtocol.openExtendedSession()` NRC `SESSION_REQUIRED` geldiğinde
 * ZATEN çağrılıyordu — ama sonucu bir `boolean`'a düşüp **ATILIYORDU**.
 * Sonuç: TS katmanı "bu ECU'da varsayılan dışı oturum açıldı mı" sorusunu
 * **hiç yanıtlayamıyordu**. Bunun üç somut bedeli vardı:
 *
 *  1. **Oturum ömrü görünmezdi.** Uzun bir tam araç taramasında ECU'nun S3
 *     zamanlayıcısı (tipik 5 sn) dolup oturum sessizce düşebilir; sonraki
 *     istek varsayılan oturuma gider ve NRC alır. Ürün bunu "servis yok"
 *     ya da "ECU sustu" sanardı — **yanlış teşhis**.
 *  2. **Oturum maliyeti görünmezdi.** Her istek kendi NRC→oturum→tekrar
 *     turunu ödüyordu (3 komut) ve bu hiçbir yerde ölçülmüyordu.
 *  3. **Keepalive imkânsızdı.** Neyin canlı tutulacağı bilinmiyordu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── KRİTİK KURAL (bu dosyanın varlık sebebi) ──────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * **TesterPresent YALNIZ, gerçekten açıldığı KANITLANMIŞ ve keepalive
 * GEREKTİREN bir oturum için çalışır.** Varsayılan oturuma ya da kanıtsız bir
 * duruma kör `3E` göndermek anlamsız hat trafiğidir, canlı PID akışını
 * geciktirir ve hiçbir şeyi canlı tutmaz. Kilit: `NOT_REQUIRED` durumundaki
 * bir kira **hiçbir koşulda** keepalive üretemez.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ OTURUM OTORİTESİ DEĞİLDİR.** Oturumu bu modül AÇMAZ; native
 *     `openExtendedSession()` açar ve bu modül yalnız onun KANITINI alır.
 * (2) **İKİNCİ RECOVERY OTORİTESİ DEĞİLDİR.** Hiçbir reconnect/recovery
 *     başlatmaz; keepalive düşerse yalnız durumu `DEGRADED`e taşır.
 * (3) **YAZMA KAPISI DEĞİLDİR.** `3E` hiçbir yetki açmaz; bu tur hiçbir
 *     clear/coding/write yolu tanımlamaz.
 * (4) **ZAMANLAYICI SAHİBİ DEĞİLDİR.** Bu dosya SAFTIR: `Date.now` kullanmaz,
 *     `setInterval` kurmaz. Zaman DIŞARIDAN verilir (`nowMs`). Sahiplik
 *     `diagnosticSessionScheduler`dadır.
 *
 * SAF: I/O yok · timer yok · `Date.now` yok · global durum yok · React yok.
 */

import type { EcuEndpoint } from './diagnosticTransaction';

/* ══════════════════════════════════════════════════════════════════════════
   1) SÖZLEŞME
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Oturumun TÜRÜ — hangi komutla açıldığı ÖLÇÜLMÜŞ bilgidir, tahmin değil.
 * `native` alanı `UdsEvidence.sessionCommand`tan gelir.
 */
export type SessionKind =
  /** ISO 14229-1 `10 03` — extended diagnostic session (CAN/UDS). */
  | 'UDS_EXTENDED_1003'
  /** ISO 14230-4 `10 81` — KWP standart tanı oturumu. */
  | 'KWP_STANDARD_1081'
  /** `10 C0` — birçok Renault/PSA KWP ECU'sunun genişletilmiş oturumu. */
  | 'KWP_EXTENDED_10C0'
  /** Varsayılan oturum — açılmış bir şey YOK, canlı tutulacak bir şey de yok. */
  | 'DEFAULT'
  /** Oturum komutu ölçülemedi — UYDURULMAZ. */
  | 'UNKNOWN';

/** Native komut → oturum türü. Tanınmayan komut `UNKNOWN` KALIR. */
export function sessionKindFromCommand(cmd: string | null | undefined): SessionKind {
  switch ((cmd ?? '').replace(/\s+/g, '').toUpperCase()) {
    case '1003': return 'UDS_EXTENDED_1003';
    case '1081': return 'KWP_STANDARD_1081';
    case '10C0': return 'KWP_EXTENDED_10C0';
    case '':     return 'DEFAULT';
    default:     return 'UNKNOWN';
  }
}

export type SessionState =
  /** Canlı tutulacak bir oturum YOK (varsayılan oturum ya da adaptör hallediyor). */
  | 'NOT_REQUIRED'
  /** Oturum açılışı denendi, sonuç henüz yok. */
  | 'OPENING'
  /** Oturum AÇIK ve canlı; keepalive zamanı gelmedi. */
  | 'ACTIVE'
  /** Keepalive zamanı GELDİ — gönderilmeli. */
  | 'KEEPALIVE_DUE'
  /** Keepalive düştü ama oturum kesin ölmedi — fail-closed: okumalar ertelenir. */
  | 'DEGRADED'
  /** Kapanış sürüyor. */
  | 'CLOSING'
  /** Normal kapandı. */
  | 'CLOSED'
  /** Oturum açılamadı ya da kesin öldü. */
  | 'FAILED'
  /** Tanınmayan durum — FAIL-CLOSED terminal. */
  | 'UNKNOWN';

const SESSION_TERMINAL: ReadonlySet<SessionState> =
  new Set<SessionState>(['CLOSED', 'FAILED', 'UNKNOWN']);

export function isSessionTerminal(s: SessionState): boolean { return SESSION_TERMINAL.has(s); }

/**
 * İZİN VERİLEN GEÇİŞLER — beyaz liste. Burada olmayan HER geçiş `UNKNOWN`.
 * `NOT_REQUIRED` terminal DEĞİLDİR ama yalnız kapanabilir: bir kere "gerekmez"
 * denen bir oturum sonradan kendiliğinden "aktif" olamaz (kanıt gerekir).
 */
const SESSION_ALLOWED: Readonly<Record<SessionState, readonly SessionState[]>> = {
  NOT_REQUIRED:  ['CLOSED'],
  OPENING:       ['ACTIVE', 'NOT_REQUIRED', 'FAILED', 'CLOSING'],
  ACTIVE:        ['KEEPALIVE_DUE', 'DEGRADED', 'CLOSING', 'CLOSED', 'FAILED'],
  KEEPALIVE_DUE: ['ACTIVE', 'DEGRADED', 'CLOSING', 'CLOSED', 'FAILED'],
  DEGRADED:      ['ACTIVE', 'CLOSING', 'CLOSED', 'FAILED'],
  CLOSING:       ['CLOSED', 'FAILED'],
  CLOSED:        [],
  FAILED:        [],
  UNKNOWN:       [],
} as const;

export function isSessionTransitionAllowed(from: SessionState, to: SessionState): boolean {
  return (SESSION_ALLOWED[from] ?? []).includes(to);
}

/** Keepalive denemesinin ÖLÇÜLEN sonucu — dördü AYRI kalır. */
export type KeepAliveOutcome =
  /** `7E 00` geldi — oturum canlı, KANITLI. */
  | 'POSITIVE'
  /** ECU sustu. Oturum öldü DEMEK DEĞİL — ölçüm YOK. */
  | 'NO_RESPONSE'
  /** Açık negatif yanıt (NRC) — provenance korunur. */
  | 'NEGATIVE'
  /** Hat/taşıma hatası. */
  | 'TRANSPORT_ERROR';

export const KEEPALIVE_OUTCOME_LABEL: Readonly<Record<KeepAliveOutcome, string>> = {
  POSITIVE:        'oturum canlı (7E 00)',
  NO_RESPONSE:     'ECU sustu — ölçüm yok',
  NEGATIVE:        'negatif yanıt (NRC)',
  TRANSPORT_ERROR: 'hat/taşıma hatası',
} as const;

/**
 * ECU'nun S3 oturum zaman aşımı (ISO 14229-1 varsayılan P3/S3 ≈ 5000 ms).
 * Keepalive aralığı bunun ALTINDA olmalı; güvenlik payıyla %60'ı seçildi.
 */
export const SESSION_S3_TIMEOUT_MS = 5_000;
export const DEFAULT_KEEPALIVE_INTERVAL_MS = 3_000;

/**
 * Üst üste kaç başarısız keepalive'dan sonra `DEGRADED`.
 * `1` DEĞİL: tek bir sessizlik hat gürültüsü olabilir ve oturumu ölü ilan
 * etmek kapsamı gereksiz yere daraltırdı. `2` ölçülmüş bir uzlaşmadır.
 */
export const KEEPALIVE_FAILURES_BEFORE_DEGRADED = 2;

export interface DiagnosticSessionLease {
  readonly leaseId: string;
  /** Kirayı sahiplenen işlem — ömrü ona BAĞLIDIR. */
  readonly transactionId: string;
  readonly ecuEndpoint: EcuEndpoint;
  readonly protocol: string | null;
  sessionKind: SessionKind;
  /**
   * Oturumun GERÇEKTEN açıldığının kanıtı (native `sessionCommand`).
   * `null` → kanıt YOK → keepalive ASLA çalışmaz.
   */
  sessionEstablishedEvidence: string | null;
  /** Keepalive gerekli mi — YALNIZ kanıtlı ve S3'e tabi oturumda `true`. */
  keepAliveRequired: boolean;
  readonly keepAliveIntervalMs: number;
  /** Son keepalive damgası (enjekte edilen saat); hiç gönderilmediyse `null`. */
  lastKeepAliveAt: number | null;
  keepAliveAttempts: number;
  keepAliveSuccesses: number;
  /** Üst üste başarısız keepalive — başarıda sıfırlanır. */
  consecutiveFailures: number;
  state: SessionState;
  /** Kira açıldığında mühürlenen OBD oturumu. */
  readonly sessionEpoch: number;
  /** Oturumun düşmüş SAYILACAĞI an; `null` = keepalive gerekmiyor. */
  expiresAt: number | null;
  /** Zaman aşımının ÖLÇÜLEN kanıtı (TR metin); yoksa `null`. */
  timeoutEvidence: string | null;
  failureReason: string | null;
  /** Geçiş ihlali izi — fail-closed kanıtı. */
  invalidTransitionFrom: SessionState | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) SAF YAŞAM DÖNGÜSÜ
   ══════════════════════════════════════════════════════════════════════════ */

export interface CreateLeaseInput {
  readonly leaseId: string;
  readonly transactionId: string;
  readonly ecuEndpoint: EcuEndpoint;
  readonly protocol: string | null;
  readonly sessionEpoch: number;
  readonly nowMs: number;
  readonly keepAliveIntervalMs?: number;
}

/**
 * Kira açar — HENÜZ oturum yok (`OPENING`).
 *
 * Keepalive burada AÇILMAZ: önce oturumun gerçekten açıldığı KANITLANMALIDIR
 * (`applySessionEvidence`). Bu sıralama, kör `3E` gönderimini yapısal olarak
 * imkânsız kılar.
 */
export function createSessionLease(i: CreateLeaseInput): DiagnosticSessionLease {
  return {
    leaseId: i.leaseId,
    transactionId: i.transactionId,
    ecuEndpoint: i.ecuEndpoint,
    protocol: i.protocol,
    sessionKind: 'UNKNOWN',
    sessionEstablishedEvidence: null,
    keepAliveRequired: false,
    keepAliveIntervalMs: i.keepAliveIntervalMs ?? DEFAULT_KEEPALIVE_INTERVAL_MS,
    lastKeepAliveAt: null,
    keepAliveAttempts: 0,
    keepAliveSuccesses: 0,
    consecutiveFailures: 0,
    state: 'OPENING',
    sessionEpoch: i.sessionEpoch,
    expiresAt: null,
    timeoutEvidence: null,
    failureReason: null,
    invalidTransitionFrom: null,
  };
}

/** Durum geçişi — beyaz listede yoksa `UNKNOWN` (fail-closed). */
export function transitionSession(
  lease: DiagnosticSessionLease, to: SessionState,
): SessionState {
  if (isSessionTransitionAllowed(lease.state, to)) { lease.state = to; return to; }
  lease.invalidTransitionFrom = lease.state;
  lease.state = 'UNKNOWN';
  lease.keepAliveRequired = false;   // UNKNOWN'da keepalive ASLA çalışmaz
  return 'UNKNOWN';
}

/**
 * Native'den gelen oturum kanıtını uygular — **keepalive'ın TEK açılış yolu**.
 *
 * ── KWP KARARI (kanıtlı, kopya değil) ─────────────────────────────────────
 * KWP2000 / ISO 9141 hattında keepalive ürün tarafından GÖNDERİLMEZ ve bu
 * bilinçli bir karardır: `ElmInitSequencer` yavaş seri protokolde adaptöre
 * `ATWM C1 33 F1 3E` (ISO 14230-4 fonksiyonel TesterPresent mesajı) +
 * `ATSW 92` (0x92 × 20 ms ≈ 2,9 sn — KWP2000 P3max 5 sn'nin ALTINDA) set
 * eder. Yani **keepalive'ı ELM327'nin kendi yerleşik wakeup'ı yapar**.
 * Üstüne TS'ten ikinci bir `3E` göndermek çift TesterPresent üretir, hattı
 * meşgul eder ve ikinci bir zamanlama otoritesi kurardı — tam olarak bu
 * mimarinin yasakladığı şey. Bu yüzden KWP oturumları `NOT_REQUIRED`dır.
 *
 * UDS/CAN'de böyle bir yerleşik mekanizma YOKTUR → keepalive gerekir.
 */
export function applySessionEvidence(
  lease: DiagnosticSessionLease,
  evidence: { sessionOpened: boolean; sessionCommand: string | null },
  nowMs: number,
): SessionState {
  if (isSessionTerminal(lease.state)) return lease.state;

  if (!evidence.sessionOpened) {
    /* Oturum AÇILMADI → varsayılan oturumdayız → canlı tutulacak bir şey YOK.
       Kör `3E` göndermek burada anlamsız trafik olurdu. */
    lease.sessionKind = 'DEFAULT';
    lease.sessionEstablishedEvidence = null;
    lease.keepAliveRequired = false;
    lease.expiresAt = null;
    return transitionSession(lease, 'NOT_REQUIRED');
  }

  const kind = sessionKindFromCommand(evidence.sessionCommand);
  lease.sessionKind = kind;
  lease.sessionEstablishedEvidence = evidence.sessionCommand ?? null;

  /* Yalnız UDS extended oturumu keepalive gerektirir (yukarıdaki KWP kararı).
     `UNKNOWN` komutta keepalive AÇILMAZ — tanımadığımız bir oturumu canlı
     tutmaya çalışmak, uydurma davranıştır. */
  if (kind !== 'UDS_EXTENDED_1003') {
    lease.keepAliveRequired = false;
    lease.expiresAt = null;
    return transitionSession(lease, 'NOT_REQUIRED');
  }

  lease.keepAliveRequired = true;
  lease.lastKeepAliveAt = nowMs;          // oturum açılışı zamanlayıcıyı sıfırlar
  lease.expiresAt = nowMs + SESSION_S3_TIMEOUT_MS;
  return transitionSession(lease, 'ACTIVE');
}

/** Oturum açılışı başarısız oldu — keepalive ASLA açılmaz. */
export function failSession(
  lease: DiagnosticSessionLease, reason: string,
): SessionState {
  lease.keepAliveRequired = false;
  lease.expiresAt = null;
  lease.failureReason = reason;
  return transitionSession(lease, 'FAILED');
}

/**
 * Keepalive gönderme ZAMANI GELDİ Mİ (SAF).
 *
 * DÖRT KAPI (hepsi geçilmeli) — hiçbiri atlanamaz:
 *  · kira terminal DEĞİL
 *  · `keepAliveRequired` **true** (yani oturum KANITLANMIŞ)
 *  · `sessionEstablishedEvidence` **dolu** (ikinci kanıt kapısı)
 *  · son keepalive'ın üzerinden aralık kadar geçmiş
 *
 * İkinci ve üçüncü kapı bilinçli olarak ÇİFTTİR: `keepAliveRequired` bir
 * bayraktır ve yanlışlıkla `true` yazılabilir; kanıt alanı ise ancak native
 * ölçümüyle dolar. Kör `3E` göndermenin iki bağımsız engeli olması gerekir.
 */
export function isKeepAliveDue(lease: DiagnosticSessionLease, nowMs: number): boolean {
  if (isSessionTerminal(lease.state)) return false;
  if (lease.state === 'NOT_REQUIRED' || lease.state === 'CLOSING' || lease.state === 'OPENING') return false;
  if (!lease.keepAliveRequired) return false;
  if (lease.sessionEstablishedEvidence === null) return false;
  if (lease.lastKeepAliveAt === null) return true;
  return nowMs - lease.lastKeepAliveAt >= lease.keepAliveIntervalMs;
}

/** Keepalive gönderildi — sonuç henüz yok. */
export function markKeepAliveSent(lease: DiagnosticSessionLease, nowMs: number): void {
  lease.keepAliveAttempts++;
  lease.lastKeepAliveAt = nowMs;
  if (lease.state === 'ACTIVE') transitionSession(lease, 'KEEPALIVE_DUE');
}

/**
 * Keepalive sonucunu uygular.
 *
 * FAIL-CLOSED: başarısızlık oturumu HEMEN öldürmez (`KEEPALIVE_FAILURES_BEFORE_DEGRADED`
 * kez üst üste düşerse `DEGRADED`). `DEGRADED` "ECU arızalı" DEMEK DEĞİLDİR —
 * "bu ECU'nun üretici okumalarına artık güvenemeyiz" demektir ve kapsamda
 * kayıp olarak görünür.
 */
export function applyKeepAliveOutcome(
  lease: DiagnosticSessionLease, outcome: KeepAliveOutcome, nowMs: number,
): SessionState {
  if (isSessionTerminal(lease.state)) return lease.state;

  if (outcome === 'POSITIVE') {
    lease.keepAliveSuccesses++;
    lease.consecutiveFailures = 0;
    lease.lastKeepAliveAt = nowMs;
    lease.expiresAt = nowMs + SESSION_S3_TIMEOUT_MS;
    lease.timeoutEvidence = null;
    return lease.state === 'KEEPALIVE_DUE' || lease.state === 'DEGRADED'
      ? transitionSession(lease, 'ACTIVE')
      : lease.state;
  }

  lease.consecutiveFailures++;
  lease.timeoutEvidence =
    `keepalive ${KEEPALIVE_OUTCOME_LABEL[outcome]} (üst üste ${lease.consecutiveFailures})`;

  if (lease.consecutiveFailures >= KEEPALIVE_FAILURES_BEFORE_DEGRADED) {
    lease.failureReason = lease.timeoutEvidence;
    return transitionSession(lease, 'DEGRADED');
  }
  /* Tek başarısızlık: henüz DEGRADED değil ama ACTIVE'e de dönmez —
     `KEEPALIVE_DUE` kalır ki bir sonraki tur tekrar denesin. */
  return lease.state;
}

/**
 * Oturumun S3 penceresi doldu mu (SAF).
 * `expiresAt` yoksa `false` — ölçülmemiş bir şey "doldu" SAYILMAZ.
 */
export function isSessionExpired(lease: DiagnosticSessionLease, nowMs: number): boolean {
  if (lease.expiresAt === null) return false;
  return nowMs >= lease.expiresAt;
}

/** Kirayı kapatır (normal son). Terminal kirayı DEĞİŞTİRMEZ. */
export function closeSessionLease(lease: DiagnosticSessionLease, reason: string): SessionState {
  if (isSessionTerminal(lease.state)) return lease.state;
  lease.keepAliveRequired = false;   // keepalive KESİN durur
  lease.expiresAt = null;
  lease.failureReason = lease.failureReason ?? reason;
  if (lease.state !== 'NOT_REQUIRED') transitionSession(lease, 'CLOSING');
  return transitionSession(lease, 'CLOSED');
}

/**
 * Oturum mührü hâlâ geçerli mi.
 * Epoch ölçülemediyse (`-1`) karşılaştırma YAPILMAZ — sahte "bayat" hükmü YASAK.
 */
export function isLeaseEpochValid(
  lease: DiagnosticSessionLease, currentEpoch: number | null,
): boolean {
  if (currentEpoch === null) return true;
  if (lease.sessionEpoch === -1) return true;
  return lease.sessionEpoch === currentEpoch;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) ÜRÜN KARARI — oturum kaybı okumayı nasıl etkiler
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * Bu kirada üretici tanı okuması YAPILABİLİR Mİ.
 *
 * ⚠️ ÖNEMLİ ÜRÜN KURALI: keepalive başarısızlığı **tek başına** "ECU arızalı"
 * ya da "DTC yok" sonucu ÜRETMEZ. Yalnız okumayı fail-closed ERTELER; kapsam
 * bunu "temiz" saymaz (`deferred` sonucu kapsam kaybıdır).
 */
export function canReadUnderLease(lease: DiagnosticSessionLease): boolean {
  switch (lease.state) {
    /* Oturum gerekmiyor ya da canlı → oku. */
    case 'NOT_REQUIRED':
    case 'ACTIVE':
    case 'KEEPALIVE_DUE':
    case 'OPENING':
      return true;
    /* Oturum kaybı şüphesi/kesinliği → ERTELE (fail-closed). */
    case 'DEGRADED':
    case 'CLOSING':
    case 'CLOSED':
    case 'FAILED':
    case 'UNKNOWN':
      return false;
  }
}

/** Erteleme gerekçesi — kanıt defterine ve kapsam raporuna taşınır. */
export function leaseDenialReason(lease: DiagnosticSessionLease): string {
  return lease.failureReason
    ?? lease.timeoutEvidence
    ?? `tanı oturumu durumu: ${lease.state}`;
}
