/**
 * gapResolverModel — CAROS LAB · Self-Healing / Gap Resolver SAF model katmanı.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Sınıflandırma `sessionInspectorModel` sözleşmesini KULLANIR — paralel sistem YOK.
 *
 * ⚠️ EN ÖNEMLİ KURAL — İKİ FARKLI "SIFIR" ASLA KARIŞTIRILMAZ:
 *   · Çözücü HİÇ koşmadıysa  → `KAYNAK YOK` (ölçüm YOKLUĞU).
 *   · Çözücü koştu ve açık boşluk gerçekten 0 ise → `AÇIK GAP 0 — ÖLÇÜLDÜ`.
 * Bunları aynı `0` ile göstermek, ölçülmemiş bir sistemi sağlıklı ilan etmektir.
 */

import {
  observed, derived, unavailable, type InspectorField,
} from './sessionInspectorModel';
import type { GapResolverRawSnapshot } from './gapResolverSources';
import {
  GAP_LIFECYCLE_LABEL, GAP_ORIGIN_LABEL, ROOT_CAUSE_LABEL,
} from '../obd/healing/gapModel';
/* P0-VDK-F5D — kanıt bağı sözlüğü; paralel sınıflandırma KURULMAZ. */
import {
  GAP_EVIDENCE_STATE_LABEL, type GapEvidenceState,
} from '../obd/gapEvidence';
import type { GapEntry } from '../obd/gapRegistry';
/* P0-VDK-F5E — kalıcılık/saklama sözlüğü; paralel sözlük KURULMAZ. */
import { STORE_HEALTH_LABEL } from '../obd/capability/capabilityStore';
import {
  GAP_EVICTION_REASON_LABEL, type GapEvictionReason,
} from '../obd/gapRetentionPolicy';
/* P0-VDK-F5F — araç kapsamı sözlüğü; paralel sözlük KURULMAZ. */
import {
  GAP_LEDGER_SCOPE_LABEL, LEGACY_UNSCOPED_POLICY_LABEL,
} from '../obd/gapLedgerScope';
import { CANDIDATE_LABEL } from '../obd/healing/resolutionPolicy';
import {
  HEALING_ADMISSION_LABEL, HEALING_TRIGGER_LABEL,
} from '../obd/healing/selfHealingTrigger';
import { DISCOVERY_ADMISSION_LABEL } from '../obd/healing/productionDiscovery';
import {
  SESSION_EVIDENCE_LABEL, SESSION_OPEN_LABEL,
} from '../obd/healing/sessionHealing';

const SRC = 'obd/healing/gapResolverRuntime';

/** `FieldInput` kurucusu — `note` zorunlu alandır, sessizce atlanmaz. */
const F = (id: string, label: string, source: string = SRC, note = '') =>
  ({ id, label, source, note });

/* ══════════════════════════════════════════════════════════════════════════
   1) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

export type ResolverVerdict =
  | 'NEVER_RAN' | 'NO_GAPS_MEASURED' | 'ACTIVE' | 'ALL_BLOCKED' | 'EXHAUSTED_ONLY';

export const RESOLVER_VERDICT_LABEL: Readonly<Record<ResolverVerdict, string>> = {
  NEVER_RAN:        'KAYNAK YOK — çözücü hiç koşmadı',
  NO_GAPS_MEASURED: 'AÇIK GAP 0 — ÖLÇÜLDÜ',
  ACTIVE:           'AÇIK BOŞLUK VAR — ölçüm sürüyor',
  ALL_BLOCKED:      'TÜM BOŞLUKLAR ENGELLİ — güvenli ölçümün ön koşulu yok',
  EXHAUSTED_ONLY:   'TÜKENDİ — yeni canlı kanıt olmadan tekrar YOK',
} as const;

export interface ResolverVerdictResult {
  readonly status: ResolverVerdict;
  readonly reasons: readonly string[];
}

export function deriveResolverVerdict(
  s: GapResolverRawSnapshot,
): ResolverVerdictResult {
  const reasons: string[] = [];
  const sum = s.summary;

  if (sum === null || sum.neverRan) {
    reasons.push('Bu cihazda tek bir çözüm turu bile koşmadı.');
    reasons.push('Sayaçlar `0` DEĞİL `KAYNAK YOK` gösterir — ölçülmemiş sistem sağlıklı SAYILMAZ.');
    return { status: 'NEVER_RAN', reasons };
  }
  if (sum.total === 0) {
    reasons.push('Çözücü koştu ve çözülebilir tek bir boşluk BULUNMADI.');
    reasons.push('Bu bir ÖLÇÜM sonucudur, ölçüm yokluğu değildir.');
    return { status: 'NO_GAPS_MEASURED', reasons };
  }
  const live = sum.open + sum.inProgress;
  if (live === 0 && sum.exhausted > 0 && sum.blocked === 0) {
    reasons.push(`${sum.exhausted} boşluk aynı yolu aynı sonuçla tüketti.`);
    reasons.push('Yeni CANLI kanıt gelmeden otomatik yeniden başlamaz.');
    return { status: 'EXHAUSTED_ONLY', reasons };
  }
  if (live === 0 && sum.blocked > 0) {
    reasons.push(`${sum.blocked} boşlukta güvenli ölçümün ön koşulu sağlanmıyor.`);
    reasons.push('Ön koşul olmadan ölçüm ZORLANMAZ — israf ve risk üretir.');
    return { status: 'ALL_BLOCKED', reasons };
  }
  reasons.push(`${sum.open} açık · ${sum.inProgress} ölçülüyor · ${sum.resolved} kapandı.`);
  if (sum.exhausted > 0) reasons.push(`${sum.exhausted} boşluk tükendi.`);
  return { status: 'ACTIVE', reasons };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KARTLAR
   ══════════════════════════════════════════════════════════════════════════ */

export type ResolverCardId = 'vehicle' | 'discovery' | 'trigger' | 'session'
  | 'run' | 'inputs' | 'evidence' | 'persistence' | 'lifecycle' | 'budget' | 'impact';

