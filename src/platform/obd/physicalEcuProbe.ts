/**
 * physicalEcuProbe — P0-OBD-PARITY · STANDART CAN ADRES UZAYINDA FİZİKSEL ECU KEŞFİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN VAR (ölçülen kusur) ─────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * ECU keşfi ürünün TEK bir komutuna bağlıydı: fonksiyonel `0100` (7DF).
 * Bu, ISO 15765-4'ün garanti ettiği kadarını bulur — ve YALNIZCA onu.
 * `0100` bir **OBD-II emisyon servisidir**; emisyon kapsamı dışındaki ya da
 * fonksiyonel yayına katılmayan birimler onu **hiç yanıtlamaz** ve bu ürün
 * için yapısal olarak GÖRÜNMEZ kalırlar. "Tam araç taraması" cümlesi tek
 * komutun bulabildiğiyle sınırlıydı ve bu hiçbir yerde YAZMIYORDU.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── UYDURMA ADRES YOK: NEDEN BU ARALIK MEŞRU ──────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * Taranan aralık ISO 15765-4'ün **kendi tanımladığı** fiziksel istek/yanıt
 * çiftidir: istek `7E0..7E7`, yanıt `7E8..7EF` (rx = tx + 8). Bu bir marka
 * tahmini, forum bilgisi ya da OEM sızıntısı DEĞİL, standardın metnidir.
 * Bu yüzden bu modül CLAUDE.md'nin "adres uydurma" yasağını ÇİĞNEMEZ:
 * araç-özel hiçbir adres burada YOKTUR ve olamaz (OEM adresleri yalnız
 * `oem/oemProfileRegistry` defterinde, `verifiedOn` kanıtıyla yaşar).
 *
 * ROL UYDURULMAZ: bulunan her ECU `role: 'unknown'` ile girer. `7E1 = şanzıman`
 * gibi yaygın eşlemeler **garanti değildir**; rol yalnız ECU'nun KENDİ beyanından
 * (`ecuIdentityService`) türetilir. Boş bilgi, yanlış bilgiden iyidir.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── GÜVENLİK SINIRLARI (pazarlıksız) ──────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * 1. **YALNIZ CAN.** Yavaş seri hatta (KWP2000 / ISO 9141) ASLA koşmaz.
 *    K-line'da kör adres taraması başka bir modülü uyandırabilir ve o modülün
 *    oturum durumunu bozabilir — sahada ölçülmüş bir risktir, teorik değil.
 * 2. **SALT-OKUNUR TEK KOMUT.** Yalnız `19 02 FF` (ReadDTCInformation,
 *    reportDTCByStatusMask). Yazma · rutin · oturum değiştirme · reset · security
 *    YOKTUR ve bu modül üzerinden açılamaz.
 * 3. **YALNIZ BİLİNMEYEN ADRESLER.** Fonksiyonel keşifte ZATEN bulunan adres
 *    tekrar sorulmaz (gereksiz hat trafiği yok).
 * 4. **BÜTÇE TAVANI.** En fazla `MAX_PHYSICAL_PROBES` adres.
 * 5. **SESSİZLİK ECU DEĞİLDİR.** Envantere YALNIZ gerçek bir yanıt veren adres
 *    girer — pozitif de olur, negatif (NRC) de olur; ikisi de "orada bir ECU
 *    var ve beni duydu" kanıtıdır. Zaman aşımı / NO DATA / hat hatası
 *    ECU SAYILMAZ (fail-closed: uydurma envanter YASAK).
 *
 * SAF DEĞİL (native köprüyü çağırır) ama karar mantığı saf fonksiyonlarda
 * ayrılmıştır ve tam test edilebilir.
 */

import type { DiscoveredEcu } from './ecuDiscovery';

/** Bütçe tavanı: 7E1..7E7 = 7 adres (7E0 fonksiyonel keşifte zaten gelir). */
export const MAX_PHYSICAL_PROBES = 7;

