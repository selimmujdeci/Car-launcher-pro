/**
 * scanReport — Tarama Kapsamı (Scan Completeness) modeli (OBD-OS-F1-4).
 *
 * NEDEN: "SİSTEM TEMİZ" demek yetmez — kullanıcının NE KADARININ tarandığını bilmesi
 * gerekir. Mode 07 timeout verdiyse ekran "temiz" demiyor (F0-1 bunu çözdü), ama
 * kullanıcı hâlâ NEYİN eksik kaldığını göremiyordu. Bu modül taramanın kapsamını
 * ölçülebilir hale getirir: hangi mod denendi, başardı, düştü, araç desteklemiyor.
 *
 * DÜRÜST COVERAGE TANIMI: 'unsupported' (araç o modu HİÇ bilmiyor — ör. Mode 0A, 2010
 * öncesi araçlarda yok) bir KAPSAM KAYBI DEĞİLDİR; okunamayan şey değil, var olmayan
 * şeydir → paydaya girmez. Kapsam kaybı yalnız GERÇEK hatadır (timeout/hata). Aksi halde
 * eski bir araçta coverage sonsuza dek <1 kalır ve rozet anlamını yitirir (gürültü).
 *
 * SAF: modül-durumu yok, yan-etki yok — tam test edilebilir.
 */

import type { DtcScanMode } from './dtcVerdict';

/** Bir teşhis modunun tarama sonucu. */
export type ScanModeStatus = 'ok' | 'failed' | 'unsupported' | 'not_run' | 'no_response' | 'deferred';

export interface ScanModeEntry {
  mode: DtcScanMode;
  /** Kullanıcıya gösterilecek TR etiket ('Onaylı kodlar (Mode 03)'…). */
  label: string;
  status: ScanModeStatus;
}

export interface ScanReport {
  modes: ScanModeEntry[];
  /**
   * MOD kapsamı 0..1 = başarılı / (başarılı + düşen). 'unsupported' ve 'not_run'
   * paydaya GİRMEZ (bkz. dürüst coverage tanımı). Hiç mod denenmediyse 0.
   *
   * ⚠️ Bu alan YALNIZ standart modların kapsamıdır — ARAÇ kapsamı DEĞİLDİR.
   * Ürünün gösterdiği kapsam `canonicalCoverage` alanıdır (P0-OBD-FINAL-02).
   */
  coverage: number;
  /**
   * P0-OBD-FINAL-02 — KANONİK (ürün) kapsamı: mod kapsamı × ECU kapsamı.
   *
   * `null` = BİLİNMİYOR. Sahada ölçülen kusur tam olarak buydu: aynı ekranda
   * "GÜVEN %0 · 1 ECU okunamadı" ile "TARAMA KAPSAMI %100 · Tam tarama" yan
   * yana duruyordu, çünkü rozet YALNIZ mod kapsamını okuyordu ve ECU
   * adreslenebilirlik/tamlık kanıtı kararın DIŞINDAYDI. Bir sayı üretmek için
   * paydanın BİLİNMESİ şarttır; ECU keşfi koşmadıysa, oturum bayatsa ya da
   * fiziksel tamlık UNKNOWN ise sayı UYDURULMAZ → `null`.
   */
  canonicalCoverage: number | null;
  /**
   * P0-VDK-F6C — ÇARPANLARIN AÇIK HALİ (açıklanabilirlik şartı).
   *
   * Tek bir yüzde gösteren bir ürün, o yüzdenin NEREDEN geldiğini de
   * gösterebilmelidir; aksi hâlde sayı denetlenemez. Ölçülemeyen çarpan
   * `null` KALIR (sahte 1 YASAK — 1 yazmak "kayıp yok" demektir).
   */
  endpointCoverageRatio: number | null;
  /** Planlanan tanı birimlerinin kaçı terminal kanıt aldı. DTC SAYISI GİRMEZ. */
  diagnosticCoverageRatio: number | null;
  /** ECU kanıtı verildi mi (tek-ECU akışında `false`). */
  ecuEvidencePresent: boolean;
  /**
   * Kanonik kapsamı düşüren / bilinemez kılan ECU kanıt boşlukları (TR).
   * Boş dizi = ECU tarafında kapsam kaybı ölçülmedi.
   */
  ecuGaps: readonly string[];
  /**
   * `canonicalCoverage === 1` VE en az bir mod başarıyla okundu VE ECU
   * tarafında hiçbir kapsam boşluğu yok. FAIL-CLOSED: kanıt eksikse `false`.
   */
  complete: boolean;
  /** Gerçek hata/timeout ile düşen mod sayısı. */
  failedCount: number;
  /** Araç tarafından desteklenmeyen mod sayısı (kapsam kaybı DEĞİL — bilgi). */
  unsupportedCount: number;
  /**
   * P0-OBD-11 — ECU'nun SUSTUĞU mod sayısı. `failedCount` ile TOPLANMAZ:
   * "hat hatası" ile "ECU sessiz" farklı teşhislerdir.
   */
  noResponseCount: number;
  /**
   * P0-OBD-CORE-05 — admisyon kapısının ERTELEDİĞİ mod sayısı. `failedCount`
   * ile TOPLANMAZ: "denendi ve düştü" ile "hiç denenmedi" farklı teşhislerdir.
   * `unsupported`/`not_run`in AKSİNE paydaya (coverage) GİRER — deferred bir
   * kapsam kaybıdır, sonradan tekrar denenmesi gerekir (kalıcı bir gerçek DEĞİL).
   */
  deferredCount: number;
  /** UI rozeti için tek satır özet. */
  summary: string;
}

