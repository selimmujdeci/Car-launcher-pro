/**
 * diagnosticTransaction — P0-VDK-F1A · KANONİK TANI İŞLEMİ OMURGASI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (ölçülen legacy borç) ───────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Her tanı girişi (`readAllDTCs` · `discoverEcus` · `scanAllEcus` · üretici
 * DTC okumaları · oturum probu) AYNI ÜÇ ADIMI **elle ve kopyalayarak** yapıyordu:
 *
 *   1. `let epoch = -1; try { epoch = getObdSessionEpoch(); } catch {}`
 *   2. `const a = await getDiagnosticAdmission(); if (a.admission !== 'READY') …`
 *   3. sonuçta dağınık `x.sessionEpoch !== epoch` filtreleri
 *
 * Kopyalanan her satır bir kusur adayıdır ve ürün bunu üç kez ödedi. Daha
 * kötüsü, ÜÇ ŞEY HİÇBİR YERDE YOKTU:
 *
 *   · **BÜTÇE** — `MAX_SCAN_ECUS` · `slice(0, 8)` · `EXT_WAIT_TIMEOUT_MS`
 *     birbirinden habersiz sabitlerdi; bir taramanın toplam maliyeti hiçbir
 *     yerde ölçülmüyordu.
 *   · **İPTAL** — `discoveryCoordinator` `AbortController` kullanıyordu ama
 *     DTC/tarama yollarında iptal kavramı YOKTU: kullanıcı ekrandan çıksa
 *     bile tarama hattı sürüyordu.
 *   · **GEÇ YANIT KORUMASI** — `obdService` kendi içinde `myGen` deseniyle
 *     korunuyordu; tanı yollarında ise bir tur bittikten SONRA gelen async
 *     yanıt sonucu SESSİZCE değiştirebiliyordu.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU MODÜL NE DEĞİLDİR (İKİNCİ MOTOR KURMAZ) ────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) **İKİNCİ OTURUM OTORİTESİ DEĞİLDİR.** Epoch `obdService.getObdSessionEpoch`
 *     tekelindedir; bu modül onu YALNIZ OKUR ve mühürler.
 * (2) **İKİNCİ ADMİSYON KAPISI DEĞİLDİR.** Karar `diagnosticAdmission`
 *     tekelindedir; bu modül onu ÇAĞIRIR, kuralını KOPYALAMAZ.
 * (3) **İKİNCİ RECOVERY/RECONNECT OTORİTESİ DEĞİLDİR.** Hiçbir yeniden
 *     bağlanma başlatmaz, hiçbir queue komutunu preempt etmez.
 * (4) **YAZMA KAPISI DEĞİLDİR.** `authorityClass` yalnız bir ETİKETTİR;
 *     `DESTRUCTIVE` işaretlemek hiçbir yetki AÇMAZ. Gerçek kapı
 *     `manufacturerClearGate` / `writeGate`tedir ve bu tur onu GENİŞLETMEZ.
 * (5) **CANLI PID POLLING'İ KAPSAMAZ.** Yalnız tek-atımlık tanı ve tarama
 *     yolları hedeflenir; çalışan poll döngüsü DEĞİŞTİRİLMEZ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── FAIL-CLOSED ───────────────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Tanınmayan/geçersiz her durum geçişi `UNKNOWN`'a düşer ve `UNKNOWN` bir
 * TERMİNAL durumdur: işlem CANLI DEĞİLDİR, bütçe tüketilemez, yanıt kabul
 * edilemez. "Bilmiyorum" asla "devam et" anlamına gelmez.
 *
 * Durum tutar (kayıt defteri) ama I/O YAPMAZ; `Date.now` enjekte edilebilir.
 */

import { getObdSessionEpoch } from '../obdService';
import { getDiagnosticAdmission, getDiagnosticAdmissionSync } from './diagnosticAdmission';
import { OwnerCommandEvidence } from '../message';