/**
 * ISO 15765-4 standart 11-bit fiziksel istek adresleri.
 * `7E0` DIŞARIDA: motor ECU'su fonksiyonel `0100`'e zaten yanıt verir ve
 * vermiyorsa sorun adreste değil bağlantıdadır (ayrı teşhis).
 */
export const STANDARD_PHYSICAL_TX: readonly string[] =
  ['7E1', '7E2', '7E3', '7E4', '7E5', '7E6', '7E7'] as const;

/** ISO 15765-4: rx = tx + 8. Standart aritmetik — tahmin DEĞİL. */
export function rxForPhysicalTx(tx: string): string | null {
  const n = parseInt(tx, 16);
  if (!Number.isFinite(n)) return null;
  return (n + 8).toString(16).toUpperCase().padStart(3, '0');
}

/**
 * Bir prob yanıtının ECU VARLIĞI kanıtı olup olmadığını söyler (SAF).
 *
 * ── KRİTİK AYRIM ──────────────────────────────────────────────────────────
 * `ok`            → ECU cevapladı (pozitif).            → ECU VAR
 * `negative_nrc`  → ECU "bu servisi bilmiyorum" dedi.   → ECU VAR (beni duydu!)
 * `unsupported`   → aynı şey, sınıflandırılmış NRC.     → ECU VAR
 * `security_required` / `condition_required`            → ECU VAR
 * `no_response` · `timeout` · `transport_error` · `malformed`
 *                 → SESSİZLİK ya da anlaşılmayan gürültü → ECU **YOK SAYILIR**
 *
 * "Duydu ve reddetti" ile "hiç ses yok" arasındaki farkı yok saymak, tam
 * olarak bu ürünün defalarca düzelttiği kusur sınıfıdır — ama TERSİ de
 * doğrudur: sessizliği ECU saymak, olmayan bir birimi envantere yazmak olur.
 */
export function isEcuPresenceEvidence(outcome: string): boolean {
  switch (outcome) {
    case 'ok':
    case 'negative_nrc':
    case 'unsupported':
    case 'security_required':
    case 'condition_required':
      return true;
    default:
      return false;
  }
}

/** Tek bir fiziksel prob denemesinin ÖLÇÜLEN sonucu (kanıt kaydı). */
export interface PhysicalProbeResult {
  readonly txHeader: string;
  readonly rxHeader: string;
  /** Native köprünün döndürdüğü ham sonuç sınıfı. */
  readonly outcome: string;
  readonly nrc: number | null;
  readonly raw: string | null;
  /** Bu adreste ECU olduğunun KANITI var mı (bkz. `isEcuPresenceEvidence`). */
  readonly present: boolean;
}

/**
 * Prob sonucundan envanter kaydı üretir (SAF).
 *
 * Rol `unknown`, kanıt `none`: adresten rol TÜRETİLMEZ. Etiket adresin
 * kendisidir — "ECU 7E1" bir adrestir, bir sistem adı DEĞİLDİR ve kullanıcıya
 * öyle sunulmaz.
 */
export function ecuFromPhysicalProbe(r: PhysicalProbeResult): DiscoveredEcu | null {
  if (!r.present) return null;
  return {
    rxHeader: r.rxHeader,
    txHeader: r.txHeader,
    addressBits: 11,
    role: 'unknown',
    roleEvidence: 'none',
    label: `ECU ${r.txHeader}`,
    discoverySource: 'physical_probe',
    probeOutcome: 'responded',
    /* KWP kavramı CAN'de YOKTUR — `false` bir ölçüm değil, kavramın yokluğu. */
    kwpTargetVerified: false,
    txProvenance: 'can_11bit_standard',
  };
}

/**
 * Hangi adreslerin sorulacağını belirler (SAF).
 *
 * Fonksiyonel keşifte ZATEN bulunan tx adresleri elenir; kalanlar bütçe
 * tavanına kadar kırpılır. Kırpma SESSİZ DEĞİLDİR: çağıran kaç adresin
 * sorulmadığını `skipped` ile öğrenir ve kapsam raporuna yazar.
 */
