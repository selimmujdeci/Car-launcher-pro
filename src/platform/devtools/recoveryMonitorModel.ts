/**
 * recoveryMonitorModel — CAROS LAB · Kurtarma İzleyici SAF modeli.
 *
 * SAFLIK SÖZLEŞMESİ (repo A3–A8 deseni): I/O YOK · timer YOK · `Date.now()` YOK ·
 * global durum YOK · React importu YOK. Zaman gereken her yerde `nowMs` PARAMETRE
 * olarak gelir. Bu dosya servis IMPORT ETMEZ; girdisi YAPISALDIR (mock'suz test).
 *
 * ── BU EKRANIN CEVAPLADIĞI SORU ─────────────────────────────────────────────
 * "ECU sustu, kurtarma neden tırmanmıyor?" Merdivenin sekiz kapısı sahada
 * `console.info` dışında hiçbir yere yazmıyordu; cihazda logcat'siz teşhis
 * imkânsızdı. Model kapıları KOD SIRASIYLA değerlendirir ve İLK ENGELLEYENİ
 * adıyla söyler — "çalışmıyor" ile "bu protokolde zaten devre dışı"yı ayırır.
 *
 * ── DÜRÜSTLÜK KURALLARI ─────────────────────────────────────────────────────
 *  · Kapı kanıtsız geçtiyse `PASS` DEĞİL `PASS_UNPROVEN` (kontak kapısı, voltaj
 *    bilinmiyorken kurtarmayı ENGELLEMEZ ama bu "motor çalışıyor" DEMEK DEĞİLDİR).
 *  · `lastRecoveryAtMs === 0` "0 ms önce" değil "HİÇ" demektir.
 *  · Saat geriye sıçradıysa cooldown kalanı UYDURULMAZ (`null`).
 *  · Kaynak okunamadıysa `UNAVAILABLE`; "hiç denenmedi" ile KARIŞTIRILMAZ.
 */

import {
  observed, derived, unavailable, formatAge,
  type InspectorField,
} from './sessionInspectorModel';

/* ── Kurtarma otoritesi ──────────────────────────────────────────────────── */

/**
 * Aktif protokolde kurtarmanın SAHİBİ kim.
 *
 * İki motorun aynı anda çalışması BİLİNÇLİ olarak yasaktır (çift ATPC oturumu
 * sürekli kapatır) — bu yüzden "diğer motor sessiz" bir arıza DEĞİL, tasarımdır.
 */
export type RecoveryAuthority =
  /** CAN (ATSP 6/7/8/9/A/B/C) → TS merdiveni sahibi. */
  | 'CAN_LADDER'
  /** KWP2000 / ISO9141 → native ATPC sahibi; TS merdiveni BİLEREK susar. */
  | 'KWP_NATIVE'
  /** Protokol bilinmiyor → fail-closed: hiçbir motor tırmanmaz. */
  | 'UNKNOWN_PROTOCOL';

export const RECOVERY_AUTHORITY_LABEL: Readonly<Record<RecoveryAuthority, string>> = {
  CAN_LADDER:      'CAN MERDİVENİ (TS)',
  KWP_NATIVE:      'NATIVE ATPC (KWP/ISO9141)',
  UNKNOWN_PROTOCOL:'BELİRSİZ — KURTARMA YOK',
} as const;

/** Yavaş seri protokol ön ekleri — native ATPC'nin alanı. */
const SLOW_SERIAL_PREFIX = ['3', '4', '5'];

/**
 * Protokolden otoriteyi çözer. `canApplicable` KAYNAKTAN gelir (politika
 * fonksiyonunun kendi cevabı) — burada yeniden uygulanmaz, yalnız yorumlanır.
 */
export function resolveRecoveryAuthority(input: {
  readonly protocolActive: string | null;
  readonly canApplicable: boolean;
}): RecoveryAuthority {
  if (input.canApplicable) return 'CAN_LADDER';
  const p = (input.protocolActive ?? '').trim().toUpperCase().charAt(0);
  if (p !== '' && SLOW_SERIAL_PREFIX.includes(p)) return 'KWP_NATIVE';
  return 'UNKNOWN_PROTOCOL';
}

/* ── Kapılar ─────────────────────────────────────────────────────────────── */

/**
 * Kapı kimlikleri — `_maybeRunEcuRecovery` içindeki KONTROL SIRASIYLA aynı.
 * Sıra önemlidir: ekran "ilk engelleyen"i gösterir, sonraki kapılar o noktada
 * HENÜZ DEĞERLENDİRİLMEMİŞ sayılır (kodda da öyle — erken `return`).
 */