/* ══════════════════════════════════════════════════════════════════════════
   1) SÖZLEŞME TİPLERİ
   ══════════════════════════════════════════════════════════════════════════ */

/**
 * İşlemin AMACI — bütçe sınıfı ve kanıt bağlantısı bundan türer.
 * Yeni amaç eklemek bir sözleşme değişikliğidir (sessizce string geçilemez).
 */
export type DiagnosticPurpose =
  /** Fonksiyonel Mode 03/07/0A turu (`dtcService.readAllDTCs`). */
  | 'dtc_scan'
  /** Tam araç taraması (`multiEcuScan.scanAllEcus`). */
  | 'multi_ecu_scan'
  /** ECU keşfi (`multiEcuScan.discoverEcus`). */
  | 'ecu_discovery'
  /** Üretici tabanı okuması (UDS 0x19 · KWP 0x18/0x13). */
  | 'manufacturer_dtc'
  /** Adres/oturum kanıt probu (KWP). */
  | 'ecu_probe'
  /** Donmuş kare okuması. */
  | 'freeze_frame'
  /**
   * P0-VDK-F5H — bağlantı sonrası ERKEN ARAÇ KİMLİĞİ ölçümü.
   *
   * Ayrı bir amaç olması bilinçlidir: bu tur tam taramadan ÖNCE, kullanıcının
   * beklediği hiçbir iş yokken koşar ve bütçesi kasten ÇOK DARDIR (§12 —
   * bağlantıyı ağırlaştırmak yasak). `ecu_discovery` bütçesini paylaşsaydı
   * kimlik ölçümü keşif payını yiyebilirdi.
   */
  | 'vehicle_identity';

/**
 * İşlemin YETKİ SINIFI — yalnız ETİKET.
 *
 * ⚠️ `DESTRUCTIVE` işaretlemek hiçbir kapıyı AÇMAZ ve bu tur hiçbir yeni
 * destructive yol tanımlamaz. Sınıf, ileride Safety Kernel'in jeton üretirken
 * okuyacağı alandır; bugün yalnız kanıt ve gözlem içindir.
 */
export type AuthorityClass = 'READ_ONLY' | 'DESTRUCTIVE';

/** İsteğin gideceği ECU; fonksiyonel (7DF) okumada `null`. */
export interface EcuEndpoint {
  readonly txHeader: string | null;
  readonly rxHeader: string | null;
  readonly addressBits: number | null;
  readonly label: string;
}

/** Fonksiyonel yayın hedefi — tek ECU'ya ait DEĞİL. */
export const FUNCTIONAL_ENDPOINT: EcuEndpoint = Object.freeze({
  txHeader: null, rxHeader: null, addressBits: null, label: 'FONKSİYONEL (7DF)',
});

/**
 * İşlem durumu. `UNKNOWN` **fail-closed terminal**dir.
 *
 * `RESTORING`: geri-alma yükümlülükleri (header/oturum) işlenirken.
 * ⚠️ BU TURDA yükümlülükler KAYDEDİLİR ama ÇALIŞTIRILMAZ (görev sınırı) —
 * native `withEcuHeader` zaten kendi restore'unu ATOMİK yapıyor ve ikinci bir
 * restore otoritesi kurmak o atomikliği bozardı.
 */
export type TransactionState =
  | 'CREATED'
  | 'PREPARING'
  | 'SESSION_ACTIVE'
  | 'EXECUTING'
  | 'RESTORING'
  | 'COMPLETED'
  | 'CANCELLED'
  | 'FAILED'
  | 'UNKNOWN';

/** Terminal durumlar — buradan çıkış YOKTUR. */
const TERMINAL: ReadonlySet<TransactionState> =
  new Set<TransactionState>(['COMPLETED', 'CANCELLED', 'FAILED', 'UNKNOWN']);

export function isTerminalState(s: TransactionState): boolean { return TERMINAL.has(s); }