export function planPhysicalProbes(
  known: readonly DiscoveredEcu[],
  budget: number = MAX_PHYSICAL_PROBES,
  opts: {
    /** Şimdiki an — merdiven zamanlaması bunu KULLANIR (kendi saatini okumaz). */
    readonly nowMs?: number;
    /**
     * Kullanıcı AKTİF tarama istedi → merdiven ATLANIR (B7 kural 10).
     * Teşhis isteyen kullanıcıya "geçen sefer sormuştuk" denmez.
     */
    readonly force?: boolean;
  } = {},
): {
  targets: readonly string[];
  skipped: number;
  /** B7 — merdiven yüzünden sorulMAYAN adresler (LAB'da gerekçesiyle görünür). */
  suppressed: readonly SuppressedProbeTarget[];
} {
  const seen = new Set(known.map((e) => e.txHeader.toUpperCase()));
  const candidates = STANDARD_PHYSICAL_TX.filter((tx) => !seen.has(tx));

  /* ── B7 · SESSİZ ADRES MERDİVENİ ────────────────────────────────────────
     Saha (2026-08-30): 7E1–7E7 hiç yanıt vermediği için envantere ASLA
     girmiyor ve her turda yeniden soruluyordu (10 dk'da 712 istek, %83'ü
     boşa). Doğrulanmış sessizlik artık zaman aşımlı olarak bastırılır. */
  const nowMs = typeof opts.nowMs === 'number' ? opts.nowMs : Date.now();
  const suppressed: SuppressedProbeTarget[] = [];
  const eligible: string[] = [];
  for (const tx of candidates) {
    const s = opts.force === true ? null : _isSuppressed(tx, nowMs);
    if (s === null) { eligible.push(tx); continue; }
    suppressed.push({
      txHeader: tx,
      reason: 'CONFIRMED_SILENT_BACKOFF',
      silentStreak: s.silentStreak,
      nextEligibleAtMs: s.nextEligibleAtMs,
      remainingMs: Math.max(0, s.nextEligibleAtMs - nowMs),
      backoffStepIndex: s.backoffStepIndex,
    });
    _noteSaved(tx);
  }

  const targets = eligible.slice(0, Math.max(0, budget));
  return { targets, skipped: eligible.length - targets.length, suppressed };
}

/* ══════════════════════════════════════════════════════════════════════════
   KANIT DEFTERİ — süreç-ömürlü, sınırlı, timer YOK
   ══════════════════════════════════════════════════════════════════════════

   ZORUNLU GÖZLEMLENEBİLİRLİK (CLAUDE.md): bu tur hatta YENİ istek çıkarıyor.
   Hangi adrese sorulduğu, ne cevap geldiği ve neden ECU sayılıp sayılmadığı
   görülemezse, "keşif genişledi" iddiası kanıtsız kalırdı. */

export interface PhysicalProbeEvidence extends PhysicalProbeResult {
  readonly atMs: number;
  readonly protocol: string | null;
}

/** Tavan: bir turda en fazla 7 prob; iki tur geçmişi yeter. */
const MAX_PROBE_EVIDENCE = 16;

let _probes: PhysicalProbeEvidence[] = [];
let _skipped = 0;

/** Prob kanıtı yazar. ASLA throw etmez. */
export function recordPhysicalProbe(r: PhysicalProbeResult, protocol: string | null): void {
  try {
    _probes.push({ ...r, atMs: Date.now(), protocol });
    if (_probes.length > MAX_PROBE_EVIDENCE) _probes = _probes.slice(-MAX_PROBE_EVIDENCE);
  } catch { /* kanıt kaydı keşfi DÜŞÜRMEZ */ }
}