export type RecoveryGateId =
  | 'inflight' | 'exhausted' | 'transport' | 'ecu-silent'
  | 'streak' | 'native-authority' | 'can-protocol' | 'ignition'
  | 'cooldown' | 'ceiling';

export const RECOVERY_GATE_ORDER: readonly RecoveryGateId[] = [
  'inflight', 'exhausted', 'transport', 'ecu-silent',
  'streak', 'native-authority', 'can-protocol', 'ignition',
  'cooldown', 'ceiling',
] as const;

export const RECOVERY_GATE_LABEL: Readonly<Record<RecoveryGateId, string>> = {
  'inflight':         'Kurtarma uçuşta değil',
  'exhausted':        'Tavan dolmadı',
  'transport':        'Taşıma canlı (link var)',
  'ecu-silent':       'ECU susmuş (veri bayat)',
  'streak':           'Ardışık sessizlik eşiği',
  'native-authority': 'Native reconnect devrede değil',
  'can-protocol':     'Protokol CAN',
  'ignition':         'Motor çalışıyor (kontak)',
  'cooldown':         'Cooldown doldu',
  'ceiling':          'Sıradaki basamak var',
} as const;

export type RecoveryGateState =
  /** Kapı geçildi ve kanıtı var. */
  | 'PASS'
  /**
   * Kapı geçildi ama KANIT YOK — kurtarma engellenmiyor, fakat bu bir olumlama
   * DEĞİL. (Saha 2026-07-19 / iCar3: ATRV vermeyen kurulumda voltaj bilinmez;
   * `isEngineLikelyRunning` bilerek `true` döner ki donmuş oturum kalıcı kalmasın.)
   */
  | 'PASS_UNPROVEN'
  /** Kapı merdiveni DURDURUYOR. */
  | 'BLOCKED'
  /** Bu kapıya SIRA GELMEDİ — önceki bir kapı zaten durdurdu (kodda erken return). */
  | 'NOT_REACHED'
  /** Girdi okunamadı. */
  | 'UNKNOWN';

export const RECOVERY_GATE_STATE_LABEL: Readonly<Record<RecoveryGateState, string>> = {
  PASS:          'GEÇTİ',
  PASS_UNPROVEN: 'GEÇTİ (KANITSIZ)',
  BLOCKED:       'DURDURUYOR',
  NOT_REACHED:   'SIRA GELMEDİ',
  UNKNOWN:       'BİLİNMİYOR',
} as const;

export interface RecoveryGate {
  readonly id: RecoveryGateId;
  readonly label: string;
  readonly state: RecoveryGateState;
  /** Kapının baktığı ÖLÇÜLEN değer — boş bırakılmaz. */
  readonly evidence: string;
}

/** Kapı değerlendirmesi için gereken ham gözlem (servisten birebir). */
export interface RecoveryGateInput {
  readonly inFlight: boolean;
  readonly exhausted: boolean;
  readonly transportConnected: boolean;
  readonly dataFresh: boolean;
  readonly ecuSilentStreak: number;
  readonly streakThreshold: number;
  readonly nativeReconnectInFlight: boolean;
  readonly protocolActive: string | null;
  readonly canApplicable: boolean;
  readonly voltageKnown: boolean;
  readonly engineLikelyRunning: boolean;
  readonly batteryVoltage: number | null;
  readonly engineVoltageThresholdV: number;
  readonly lastRecoveryAtMs: number;
  readonly cooldownMs: number;
  readonly nextLevelPresent: boolean;
}

/**
 * Cooldown'ın KALAN süresi (ms). `null` = hesaplanamaz.
 *
 * `lastRecoveryAtMs === 0` → hiç deneme yok, cooldown de yok (kodda `if` bile
 * çalışmaz). `nowMs < lastRecoveryAtMs` → saat geriye sıçramış; kalan süre
 * UYDURULMAZ (CLAUDE.md §Clock Jump Protection).
 */
export function cooldownRemainingMs(input: {
  readonly lastRecoveryAtMs: number;
  readonly cooldownMs: number;
  readonly nowMs: number;
}): number | null {
  if (!(input.lastRecoveryAtMs > 0)) return null;
  const elapsed = input.nowMs - input.lastRecoveryAtMs;
  if (elapsed < 0) return null;              // saat sıçraması → hüküm YOK
  const left = input.cooldownMs - elapsed;
  return left > 0 ? left : 0;
}

function _gate(
  id: RecoveryGateId, state: RecoveryGateState, evidence: string,
): RecoveryGate {
  return { id, label: RECOVERY_GATE_LABEL[id], state, evidence };
}