/**
 * İZİN VERİLEN GEÇİŞLER — burada olmayan HER geçiş `UNKNOWN` üretir.
 *
 * Beyaz liste (kara liste değil) bilinçlidir: yarın yeni bir durum eklenirse
 * geçişleri AÇIKÇA tanımlanana kadar fail-closed kalır.
 */
const ALLOWED: Readonly<Record<TransactionState, readonly TransactionState[]>> = {
  CREATED:        ['PREPARING', 'CANCELLED', 'FAILED'],
  PREPARING:      ['SESSION_ACTIVE', 'CANCELLED', 'FAILED'],
  /* `COMPLETED` bilinçlidir: hiç istek GÖNDERMEDEN başarıyla biten işlem
     MEŞRUDUR (ör. taranacak ECU yok, erken dönüş). Onu `UNKNOWN`'a düşürmek,
     doğru çalışan bir turu kusur gibi raporlamak olurdu. */
  SESSION_ACTIVE: ['EXECUTING', 'RESTORING', 'COMPLETED', 'CANCELLED', 'FAILED'],
  EXECUTING:      ['EXECUTING', 'RESTORING', 'COMPLETED', 'CANCELLED', 'FAILED'],
  RESTORING:      ['COMPLETED', 'FAILED'],
  COMPLETED:      [],
  CANCELLED:      [],
  FAILED:         [],
  UNKNOWN:        [],
} as const;

export function isTransitionAllowed(from: TransactionState, to: TransactionState): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

/**
 * Geri-alma yükümlülüğü. BU TURDA yalnız KAYDEDİLİR.
 * `applied: false` kalır — kimse çalıştırmaz (F1-B kapsamı).
 */
export interface RestoreObligation {
  readonly kind: 'ecu_header' | 'diagnostic_session' | 'adapter_config';
  readonly detail: string;
  readonly applied: boolean;
}

/** İşlem bütçesi — `null` = sınırsız DEĞİL, ÖLÇÜLMEDİ (fail-closed: reddedilir). */
export interface TransactionBudget {
  /** Azami istek adedi. */
  readonly maxRequests: number;
  /** Azami süre (ms). */
  readonly timeBudgetMs: number;
}

/** Neden bütçe/canlılık reddedildi — teşhis için AYRI tutulur. */
export type TransactionDenial =
  | 'NOT_LIVE'
  | 'CANCELLED'
  | 'REQUEST_BUDGET_EXHAUSTED'
  | 'TIME_BUDGET_EXHAUSTED'
  | 'STALE_EPOCH';

export const TRANSACTION_DENIAL_LABEL: Readonly<Record<TransactionDenial, string>> = {
  NOT_LIVE:                 'işlem canlı değil',
  CANCELLED:                'işlem iptal edildi',
  REQUEST_BUDGET_EXHAUSTED: 'istek bütçesi doldu',
  TIME_BUDGET_EXHAUSTED:    'süre bütçesi doldu',
  STALE_EPOCH:              'OBD oturumu değişti (bayat epoch)',
} as const;

export interface DiagnosticTransaction {
  readonly transactionId: string;
  readonly purpose: DiagnosticPurpose;
  readonly ecuEndpoint: EcuEndpoint;
  /** Aktif protokol (ATDPN); ölçülmediyse `null`. */
  protocol: string | null;
  /** İşlem AÇILDIĞINDA mühürlenen OBD oturumu. `-1` = okunamadı. */
  sessionEpoch: number;
  readonly authorityClass: AuthorityClass;
  readonly requestBudget: number;
  readonly timeBudgetMs: number;
  readonly startedAt: number;
  state: TransactionState;
  /** Kanıt defterlerine bu işlemi bağlayan kimlik. */
  readonly evidenceCorrelationId: string;
  restoreObligations: RestoreObligation[];