/** Bütçe tavanı yüzünden sorulMAYAN adres adedi — sessiz kırpma YASAK. */
export function recordPhysicalProbeSkipped(n: number): void {
  try { _skipped = n; } catch { /* yut */ }
}

export function getPhysicalProbes(): readonly PhysicalProbeEvidence[] { return [..._probes]; }
export function getPhysicalProbeSkipped(): number { return _skipped; }

/**
 * Test kancası — süreç durumu sıfırlanır. Üretim yolunda ÇAĞRILMAZ.
 *
 * B7: eleme merdiveni de BURADAN sıfırlanır. Ayrı bırakılsaydı, bir testin
 * öğrendiği sessizlik bir sonraki teste SIZAR ve orada ECU'yu görünmez yapardı
 * (ölçüldü: 4 mevcut kilit bu yüzden düştü). Tek kanca = tek gerçek.
 */
export function _resetPhysicalProbesForTest(): void {
  _probes = []; _skipped = 0;
  _resetProbeSuppressionForTest();
}

/* ══════════════════════════════════════════════════════════════════════════
 * P0-VDK-B7 · SESSİZ ADRES ELEME MERDİVENİ (bounded · geri alınabilir)
 *
 * ── SAHADA ÖLÇÜLEN KUSUR (2026-08-30 · gerçek araç · B3 saha turu) ────────
 * Ana ekranda, DTC ekranı KAPALIYKEN:
 *   · `readAdvancedDtcs` ~1,15/sn · 10 dk'da **712 çağrı**
 *   · `probeEcus` 102 çağrı → 712 ≈ 102 × 7 (tam uyum)
 *   · 60 sn'de `44 × 1902FF` → **hepsi NO DATA**
 *   · 10 dk'da bilgi üretmeyen süre 335 270 ms → hattın **%83'ü**
 *
 * KÖK NEDEN: {@link planPhysicalProbes} yalnız "fonksiyonel keşifte ZATEN
 * bulunmuş" adresleri eliyordu. 7E1–7E7 hiç yanıt vermediği için envantere
 * ASLA girmiyor → her keşif turunda yeniden soruluyordu. Kanıt defteri
 * (`_probes`) vardı ama YALNIZ GÖSTERİM içindi; planlamaya geri beslenmiyordu.
 * Yani ürün aynı yedi sessiz adresi sonsuza kadar sorguluyordu.
 *
 * ── BU MERDİVENİN SÖZLEŞMESİ ──────────────────────────────────────────────
 * 1. **Tek sessizlik eleme YAPMAZ.** En az {@link PROBE_SILENCE_CONFIRM}
 *    ardışık DOĞRULANMIŞ sessizlik gerekir.
 * 2. **Hat sorunu ile gerçek sessizlik AYRIDIR.** `transport_error`/`malformed`
 *    öğrenmeye GİRMEZ (bkz. {@link classifyProbeLearning}) — adaptör koptuğunda
 *    yedi adres birden "yok" öğrenilmesi, ürünü kör eden bir hata olurdu.
 * 3. **Terminal kara liste YOKTUR.** Bastırma her zaman zaman aşımlıdır
 *    ({@link PROBE_BACKOFF_LADDER_MS}); süre dolunca adres YENİDEN ölçülür.
 * 4. **Yanıt gelirse durum SİLİNİR** — ECU sonradan uyanırsa geri kazanılır.
 * 5. **`SUPPRESSED` ≠ `ABSENT`/`UNSUPPORTED`.** Bu bir ölçüm ekonomisi
 *    kararıdır, ECU'nun yokluğuna dair bir HÜKÜM DEĞİLDİR; kayıt provenance
 *    ve tazelik taşır.
 * 6. **Kapsam mühürlü.** Durum `sessionEpoch` + `protocol` ile mühürlüdür;
 *    mühür değişince (araç/protokol değişimi, yeniden bağlanma) TÜMÜYLE
 *    temizlenir → başka aracın öğrenmesi SIZAMAZ.
 * 7. **Kullanıcı aktif tarama isterse merdiven ATLANIR** (`force`) — teşhis
 *    isteyen kullanıcıya "bunu geçen sefer sormuştuk" denmez.
 *
 * Bu blok YENİ BİR KEŞİF/ÖĞRENME MOTORU DEĞİLDİR: mevcut `physicalEcuProbe`
 * otoritesinin kendi kanıt defterini kendi planlayıcısına bağlar. Timer YOK,
 * I/O YOK, kalıcı depolama YOK (süreç ömürlü, oturum mühürlü).
 * ════════════════════════════════════════════════════════════════════════ */