export const RESOLVER_CARD_ORDER: readonly ResolverCardId[] =
  ['vehicle', 'discovery', 'trigger', 'session', 'run', 'inputs', 'evidence',
    'persistence', 'lifecycle', 'budget', 'impact'] as const;

export const RESOLVER_CARD_TITLE: Readonly<Record<ResolverCardId, string>> = {
  vehicle:     '1 · Aktif Araç Kapsamı (F5-F)',
  discovery:   '2 · Üretim Servis Keşfi',
  trigger:     '3 · Self-Healing Tetiği',
  session:     '4 · Oturum-Koşullu İyileştirme',
  run:         '5 · Çözüm Turu',
  inputs:      '6 · Boşluk Girdileri',
  evidence:    '7 · Kanıt Bağı (F5-D)',
  persistence: '8 · Kalıcılık ve Saklama (F5-E)',
  lifecycle:   '9 · Yaşam Döngüsü',
  budget:      '10 · Bütçe ve Anti-Döngü',
  impact:      '11 · Yetenek Çizgesi Etkisi',
} as const;

export interface ResolverCard {
  readonly id: ResolverCardId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

/**
 * P0-VDK-F5G — BOŞLUK SİCİLİ ↔ YETENEK ÖĞRENMESİ araç paritesi.
 *
 * İki depo AYNI araca bakmak ZORUNDADIR. Biri Araç A'da biri Araç B'de
 * kalırsa Self-Healing bir aracın boşluğunu başka bir aracın öğrenmesiyle
 * yorumlar. Bu yüzden hüküm FAIL-CLOSED yazılır.
 */
function _parityField(
  gapRef: string | null, capRef: string | null,
): InspectorField {
  const f = F('vparity', 'Sicil ↔ öğrenme araç paritesi', 'obd/vehicleDiagnosticContext');
  if (gapRef === null && capRef === null) {
    return unavailable(f, 'İki depo da bir araca bağlı DEĞİL — parite ölçülemez.');
  }
  if (gapRef === capRef) return observed(f, `PARİTE SAĞLAM (${gapRef})`);
  return unavailable(f,
    `PARİTE BOZUK — sicil ${gapRef ?? 'YOK'} · öğrenme ${capRef ?? 'YOK'}. `
    + 'İki depo farklı araca bakıyor; bu bir uyarı değil ARIZADIR.');
}

/**
 * P0-VDK-F5E — kota/tavan gerekçelerinin dağılımı.
 *
 * Kayıt HİÇ düşürülmediyse bu bir ÖLÇÜMDÜR (`0`), eksik veri değil; ama
 * dağılım hiç okunamadıysa `KAYNAK YOK` gösterilir.
 */
function _reasonField(
  reasons: Readonly<Record<string, number>> | null | undefined,
): InspectorField {
  const f = F('psreasons', 'Kota/tavan gerekçe dağılımı', 'obd/gapRetentionPolicy');
  if (reasons == null) return unavailable(f, 'Sayaç okunamadı.');
  const keys = Object.keys(reasons).sort();
  if (keys.length === 0) {
    return derived(f, 'yok — hiçbir kayıt kota/tavan yüzünden düşmedi');
  }
  return observed(f, keys.map((k) => {
    const label = GAP_EVICTION_REASON_LABEL[k as GapEvictionReason] ?? k;
    return `${label}: ${reasons[k]}`;
  }).join(' · '));
}

/** Ölçüm yapılmadıysa sayı GÖSTERİLMEZ — `0` bir ölçümdür. */
function _count(
  id: string, label: string, ran: boolean, value: number | null,
): InspectorField {
  const f = F(id, label);
  if (!ran) return unavailable(f, 'Çözücü hiç koşmadı — sayı bir ÖLÇÜM olurdu.');
  if (value === null) return unavailable(f, 'Sayaç okunamadı.');
  return observed(f, String(value));
}

export function buildResolverCards(
  s: GapResolverRawSnapshot,
): readonly ResolverCard[] {
  const ran = s.summary !== null && !s.summary.neverRan;
  const sum = s.summary;
  const v = deriveResolverVerdict(s);

  const run: InspectorField[] = [
    derived(F('verdict', 'Durum'),
      RESOLVER_VERDICT_LABEL[v.status]),
    _count('runs', 'Çözüm turu sayısı', ran, s.runCount),
    _count('total', 'İzlenen boşluk', ran, sum?.total ?? null),
    s.dropped !== null && s.dropped > 0
      ? observed(F('dropped', 'Tavan nedeniyle kaydedilemeyen'),
        `${s.dropped} (tavan ${s.maxStates})`)
      : derived(F('dropped', 'Tavan nedeniyle kaydedilemeyen'),
        `0 (tavan ${s.maxStates})`),
  ];

  const inputs: InspectorField[] = [
    observed(F('registry', 'Boşluk sicilinde satır', 'obd/gapRegistry'),
      String(s.registry.length)),
    s.registryDropped !== null && s.registryDropped > 0
      ? observed(F('regdrop', 'Sicil tavanı aşımı', 'obd/gapRegistry'),
        String(s.registryDropped))
      : derived(F('regdrop', 'Sicil tavanı aşımı', 'obd/gapRegistry'), '0'),
    s.registry.length === 0
      ? unavailable(F('topsignal', 'En sık sinyal', 'obd/gapRegistry'),
        'Sicilde kayıt yok.')
      : observed(F('topsignal', 'En sık sinyal', 'obd/gapRegistry'),
        `${s.registry[0].signal} × ${s.registry[0].count}`),
  ];

  const lifecycle: InspectorField[] = ran && sum !== null ? [
    observed(F('open', GAP_LIFECYCLE_LABEL.OPEN), String(sum.open)),
    observed(F('prog', GAP_LIFECYCLE_LABEL.IN_PROGRESS), String(sum.inProgress)),
    observed(F('res', GAP_LIFECYCLE_LABEL.RESOLVED), String(sum.resolved)),
    observed(F('blk', GAP_LIFECYCLE_LABEL.BLOCKED), String(sum.blocked)),
    observed(F('exh', GAP_LIFECYCLE_LABEL.EXHAUSTED), String(sum.exhausted)),
    observed(F('unk', GAP_LIFECYCLE_LABEL.UNKNOWN), String(sum.unknown)),
  ] : [
    unavailable(F('open', 'Yaşam döngüsü sayaçları'),
      'Çözücü hiç koşmadı.'),
  ];

  const budget: InspectorField[] = [
    _count('spent', 'Harcanan istek', ran, sum?.requestsSpent ?? null),
    _count('saved', 'Öğrenmeyle KAZANILAN istek', ran, sum?.requestsSaved ?? null),
    derived(F('ceil1', 'Aynı yol için deneme tavanı', 'obd/healing/resolutionPolicy'),
      String(s.maxAttemptsPerTriple)),
    derived(F('ceil2', 'Boşluk başına toplam tavan', 'obd/healing/resolutionPolicy'),
      String(s.maxAttemptsPerGap)),
    derived(F('ceil3', 'Tur başına boşluk bütçesi'),
      String(s.maxGapsPerRun)),
    derived(F('share', 'Sahibi işlemden alınan pay', 'obd/healing/selfHealingTrigger'),
      `kalanın %${Math.round(s.budgetShare * 100)}'i · en çok ${s.budgetMaxRequests} istek`),
    derived(F('reserve', 'Normal tanıya bırakılan rezerv', 'obd/healing/selfHealingTrigger'),
      `${s.budgetReserve} istek`),
    derived(F('epochcap', 'Oturum başına tur tavanı (anti-storm)', 'obd/healing/selfHealingTrigger'),
      String(s.maxRunsPerEpoch)),
  ];

  /* ── P0-VDK-F5D · KANIT BAĞI ───────────────────────────────────────────
     Sicilde satır YOKSA sayı GÖSTERİLMEZ: "kanıt bağı %100" demek için önce
     bir boşluk ölçülmüş olmalı. Kanıt bağı EKSİK olan satır varsa hüküm
     FAIL-CLOSED yazılır — kaynak defter kırpılırsa o boşluk çözülemez. */
  const cov = s.evidenceCoverage;
  const ESRC = 'obd/gapEvidence';
  const evidence: InspectorField[] = cov == null || cov.total === 0 ? [
    unavailable(F('evtotal', 'Kanıt bağı', ESRC),
      'Sicilde tek satır yok — kanıt bağı ÖLÇÜLEMEZ (0 bir ölçüm olurdu).'),
    derived(F('evwhat', 'Bu kart ne ölçer', ESRC),
      'Bir boşluğun HANGİ ECU · servis · NRC · işlem kanıtından doğduğu, '
      + 'kaynak yoklama defteri kırpılsa BİLE okunabiliyor mu.'),
  ] : [
    observed(F('evtotal', 'Sicil satırı', ESRC), String(cov.total)),
    observed(F('evok', GAP_EVIDENCE_STATE_LABEL.MEASURED, ESRC), String(cov.measured)),
    observed(F('evpart', GAP_EVIDENCE_STATE_LABEL.LEGACY_INCOMPLETE, ESRC),
      String(cov.incomplete)),
    observed(F('evnone', GAP_EVIDENCE_STATE_LABEL.UNAVAILABLE, ESRC),
      String(cov.unavailable)),
    cov.measured === cov.total
      ? derived(F('evverdict', 'HÜKÜM', ESRC),
        'KANIT BAĞI SAĞLAM — her boşluk kendi ölçüm künyesini taşıyor')
      : derived(F('evverdict', 'HÜKÜM', ESRC),
        `KANIT BAĞI EKSİK — ${cov.incomplete + cov.unavailable} satır kendi `
        + 'künyesini taşımıyor; kaynak defter kırpılırsa bu boşluklar '
        + 'hedefsiz kalır (fail-closed)'),
    observed(F('evres', 'Kapatan kanıtı olan satır', ESRC), String(cov.resolved)),
    cov.reopened === 0
      ? derived(F('evreopen', 'Kapandıktan sonra tekrar ölçülen', ESRC), '0')
      : observed(F('evreopen', 'Kapandıktan sonra tekrar ölçülen', ESRC),
        String(cov.reopened)),
  ];

  /* ── P0-VDK-F5F · AKTİF ARAÇ KAPSAMI ───────────────────────────────────
     ⚠️ HAM VIN GÖSTERİLMEZ: taşınan tek kimlik parmak izi KARMASIDIR.
     "Araç kimliği yok" ile "araç var ama kimliği zayıf" AYRI gerçeklerdir. */
  const VSRC = 'obd/gapLedgerScope';
  const CSRC = 'obd/capability/capabilityStore';
  const PSRC2 = 'obd/vehiclePartitionCatalog';
  const sc = s.ledgerScope;
  const vehicle: InspectorField[] = sc === null ? [
    unavailable(F('vstate', 'Aktif araç kapsamı', VSRC),
      'Kapsam okunamadı — sicil hiçbir araca bağlı DEĞİL.'),
  ] : [
    sc.state === 'VEHICLE_SCOPED'
      ? observed(F('vstate', 'Aktif araç kapsamı', VSRC),
        GAP_LEDGER_SCOPE_LABEL[sc.state])
      : unavailable(F('vstate', 'Aktif araç kapsamı', VSRC),
        `${GAP_LEDGER_SCOPE_LABEL[sc.state]} — ${sc.blockedReason ?? ''}`),
    sc.vehicleRef === null
      ? unavailable(F('vref', 'Araç parmak izi referansı', VSRC),
        'Kimlik ÖLÇÜLMEDİ — açılışta araç henüz bilinmez.')
      : observed(F('vref', 'Araç parmak izi referansı (karma · ham VIN DEĞİL)', VSRC),
        sc.vehicleRef),
    derived(F('vstrength', 'Kimlik gücü (F4-C isFingerprintReusable)',
      'obd/capability/capabilityFingerprint'),
    sc.state === 'VEHICLE_SCOPED'
      ? 'YETERLİ — kendi kalıcı bölümü açıldı'
      : 'YETERSİZ ya da ÖLÇÜLMEDİ — başka aracın sicili YÜKLENMEZ'),
    sc.storageKey === null
      ? unavailable(F('vpart', 'Aktif sicil bölümü', VSRC),
        'Kalıcı bölüm YOK — sicil yalnız bellekte.')
      : observed(F('vpart', 'Aktif sicil bölümü', VSRC), sc.storageKey),
    sc.persistenceAllowed
      ? observed(F('vpersist', 'Kalıcılık', VSRC), 'İZİNLİ')
      : unavailable(F('vpersist', 'Kalıcılık', VSRC),
        `ENGELLİ — ${sc.blockedReason ?? 'gerekçe ölçülmedi'}`),
    s.ledgerBlockedWrites === null || s.ledgerBlockedWrites === 0
      ? derived(F('vblocked', 'Engellenen yazım', VSRC), '0')
      : observed(F('vblocked', 'Engellenen yazım', VSRC),
        String(s.ledgerBlockedWrites)),
    s.ledgerSwitchCount === null
      ? unavailable(F('vswitch', 'Araç değişimi', VSRC), 'Ölçülmedi.')
      : observed(F('vswitch', 'Araç değişimi', VSRC), String(s.ledgerSwitchCount)),
    s.ledgerDetachedRef === null
      ? derived(F('vdetach', 'Ayrılan önceki bölüm', VSRC), 'yok')
      : observed(F('vdetach', 'Ayrılan önceki bölüm', VSRC), s.ledgerDetachedRef),
    s.ledgerBootAt === null
      ? unavailable(F('vboot', 'Açılış adımı', 'obd/gapRegistry'),
        'Açılış adımı bu oturumda KOŞMADI.')
      : observed({ id: 'vboot', label: 'Açılış adımı (hidrasyon ERTELENDİ)',
        source: 'obd/gapRegistry', note: '', updatedAt: s.ledgerBootAt },
      new Date(s.ledgerBootAt).toISOString()),
    s.ledgerRestoreAttempted
      ? observed(F('vrestore', 'Geri yükleme denendi mi', 'obd/gapRegistry'), 'EVET')
      : unavailable(F('vrestore', 'Geri yükleme denendi mi', 'obd/gapRegistry'),
        'HAYIR — araç kimliği hazır olmadan geri yükleme YASAK.'),
    s.legacyUnscopedPresent === null
      ? unavailable(F('vlegacy', 'Kapsamsız eski depo', VSRC), 'Okunamadı.')
      : s.legacyUnscopedPresent
        ? unavailable(F('vlegacy', 'Kapsamsız eski depo', VSRC),
          `VAR — ${LEGACY_UNSCOPED_POLICY_LABEL}`)
        : derived(F('vlegacy', 'Kapsamsız eski depo', VSRC), 'yok'),

    /* ── P0-VDK-F5G · YETENEK BÖLÜMÜ ve PARİTE ───────────────────────────
       ⚠️ PARİTE FAIL-CLOSED: boşluk sicili ile öğrenme AYNI araca bakmak
       ZORUNDADIR. Biri A'da biri B'de kalırsa bu bir uyarı değil bir
       ARIZADIR — ekran bunu açıkça söyler. */
    _parityField(sc.vehicleRef, s.capabilityScope?.vehicleRef ?? null),
    s.capabilityPartitionKey === null
      ? unavailable(F('cpart', 'Yetenek bölümü', CSRC),
        'Kalıcı yetenek bölümü YOK — öğrenme yalnız bellekte.')
      : observed(F('cpart', 'Yetenek bölümü', CSRC), s.capabilityPartitionKey),
    s.capabilityHealth === null
      ? unavailable(F('chealth', 'Yetenek bölümü sağlığı', CSRC), 'Okunamadı.')
      : s.capabilityHealth === 'OK' || s.capabilityHealth === 'EMPTY'
        ? observed(F('chealth', 'Yetenek bölümü sağlığı', CSRC),
          STORE_HEALTH_LABEL[s.capabilityHealth])
        : unavailable(F('chealth', 'Yetenek bölümü sağlığı', CSRC),
          `${STORE_HEALTH_LABEL[s.capabilityHealth]} — FAIL-CLOSED boş başladı`),
    s.capabilityEdgeCount === null
      ? unavailable(F('cedges', 'Yüklü yetenek kenarı', CSRC), 'Ölçülmedi.')
      : observed(F('cedges', 'Yüklü yetenek kenarı', CSRC),
        String(s.capabilityEdgeCount)),
    s.capabilityBlockedWrites === null || s.capabilityBlockedWrites === 0
      ? derived(F('cblocked', 'Engellenen yetenek yazımı', CSRC), '0')
      : observed(F('cblocked', 'Engellenen yetenek yazımı', CSRC),
        String(s.capabilityBlockedWrites)),

    /* ── BÖLÜM KATALOĞU ve ÇÖP TOPLAMA ───────────────────────────────────── */
    s.partitionCatalogLoaded !== true
      ? unavailable(F('pcount', 'Cihazdaki araç bölümü', PSRC2),
        'Katalog bu oturumda HİÇ okunmadı — sayı bir ÖLÇÜM olurdu.')
      : observed(F('pcount', 'Cihazdaki araç bölümü', PSRC2),
        `${s.partitions.length} / tavan ${s.maxPartitions}`),
    s.partitionCatalogHealth === null
      ? unavailable(F('phealth', 'Katalog sağlığı', PSRC2), 'Okunamadı.')
      : observed(F('phealth', 'Katalog sağlığı', PSRC2),
        STORE_HEALTH_LABEL[s.partitionCatalogHealth]),
    s.partitionLastGcAt === null
      ? unavailable(F('pgc', 'Son bölüm temizliği', PSRC2),
        'Bu cihazda HİÇ temizlik koşmadı.')
      : observed({ id: 'pgc', label: 'Son bölüm temizliği', source: PSRC2,
        note: '', updatedAt: s.partitionLastGcAt },
      new Date(s.partitionLastGcAt).toISOString()),
    s.partitionEvictedTotal === null
      ? unavailable(F('pevict', 'Temizlenen araç bölümü', PSRC2), 'Ölçülmedi.')
      : observed(F('pevict', 'Temizlenen araç bölümü', PSRC2),
        String(s.partitionEvictedTotal)),
    s.partitionPartialGc === null || s.partitionPartialGc === 0
      ? derived(F('ppartial', 'YARIM kalan temizlik', PSRC2), '0')
      : unavailable(F('ppartial', 'YARIM kalan temizlik', PSRC2),
        `${s.partitionPartialGc} bölüm silinemedi — tekrar denenecek `
        + '(sessiz başarı SAYILMAZ)'),
    s.partitionCorrupt === null || s.partitionCorrupt === 0
      ? derived(F('pcorrupt', 'Bozuk/yarım bölüm', PSRC2), '0')
      : observed(F('pcorrupt', 'Bozuk/yarım bölüm', PSRC2),
        String(s.partitionCorrupt)),
    derived(F('pprotect', 'Aktif araç koruması', 'obd/vehiclePartitionPolicy'),
      sc.vehicleRef === null
        ? 'aktif araç YOK — korunacak bölüm de yok'
        : 'AKTİF ARAÇ HİÇBİR KOŞULDA TEMİZLENMEZ (ağırlık 200 > 40+20)'),
  ];

  /* ── P0-VDK-F5E · KALICILIK ve SAKLAMA ─────────────────────────────────
     ⚠️ ÜÇ FARKLI GERÇEK ASLA KARIŞTIRILMAZ:
       · depo HİÇ okunmadı        → KAYNAK YOK
       · depo okundu ve BOŞ       → ölçülmüş `0` (ilk çalıştırma)
       · depo okundu ve BOZUK     → FAIL-CLOSED, sicil boş başladı  */
  const PSRC = 'obd/gapRegistry';
  const health = s.ledgerHealth;
  const persistence: InspectorField[] = !s.ledgerLoaded || health === null ? [
    unavailable(F('psstate', 'Kalıcı sicil', PSRC),
      'Depo bu oturumda HİÇ okunmadı — "boş" ile "okunmadı" aynı şey değildir.'),
    derived(F('psschema', 'Şema sürümü', PSRC), String(s.ledgerSchemaVersion)),
  ] : [
    health === 'CORRUPT' || health === 'SCHEMA_MISMATCH' || health === 'UNAVAILABLE'
      ? unavailable(F('psstate', 'Kalıcı sicil', PSRC),
        `${STORE_HEALTH_LABEL[health]} — sicil FAIL-CLOSED boş başladı; `
        + 'kayıp kayıt "çözüldü" SAYILMAZ.')
      : observed(F('psstate', 'Kalıcı sicil', PSRC), STORE_HEALTH_LABEL[health]),
    derived(F('psschema', 'Şema sürümü', PSRC), String(s.ledgerSchemaVersion)),
    s.ledgerRestored === null
      ? unavailable(F('psrestored', 'Açılışta geri yüklenen satır', PSRC), 'Okunmadı.')
      : observed(F('psrestored', 'Açılışta geri yüklenen satır', PSRC),
        String(s.ledgerRestored)),
    s.ledgerRestoredAt === null
      ? unavailable(F('psrestoredat', 'Geri yükleme zamanı', PSRC),
        'Damga ölçülmedi — sahte tarih üretilmez.')
      : observed({ id: 'psrestoredat', label: 'Geri yükleme zamanı',
        source: PSRC, note: '', updatedAt: s.ledgerRestoredAt },
      new Date(s.ledgerRestoredAt).toISOString()),
    s.ledgerSavedAt === null
      ? unavailable(F('pssaved', 'Son yazım zamanı', PSRC),
        'Bu oturumda hiç yazım yapılmadı.')
      : observed({ id: 'pssaved', label: 'Son yazım zamanı',
        source: PSRC, note: '', updatedAt: s.ledgerSavedAt },
      new Date(s.ledgerSavedAt).toISOString()),
    s.ledgerLastSaveOk === null
      ? unavailable(F('pssaveok', 'Son yazım sonucu', PSRC),
        'HİÇ yazılmadı — bu "başarısız" DEĞİLDİR.')
      : observed(F('pssaveok', 'Son yazım sonucu', PSRC),
        s.ledgerLastSaveOk ? 'BAŞARILI' : 'BAŞARISIZ'),
    s.ledgerNotPersisted === null
      ? unavailable(F('psskip', 'Diske YAZILMAYAN satır', PSRC), 'Ölçülmedi.')
      : observed(F('psskip', 'Diske YAZILMAYAN satır (kökeni `live` değil)', PSRC),
        String(s.ledgerNotPersisted)),
    s.evidenceCoverage === null
      ? unavailable(F('pspersistable', 'Kalıcı olabilir satır', PSRC), 'Ölçülmedi.')
      : observed(F('pspersistable', 'Kalıcı olabilir satır (canlı kanıtlı)', PSRC),
        String(s.evidenceCoverage.persistable)),
    s.evidenceCoverage === null
      ? unavailable(F('psopen', 'Kapanmamış / kapanmış', PSRC), 'Ölçülmedi.')
      : observed(F('psopen', 'Kapanmamış / kapanmış', PSRC),
        `${s.evidenceCoverage.total - s.evidenceCoverage.resolved} / `
        + `${s.evidenceCoverage.resolved}`),
    s.evicted === null
      ? unavailable(F('psevicted', 'Yer açmak için düşürülen satır', PSRC), 'Ölçülmedi.')
      : observed(F('psevicted', 'Yer açmak için düşürülen satır', PSRC),
        String(s.evicted)),
    _reasonField(s.evictionReasons),
    derived(F('pscaps', 'Tavan / kotalar', 'obd/gapRetentionPolicy'),
      `sicil ${s.maxEntries} · aile ${s.maxPerFamily} · ECU ${s.maxPerEcu}`),
    derived(F('pspolicy', 'Saklama kuralı', 'obd/gapRetentionPolicy'),
      'ÇÖZÜLMEMİŞ boşluk, çözülmüş boşluktan ÖNCE ASLA düşmez '
      + '(ağırlık 200 > 60+40+20).'),
  ];

  const cap = s.capability;
  const impact: InspectorField[] = cap === null || cap.neverLearned ? [
    unavailable(F('edges', 'Yetenek çizgesi', 'obd/capability/capabilityStore'),
      'Hiç öğrenme yok — çözümün etkisi ÖLÇÜLEMEZ.'),
  ] : [
    observed(F('edges', 'Öğrenilmiş yetenek', 'obd/capability/capabilityStore'),
      String(cap.edges)),
    observed(F('trusted', 'Ürün-güvenilir (canlı)', 'obd/capability/capabilityStore'),
      String(cap.trusted)),
    observed(F('conf', 'Çözülmemiş çelişki', 'obd/capability/capabilityStore'),
      String(cap.conflicts)),
    observed(F('stale', 'Bayat kayıt', 'obd/capability/capabilityStore'),
      String(cap.stale)),
  ];

  /* ── P0-VDK-F5B · ÜRETİM TETİĞİ ──────────────────────────────────────────
     Tetik HİÇ değerlendirilmediyse sayı GÖSTERİLMEZ: "hiç tetiklenmedi" ile
     "tetiklendi ve çalışmadı" AYNI ŞEY DEĞİLDİR. */
  const lt = s.lastTrigger;
  const trigger: InspectorField[] = !s.triggerEverEvaluated || lt === null ? [
    unavailable(F('trg', 'Son üretim tetiği', 'obd/healing/selfHealingTrigger'),
      'Self-Healing üretim yolundan HİÇ değerlendirilmedi.'),
    derived(F('trgwhy', 'Neden tekrar çalışmadı', 'obd/healing/selfHealingTrigger'),
      'Tetik noktası tam araç taramasının bitişidir — henüz tarama koşmadı.'),
  ] : [
    observed(F('trg', 'Son üretim tetiği', 'obd/healing/selfHealingTrigger'),
      HEALING_TRIGGER_LABEL[lt.trigger]),
    observed(F('trgres', 'Sonuç', 'obd/healing/selfHealingTrigger'),
      HEALING_ADMISSION_LABEL[lt.decision]),
    observed(F('trgwhy', 'Neden', 'obd/healing/selfHealingTrigger'), lt.reason),
    observed(F('trgalloc', 'Ayrılan istek / süre', 'obd/healing/selfHealingTrigger'),
      `${lt.allocatedRequests} istek · ${lt.allocatedTimeMs} ms`),
    lt.usedRequests === null
      ? unavailable(F('trgused', 'Kullanılan istek', 'obd/healing/selfHealingTrigger'),
        'Ölçüm yapılmadı — sayı bir ÖLÇÜM olurdu.')
      : observed(F('trgused', 'Kullanılan istek', 'obd/healing/selfHealingTrigger'),
        String(lt.usedRequests)),
    lt.resolvedGaps === null
      ? unavailable(F('trgres2', 'Çözülen boşluk', 'obd/healing/selfHealingTrigger'),
        'Ölçüm yapılmadı.')
      : observed(F('trgres2', 'Çözülen boşluk', 'obd/healing/selfHealingTrigger'),
        String(lt.resolvedGaps)),
    lt.openGaps === null
      ? unavailable(F('trgopen', 'Açık kalan boşluk', 'obd/healing/selfHealingTrigger'), 'Ölçülmedi.')
      : observed(F('trgopen', 'Açık kalan boşluk', 'obd/healing/selfHealingTrigger'),
        String(lt.openGaps)),
    lt.savedRequests === null
      ? unavailable(F('trgsaved', 'Kazanılan istek', 'obd/healing/selfHealingTrigger'), 'Ölçülmedi.')
      : observed(F('trgsaved', 'Kazanılan istek', 'obd/healing/selfHealingTrigger'),
        String(lt.savedRequests)),
    lt.atMs === null
      ? unavailable(F('trgat', 'Son çalışma zamanı', 'obd/healing/selfHealingTrigger'),
        'Damga ölçülmedi — sahte tarih üretilmez.')
      : observed({ id: 'trgat', label: 'Son çalışma zamanı',
        source: 'obd/healing/selfHealingTrigger', note: '', updatedAt: lt.atMs },
      new Date(lt.atMs).toISOString()),
    observed(F('trgepoch', 'OBD oturum mührü', 'obd/healing/selfHealingTrigger'),
      lt.sessionEpoch === -1 ? 'ÖLÇÜLEMEDİ' : String(lt.sessionEpoch)),
  ];

  /* ── P0-VDK-F5B.1 · ÜRETİM SERVİS KEŞFİ ────────────────────────────────
     Keşif HİÇ değerlendirilmediyse sayı GÖSTERİLMEZ. */
  const ld = s.lastDiscovery;
  const DSRC = 'obd/healing/productionDiscovery';
  const discovery: InspectorField[] = !s.discoveryEverEvaluated || ld === null ? [
    unavailable(F('dsc', 'Üretim servis keşfi', DSRC),
      'Üretim taraması içinde HİÇ değerlendirilmedi.'),
    derived(F('dscwhy', 'Neden çalışmadı', DSRC),
      'Keşif yalnız tam araç taraması bittikten sonra değerlendirilir.'),
  ] : [
    observed(F('dsc', 'Üretim servis keşfi', DSRC),
      DISCOVERY_ADMISSION_LABEL[ld.decision]),
    observed(F('dscwhy', 'Neden', DSRC), ld.reason),
    observed(F('dscalloc', 'Ayrılan istek', DSRC), String(ld.allocatedRequests)),
    ld.usedRequests === null
      ? unavailable(F('dscused', 'Kullanılan istek', DSRC), 'Ölçüm yapılmadı.')
      : observed(F('dscused', 'Kullanılan istek', DSRC), String(ld.usedRequests)),
    ld.ecusProbed === null
      ? unavailable(F('dscecus', 'Yoklanan ECU', DSRC), 'Ölçüm yapılmadı.')
      : observed(F('dscecus', 'Yoklanan ECU', DSRC),
        `${ld.ecusProbed} (tavan ${s.discoveryMaxEcus})`),
    ld.reusedProbes === null
      ? unavailable(F('dscreuse', 'Öğrenmeyle ATLANAN yoklama', DSRC), 'Ölçüm yapılmadı.')
      : observed(F('dscreuse', 'Öğrenmeyle ATLANAN yoklama', DSRC), String(ld.reusedProbes)),
    ld.gapsProduced === null
      ? unavailable(F('dscgaps', 'Oluşan yeni boşluk', DSRC), 'Ölçüm yapılmadı.')
      : observed(F('dscgaps', 'Oluşan yeni boşluk', DSRC), String(ld.gapsProduced)),
    ld.fingerprintReusable === null
      ? unavailable(F('dscfp', 'Parmak izi yeniden kullanılabilir', DSRC), 'Ölçülemedi.')
      : observed(F('dscfp', 'Parmak izi yeniden kullanılabilir', DSRC),
        ld.fingerprintReusable ? 'EVET — ikinci tur yoklama azaltabilir'
          : 'HAYIR — fail-closed yeniden ölçülür'),
    derived(F('dscshare', 'Keşif payı / rezervi', DSRC),
      `kalanın %${Math.round(s.discoveryShare * 100)}'i · rezerv ${s.discoveryReserve} istek`),
  ];

  /* ── P0-VDK-F5C · OTURUM-KOŞULLU İYİLEŞTİRME ───────────────────────────── */
  const ls = s.lastSessionHealing;
  const SSRC = 'obd/healing/sessionHealing';
  const session: InspectorField[] = !s.sessionHealingEverEvaluated || ls === null ? [
    unavailable(F('ses', 'Oturum-koşullu iyileştirme', SSRC),
      'Hiç değerlendirilmedi — oturum-koşullu boşluk ölçülmedi.'),
    derived(F('seschain', 'Atomik zincir maliyeti', SSRC),
      `${s.sessionChainCost} istek (yarım zincir başlatılmaz)`),
  ] : [
    observed(F('ses', 'Karar', SSRC), ls.decision),
    observed(F('sesreason', 'Neden', SSRC), ls.reason),
    observed(F('sesev', 'Gerekli oturum kanıtı', SSRC),
      SESSION_EVIDENCE_LABEL[ls.evidenceSource]),
    ls.sessionCommand === null
      ? unavailable(F('sescmd', 'Oturum komutu', SSRC),
        'ÖLÇÜLMEDİ — oturum baytı uydurulmaz.')
      : observed(F('sescmd', 'Oturum komutu', SSRC), ls.sessionCommand),
    ls.sessionOpen === null
      ? unavailable(F('sesopen', 'Oturum açılış sonucu', SSRC), 'Ölçüm yapılmadı.')
      : observed(F('sesopen', 'Oturum açılış sonucu', SSRC),
        SESSION_OPEN_LABEL[ls.sessionOpen]),
    ls.leaseState === null
      ? unavailable(F('seslease', 'F1-B kira durumu', SSRC), 'Ölçüm yapılmadı.')
      : observed(F('seslease', 'F1-B kira durumu', SSRC), ls.leaseState),
    derived(F('sestpreq', 'TesterPresent gerekli mi', SSRC),
      ls.testerPresentRequired ? 'EVET' : 'HAYIR'),
    ls.testerPresent === null
      ? unavailable(F('sestp', 'TesterPresent sonucu', SSRC),
        'GÖNDERİLMEDİ — gönderilmedi ≠ başarısız.')
      : observed(F('sestp', 'TesterPresent sonucu', SSRC), ls.testerPresent),
    ls.probeClassification === null
      ? unavailable(F('sesprobe', 'Asıl yoklama sonucu', SSRC), 'Ölçüm yapılmadı.')
      : observed(F('sesprobe', 'Asıl yoklama sonucu', SSRC), ls.probeClassification),
    ls.requestsUsed === null
      ? unavailable(F('sescost', 'Toplam istek maliyeti', SSRC), 'Ölçüm yapılmadı.')
      : observed(F('sescost', 'Toplam istek maliyeti', SSRC), String(ls.requestsUsed)),
    derived(F('seschain', 'Atomik zincir maliyeti', SSRC), String(s.sessionChainCost)),
  ];

  return [
    { id: 'vehicle', title: RESOLVER_CARD_TITLE.vehicle, fields: vehicle },
    { id: 'discovery', title: RESOLVER_CARD_TITLE.discovery, fields: discovery },
    { id: 'trigger', title: RESOLVER_CARD_TITLE.trigger, fields: trigger },
    { id: 'session', title: RESOLVER_CARD_TITLE.session, fields: session },
    { id: 'run', title: RESOLVER_CARD_TITLE.run, fields: run },
    { id: 'inputs', title: RESOLVER_CARD_TITLE.inputs, fields: inputs },
    { id: 'evidence', title: RESOLVER_CARD_TITLE.evidence, fields: evidence },
    { id: 'persistence', title: RESOLVER_CARD_TITLE.persistence, fields: persistence },
    { id: 'lifecycle', title: RESOLVER_CARD_TITLE.lifecycle, fields: lifecycle },
    { id: 'budget', title: RESOLVER_CARD_TITLE.budget, fields: budget },
    { id: 'impact', title: RESOLVER_CARD_TITLE.impact, fields: impact },
  ];
}

/* ══════════════════════════════════════════════════════════════════════════
   3) BOŞLUK SATIRLARI
   ══════════════════════════════════════════════════════════════════════════ */

export interface ResolverRow {
  readonly key: string;
  /** Boşluk sınıfı (mevcut sözlük adı). */
  readonly gapClass: string;
  readonly origin: string;
  /** Kök katman — MEVCUT `GapScope`. */
  readonly rootLayer: string;
  readonly rootCause: string;
  readonly target: string;
  readonly lifecycle: string;
  readonly selected: string;
  readonly selectionReason: string;
  readonly attempts: string;
  readonly lastOutcome: string;
  readonly detail: string;
  readonly requests: string;