  /* ── iç sayaçlar (salt-okunur sözleşme dışında) ── */
  /** TANI istekleri (Mode 03/07/0A · 0x19 · 0x18 · 0x13 · prob). */
  requestsUsed: number;
  /**
   * P0-VDK-F1B — KEEPALIVE istekleri (`3E 00`) AYRI SAYILIR.
   *
   * NEDEN AYRI: keepalive bir TANI isteği DEĞİLDİR — bulgu üretmez, kapsama
   * girmez, bir ECU'yu "tarandı" yapmaz. İkisini tek sayaçta toplamak, uzun
   * bir taramanın tanı bütçesini keepalive'la doldurup okumaları erkenden
   * kestirirdi. **Ama iptal ve süre otoritesi TEK kalır:** sahip işlem
   * terminal olduğu anda keepalive da durur.
   */
  keepAliveRequestsUsed: number;
  cancelled: boolean;
  cancelReason: string | null;
  /** Son reddedilme nedeni — teşhis. */
  lastDenial: TransactionDenial | null;
  /** Bu işlem sırasında bir geçiş kuralı ihlal edildi mi (fail-closed izi). */
  invalidTransitionFrom: TransactionState | null;
}

/* ══════════════════════════════════════════════════════════════════════════
   2) DEFTER — süreç-ömürlü, sınırlı, timer YOK
   ══════════════════════════════════════════════════════════════════════════ */

const MAX_TRANSACTIONS = 32;

let _txns: DiagnosticTransaction[] = [];
let _seq = 0;
const _commandEvidence = new OwnerCommandEvidence('DiagnosticTransaction');
export function getDiagnosticCommandFlowEvidence() { return _commandEvidence.recent(); }
let _now: () => number = Date.now;

/** Test kancası — zaman enjeksiyonu. Üretim yolunda ÇAĞRILMAZ. */
export function _setTransactionClockForTest(fn: () => number): void { _now = fn; }
/** Test kancası — defter sıfırlanır. Üretim yolunda ÇAĞRILMAZ. */
export function _resetTransactionsForTest(): void {
  _txns = []; _seq = 0; _now = Date.now;
}

export function getTransactions(): readonly DiagnosticTransaction[] { return [..._txns]; }

export function getTransaction(id: string): DiagnosticTransaction | null {
  return _txns.find((t) => t.transactionId === id) ?? null;
}

/* ══════════════════════════════════════════════════════════════════════════
   3) VARSAYILAN BÜTÇELER — tek yer
   ══════════════════════════════════════════════════════════════════════════

   ÖLÇÜLEN KUSUR: bütçe sabitleri (`MAX_SCAN_ECUS` · `slice(0, 8)` ·
   `EXT_WAIT_TIMEOUT_MS`) birbirinden habersiz yaşıyordu ve bir taramanın
   TOPLAM maliyeti hiçbir yerde görünmüyordu.

   Değerler MEVCUT davranışın ÜSTÜNDE seçildi: bu tur hiçbir taramayı
   KISALTMAZ (davranış regresyonu yok), yalnız artık ölçülebilir bir tavan
   VAR ve doldurulduğu görülebilir. Daraltma ölçümle yapılacak iştir. */
export const DEFAULT_BUDGETS: Readonly<Record<DiagnosticPurpose, TransactionBudget>> = {
  /* 3 mod × (fonksiyonel + tekrar) + freeze frame payı. */
  dtc_scan:         { maxRequests: 24,  timeBudgetMs: 90_000 },
  /* 8 ECU × 7 servis + prob/oturum payı. */
  multi_ecu_scan:   { maxRequests: 160, timeBudgetMs: 300_000 },
  /* Fonksiyonel prob + 7 fiziksel adres. */
  ecu_discovery:    { maxRequests: 16,  timeBudgetMs: 60_000 },
  /* Bir ECU'da 0x19-01/02/0A + 0x18 + 0x13 + referans okumaları. */
  manufacturer_dtc: { maxRequests: 24,  timeBudgetMs: 60_000 },
  ecu_probe:        { maxRequests: 24,  timeBudgetMs: 45_000 },
  /* P0-VDK-F5H — en çok ÜÇ salt-okunur DID (`EARLY_IDENTITY_DID_ORDER`) +
     tam tarama sırasındaki TEK yeniden doğrulama. Süre tavanı bilinçli
     olarak küçüktür: erken kimlik bir kullanılabilirlik kapısı DEĞİLDİR ve
     düşerse normal OBD akışı etkilenmemelidir. */
  vehicle_identity: { maxRequests: 4,   timeBudgetMs: 15_000 },
  freeze_frame:     { maxRequests: 24,  timeBudgetMs: 45_000 },
} as const;