/** Bir prob sonucunun ÖĞRENME değeri — üç sınıf, birbirine karıştırılamaz. */
export type ProbeLearningClass =
  /** ECU duydu (pozitif ya da NRC) → adres CANLI; merdiven SIFIRLANIR. */
  | 'RESPONDED'
  /** Gerçek sessizlik (NO DATA / timeout) → merdiven bir basamak ilerler. */
  | 'SILENT'
  /** Hat/çözümleme sorunu → ÖĞRENME YOK (streak DEĞİŞMEZ). */
  | 'INCONCLUSIVE';

/**
 * Prob sonucunu öğrenme sınıfına ayırır (SAF).
 *
 * ⚠️ NRC SEMANTİKLERİ KARIŞTIRILMAZ: `0x11` (serviceNotSupported), `0x12`
 * (subFunctionNotSupported) ve `0x31` (requestOutOfRange) FARKLI şeyler söyler
 * — ama üçü de **ECU'nun isteği DUYDUĞUNU** kanıtlar. Bu yüzden hepsi
 * `RESPONDED`tır ve hiçbiri bastırma üretmez. Bastırma yalnız SESSİZLİKTEN doğar.
 */
export function classifyProbeLearning(outcome: string, nrc: number | null): ProbeLearningClass {
  if (isEcuPresenceEvidence(outcome)) return 'RESPONDED';
  /* NRC ölçüldüyse ECU konuşmuştur — outcome sözlüğü tanınmasa bile. */
  if (typeof nrc === 'number' && Number.isFinite(nrc)) return 'RESPONDED';
  switch (outcome) {
    case 'no_response':
    case 'timeout':
    case 'no_data':
      return 'SILENT';
    default:
      /* transport_error · malformed · error · cancelled · bilinmeyen dize:
         hat mı ECU mu belli DEĞİL → öğrenme üretilmez (fail-closed). */
      return 'INCONCLUSIVE';
  }
}

/** Tek sessizlik ELEMEZ: bastırma için gereken ardışık doğrulanmış sessizlik. */
export const PROBE_SILENCE_CONFIRM = 2;

/**
 * Bastırma süreleri (ms) — üstel ve TAVANLI. Son basamak tekrarlanır;
 * "sonsuza kadar bastır" basamağı YOKTUR.
 */
export const PROBE_BACKOFF_LADDER_MS: readonly number[] =
  [30_000, 120_000, 600_000, 1_800_000] as const;

/** Bir adresin merdiven durumu (süreç ömürlü, oturum mühürlü). */
export interface ProbeSuppressionState {
  readonly txHeader: string;
  /** Ardışık DOĞRULANMIŞ sessizlik. `INCONCLUSIVE` bunu artırmaz. */
  readonly silentStreak: number;
  /** Öğrenmeye girmeyen deneme adedi — görünürlük için sayılır. */
  readonly inconclusiveCount: number;
  readonly lastSilentAtMs: number;
  /** Bu ana kadar adres sorulmaz. `0` = bastırma yok. */
  readonly nextEligibleAtMs: number;
  readonly backoffStepIndex: number;
  /** Kapsam mührü — değişirse durum TÜMÜYLE atılır. */
  readonly sessionEpoch: number;
  readonly protocol: string | null;
  /** Bu adres için atlanan istek adedi (ölçülen tasarruf). */
  readonly savedRequests: number;
  /** Atlanan isteklerin tahmini süresi — ÖLÇÜLMEDİYSE `null` (sahte 0 YOK). */
  readonly savedMs: number | null;
}