/**
 * Sekiz+iki kapıyı KOD SIRASIYLA değerlendirir.
 *
 * İlk `BLOCKED` kapıdan sonrası `NOT_REACHED`'tir — çünkü `_maybeRunEcuRecovery`
 * orada `return` eder ve sonraki koşulları HİÇ hesaplamaz. Bunları "geçti" diye
 * göstermek, olmayan bir değerlendirmeyi olmuş gibi sunmak olurdu.
 */
export function evaluateRecoveryGates(
  input: RecoveryGateInput | null, nowMs: number,
): readonly RecoveryGate[] {
  if (input === null) {
    return RECOVERY_GATE_ORDER.map((id) =>
      _gate(id, 'UNKNOWN', 'Merdiven okunamadı.'));
  }

  const out: RecoveryGate[] = [];
  let blocked = false;

  const push = (
    id: RecoveryGateId, state: RecoveryGateState, evidence: string,
  ): void => {
    if (blocked) { out.push(_gate(id, 'NOT_REACHED', evidence)); return; }
    out.push(_gate(id, state, evidence));
    if (state === 'BLOCKED') blocked = true;
  };

  push('inflight', input.inFlight ? 'BLOCKED' : 'PASS',
    input.inFlight ? 'Bir kurtarma turu HÂLÂ uçuşta.' : 'Uçuşta tur yok.');

  push('exhausted', input.exhausted ? 'BLOCKED' : 'PASS',
    input.exhausted
      ? 'Tavan doldu — veri kendiliğinden dönene dek yeni deneme YOK.'
      : 'Tavan dolmadı.');

  push('transport', input.transportConnected ? 'PASS' : 'BLOCKED',
    input.transportConnected
      ? 'Taşıma bağlı — bu bir ECU susması.'
      : 'Taşıma KOPUK → bu bir kurtarma değil, KOPMA vakası (reconnect zinciri işler).');

  push('ecu-silent', input.dataFresh ? 'BLOCKED' : 'PASS',
    input.dataFresh
      ? 'Veri TAZE — kurtarılacak bir şey yok (sağlıklı durum).'
      : 'Veri bayat — ECU susmuş.');

  push('streak',
    input.ecuSilentStreak >= input.streakThreshold ? 'PASS' : 'BLOCKED',
    `Ardışık sessizlik ${input.ecuSilentStreak}/${input.streakThreshold}` +
    (input.ecuSilentStreak >= input.streakThreshold
      ? ' — eşik karşılandı.'
      : ' — TEK stale olayı merdiveni başlatmaz.'));

  push('native-authority', input.nativeReconnectInFlight ? 'BLOCKED' : 'PASS',
    input.nativeReconnectInFlight
      ? 'Native reconnect uçuşta — otorite NATIVE\'de, TS karışmaz (çift motor yasağı).'
      : 'Native reconnect uçuşta değil.');

  push('can-protocol', input.canApplicable ? 'PASS' : 'BLOCKED',
    input.canApplicable
      ? `Protokol ${input.protocolActive ?? '?'} → CAN merdiveni uygulanabilir.`
      : input.protocolActive === null
        ? 'Protokol BİLİNMİYOR → fail-closed, merdiven tırmanmaz.'
        : `Protokol ${input.protocolActive} CAN değil → kurtarma NATIVE ATPC'de (çift ATPC yasağı).`);

  push('ignition',
    input.engineLikelyRunning
      ? (input.voltageKnown ? 'PASS' : 'PASS_UNPROVEN')
      : 'BLOCKED',
    input.voltageKnown
      ? `ATRV ${input.batteryVoltage?.toFixed(1) ?? '?'} V / eşik ${input.engineVoltageThresholdV.toFixed(1)} V` +
        (input.engineLikelyRunning
          ? ' — motor çalışıyor.'
          : ' — motor KAPALI: ECU susması BEKLENİR, kurtarma yapılmaz.')
      : 'ATRV okunamadı — motor durumu KANITLANAMADI; kurtarma yine de engellenmez (donmuş oturum kalıcı kalmasın).');

  const remaining = cooldownRemainingMs({
    lastRecoveryAtMs: input.lastRecoveryAtMs,
    cooldownMs: input.cooldownMs,
    nowMs,
  });
  push('cooldown',
    remaining === null ? 'PASS' : (remaining > 0 ? 'BLOCKED' : 'PASS'),
    input.lastRecoveryAtMs > 0
      ? (remaining === null
          ? 'Saat geriye sıçradı — kalan süre hesaplanamaz.'
          : `Kalan ${Math.round(remaining / 1000)} sn / cooldown ${Math.round(input.cooldownMs / 1000)} sn`)
      : 'Bu oturumda hiç deneme yok — cooldown işlemiyor.');

  push('ceiling', input.nextLevelPresent ? 'PASS' : 'BLOCKED',
    input.nextLevelPresent
      ? 'Sıradaki basamak mevcut.'
      : 'Sıradaki basamak YOK — tavan (bu tur "tükendi" olarak işaretlenir).');

  return out;
}