/* ══════════════════════════════════════════════════════════════════════════
   4) YAŞAM DÖNGÜSÜ
   ══════════════════════════════════════════════════════════════════════════ */

export interface BeginTransactionOptions {
  readonly purpose: DiagnosticPurpose;
  readonly ecuEndpoint?: EcuEndpoint;
  readonly authorityClass?: AuthorityClass;
  readonly budget?: Partial<TransactionBudget>;
  readonly protocol?: string | null;
}

/**
 * İşlem açar (`CREATED`). Hattan tek bayt istemez, admisyon SORMAZ.
 *
 * Epoch burada mühürlenir: sonraki her yanıt bu mühre karşı doğrulanır.
 * Okunamazsa `-1` — sahte `0` YASAK (`0` gerçek bir oturum numarasıdır).
 */
export function beginTransaction(opts: BeginTransactionOptions): DiagnosticTransaction {
  const budget = { ...DEFAULT_BUDGETS[opts.purpose], ...(opts.budget ?? {}) };
  let epoch = -1;
  try { epoch = getObdSessionEpoch(); } catch { epoch = -1; }

  const id = `txn-${++_seq}-${opts.purpose}`;
  const txn: DiagnosticTransaction = {
    transactionId: id,
    purpose: opts.purpose,
    ecuEndpoint: opts.ecuEndpoint ?? FUNCTIONAL_ENDPOINT,
    protocol: opts.protocol ?? null,
    sessionEpoch: epoch,
    authorityClass: opts.authorityClass ?? 'READ_ONLY',
    requestBudget: budget.maxRequests,
    timeBudgetMs: budget.timeBudgetMs,
    startedAt: _now(),
    state: 'CREATED',
    evidenceCorrelationId: id,
    restoreObligations: [],
    requestsUsed: 0,
    keepAliveRequestsUsed: 0,
    cancelled: false,
    cancelReason: null,
    lastDenial: null,
    invalidTransitionFrom: null,
  };

  _txns.push(txn);
  _commandEvidence.record({ id: `${id}:request`, kind: 'REQUEST', name: 'obd.diagnostic.request', source: 'diagnostic.requester', target: 'DiagnosticTransaction', operationId: id, correlationId: id, epoch, nowMs: txn.startedAt });
  if (_txns.length > MAX_TRANSACTIONS) _txns = _txns.slice(-MAX_TRANSACTIONS);
  return txn;
}

/**
 * Durum geçişi — beyaz listede YOKSA `UNKNOWN` (fail-closed).
 *
 * `UNKNOWN`'a düşen bir işlem CANLI DEĞİLDİR: bütçe tüketemez, yanıt kabul
 * edemez. İhlalin NEREDEN geldiği `invalidTransitionFrom`da saklanır —
 * sessiz düşüş teşhis kaybıdır.
 */
export function transitionTransaction(
  txn: DiagnosticTransaction, to: TransactionState,
): TransactionState {
  if (isTransitionAllowed(txn.state, to)) { txn.state = to; return to; }
  txn.invalidTransitionFrom = txn.state;
  txn.state = 'UNKNOWN';
  return 'UNKNOWN';
}

/**
 * Admisyon kapısını ÇAĞIRIR (kuralı kopyalamaz) ve işlemi hazırlar.
 *
 * READY değilse işlem `FAILED` olur ve `false` döner — çağıran ECU'ya TEK
 * BAYT göndermez. Bu, mevcut `readAllDTCs` / `discoverEcus` davranışının
 * AYNISIDIR; yalnız artık tek yerde ve ölçülebilir.
 */