/** Planlamada bastırılan hedefin insan-okur gerekçesi (LAB için). */
export interface SuppressedProbeTarget {
  readonly txHeader: string;
  readonly reason: 'CONFIRMED_SILENT_BACKOFF';
  readonly silentStreak: number;
  readonly nextEligibleAtMs: number;
  readonly remainingMs: number;
  readonly backoffStepIndex: number;
}

/* Kapsam mührü + durum tablosu — bounded (en fazla STANDARD_PHYSICAL_TX kadar). */
let _suppression = new Map<string, ProbeSuppressionState>();
let _scopeEpoch: number | null = null;
let _scopeProtocol: string | null = null;
/** Ölçülen prob sürelerinin ortalaması (ms) — tasarruf tahmini için. */
let _observedProbeMsTotal = 0;
let _observedProbeCount = 0;

/** Kapsam mührünü uygular; mühür değiştiyse öğrenme TÜMÜYLE atılır. */
function _enforceScope(sessionEpoch: number, protocol: string | null): void {
  if (_scopeEpoch === sessionEpoch && _scopeProtocol === protocol) return;
  _suppression = new Map();
  _observedProbeMsTotal = 0;
  _observedProbeCount = 0;
  _scopeEpoch = sessionEpoch;
  _scopeProtocol = protocol;
}

/** Gözlenen ortalama prob süresi; hiç ölçüm yoksa `null`. */
function _avgProbeMs(): number | null {
  return _observedProbeCount === 0 ? null
    : Math.round(_observedProbeMsTotal / _observedProbeCount);
}

/**
 * Bir prob sonucunu merdivene işler (SAF DEĞİL: süreç durumu yazar; I/O yok).
 *
 * @param elapsedMs ölçülen süre — bilinmiyorsa `null` (tasarruf tahmini yapılmaz)
 */
export function noteProbeOutcome(
  txHeader: string, outcome: string, nrc: number | null,
  sessionEpoch: number, protocol: string | null,
  nowMs: number, elapsedMs: number | null,
): ProbeLearningClass {
  const cls = classifyProbeLearning(outcome, nrc);
  try {
    _enforceScope(sessionEpoch, protocol);
    const tx = txHeader.toUpperCase();
    if (typeof elapsedMs === 'number' && Number.isFinite(elapsedMs) && elapsedMs >= 0) {
      _observedProbeMsTotal += elapsedMs;
      _observedProbeCount += 1;
    }

    if (cls === 'RESPONDED') {
      /* Yeniden kazanım: adres konuştu → tüm bastırma geçmişi SİLİNİR. */
      _suppression.delete(tx);
      return cls;
    }

    const prev = _suppression.get(tx);
    if (cls === 'INCONCLUSIVE') {
      /* Hat sorunu ÖĞRENME ÜRETMEZ — yalnız görünürlük için sayılır. */
      _suppression.set(tx, {
        txHeader: tx,
        silentStreak: prev?.silentStreak ?? 0,
        inconclusiveCount: (prev?.inconclusiveCount ?? 0) + 1,
        lastSilentAtMs: prev?.lastSilentAtMs ?? 0,
        nextEligibleAtMs: prev?.nextEligibleAtMs ?? 0,
        backoffStepIndex: prev?.backoffStepIndex ?? 0,
        sessionEpoch, protocol,
        savedRequests: prev?.savedRequests ?? 0,
        savedMs: prev?.savedMs ?? null,
      });
      return cls;
    }

    /* SILENT — merdiven bir basamak ilerler. */
    const streak = (prev?.silentStreak ?? 0) + 1;
    let stepIndex = prev?.backoffStepIndex ?? 0;
    let nextEligible = 0;
    if (streak >= PROBE_SILENCE_CONFIRM) {
      /* İlk doğrulamada 0. basamak; her ek sessizlikte bir üst basamak (tavanlı). */
      stepIndex = Math.min(
        (prev?.silentStreak ?? 0) >= PROBE_SILENCE_CONFIRM ? stepIndex + 1 : 0,
        PROBE_BACKOFF_LADDER_MS.length - 1,
      );
      nextEligible = nowMs + PROBE_BACKOFF_LADDER_MS[stepIndex]!;
    }
    _suppression.set(tx, {
      txHeader: tx,
      silentStreak: streak,
      inconclusiveCount: prev?.inconclusiveCount ?? 0,
      lastSilentAtMs: nowMs,
      nextEligibleAtMs: nextEligible,
      backoffStepIndex: stepIndex,
      sessionEpoch, protocol,
      savedRequests: prev?.savedRequests ?? 0,
      savedMs: prev?.savedMs ?? null,
    });
  } catch { /* öğrenme arızası keşfi DÜŞÜRMEZ */ }
  return cls;
}