/** Merdiveni ilk DURDURAN kapı; hiçbiri durdurmuyorsa `null`. */
export function firstBlockingGate(
  gates: readonly RecoveryGate[],
): RecoveryGate | null {
  for (const g of gates) if (g.state === 'BLOCKED') return g;
  return null;
}

/* ── Genel hüküm ─────────────────────────────────────────────────────────── */

export type RecoveryVerdict =
  /** Merdiven şu an tırmanıyor. */
  | 'CLIMBING'
  /** Tüm kapılar açık — sıradaki watchdog turunda tırmanır. */
  | 'READY'
  /** Veri taze; kurtarılacak bir şey YOK (bu iyi haber). */
  | 'HEALTHY'
  /** Bu protokolde CAN merdiveni BİLEREK devre dışı — otorite native ATPC. */
  | 'NOT_APPLICABLE'
  /** Tavan doldu — veri dönene dek yeni deneme yok. */
  | 'EXHAUSTED'
  /** Bir kapı durduruyor (hangisi `firstBlockingGate` ile söylenir). */
  | 'BLOCKED'
  /** Merdiven okunamadı. */
  | 'UNAVAILABLE';

export const RECOVERY_VERDICT_LABEL: Readonly<Record<RecoveryVerdict, string>> = {
  CLIMBING:       'TIRMANIYOR',
  READY:          'HAZIR — sıradaki turda tırmanır',
  HEALTHY:        'GEREK YOK — veri taze',
  NOT_APPLICABLE: 'BU PROTOKOLDE DEVRE DIŞI (tasarım)',
  EXHAUSTED:      'TAVAN DOLDU',
  BLOCKED:        'DURDURULDU',
  UNAVAILABLE:    'OKUNAMADI',
} as const;

/** Hüküm tonu — model renk BİLMEZ, ekran OEM token'ına çevirir. */
export type RecoveryTone = 'ok' | 'muted' | 'warn' | 'bad';

export function recoveryVerdictTone(v: RecoveryVerdict): RecoveryTone {
  switch (v) {
    case 'HEALTHY':        return 'ok';
    case 'READY':          return 'ok';
    case 'CLIMBING':       return 'warn';
    case 'NOT_APPLICABLE': return 'muted';
    case 'UNAVAILABLE':    return 'muted';
    case 'EXHAUSTED':      return 'bad';
    case 'BLOCKED':        return 'warn';
  }
}

export function gateStateTone(s: RecoveryGateState): RecoveryTone {
  switch (s) {
    case 'PASS':          return 'ok';
    case 'PASS_UNPROVEN': return 'warn';
    case 'BLOCKED':       return 'bad';
    case 'NOT_REACHED':   return 'muted';
    case 'UNKNOWN':       return 'muted';
  }
}

/**
 * Genel hüküm. SIRA ÖNEMLİDİR: "okunamadı" > "devre dışı" > "tırmanıyor" >
 * "tavan" > "sağlıklı" > "engelli" > "hazır".
 *
 * `HEALTHY` (veri taze) `BLOCKED`'tan ÖNCE gelir çünkü `ecu-silent` kapısının
 * durdurması bir ARIZA değil, sistemin doğru çalıştığının kanıtıdır — kırmızı
 * göstermek yanlış alarm olurdu.
 */
export function deriveRecoveryVerdict(input: {
  readonly gates: readonly RecoveryGate[];
  readonly authority: RecoveryAuthority;
  readonly inFlight: boolean;
  readonly exhausted: boolean;
  readonly dataFresh: boolean;
  readonly available: boolean;
}): RecoveryVerdict {
  if (!input.available) return 'UNAVAILABLE';
  if (input.authority !== 'CAN_LADDER') return 'NOT_APPLICABLE';
  if (input.inFlight) return 'CLIMBING';
  if (input.exhausted) return 'EXHAUSTED';
  if (input.dataFresh) return 'HEALTHY';
  return firstBlockingGate(input.gates) !== null ? 'BLOCKED' : 'READY';
}

