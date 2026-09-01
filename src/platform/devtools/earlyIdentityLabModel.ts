/**
 * earlyIdentityLabModel — CAROS LAB · Erken Araç Kimliği SAF model katmanı.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Sınıflandırma `sessionInspectorModel` sözleşmesini KULLANIR — paralel sistem YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── EN ÖNEMLİ KURAL: DÖRT "YOK" BİRBİRİNDEN AYRIDIR ───────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   KAYNAK YOK   → erken kimlik HİÇ değerlendirilmedi (ölçüm yok)
 *   DENENMEDİ    → değerlendirildi ama yapısal ön koşul yoktu (hatta bayt çıkmadı)
 *   BAŞARISIZ    → denendi, deterministik sonuç alınamadı
 *   BAŞARILI     → ölçüldü ve bağlam bağlandı
 * Bu dördü aynı hücrede gösterilirse ekran yalan söyler.
 */

import {
  observed, derived, unavailable, type InspectorField,
} from './sessionInspectorModel';
import type { EarlyIdentityRawSnapshot } from './earlyIdentitySources';
import {
  DID_PROBE_VERDICT_LABEL, EARLY_IDENTITY_ADMISSION_LABEL,
  EARLY_IDENTITY_DID_ORDER, IDENTITY_RELATION_LABEL,
} from '../obd/identity/earlyIdentityModel';
import { EARLY_IDENTITY_ACTIVATION_LABEL } from '../obd/identity/earlyVehicleIdentity';
import {
  VEHICLE_IDENTITY_AXIS_LABEL,
} from '../obd/capability/capabilityFingerprint';
import { GAP_LEDGER_SCOPE_LABEL } from '../obd/gapLedgerScope';

const SRC = 'obd/identity/earlyVehicleIdentity';

export type EarlyIdentityCardId =
  | 'gate' | 'probe' | 'evidence' | 'fingerprint' | 'activation' | 'reconcile';

export const EARLY_IDENTITY_CARD_ORDER: readonly EarlyIdentityCardId[] =
  ['gate', 'probe', 'evidence', 'fingerprint', 'activation', 'reconcile'] as const;

export const EARLY_IDENTITY_CARD_TITLE:
Readonly<Record<EarlyIdentityCardId, string>> = {
  gate:        '1 · Kapı ve Ön Koşullar',
  probe:       '2 · DID Yoklamaları',
  evidence:    '3 · Kalibrasyon Kanıtı',
  fingerprint: '4 · Parmak İzi (F4-C)',
  activation:  '5 · Araç Bağlamı ve Hydrate',
  reconcile:   '6 · Tam Tarama Uzlaştırması',
} as const;

