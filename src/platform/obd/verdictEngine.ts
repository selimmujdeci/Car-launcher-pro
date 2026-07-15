/**
 * verdictEngine — Araç Sağlık Verdisi + Aksiyon Üretimi (OBD-OS-F4-1).
 *
 * BU KATMANIN VARLIK SEBEBİ (anayasa, "8 Kapı"): bir PID okumak veya bir DTC listelemek
 * BAŞARI DEĞİLDİR. Başarı, o sinyalden ANLAM ve KARAR üretmektir. Şimdiye kadar ürettiğimiz
 * tüm kanıtlar (DTC verdisi F0-1 · tarama kapsamı F1-4 · MIL tutarsızlığı F1-2 · çoklu-ECU
 * F2 · üretici kodları F3-1) ayrı ayrı doğruydu ama kullanıcıya TEK BİR KARAR olarak
 * sunulmuyordu. Bu modül onları birleştirir ve "ne yapmalıyım?" sorusunu yanıtlar.
 *
 * ÜÇ SÖZLEŞME:
 *
 * 1. CONFIDENCE KANITTAN TÜRER — sabit olamaz. Güven, ne kadarını GÖREBİLDİĞİMİZLE
 *    orantılıdır: kısmi tarama, düşen okuma, keşfedilmemiş ECU → güven DÜŞER. "%95 eminim"
 *    diyen ama yarısını okuyamamış bir teşhis, yalan söylüyordur.
 *
 * 2. FAIL-CLOSED — kanıt eksikse "temiz" DEME. Bulgu > belirsizlik > temiz önceliği
 *    (dtcVerdict ile aynı felsefe, burada araç geneline taşınır).
 *
 * 3. HER FINDING KANITA BAĞLI — `evidence` alanı boş olamaz. Uydurma bulgu üretmek,
 *    bulgu kaçırmaktan daha zararlıdır (kullanıcı yanlış parça değiştirir).
 *
 * SAF: modül-durumu yok, I/O yok, zaman enjekte edilir — tam test edilebilir.
 */

import type { DtcVerdictResult } from './dtcVerdict';
import type { ScanReport } from './scanReport';
import type { MultiEcuScanReport, EcuDtc } from './multiEcuScan';

export type VerdictLevel = 'not_scanned' | 'clean' | 'attention' | 'critical' | 'inconclusive';

export type FindingSource = 'standard_dtc' | 'uds_dtc' | 'mil_inconsistency' | 'scan_gap';

export interface Finding {
  id: string;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  detail: string;
  /** KANIT — boş olamaz (uydurma bulgu yasak). */
  evidence: string[];
  source: FindingSource;
}

export interface RecommendedAction {
  id: string;
  /** 1 = en acil. */
  priority: 1 | 2 | 3;
  title: string;
  /** NEDEN bu aksiyon — kanıta dayalı gerekçe (kullanıcı körü körüne uygulamasın). */
  reason: string;
}

export interface VehicleVerdict {
  level: VerdictLevel;
  /** Kullanıcıya gösterilecek tek satır. */
  headline: string;
  /**
   * 0..1 — KANITTAN türer. Ne kadarını görebildiğimizle orantılı; sabit DEĞİL.
   * Kısmi tarama / düşen okuma / keşfedilememiş ECU → düşer.
   */
  confidence: number;
  /** Neden bu güven seviyesinde olduğumuzun açık gerekçesi (şeffaflık). */
  confidenceReason: string;
  /** 0..1 — taramanın kapsamı (mod + ECU bazında). */
  coverage: number;
  findings: Finding[];
  actions: RecommendedAction[];
}

export interface VerdictEngineInput {
  /** F0-1 fail-closed DTC verdisi (motor ECU / standart modlar). */
  dtc: DtcVerdictResult;
  /** F1-4 mod bazlı tarama kapsamı. */
  scan: ScanReport;
  /** F2/F3 çoklu-ECU + UDS taraması; null = çalışmadı (tek-ECU akışı). */
  multiEcu: MultiEcuScanReport | null;
  /** Kritik sayılan DTC kodları (UI severity ile aynı kaynak). */
  criticalCodes: string[];
}

/* ── Confidence: kanıttan türeyen güven ────────────────────────────────────── */