/* ── Alan kartları (sessionInspector sözleşmesi) ─────────────────────────── */

const SRC_LADDER   = 'obdService.getEcuRecoveryLadder';
const SRC_KWP      = 'obd/kwpRecoveryEvidence.getKwpRecoveryEvidence';
const SRC_RECONN   = 'obdService.getObdReconnectLifecycle';
const SRC_LEDGER   = 'obdService.getLinkLossLedger';

/** Girdi tipi YAPISALDIR — servis importu YOK (mock'suz test edilir). */
export interface RecoveryFieldsInput {
  readonly ladder: (RecoveryGateInput & {
    readonly attemptsUsed: number;
    readonly maxAttempts: number;
    readonly nextLevel: string | null;
    readonly lastLevel: string | null;
  }) | null;
  readonly kwp: {
    readonly status: string;
    readonly recoveryCount: number;
    readonly consecutiveFailedRecoveries: number | null;
    readonly suppressedCount: number;
    readonly atpcSendFailures: number;
    readonly maxCoreNoDataStreak: number;
    readonly lastRecoveryToFirstPidMs: number;
    readonly refreshedAt: number;
  } | null;
  readonly reconnect: {
    readonly consecutiveRetryStreak: number;
    readonly lifetimeRequested: number;
    readonly sessionEventCount: number;
    readonly sessionTimeoutCount: number;
    readonly lastReason: string | null;
    readonly lastReconnectAt: number;
    readonly lastOutcome: string;
    /* ── P0-OBD-CORE-06 · connect otoritesi (tek-uçuş kapısının kanıtı) ────── */
    readonly connectInFlight: boolean;
    readonly connectAttemptsStarted: number;
    readonly connectBusyRejections: number;
    readonly connectPreemptions: number;
    readonly reconnectYieldedToRecovery: number;
    readonly lastNativeFailureClass: string | null;
    /* ── P0-OBD-FINAL-01 · NATIVE RECONNECT OTORİTESİ ─────────────────────── */
    readonly nativeReconnectEpoch: number | null;
    readonly nativeReconnectInFlight: boolean;
    readonly nativeReconnectRounds: number;
    readonly nativeReconnectRecovered: number;
    readonly nativeReconnectFailed: number;
    readonly nativeReconnectGuardTimeouts: number;
    readonly nativeReconnectLastOutcome: string | null;
    readonly nativeReconnectLastDurationMs: number | null;
  } | null;
  readonly linkLoss: {
    readonly total: number;
    readonly pendingRecoveryCount: number;
    readonly supersededCount: number;
    readonly medianRecoveryMs: number | null;
    readonly maxRecoveryMs: number | null;
  } | null;
  readonly nowMs: number;
}

/** CAN merdiveninin sayısal durumu. */
export function buildLadderFields(input: RecoveryFieldsInput): readonly InspectorField[] {
  const l = input.ladder;
  if (l === null) {
    return [unavailable({
      id: 'ladder', label: 'CAN merdiveni', source: SRC_LADDER,
      note: 'Okuma hata verdi — "hiç denenmedi" ile KARIŞTIRILMAZ.',
    })];
  }
  return [
    observed({
      id: 'ladder-attempts', label: 'Kullanılan deneme', source: SRC_LADDER,
      note: 'Bounded: tavana ulaşınca merdiven DURUR (sonsuz döngü koruması).',
    }, `${l.attemptsUsed}/${l.maxAttempts}`),
    observed({
      id: 'ladder-streak', label: 'Ardışık ECU sessizliği', source: SRC_LADDER,
      note: 'Tetik için eşik şarttır; tek stale olayı merdiveni başlatmaz.',
    }, `${l.ecuSilentStreak}/${l.streakThreshold}`),
    l.nextLevel === null
      ? unavailable({
          id: 'ladder-next', label: 'Sıradaki basamak', source: SRC_LADDER,
          note: '',
        }, 'Tavan doldu — sıradaki basamak YOK.')
      : observed({
          id: 'ladder-next', label: 'Sıradaki basamak', source: SRC_LADDER,
          note: 'Merdiven en hafiften ağıra: protocol_close → elm_reinit → transport_reconnect.',
        }, l.nextLevel),
    l.lastLevel === null
      ? unavailable({
          id: 'ladder-last', label: 'Son tırmanılan basamak', source: SRC_LADDER,
          note: '',
        }, 'Bu oturumda hiç tırmanılmadı.')
      : observed({
          id: 'ladder-last', label: 'Son tırmanılan basamak', source: SRC_LADDER,
          note: 'Bu oturumda gerçekten çalıştırılan en son basamak.',
        }, l.lastLevel),
    l.lastRecoveryAtMs > 0
      ? derived({
          id: 'ladder-last-at', label: 'Son deneme yaşı', source: SRC_LADDER,
          note: 'Damgadan türetildi; damga yoksa yaş HESAPLANMAZ.',
          updatedAt: l.lastRecoveryAtMs,
        }, formatAge(l.lastRecoveryAtMs, input.nowMs))
      : unavailable({
          id: 'ladder-last-at', label: 'Son deneme yaşı', source: SRC_LADDER,
          note: '',
        }, 'Hiç deneme yok — "0 ms önce" DEĞİL.'),
  ];
}