export interface EarlyIdentityCard {
  readonly id: EarlyIdentityCardId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

/* ══════════════════════════════════════════════════════════════════════════
   1) TUR HÜKMÜ
   ══════════════════════════════════════════════════════════════════════════ */

export type EarlyIdentityVerdict =
  | 'NEVER_EVALUATED' | 'BLOCKED' | 'DEFERRED' | 'UNAVAILABLE'
  | 'WEAK' | 'CONFLICT' | 'IDENTIFIED';

export const EARLY_IDENTITY_VERDICT_LABEL:
Readonly<Record<EarlyIdentityVerdict, string>> = {
  NEVER_EVALUATED: 'HİÇ DEĞERLENDİRİLMEDİ — ölçüm yok, "başarısız" DEĞİL',
  BLOCKED:         'ENGELLENDİ — yapısal ön koşul yok, hatta tek bayt çıkmadı',
  DEFERRED:        'ERTELENDİ — bütçe/oturum; bir sonraki fırsatta denenir',
  UNAVAILABLE:     'ÖLÇÜLEMEDİ — deterministik sonuç alınamadı',
  WEAK:            'ZAYIF KİMLİK — kalıcı bölüm AÇILMADI (bellek içi)',
  CONFLICT:        'ÇELİŞKİ — kalıcılık DONDURULDU, bölüm BİRLEŞTİRİLMEDİ',
  IDENTIFIED:      'KİMLİK ÖLÇÜLDÜ — araç bağlamı ERKEN bağlandı',
} as const;

export interface EarlyIdentityVerdictResult {
  readonly status: EarlyIdentityVerdict;
  readonly reasons: readonly string[];
}

export function deriveEarlyIdentityVerdict(
  s: EarlyIdentityRawSnapshot,
): EarlyIdentityVerdictResult {
  const reasons: string[] = [];
  const last = s.last;
  if (s.everEvaluated !== true || last === null) {
    reasons.push('Erken kimlik turu bu oturumda hiç değerlendirilmedi.');
    reasons.push('Bu bir BAŞARISIZLIK DEĞİLDİR — ölçüm yokluğudur.');
    return { status: 'NEVER_EVALUATED', reasons };
  }
  if (s.reconciliation?.relation === 'CONFLICT') {
    reasons.push(s.reconciliation.reason);
    reasons.push('İki aracı birleştirmektense iki bölüm bırakılır (fail-closed).');
    return { status: 'CONFLICT', reasons };
  }
  switch (last.outcome) {
    case 'EARLY_IDENTITY_BLOCKED':
      reasons.push(last.reason);
      reasons.push('Hiçbir istek gönderilmedi; araç hakkında hüküm ÜRETİLMEDİ.');
      return { status: 'BLOCKED', reasons };
    case 'EARLY_IDENTITY_DEFERRED':
      reasons.push(last.reason);
      if (last.sessionRequired) {
        reasons.push('ECU oturum ailesi NRC döndürdü — kör `10 xx` GÖNDERİLMEZ.');
      }
      return { status: 'DEFERRED', reasons };
    case 'EARLY_IDENTITY_UNAVAILABLE':
      reasons.push('Aday DID\'lerin hiçbiri deterministik kimlik değeri vermedi.');
      reasons.push('Sessizlik/zaman aşımı bir araç beyanı DEĞİLDİR.');
      return { status: 'UNAVAILABLE', reasons };
    case 'EARLY_IDENTITY_WEAK':
      reasons.push('Kalibrasyon ölçüldü ama F4-C yeniden kullanıma YETMEDİ.');
      reasons.push('Zayıf kimlik başka aracın geçmişini YÜKLEYEMEZ.');
      return { status: 'WEAK', reasons };
    default:
      reasons.push(`Kimlik ${last.calibrationDid ?? '—'} DID'inden ölçüldü.`);
      if (last.calibrationDiscrimination === 'VARIANT') {
        reasons.push('AYRIM GÜCÜ VARYANT SEVİYESİNDE: aynı model iki araç '
          + 'bu değerde AYNI olabilir (filo riski — kütükte açık borç).');
      }
      reasons.push(`Bağlam: ${EARLY_IDENTITY_ACTIVATION_LABEL[last.activation]}.`);
      return { status: 'IDENTIFIED', reasons };
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KARTLAR
   ══════════════════════════════════════════════════════════════════════════ */

function _f(id: string, label: string, note: string, value: unknown): InspectorField {
  return value === null || value === undefined
    ? unavailable({ id, label, source: SRC, note }, `${note} · ölçüm yok.`)
    : observed({ id, label, source: SRC, note }, value);
}

export function buildEarlyIdentityCards(
  s: EarlyIdentityRawSnapshot,
): readonly EarlyIdentityCard[] {
  const last = s.last;
  const evaluated = s.everEvaluated === true && last !== null;

  /* ── 1) KAPI ────────────────────────────────────────────────────────── */
  const gate: InspectorField[] = [
    _f('attempted', 'değerlendirildi mi',
      'DENENMEDİ ile KAYNAK YOK aynı şey değildir.',
      s.everEvaluated === null ? null : (s.everEvaluated ? 'EVET' : 'HAYIR')),
    _f('admission', 'admisyon',
      'F1-A/diagnosticAdmission kararı — kural burada kopyalanmaz.',
      evaluated ? EARLY_IDENTITY_ADMISSION_LABEL[last.admission] : null),
    _f('reason', 'gerekçe', 'Sessiz ret YASAK.', evaluated ? last.reason : null),
    _f('bridge', 'genel PDU köprüsü',
      'Köprü yoksa bu ARAÇ kararı DEĞİL, bizim sınırımızdır.',
      s.bridgeAvailable === null ? null : (s.bridgeAvailable ? 'VAR' : 'YOK')),
    _f('protocol', 'aktif protokol',
      'ATDPN ölçümü; bilinmiyorsa kimlik turu açılmaz.', s.protocol),
    _f('protocol-class', 'protokol sınıfı',
      '0x22 DID yolu YALNIZ CAN sınıfında tanımlıdır (KWP LID repoda TANIMSIZ).',
      s.protocolClass),
    _f('target', 'hedef ECU',
      'Adres UYDURULMAZ: hedef mevcut keşfin ölçtüğü ECU\'dur.',
      evaluated && last.targetRx !== null
        ? `${last.targetTx ?? '—'} → ${last.targetRx}` : null),
  ];

  /* ── 2) YOKLAMALAR ──────────────────────────────────────────────────── */
  const candidateList = EARLY_IDENTITY_DID_ORDER
    .map((d) => `${d.did} (${d.name})`).join(' · ');
  const probe: InspectorField[] = [
    derived({
      id: 'candidates', label: 'aday DID sırası', source: SRC,
      note: 'Hepsi ISO 14229-1 ve hepsi bu repoda ZATEN tanımlı — sihirli OEM listesi YOK.',
    }, candidateList),
    _f('requests', 'gönderilen istek',
      'Hatta GERÇEKTEN çıkan istek sayısı (tavan: aday sayısı).',
      evaluated ? last.requestsUsed : null),
    _f('latency', 'toplam RTT (ms)',
      'Ölçülmediyse sahte 0 YAZILMAZ.',
      evaluated ? last.totalLatencyMs : null),
    ...(evaluated && last.probes.length > 0
      ? last.probes.map((p) => observed({
        id: `probe-${p.did}`, label: `${p.did} · ${p.request ?? '—'}`, source: SRC,
        note: `${p.sent ? 'gönderildi' : 'GÖNDERİLMEDİ'}`
          + `${p.nrc === null ? '' : ` · NRC 0x${p.nrc.toString(16).toUpperCase()}`}`
          + `${p.latencyMs === null ? '' : ` · ${p.latencyMs}ms`}`
          + ` · gövde ${p.valueHexLength} hex hane (İÇERİK TAŞINMAZ)`,
      }, DID_PROBE_VERDICT_LABEL[p.verdict]))
      : [unavailable({
        id: 'no-probe', label: 'yoklama', source: SRC,
        note: 'Hiç istek gönderilmedi — bu bir ölçüm yokluğudur.',
      })]),
  ];

  /* ── 3) KALİBRASYON KANITI ──────────────────────────────────────────── */
  const evidence: InspectorField[] = [
    _f('cal-measured', 'kalibrasyon karması ölçüldü mü',
      'Karma ÖLÇÜLDÜ demek; DEĞER burada YOKTUR.',
      evaluated ? (last.calibrationMeasured ? 'EVET' : 'HAYIR') : null),
    _f('cal-did', 'kimliği üreten DID',
      'Hangi DID kimliği ürettiyse parmak izi ona bağlıdır.',
      evaluated ? last.calibrationDid : null),
    _f('cal-disc', 'ayrım gücü',
      'INSTANCE = fiziksel aracı ayırır · VARIANT = aynı modelde AYNI olabilir.',
      evaluated ? last.calibrationDiscrimination : null),
    observed({
      id: 'raw-persisted', label: 'ham kalibrasyon kalıcı yazıldı mı', source: SRC,
      note: 'YAPISAL SABİT: ham değer karma alındıktan sonra atılır; kalıcı '
        + 'bölüm/katalog/sicil/iz export\'una GİRMEZ.',
    }, 'HAYIR'),
    _f('session-required', 'oturum gerekli mi',
      'F5-C deriveSessionRequirement kanıtı (7E·7F·22·24).',
      evaluated ? (last.sessionRequired ? 'EVET' : 'HAYIR') : null),
    observed({
      id: 'session-opened', label: 'oturum açıldı mı', source: SRC,
      note: 'Bu turda `10 xx` gönderen tek satır YOKTUR; SecurityAccess de YOK.',
    }, 'HAYIR — kör oturum komutu gönderilmez'),
  ];

  /* ── 4) PARMAK İZİ ──────────────────────────────────────────────────── */
  const fingerprint: InspectorField[] = [
    _f('axes', 'ölçülen eksenler',
      'F4-C `measuredAxes` — güven bundan türer, uydurulmaz.',
      evaluated && last.measuredAxes !== null
        ? last.measuredAxes.map((a) => VEHICLE_IDENTITY_AXIS_LABEL[a]).join(' · ')
        : null),
    _f('confidence', 'güven',
      'F4-C: ölçülen eksen / toplam eksen. Erken turda yanıt imzası YOKTUR.',
      evaluated && last.confidence !== null ? last.confidence.toFixed(2) : null),
    _f('reusable', 'yeniden kullanılabilir mi',
      'Karar F4-C `isFingerprintReusable`ındır — burada yeniden hesaplanmaz.',
      evaluated && last.reusable !== null
        ? (last.reusable ? 'EVET' : 'HAYIR') : null),
    _f('vehicle-ref', 'araç kimliği (karma)',
      'Geri döndürülemez `fingerprintHash` çıktısı — ham VIN/MAC İÇERMEZ.',
      evaluated ? last.vehicleRef : null),
    _f('anchor', 'aktif bağlantı noktası',
      'Oturum mührü değişirse anchor OTOMATİK geçersizdir.',
      s.anchor === null ? null : `${s.anchor.vehicleRef} · mühür ${s.anchor.sessionEpoch}`),
  ];

  /* ── 5) BAĞLAM + HYDRATE ────────────────────────────────────────────── */
  const activation: InspectorField[] = [
    _f('activation', 'bağlam aktivasyonu',
      'F5-G `activateVehicleDiagnosticContext` TEK bağlama noktasıdır.',
      evaluated ? EARLY_IDENTITY_ACTIVATION_LABEL[last.activation] : null),
    _f('scope', 'boşluk sicili kapsamı',
      'Zayıf kimlik ve replay ürün bölümü AÇAMAZ.',
      evaluated && last.scopeState !== null
        ? GAP_LEDGER_SCOPE_LABEL[last.scopeState] : null),
    _f('cap-scope', 'yetenek deposu kapsamı',
      'PARİTE: iki depo AYNI araca bakmalıdır (F5-G invaryantı).',
      s.capabilityScope === null
        ? null : GAP_LEDGER_SCOPE_LABEL[s.capabilityScope.state]),
    _f('parity', 'bölüm paritesi',
      'Boşluk sicili ve yetenek deposu aynı araç referansında mı.',
      evaluated && s.capabilityScope !== null && last.vehicleRef !== null
        ? (s.capabilityScope.vehicleRef === last.vehicleRef
          ? 'EŞİT' : 'AYRIŞTI — fail-closed incelenmeli')
        : null),
    _f('gap-hydrated', 'hydrate edilen boşluk kaydı',
      'Tam tarama BEKLENMEDEN yüklenen sicil satırı sayısı.',
      evaluated ? last.hydratedGapEntries : null),
    _f('cap-hydrated', 'hydrate edilen yetenek kenarı',
      'Tam tarama BEKLENMEDEN yüklenen öğrenme kenarı sayısı.',
      evaluated ? last.hydratedCapabilityEdges : null),
  ];

  /* ── 6) UZLAŞTIRMA ──────────────────────────────────────────────────── */
  const rec = s.reconciliation;
  const reconcile: InspectorField[] = [
    rec === null
      ? unavailable({
        id: 'relation', label: 'erken ↔ tam tarama ilişkisi', source: SRC,
        note: 'Tam tarama bu oturumda henüz uzlaştırma sormadı — '
          + '"ilişki yok" DEĞİL, "sorulmadı".',
      })
      : rec.relation === null
        ? unavailable({
          id: 'relation', label: 'erken ↔ tam tarama ilişkisi', source: SRC,
          note: rec.reason,
        })
        : observed({
          id: 'relation', label: 'erken ↔ tam tarama ilişkisi', source: SRC,
          note: rec.reason,
        }, IDENTITY_RELATION_LABEL[rec.relation]),
    _f('reverified', 'ortak kanıt yeniden ölçüldü mü',
      'Protokol/adres/bitmap benzerliği birleştirme kanıtı DEĞİLDİR.',
      rec === null ? null : (rec.reverified ? 'EVET' : 'HAYIR')),
    _f('adopted', 'bağlı kalınan kimlik',
      'Çelişkide `null` — kanıtsız migration YOK.',
      rec === null ? null : (rec.adoptedRef ?? 'YOK (çelişki/kanıtsız)')),
    _f('frozen', 'kalıcılık donduruldu mu',
      'Yanlış iki aracı birleştirmek, iki bölüm bırakmaktan KÖTÜDÜR.',
      rec === null ? null : (rec.persistenceFrozen ? 'EVET' : 'HAYIR')),
  ];

  return [
    { id: 'gate', title: EARLY_IDENTITY_CARD_TITLE.gate, fields: gate },
    { id: 'probe', title: EARLY_IDENTITY_CARD_TITLE.probe, fields: probe },
    { id: 'evidence', title: EARLY_IDENTITY_CARD_TITLE.evidence, fields: evidence },
    { id: 'fingerprint', title: EARLY_IDENTITY_CARD_TITLE.fingerprint, fields: fingerprint },
    { id: 'activation', title: EARLY_IDENTITY_CARD_TITLE.activation, fields: activation },
    { id: 'reconcile', title: EARLY_IDENTITY_CARD_TITLE.reconcile, fields: reconcile },
  ];
}

export function countByEarlyIdentityClass(
  cards: readonly EarlyIdentityCard[],
): Readonly<Record<'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE', number>> {
  const out = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  for (const c of cards) for (const f of c.fields) out[f.klass]++;
  return out;
}