/** Bir adres şu an bastırılmış mı (SAF sorgu). */
function _isSuppressed(tx: string, nowMs: number): ProbeSuppressionState | null {
  const s = _suppression.get(tx);
  if (!s) return null;
  if (s.silentStreak < PROBE_SILENCE_CONFIRM) return null;
  if (s.nextEligibleAtMs === 0 || nowMs >= s.nextEligibleAtMs) return null;
  return s;
}

/** Atlanan bir isteği tasarruf olarak işler. */
function _noteSaved(tx: string): void {
  const s = _suppression.get(tx);
  if (!s) return;
  const avg = _avgProbeMs();
  _suppression.set(tx, {
    ...s,
    savedRequests: s.savedRequests + 1,
    savedMs: avg === null ? s.savedMs : (s.savedMs ?? 0) + avg,
  });
}

/** LAB için salt-okunur görünüm (bounded). */
export function getProbeSuppressionStates(): readonly ProbeSuppressionState[] {
  return [..._suppression.values()];
}

/** LAB için toplam tasarruf — `savedMs` hiç ölçülmediyse `null`. */
export function getProbeSuppressionSavings(): {
  readonly savedRequests: number;
  readonly savedMs: number | null;
  readonly avgProbeMs: number | null;
  readonly suppressedAddresses: number;
} {
  let req = 0; let ms: number | null = null; let addrs = 0;
  for (const s of _suppression.values()) {
    req += s.savedRequests;
    if (s.savedMs !== null) ms = (ms ?? 0) + s.savedMs;
    if (s.silentStreak >= PROBE_SILENCE_CONFIRM) addrs += 1;
  }
  return { savedRequests: req, savedMs: ms, avgProbeMs: _avgProbeMs(), suppressedAddresses: addrs };
}

/* Son planlamada bastırılan hedefler — LAB salt-okuma yüzeyi (bounded). */
let _lastSuppressed: readonly SuppressedProbeTarget[] = [];

/** Planlayıcının bastırdığı hedefleri kaydeder (yalnız gösterim). ASLA throw etmez. */
export function recordSuppressedProbes(list: readonly SuppressedProbeTarget[]): void {
  try { _lastSuppressed = [...list].slice(0, MAX_PHYSICAL_PROBES); } catch { /* yut */ }
}

/** LAB için: son planlamada merdiven yüzünden sorulMAYAN adresler. */
export function getSuppressedProbes(): readonly SuppressedProbeTarget[] {
  return [..._lastSuppressed];
}

/** Test kancası — merdiven durumu sıfırlanır. */
export function _resetProbeSuppressionForTest(): void {
  _lastSuppressed = [];
  _suppression = new Map();
  _scopeEpoch = null; _scopeProtocol = null;
  _observedProbeMsTotal = 0; _observedProbeCount = 0;
}