const LABELS: Record<DtcScanMode, string> = {
  stored:    'Onaylı kodlar',
  pending:   'Bekleyen kodlar',
  permanent: 'Kalıcı kodlar',
  status:    'MIL / monitörler',
};

/**
 * P0-OBD-FINAL-02 — ECU KAPSAM KANITI (YAPISAL — servis importu YOK).
 *
 * `ecuCompleteness.ts` üretir, `multiEcuScan` taşır, bu saf model yalnız OKUR.
 * İkinci bir otorite kurulmaz: alanlar `EcuCompletenessEvidence` ile BİREBİR
 * aynı adlara sahiptir; buradaki tek fark yapısal (import'suz) olmasıdır.
 */
export interface ScanEcuCoverageInput {
  /** ECU keşfi GERÇEKTEN koştu mu (`topology.probedAt !== null`). */
  readonly discoveryRan: boolean;
  /** Keşfedilen ECU adedi. */
  readonly discovered: number;
  /** Başarıyla taranan ECU adedi. */
  readonly scanned: number;
  /** Okuması düşen ECU adedi. */
  readonly failed: number;
  /** Tavan/erteleme yüzünden taranMAYAN ECU adedi. */
  readonly skipped: number;
  /** Fiziksel isteğe SUSMUŞ (ulaşılamayan) ECU adedi. */
  readonly notAddressable: number;
  /** Kanıt başka bir oturuma mı ait. */
  readonly staleSession: boolean;
  /** Gerçek ECU toplamı BİLİNİYOR mu (fonksiyonel 0100 tek başına BİLDİRMEZ). */
  readonly denominatorKnown: boolean;
  /**
   * ── P0-VDK-F6C · TANI KAPSAMI (ikinci eksen) ─────────────────────
   *
   * ÖLÇÜLEN KUSUR: bu rapora kadar üst seviye kapsam YALNIZ (a) 4 standart
   * FONKSİYONEL modun kaçı okundu ve (b) ECU'ların kaçı tarandı çarpımıydı.
   * **UDS 0x19 ve KWP 0x18/0x13 kapsamı üst seviye sayıya HİÇ GİRMİYORDU** —
   * yani üretici arıza tabanı hiç okunamamış bir araç ile tam okunmuş bir
   * araç AYNI kapsam sayısını alabiliyordu.
   *
   * VERİLMEZSE davranış BİREBİR eskisi gibidir (regresyon YOK).
   */
  readonly diagnosticPlannedUnits?: number | null;
  readonly diagnosticTerminalUnits?: number | null;
  /** Ölçülen HER uç noktanın TEMEL ekseni terminal mi. */
  readonly diagnosticCoreComplete?: boolean | null;
  /** İnsan-okur tanı kapsamı boşlukları (üst özet bunları EZER). */
  readonly diagnosticGaps?: readonly string[];
}