/** KWP native ATPC kanıtı — bayatlık DAİMA gösterilir (#642). */
export function buildKwpFields(input: RecoveryFieldsInput): readonly InspectorField[] {
  const k = input.kwp;
  if (k === null) {
    return [unavailable({
      id: 'kwp', label: 'Native ATPC kanıtı', source: SRC_KWP,
      note: '',
    }, 'Native kanıt önbelleği BOŞ. Bu ekran salt-okunur olduğu için tazeleme TETİKLEMEZ — üstteki TÜMÜNÜ YENİLE (kwp-recovery bölümü) doldurur.')];
  }
  return [
    observed({
      id: 'kwp-status', label: 'Kurtarma durumu', source: SRC_KWP,
      note: 'Native ElmProtocol.noteKwpSessionHealth akışının son durumu.',
      updatedAt: k.refreshedAt,
    }, k.status),
    observed({
      id: 'kwp-count', label: 'ATPC gönderimi', source: SRC_KWP,
      note: 'Oturum boyunca kaç kez kurtarma tetiklendi.',
      updatedAt: k.refreshedAt,
    }, k.recoveryCount),
    k.consecutiveFailedRecoveries === null
      ? unavailable({
          id: 'kwp-consec', label: 'Ardışık başarısız kurtarma', source: SRC_KWP,
          note: '',
        }, 'Eski APK bu alanı vermiyor → "tavanda mıyız" BİLİNMİYOR. recoveryCount\'tan TÜRETİLMEZ (#642: türetince yalan çıktı).')
      : observed({
          id: 'kwp-consec', label: 'Ardışık başarısız kurtarma', source: SRC_KWP,
          note: 'Native tavan kararının baktığı TEK sayaç.',
          updatedAt: k.refreshedAt,
        }, k.consecutiveFailedRecoveries),
    observed({
      id: 'kwp-suppressed', label: 'Tavan nedeniyle bastırıldı', source: SRC_KWP,
      note: 'Tavan dolduğu için ATPC\'nin GÖNDERİLMEDİĞİ kez.',
      updatedAt: k.refreshedAt,
    }, k.suppressedCount),
    observed({
      id: 'kwp-sendfail', label: 'ATPC gönderim hatası', source: SRC_KWP,
      note: 'Denendi ama kanal hatasına düştü (gitmedi).',
      updatedAt: k.refreshedAt,
    }, k.atpcSendFailures),
    k.lastRecoveryToFirstPidMs >= 0
      ? observed({
          id: 'kwp-ttfp', label: 'ATPC→ilk geçerli PID', source: SRC_KWP,
          note: 'Son BAŞARILI kurtarmanın gerçek süresi.',
          updatedAt: k.refreshedAt,
        }, `${k.lastRecoveryToFirstPidMs} ms`)
      : unavailable({
          id: 'kwp-ttfp', label: 'ATPC→ilk geçerli PID', source: SRC_KWP,
          note: '',
        }, 'Ölçülmedi (-1) — sahte 0 YAZILMAZ.'),
    derived({
      id: 'kwp-age', label: 'Kanıt yaşı', source: SRC_KWP,
      note: 'BAYAT kanıt taze gibi sunulamaz (#642 saha dersi).',
      updatedAt: k.refreshedAt,
    }, formatAge(k.refreshedAt, input.nowMs)),
  ];
}