export async function prepareTransaction(
  txn: DiagnosticTransaction,
): Promise<{ ok: boolean; admission: string; reason: string }> {
  if (transitionTransaction(txn, 'PREPARING') === 'UNKNOWN') {
    return { ok: false, admission: 'UNKNOWN', reason: 'geçersiz durum geçişi' };
  }
  let admission = 'UNKNOWN'; let reason = 'admisyon okunamadı';
  try {
    const a = await getDiagnosticAdmission();
    admission = a.admission; reason = a.reason;
  } catch { /* fail-closed: UNKNOWN kalır */ }

  if (admission !== 'READY') {
    transitionTransaction(txn, 'FAILED');
    return { ok: false, admission, reason };
  }
  /* Epoch admisyondan SONRA tazelenir: kapı beklerken oturum değişmiş
     olabilir ve bayat mühürle devam etmek tam olarak bu modülün
     engellediği hatadır. */
  try { txn.sessionEpoch = getObdSessionEpoch(); } catch { /* mühür korunur */ }

  transitionTransaction(txn, 'SESSION_ACTIVE');
  return { ok: true, admission, reason };
}

/** Senkron hazırlık — admisyonu `getDiagnosticAdmissionSync` ile sorar. */
export function prepareTransactionSync(
  txn: DiagnosticTransaction,
): { ok: boolean; admission: string; reason: string } {
  if (transitionTransaction(txn, 'PREPARING') === 'UNKNOWN') {
    return { ok: false, admission: 'UNKNOWN', reason: 'geçersiz durum geçişi' };
  }
  let admission = 'UNKNOWN'; let reason = 'admisyon okunamadı';
  try {
    const a = getDiagnosticAdmissionSync();
    admission = a.admission; reason = a.reason;
  } catch { /* fail-closed */ }
  if (admission !== 'READY') {
    transitionTransaction(txn, 'FAILED');
    return { ok: false, admission, reason };
  }
  try { txn.sessionEpoch = getObdSessionEpoch(); } catch { /* mühür korunur */ }
  transitionTransaction(txn, 'SESSION_ACTIVE');
  return { ok: true, admission, reason };
}

/* ══════════════════════════════════════════════════════════════════════════
   5) CANLILIK · BÜTÇE · İPTAL
   ══════════════════════════════════════════════════════════════════════════ */

/** Şu anki OBD oturumunu okur; okunamazsa `null` (sahte değer YOK). */
function _currentEpoch(): number | null {
  try { return getObdSessionEpoch(); } catch { return null; }
}

/**
 * İşlem CANLI mı — istek göndermeden önce sorulur.
 *
 * ÜÇ KAPI (hepsi geçilmeli):
 *  · terminal durumda DEĞİL ve iptal edilmemiş
 *  · süre bütçesi dolmamış
 *  · **oturum mührü hâlâ geçerli** (epoch değişmemiş)
 *
 * Epoch OKUNAMAZSA (`null`) canlılık REDDEDİLMEZ: bu, hattın koptuğu değil
 * ölçümün alınamadığı anlamına gelir ve mevcut davranışı bozmamak için
 * mühür kontrolü ATLANIR. Mühür `-1` (hiç okunamamış) ise de karşılaştırma
 * yapılmaz — sahte bir "bayat" hükmü üretmek YASAK.
 */