/**
 * Güven, GÖREBİLDİĞİMİZ kadardır. Üç çarpan:
 *  - mod kapsamı (scan.coverage): standart modların kaçı okundu
 *  - ECU kapsamı: keşfedilen ECU'ların kaçı sorunsuz okundu
 *  - keşif yapıldı mı: ECU keşfi hiç çalışmadıysa araç geneli hakkında konuşamayız
 */
function computeConfidence(input: VerdictEngineInput): { value: number; reason: string } {
  const reasons: string[] = [];
  let conf = input.scan.coverage;

  if (input.scan.failedCount > 0) {
    reasons.push(`${input.scan.failedCount} standart okuma tamamlanamadı`);
  }

  const me = input.multiEcu;
  if (!me || me.topology.probedAt === null) {
    // ECU keşfi HİÇ çalışmadı → yalnız motor ECU'sunu gördük; araç geneli hakkında
    // konuşma hakkımız sınırlı. Tavan koyulur (fail-closed).
    conf = Math.min(conf, 0.6);
    reasons.push('ECU keşfi yapılamadı — yalnız motor ECU’su görüldü');
  } else if (me.topology.probeEmpty) {
    conf = Math.min(conf, 0.5);
    reasons.push('hiçbir ECU yanıt vermedi');
  } else {
    const total = me.scannedEcus;
    if (total > 0) {
      const cleanEcus = me.results.filter(
        (r) => !(r.stored === 'failed' && r.pending === 'failed' && r.permanent === 'failed'),
      ).length;
      conf *= cleanEcus / total;
      if (cleanEcus < total) reasons.push(`${total - cleanEcus} ECU okunamadı`);
    }
    if (me.skippedEcus > 0) {
      conf *= total / (total + me.skippedEcus);
      reasons.push(`${me.skippedEcus} ECU bütçe tavanı nedeniyle taranmadı`);
    }
  }

  const value = Math.max(0, Math.min(1, conf));
  const reason = reasons.length === 0
    ? 'Denetlenen tüm modlar ve ECU’lar sorunsuz okundu.'
    : `Güven düşürücü: ${reasons.join(', ')}.`;
  return { value, reason };
}

/* ── Findings: her biri kanıta bağlı ───────────────────────────────────────── */

function buildFindings(input: VerdictEngineInput): Finding[] {
  const out: Finding[] = [];
  const crit = new Set(input.criticalCodes);

  // 1) DTC bulguları (standart + UDS), provenance korunur.
  const codes: EcuDtc[] = input.multiEcu?.allCodes ?? [];
  for (const c of codes) {
    const isCritical = crit.has(c.code);
    out.push({
      id: `dtc:${c.ecuTxHeader}:${c.code}`,
      severity: isCritical ? 'critical' : 'warning',
      title: `${c.code} — ${c.ecuLabel}`,
      detail: c.fromUds
        ? 'Üretici-özel arıza kodu (standart OBD taraması bu kodu göremez).'
        : 'Standart OBD arıza kodu.',
      evidence: [
        `ECU ${c.ecuTxHeader}`,
        c.fromUds ? 'UDS 0x19 (üretici tabanı)' : `Mode ${c.mode === 'pending' ? '07' : c.mode === 'permanent' ? '0A' : '03'}`,
        ...(c.active ? ['şu anda AKTİF'] : []),
        ...(c.failureType ? [`arıza tipi ${c.failureType}`] : []),
      ],
      source: c.fromUds ? 'uds_dtc' : 'standard_dtc',
    });
  }

  // 2) MIL tutarsızlığı (F1-2) — standart tarama YETMİYOR sinyali.
  if (input.dtc.advisories.includes('mil_without_codes')) {
    out.push({
      id: 'mil_without_codes',
      severity: 'warning',
      title: 'Arıza lambası yanıyor ama standart kod yok',
      detail: 'Arıza büyük olasılıkla üretici-özel kod tabanındadır; standart tarama bunu göremez.',
      evidence: ['MIL / PID01 arıza bildiriyor', 'Mode 03/07/0A boş'],
      source: 'mil_inconsistency',
    });
  }

  // 3) Tarama boşluğu (F1-4 / F2-4) — sessiz eksiklik = yanlış güven.
  const gaps: string[] = [];
  if (input.scan.failedCount > 0) gaps.push(input.scan.summary);
  if (input.multiEcu && input.multiEcu.failedReads > 0) {
    gaps.push(`${input.multiEcu.failedReads} ECU okuması tamamlanamadı`);
  }
  if (input.multiEcu && input.multiEcu.skippedEcus > 0) {
    gaps.push(`${input.multiEcu.skippedEcus} ECU taranmadı (bütçe)`);
  }
  if (gaps.length > 0) {
    out.push({
      id: 'scan_gap',
      severity: 'info',
      title: 'Tarama kısmi — sonuç kesin değil',
      detail: 'Bazı okumalar tamamlanamadı; “sorun yok” sonucuna güvenmeyin.',
      evidence: gaps,
      source: 'scan_gap',
    });
  }

  return out;
}