/** Merdivenin SON basamağının sonucunu okuyan kanonik reconnect kaydı. */
export function buildReconnectFields(input: RecoveryFieldsInput): readonly InspectorField[] {
  const r = input.reconnect;
  if (r === null) {
    return [unavailable({
      id: 'reconnect', label: 'Reconnect yaşam döngüsü', source: SRC_RECONN,
      note: '',
    }, 'Okunamadı.')];
  }
  return [
    observed({
      id: 'rc-outcome', label: 'Son reconnect sonucu', source: SRC_RECONN,
      note: '"Kopma yaşandı ama toparlandı" ile "hâlâ kopuk" ayrımının TEK kaynağı.',
    }, r.lastOutcome),
    observed({
      id: 'rc-streak', label: 'Anlık backoff serisi', source: SRC_RECONN,
      note: 'Başarılı bağlantıda 0\'a döner.',
    }, r.consecutiveRetryStreak),
    observed({
      id: 'rc-lifetime', label: 'Oturum ömrü talep', source: SRC_RECONN,
      note: 'Doyumlu sayaç — oturum boyunca reconnect TALEP edildi.',
    }, r.lifetimeRequested),
    observed({
      id: 'rc-events', label: 'Oturum olayı / timeout', source: SRC_RECONN,
      note: 'Bounded geçmişten (son 8) sayılır.',
    }, `${r.sessionEventCount} / ${r.sessionTimeoutCount}`),
    r.lastReason === null
      ? unavailable({
          id: 'rc-reason', label: 'Son reconnect nedeni', source: SRC_RECONN,
          note: '',
        }, 'Bu oturumda reconnect talebi yok.')
      : observed({
          id: 'rc-reason', label: 'Son reconnect nedeni', source: SRC_RECONN,
          note: 'Enum — PII taşımaz.',
          updatedAt: r.lastReconnectAt > 0 ? r.lastReconnectAt : null,
        }, r.lastReason),

    /* ── P0-OBD-CORE-06 · CONNECT OTORİTESİ ───────────────────────────
     * Sahada "17 başarısız deneme" sayılıyordu ama bu denemelerin kaçının
     * BİZDEN (çift otorite) kaçının ARAÇTAN geldiği ÖLÇÜLEMİYORDU. Bu üç
     * satır ayırımı kanıtlar: başlatılan · kapıda reddedilen · öne geçirilen. */
    observed({
      id: 'rc-connect-authority', label: 'Connect otoritesi (başlatılan / kapıda / preempt)',
      source: SRC_RECONN,
      note: 'Tek-uçuş kapısı. "Kapıda" > 0 → ikinci bir otorite denedi ve '
          + 'ÖNLENDİ (eskiden bu istek gerçek bir soket açıp birincisini düşürüyordu).',
    }, `${r.connectAttemptsStarted} / ${r.connectBusyRejections} / ${r.connectPreemptions}`),
    observed({
      id: 'rc-connect-inflight', label: 'Connect uçuşta', source: SRC_RECONN,
      note: 'Uçuşta deneme varken foreground-resume, merdiven ve derin döngü '
          + 'yeni deneme BAŞLATMAZ.',
    }, r.connectInFlight ? 'EVET' : 'HAYIR'),
    observed({
      id: 'rc-recovery-yield', label: 'Kurtarmaya ertelenen tetik', source: SRC_RECONN,
      note: 'Transport reconnect ile ECU oturum kurtarması artık çakışmaz; tetik '
          + 'iptal EDİLMEZ, kısa süre geri çekilir.',
    }, r.reconnectYieldedToRecovery),
    /* ══════════════════════════════════════════════════════════════════
       P0-OBD-FINAL-01 · ÖNCELİK 1 — NATIVE RECONNECT OTORİTESİ.
       ══════════════════════════════════════════════════════════════════
       Sahadaki "aynı oturumda tekrar tekrar 60 s timeout" iddiası bu dört
       satırla DOĞRULANIR ya da ÇÜRÜTÜLÜR. Kritik alan `guardTimeouts`:
       fail-safe zamanlayıcısı ARTIK normal yol DEĞİLDİR; ateşlenmesi
       terminal olayın yine kaybolduğunu gösterir. */
    observed({
      id: 'rc-native-rounds', label: 'Native reconnect (tur / başarı / başarısız)',
      source: SRC_RECONN,
      note: 'Native turun SONU artık açık bir olaydır; başarısızlık da bildirilir '
          + '(eskiden yutuluyordu → otorite 60 s askıda kalıyordu).',
    }, `${r.nativeReconnectRounds} / ${r.nativeReconnectRecovered} / ${r.nativeReconnectFailed}`),
    r.nativeReconnectGuardTimeouts > 0
      ? derived({
          id: 'rc-native-guard', label: 'FAIL-SAFE zamanlayıcı ateşlemesi', source: SRC_RECONN,
          note: 'KUSUR SINYALI: native turun sonucu TS tarafina HIC ulasmadi ve otorite '
              + '60 s askıda kaldı. Saha kabul ölçütü bu değerin 0 olmasıdır.',
        }, r.nativeReconnectGuardTimeouts)
      : observed({
          id: 'rc-native-guard', label: 'FAIL-SAFE zamanlayıcı ateşlemesi', source: SRC_RECONN,
          note: 'Beklenen değer 0 — her tur açık bir sonuçla kapandı.',
        }, 0),
    r.nativeReconnectEpoch === null
      ? unavailable({
          id: 'rc-native-epoch', label: 'Native tur kimliği', source: SRC_RECONN,
          note: '',
        }, 'Köprü tur kimliği taşımıyor (eski APK) — eşleştirme SIRAYA düşer.')
      : observed({
          id: 'rc-native-epoch', label: 'Native tur kimliği', source: SRC_RECONN,
          note: '"reconnecting" ile sonucu eşleştiren tek güvenilir anahtar '
              + '(LIFO eşleştirme artefaktı #596).',
        }, r.nativeReconnectEpoch),
    r.nativeReconnectLastOutcome === null
      ? unavailable({
          id: 'rc-native-last', label: 'Son native tur sonucu', source: SRC_RECONN,
          note: '',
        }, 'Bu oturumda native reconnect turu açılmadı.')
      : observed({
          id: 'rc-native-last', label: 'Son native tur sonucu', source: SRC_RECONN,
          note: 'Otorite su an ' + (r.nativeReconnectInFlight ? 'NATIVE tarafinda.' : 'TS tarafinda.'),
        }, r.nativeReconnectLastDurationMs === null
            ? r.nativeReconnectLastOutcome
            : `${r.nativeReconnectLastOutcome} (${r.nativeReconnectLastDurationMs} ms)`),

    r.lastNativeFailureClass === null
      ? unavailable({
          id: 'rc-native-failclass', label: 'Native hata sınıfı', source: SRC_RECONN,
          note: '',
        }, 'Bu oturumda native bir bağlantı hatası bildirilmedi.')
      : observed({
          id: 'rc-native-failclass', label: 'Native hata sınıfı', source: SRC_RECONN,
          note: "İstisnanın SINIFINDAN türetilir — hata MESAJINDAN değil. "
              + "Mesaj null geldiğinde eskiden neden UNKNOWN'a düşüyordu.",
        }, r.lastNativeFailureClass),
  ];
}