export function transactionLiveness(
  txn: DiagnosticTransaction,
): { live: boolean; denial: TransactionDenial | null } {
  if (txn.cancelled) { txn.lastDenial = 'CANCELLED'; return { live: false, denial: 'CANCELLED' }; }
  if (isTerminalState(txn.state)) { txn.lastDenial = 'NOT_LIVE'; return { live: false, denial: 'NOT_LIVE' }; }
  if (txn.state === 'CREATED') { txn.lastDenial = 'NOT_LIVE'; return { live: false, denial: 'NOT_LIVE' }; }

  if (_now() - txn.startedAt >= txn.timeBudgetMs) {
    txn.lastDenial = 'TIME_BUDGET_EXHAUSTED';
    return { live: false, denial: 'TIME_BUDGET_EXHAUSTED' };
  }

  const cur = _currentEpoch();
  if (cur !== null && txn.sessionEpoch !== -1 && cur !== txn.sessionEpoch) {
    txn.lastDenial = 'STALE_EPOCH';
    return { live: false, denial: 'STALE_EPOCH' };
  }

  txn.lastDenial = null;
  return { live: true, denial: null };
}

export function isTransactionLive(txn: DiagnosticTransaction): boolean {
  return transactionLiveness(txn).live;
}

/**
 * İstek bütçesinde hak KALDI mı — `transactionLiveness`ten AYRI tutulur.
 *
 * NEDEN AYRI: canlılık `acceptResponse` tarafından da okunur ve bütçenin
 * dolması UÇUŞTAKİ meşru bir yanıtı geçersiz KILMAZ. İkisini birleştirmek,
 * gönderilmiş ve cevaplanmış bir okumayı çöpe atmak olurdu.
 *
 * Çağıran bunu bir SONRAKİ iş birimine (ör. bir ECU turu) girmeden önce
 * sorar: hiç istek gönderemeyecekse o birime hiç başlamamalıdır — yoksa
 * rapor onu "tarandı" diye gösterir ve bu bir kapsam yalanı olur.
 */
export function hasRequestBudget(txn: DiagnosticTransaction): boolean {
  return txn.requestsUsed < txn.requestBudget;
}

/**
 * Bir istek hakkı tüketir. `false` → çağıran **göndermemelidir**.
 *
 * Canlılık + istek bütçesi TEK yerde. `KwpCommandBudget` (PID/DID keşfi)
 * DEĞİŞTİRİLMEDİ — o kendi pencereli bütçesini korur; bu sayaç işlem
 * ömrü boyuncadır ve onunla YARIŞMAZ.
 */
export function consumeRequest(txn: DiagnosticTransaction): boolean {
  const l = transactionLiveness(txn);
  if (!l.live) return false;
  if (txn.requestsUsed >= txn.requestBudget) {
    txn.lastDenial = 'REQUEST_BUDGET_EXHAUSTED';
    return false;
  }
  txn.requestsUsed++;
  if (txn.state === 'SESSION_ACTIVE') transitionTransaction(txn, 'EXECUTING');
  return true;
}

/**
 * GEÇ YANIT KORUMASI — bir yanıt bu işleme YAZILABİLİR mi?
 *
 * ÖLÇÜLEN KUSUR: bir tur bittikten SONRA gelen async yanıt sonucu sessizce
 * değiştirebiliyordu (uçuştaki native çağrı, iptal edilmiş tarama, oturum
 * değişimi). Bu fonksiyon o pencereyi kapatır: terminal durumdaki ya da
 * mührü bozulmuş bir işleme HİÇBİR yanıt yazılamaz.
 *
 * `consumeRequest`ten AYRIDIR: o "göndereyim mi", bu "gelen kabul edilir mi".
 * İkisini birleştirmek, bütçesi dolmuş ama uçuşta olan meşru bir yanıtı
 * atmak olurdu.
 */
export function acceptResponse(txn: DiagnosticTransaction): boolean {
  if (txn.cancelled) { txn.lastDenial = 'CANCELLED'; return false; }
  if (isTerminalState(txn.state)) { txn.lastDenial = 'NOT_LIVE'; return false; }
  const cur = _currentEpoch();
  if (cur !== null && txn.sessionEpoch !== -1 && cur !== txn.sessionEpoch) {
    txn.lastDenial = 'STALE_EPOCH';
    return false;
  }
  return true;
}