export interface ScanReportInput {
  /** Her mod için sonuç. Eksik bırakılan mod 'not_run' sayılır. */
  stored?: ScanModeStatus;
  pending?: ScanModeStatus;
  permanent?: ScanModeStatus;
  status?: ScanModeStatus;
  /**
   * P0-OBD-FINAL-02 — ECU kapsam kanıtı. VERİLMEZSE rapor yalnız MOD kapsamını
   * bildirir (tek-ECU akışı; `ecuEvidencePresent:false`) — ve bu durumda da
   * "araç tam tarandı" İDDİA EDİLMEZ, yalnız denetlenen modlar için konuşulur.
   */
  ecu?: ScanEcuCoverageInput;
}

/**
 * ECU kanıtından kapsam boşluklarını ve ÇARPANI çıkarır (saf).
 *
 * İki AYRI boşluk sınıfı vardır ve karıştırılmaları yasaktır:
 *  · BİLİNMEZLİK (keşif koşmadı · oturum bayat · payda bilinmiyor) → oran
 *    ÜRETİLEMEZ, `null` döner. "0" ya da "1" yazmak iki ayrı yalan olurdu.
 *  · ÖLÇÜLMÜŞ KAYIP (okunamadı · ulaşılamadı · taranmadı) → oran DÜŞER.
 */
export function evaluateEcuCoverage(e: ScanEcuCoverageInput): {
  gaps: string[]; ratio: number | null; diagnosticRatio: number | null;
} {
  const gaps: string[] = [];
  let unknown = false;

  /* ── P0-VDK-F6C · TANI KAPSAMI ÇARPANI ──────────────────────────
     UÇ NOKTA paydasından (araçta kaç ECU var?) FARKLI bir bilinebilirliği
     vardır: tanı paydası BİZİM KENDİ PLANIMIZDIR ve TAM OLARAK BİLİNİR.
     Bu yüzden uç nokta oranı `null` olsa bile tanı oranı üretilebilir. */
  const dPlanned = e.diagnosticPlannedUnits;
  const dTerminal = e.diagnosticTerminalUnits;
  const diagnosticRatio =
    typeof dPlanned === 'number' && dPlanned > 0
    && typeof dTerminal === 'number' && dTerminal >= 0
      ? Math.min(1, dTerminal / dPlanned)
      : null;
  for (const g of e.diagnosticGaps ?? []) gaps.push(g);
  if (e.diagnosticCoreComplete === false) {
    gaps.push('tanı kapsamı TAM DEĞİL — en az bir uç noktanın arıza hafızası okunamadı');
  }

  if (!e.discoveryRan) { gaps.push('ECU keşfi çalışmadı — araç geneli BİLİNMİYOR'); unknown = true; }
  if (e.staleSession)  { gaps.push('ECU kanıtı BAŞKA oturuma ait (bayat)'); unknown = true; }
  if (e.discoveryRan && !e.denominatorKnown) {
    gaps.push('araçtaki gerçek ECU sayısı BİLİNMİYOR — fiziksel tamlık UNKNOWN');
    unknown = true;
  }
  if (e.notAddressable > 0) gaps.push(`${e.notAddressable} ECU ULAŞILAMADI (fiziksel istek yanıtsız)`);
  if (e.failed > 0)         gaps.push(`${e.failed} ECU okunamadı`);
  if (e.skipped > 0)        gaps.push(`${e.skipped} ECU taranmadı`);

  if (unknown) return { gaps, ratio: null, diagnosticRatio };

  const denom = e.scanned + e.failed + e.skipped + e.notAddressable;
  if (denom === 0) {
    /* Keşif koştu, payda biliniyor ama TEK ECU bile ölçülmedi → oran yok. */
    gaps.push('hiçbir ECU ölçülmedi');
    return { gaps, ratio: null, diagnosticRatio };
  }
  return { gaps, ratio: e.scanned / denom, diagnosticRatio };
}

/**
 * Tarama kapsam raporu üretir (saf).
 * Kabul kriteri (F1-4): kısmi taramada coverage < 1 raporlanır.
 */