/** Kurtarmanın GERÇEKTEN ÖLÇÜLMÜŞ süresi — kopma defterinden. */
export function buildLedgerFields(input: RecoveryFieldsInput): readonly InspectorField[] {
  const d = input.linkLoss;
  if (d === null) {
    return [unavailable({
      id: 'ledger', label: 'Kopma defteri', source: SRC_LEDGER,
      note: '',
    }, 'Okunamadı.')];
  }
  return [
    observed({
      id: 'll-total', label: 'Kayıtlı kopma', source: SRC_LEDGER,
      note: 'Bu oturumda deftere yazılan kopma sayısı.',
    }, d.total),
    d.medianRecoveryMs === null
      ? unavailable({
          id: 'll-median', label: 'Kurtarma süresi (medyan)', source: SRC_LEDGER,
          note: '',
        }, 'Kapanmış kurtarma yok — süre UYDURULMAZ.')
      : observed({
          id: 'll-median', label: 'Kurtarma süresi (medyan)', source: SRC_LEDGER,
          note: 'Yalnız KAPANMIŞ kayıtlardan; bekleyen ve superseded HARİÇ.',
        }, `${d.medianRecoveryMs} ms`),
    d.maxRecoveryMs === null
      ? unavailable({
          id: 'll-max', label: 'Kurtarma süresi (en kötü)', source: SRC_LEDGER,
          note: '',
        }, 'Kapanmış kurtarma yok.')
      : observed({
          id: 'll-max', label: 'Kurtarma süresi (en kötü)', source: SRC_LEDGER,
          note: 'En uzun ölçülmüş toparlanma.',
        }, `${d.maxRecoveryMs} ms`),
    observed({
      id: 'll-pending', label: 'Kurtarması bekleyen', source: SRC_LEDGER,
      note: 'Kanıt henüz gelmedi ama HÂLÂ gelebilir.',
    }, d.pendingRecoveryCount),
    observed({
      id: 'll-superseded', label: 'Ölçülemeyen kurtarma', source: SRC_LEDGER,
      note: '#596: üstüne yeni kopma doğdu → gerçek süre bir daha BİLİNEMEZ. "Bekliyor" SAYILMAZ.',
    }, d.supersededCount),
  ];
}