  /* ── P0-VDK-F5D · KANIT BAĞI (satır bazında) ────────────────────────────
     ⚠️ HAM YANIT GÖSTERİLMEZ. Yalnız künye ve referans VARLIĞI taşınır. */
  readonly evidenceState: GapEvidenceState;
  readonly evidenceLabel: string;
  /** Boşluğu doğuran ECU künyesi (parmak izi/adres) — ölçülmediyse `ÖLÇÜLMEDİ`. */
  readonly evidenceEcu: string;
  readonly evidenceService: string;
  readonly evidenceOutcome: string;
  readonly evidenceNrc: string;
  readonly evidenceProvenance: string;
  /** İşlem/korelasyon bağı — kimlik gösterilir, içerik GÖSTERİLMEZ. */
  readonly evidenceCorrelation: string;
  /** Kapatan kanıt — kapanmadıysa açıkça "kapanmadı". */
  readonly resolutionEvidence: string;
}

/** Tavan — çok uzun liste bir gözlem değil, bir gürültüdür. */
export const MAX_RESOLVER_ROWS = 40;

/** Sicil satırlarını anahtara göre indeksler (kapanış kanıtı için). */
function _registryIndex(
  s: GapResolverRawSnapshot,
): ReadonlyMap<string, GapEntry> {
  const m = new Map<string, GapEntry>();
  for (const e of s.registry) m.set(e.key, e);
  return m;
}

export function buildResolverRows(
  s: GapResolverRawSnapshot,
): readonly ResolverRow[] {
  const reg = _registryIndex(s);
  return s.states.slice(0, MAX_RESOLVER_ROWS).map((st) => {
    const ev = st.gap.evidence ?? null;
    const evState: GapEvidenceState = st.gap.evidenceState
      ?? (ev === null ? 'UNAVAILABLE' : ev.state);
    const entry = st.gap.registryKey == null ? null : reg.get(st.gap.registryKey) ?? null;
    const res = entry?.resolution ?? null;
    return {
    key: st.gap.key,
    gapClass: st.gap.gapClass,
    origin: GAP_ORIGIN_LABEL[st.gap.origin],
    rootLayer: st.gap.scope,
    rootCause: ROOT_CAUSE_LABEL[st.rootCause],
    target: st.gap.target.service === null
      ? 'HEDEF YOK'
      : `${st.gap.target.ecuKey ?? 'fonksiyonel'} · ${st.gap.target.service}`
        + (st.gap.target.subFunction === null ? '' : `-${st.gap.target.subFunction}`),
    lifecycle: GAP_LIFECYCLE_LABEL[st.lifecycle],
    selected: st.selected === null ? '—'
      : (CANDIDATE_LABEL[st.selected as keyof typeof CANDIDATE_LABEL] ?? st.selected),
    selectionReason: st.selectionReason,
    attempts: String(st.attempts),
    lastOutcome: st.lastOutcome ?? '—',
    detail: st.outcomeDetail,
      requests: st.requestsSaved > 0
        ? `${st.requestsSpent} harcandı · ${st.requestsSaved} kazanıldı`
        : `${st.requestsSpent} harcandı`,

      evidenceState: evState,
      evidenceLabel: GAP_EVIDENCE_STATE_LABEL[evState],
      evidenceEcu: ev === null ? 'KANIT YOK'
        : (ev.ecuKey ?? ev.ecuTxHeader ?? 'ÖLÇÜLMEDİ'),
      evidenceService: ev === null || ev.service === null ? 'ÖLÇÜLMEDİ'
        : `${ev.service}${ev.subFunction === null ? '' : `-${ev.subFunction}`}`,
      evidenceOutcome: ev?.observedClassification ?? 'ÖLÇÜLMEDİ',
      evidenceNrc: ev === null || ev.observedNrc === null ? 'ÖLÇÜLMEDİ'
        : `0x${ev.observedNrc.toString(16).toUpperCase().padStart(2, '0')}`,
      evidenceProvenance: ev?.provenance ?? 'ÖLÇÜLMEDİ',
      evidenceCorrelation: ev === null ? 'KANIT YOK'
        : [
          ev.transactionId === null ? null : `txn ${ev.transactionId}`,
          ev.evidenceCorrelationId === null ? null : `corr ${ev.evidenceCorrelationId}`,
          ev.traceEventRef === null ? null : `iz ${ev.traceEventRef}`,
          ev.capabilityEdgeRef === null ? null : 'yetenek kenarı VAR',
        ].filter((x): x is string => x !== null).join(' · ') || 'REFERANS YOK',
      resolutionEvidence: res === null
        ? (entry === null ? 'sicil dışı boşluk' : 'kapanmadı')
        : `${res.classification ?? 'ÖLÇÜLMEDİ'} · `
          + `${res.evidenceRef === null ? 'iz referansı YOK' : `iz ${res.evidenceRef}`} · `
          + `${res.provenance ?? 'köken ÖLÇÜLMEDİ'}`,
    };
  });
}