export function buildScanReport(input: ScanReportInput): ScanReport {
  const order: DtcScanMode[] = ['stored', 'pending', 'permanent', 'status'];
  const modes: ScanModeEntry[] = order.map((mode) => ({
    mode,
    label: LABELS[mode],
    status: input[mode] ?? 'not_run',
  }));

  const ok = modes.filter((m) => m.status === 'ok').length;
  const failed = modes.filter((m) => m.status === 'failed').length;
  const unsupported = modes.filter((m) => m.status === 'unsupported').length;
  /* P0-OBD-11 — ECU'nun SUSTUĞU (NO DATA / timeout) mod sayısı. Bu bir KAPSAM
     KAYBIDIR: `unsupported` gibi paydadan DÜŞMEZ. "Araç bu servisi bilmiyor"
     ölçülmüş bir gerçektir; "ECU cevap vermedi" ise ölçüm YOKLUĞUDUR ve
     kapsamı %100 göstermek tam olarak sahadaki yalanı üretir. */
  const noResponse = modes.filter((m) => m.status === 'no_response').length;
  /* P0-OBD-CORE-05 — admisyon kapısının ERTELEDİĞİ mod sayısı (bkz. arayüz
     yorumu: `unsupported`/`not_run`in AKSİNE paydaya GİRER — "hiç sorulmadı,
     araç bilmiyor diye değil oturum hazır olmadığı için" kalıcı bir kapsam
     kaybıdır, sonradan tekrar denenmelidir). */
  const deferred = modes.filter((m) => m.status === 'deferred').length;

  const denom = ok + failed + noResponse + deferred;
  const coverage = denom === 0 ? 0 : ok / denom;

  /* P0-OBD-FINAL-02 — KANONİK KAPSAM: mod kapsamı ARTIK TEK BAŞINA HÜKÜM DEĞİL.
     Saha (2026-08-25, Protocol 5 / KWP, ECU 7A): mod kapsamı %100 çıkarken aynı
     turda 1 ECU okunamamıştı ve fiziksel `817AF1` susuyordu. Rozet "Tam tarama"
     derken hüküm motoru "GÜVEN %0" diyordu — ikisi de AYNI ekrandaydı. Kapsam
     kararı artık ECU kanıtını İÇERİR; ECU kanıtı bilinmiyorsa sayı ÜRETİLMEZ. */
  const ecu = input.ecu;
  const ecuEval = ecu ? evaluateEcuCoverage(ecu) : null;
  const ecuGaps: readonly string[] = ecuEval ? ecuEval.gaps : [];

  /* ── P0-VDK-F6C · KANONİK KAPSAM ARTIK ÜÇ ÇARPANDIR ───────────────
        mod kapsamı  ×  uç nokta kapsamı  ×  TANI kapsamı

     Üçüncü çarpan bu turda EKLENDİ. Onsuz, üretici arıza tabanı (UDS 0x19 /
     KWP 0x18-0x13) hiç okunamamış bir araç ile tam okunmuş bir araç AYNI
     kapsam sayısını alabiliyordu — çünkü üst seviye sayı yalnız 4 standart
     FONKSİYONEL modu biliyordu.

     FAIL-CLOSED (değişmedi): ölçülemeyen ÇARPAN varsa sonuç `null`dır.
     `undefined` (çağıran bildirmedi) ile `null` (ölçülemedi) AYRI: bildirmeyen
     çağıranın davranışı BİREBİR eskisi gibidir. */
  const diagnosticRatio = ecuEval?.diagnosticRatio ?? null;
  const diagnosticReported = ecu?.diagnosticPlannedUnits !== undefined
    && ecu?.diagnosticPlannedUnits !== null;

  let canonicalCoverage: number | null;
  if (ecuEval === null) {
    canonicalCoverage = coverage;
  } else if (ecuEval.ratio === null) {
    canonicalCoverage = null;
  } else if (!diagnosticReported) {
    canonicalCoverage = coverage * ecuEval.ratio;
  } else {
    canonicalCoverage = diagnosticRatio === null
      ? null
      : coverage * ecuEval.ratio * diagnosticRatio;
  }

  /* `complete` KAPSAM İDDİASIDIR ve artık tanı eksenini de ŞART KOŞAR:
     uç noktaların hepsi taranmış olsa bile bir ECU'nun arıza hafızası
     okunamadıysa "tam tarama" demek, tam olarak bu turun kapattığı yalan. */
  const complete = canonicalCoverage === 1 && ok > 0 && ecuGaps.length === 0
    && (!diagnosticReported || ecu?.diagnosticCoreComplete === true);

  let summary: string;
  if (ok === 0 && failed === 0 && noResponse === 0 && deferred === 0) {
    summary = 'Tarama yapılmadı.';
  } else if (deferred > 0 && ok === 0 && failed === 0 && noResponse === 0) {
    /* SAHA KANITI (P0-OBD-CORE-05): recovery/reconnect sürerken hiçbir sorgu
       gönderilmedi — bu bir HATA DEĞİLDİR, oturum hazır olunca tekrar denenir. */
    const defLabels = modes.filter((m) => m.status === 'deferred').map((m) => m.label).join(', ');
    summary = `Tarama ertelendi (${defLabels}) — oturum hazır değildi (kurtarma/yeniden bağlanma sürüyor).`;
  } else if (noResponse > 0 && ok === 0) {
    /* Hiçbir servisten yanıt yok → sonuç BİLİNMİYOR. "Temiz" DEĞİL. */
    const nrLabels = modes.filter((m) => m.status === 'no_response').map((m) => m.label).join(', ');
    summary = `ECU yanıt vermedi (${nrLabels}) — sonuç bilinmiyor, tarama geçersiz.`;
  } else if (noResponse > 0) {
    const nrLabels = modes.filter((m) => m.status === 'no_response').map((m) => m.label).join(', ');
    const failedLabels = modes.filter((m) => m.status === 'failed').map((m) => m.label).join(', ');
    summary = `Eksik tarama — ECU yanıt vermedi: ${nrLabels}.`
      + (failedLabels ? ` Okunamadı: ${failedLabels}.` : '');
  } else if (failed > 0) {
    const failedLabels = modes.filter((m) => m.status === 'failed').map((m) => m.label).join(', ');
    summary = `Kısmi tarama — okunamadı: ${failedLabels}.`;
  } else if (deferred > 0) {
    const defLabels = modes.filter((m) => m.status === 'deferred').map((m) => m.label).join(', ');
    summary = `Kısmi tarama — ertelendi: ${defLabels} (oturum hazır değildi).`;
  } else if (unsupported > 0) {
    const unsupLabels = modes.filter((m) => m.status === 'unsupported').map((m) => m.label).join(', ');
    summary = `Tam tarama — araç şunları desteklemiyor: ${unsupLabels}.`;
  } else {
    summary = 'Tam tarama — denetlenen tüm modlar okundu.';
  }

  /* ── ECU KANITI ÖZETİ EZER (fail-closed) ────────────────────────────────
     Mod özeti "Tam tarama" diyorsa ve ECU tarafında ÖLÇÜLMÜŞ bir boşluk varsa,
     o cümle SAHADAKİ YALANIN TA KENDİSİDİR. Bu yüzden metin burada yeniden
     yazılır; sessizce yanına not düşülmez. */
  if (ecuGaps.length > 0) {
    const head = canonicalCoverage === null
      ? 'Tarama kapsamı BİLİNMİYOR'
      : 'Kısmi tarama';
    summary = `${head} — ECU kanıtı: ${ecuGaps.join('; ')}.`
      + (ok > 0 ? ` Denetlenen standart modlar: ${modes.filter((m) => m.status === 'ok').map((m) => m.label).join(', ')}.` : '')
      + (failed > 0 || noResponse > 0 || deferred > 0 ? ` ${summary}` : '');
  }

  return {
    modes, coverage, canonicalCoverage,
    endpointCoverageRatio: ecuEval?.ratio ?? null,
    diagnosticCoverageRatio: diagnosticRatio,
    ecuEvidencePresent: ecuEval !== null,
    ecuGaps,
    complete,
    failedCount: failed, unsupportedCount: unsupported, noResponseCount: noResponse,
    deferredCount: deferred,
    summary,
  };
}