/** İptal — idempotent. Terminal işlemi geri almaz. */
export function cancelTransaction(txn: DiagnosticTransaction, reason: string): void {
  if (isTerminalState(txn.state)) return;
  txn.cancelled = true;
  txn.cancelReason = reason;
  transitionTransaction(txn, 'CANCELLED');
  _commandEvidence.record({ id: `${txn.transactionId}:cancelled`, kind: 'RESULT', name: 'obd.diagnostic.result', source: 'DiagnosticTransaction', target: null, operationId: txn.transactionId, correlationId: txn.evidenceCorrelationId, epoch: txn.sessionEpoch, reason: 'CANCELLED', nowMs: _now() });
}

/**
 * Geri-alma yükümlülüğü KAYDEDER.
 * ⚠️ BU TURDA ÇALIŞTIRILMAZ — `applied` daima `false`. Native
 * `withEcuHeader` restore'unu ATOMİK yapıyor ve ikinci bir restore
 * otoritesi o atomikliği bozardı (görev sınırı: F1-B).
 */
export function addRestoreObligation(
  txn: DiagnosticTransaction, kind: RestoreObligation['kind'], detail: string,
): void {
  txn.restoreObligations.push({ kind, detail, applied: false });
}

/** Başarıyla kapatır. İptal/terminal işlemi COMPLETED YAPMAZ (fail-closed). */
export function completeTransaction(txn: DiagnosticTransaction): TransactionState {
  if (isTerminalState(txn.state)) return txn.state;
  if (txn.restoreObligations.length > 0) transitionTransaction(txn, 'RESTORING');
  const state = transitionTransaction(txn, 'COMPLETED');
  _commandEvidence.record({ id: `${txn.transactionId}:completed`, kind: 'RESULT', name: 'obd.diagnostic.result', source: 'DiagnosticTransaction', target: null, operationId: txn.transactionId, correlationId: txn.evidenceCorrelationId, epoch: txn.sessionEpoch, reason: state, nowMs: _now() });
  return state;
}

/** Hata ile kapatır. */
export function failTransaction(txn: DiagnosticTransaction, reason: string): TransactionState {
  if (isTerminalState(txn.state)) return txn.state;
  txn.cancelReason = reason;
  const state = transitionTransaction(txn, 'FAILED');
  _commandEvidence.record({ id: `${txn.transactionId}:failed`, kind: 'RESULT', name: 'obd.diagnostic.result', source: 'DiagnosticTransaction', target: null, operationId: txn.transactionId, correlationId: txn.evidenceCorrelationId, epoch: txn.sessionEpoch, reason, nowMs: _now() });
  return state;
}

/* ══════════════════════════════════════════════════════════════════════════
   6) ÖZET (LAB gözlemi)
   ══════════════════════════════════════════════════════════════════════════ */

export interface TransactionSummary {
  readonly total: number;
  readonly live: number;
  readonly completed: number;
  readonly cancelled: number;
  readonly failed: number;
  /** Fail-closed geçiş ihlali sayısı — 0 DIŞINDAKİ her değer bir kusurdur. */
  readonly unknown: number;
  readonly budgetExhausted: number;
  readonly staleEpochRejections: number;
}

export function summarizeTransactions(
  txns: readonly DiagnosticTransaction[],
): TransactionSummary {
  return {
    total:     txns.length,
    live:      txns.filter((t) => !isTerminalState(t.state)).length,
    completed: txns.filter((t) => t.state === 'COMPLETED').length,
    cancelled: txns.filter((t) => t.state === 'CANCELLED').length,
    failed:    txns.filter((t) => t.state === 'FAILED').length,
    unknown:   txns.filter((t) => t.state === 'UNKNOWN').length,
    budgetExhausted: txns.filter((t) =>
      t.lastDenial === 'REQUEST_BUDGET_EXHAUSTED' || t.lastDenial === 'TIME_BUDGET_EXHAUSTED').length,
    staleEpochRejections: txns.filter((t) => t.lastDenial === 'STALE_EPOCH').length,
  };
}