/* ── Actions: "8. kapı" — en doğru aksiyon ─────────────────────────────────── */

function buildActions(level: VerdictLevel, findings: Finding[]): RecommendedAction[] {
  const out: RecommendedAction[] = [];
  const criticalDtc = findings.filter((f) => f.severity === 'critical' && f.source !== 'scan_gap');
  const udsFindings = findings.filter((f) => f.source === 'uds_dtc');
  const milGap = findings.some((f) => f.source === 'mil_inconsistency');
  const scanGap = findings.some((f) => f.source === 'scan_gap');

  if (criticalDtc.length > 0) {
    out.push({
      id: 'service_now',
      priority: 1,
      title: 'Servise başvurun',
      reason: `Kritik arıza kodu var (${criticalDtc.map((f) => f.title.split(' — ')[0]).join(', ')}). Sürüşe devam motora zarar verebilir.`,
    });
  }

  if (milGap) {
    out.push({
      id: 'manufacturer_scan',
      priority: 2,
      title: 'Üretici protokolüyle derin tarama gerekiyor',
      reason: 'Arıza lambası yanıyor ama standart modlarda kod yok — kod üretici tabanında olabilir.',
    });
  }

  if (udsFindings.length > 0) {
    out.push({
      id: 'uds_codes_found',
      priority: 2,
      title: 'Üretici-özel kodlar bulundu',
      reason: 'Bu kodlar standart OBD taramasında görünmez; servise giderken kod numaralarını iletin.',
    });
  }

  if (scanGap) {
    out.push({
      id: 'rescan',
      priority: 3,
      title: 'Taramayı tekrarlayın',
      reason: 'Bazı okumalar tamamlanamadı; kontak açıkken ve motor çalışırken tekrar deneyin.',
    });
  }

  if (level === 'clean' && out.length === 0) {
    out.push({
      id: 'no_action',
      priority: 3,
      title: 'Şu an aksiyon gerekmiyor',
      reason: 'Denetlenen tüm modlar ve ECU’lar temiz okundu.',
    });
  }

  return out.sort((a, b) => a.priority - b.priority);
}

/* ── Ana motor ─────────────────────────────────────────────────────────────── */

/**
 * Tüm teşhis kanıtlarını TEK verdi + aksiyon setine bağlar (F4-1).
 * FAIL-CLOSED: bulgu > belirsizlik > temiz.
 */
export function buildVehicleVerdict(input: VerdictEngineInput): VehicleVerdict {
  const findings = buildFindings(input);
  const { value: confidence, reason: confidenceReason } = computeConfidence(input);
  const coverage = input.scan.coverage;

  const hasCritical = findings.some((f) => f.severity === 'critical');
  const realFindings = findings.filter((f) => f.source !== 'scan_gap');
  const hasGap = findings.some((f) => f.source === 'scan_gap');

  let level: VerdictLevel;
  let headline: string;

  if (input.dtc.verdict === 'not_scanned') {
    level = 'not_scanned';
    headline = 'Tarama yapılmadı.';
  } else if (hasCritical) {
    level = 'critical';
    headline = 'Kritik arıza tespit edildi.';
  } else if (realFindings.length > 0) {
    level = 'attention';
    headline = 'Dikkat gerektiren bulgular var.';
  } else if (hasGap || input.dtc.verdict === 'inconclusive') {
    // Bulgu yok AMA her şeyi göremedik → "temiz" DEME (fail-closed).
    level = 'inconclusive';
    headline = 'Kısmi tarama — sonuç kesin değil.';
  } else {
    level = 'clean';
    headline = 'Araç sağlıklı görünüyor.';
  }

  return {
    level,
    headline,
    confidence,
    confidenceReason,
    coverage,
    findings,
    actions: buildActions(level, findings),
  };
}
