/**
 * ecuEndpointLabModel — CAROS LAB · ECU Uç Noktaları & Rol Kanıtı SAF modeli.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Sınıflandırma `sessionInspectorModel` sözleşmesini KULLANIR — paralel sistem YOK.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── EKRANIN TEK İDDİASI ───────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 *   "Bu araçta KAÇ tanı uç noktası VAR, hangisinin KİM olduğunu BİLİYORUZ,
 *    ve bilmediklerimiz NEDEN bilinmiyor."
 *
 * `KAYNAK YOK` (hiç ölçülmedi) ile `0` (ölçtük ve sıfır çıktı) ASLA aynı
 * hücreye yazılmaz — ikisi farklı gerçeklerdir.
 */

import {
  observed, derived, unavailable, type InspectorField,
} from './sessionInspectorModel';
import type { EcuEndpointRawSnapshot } from './ecuEndpointSources';
import {
  IDENTITY_ADMISSION_LABEL, IDENTITY_MAX_ENDPOINTS,
} from '../obd/ecu/ecuIdentityResolver';
import type { CanonicalEcuRecord } from '../obd/ecu/ecuIdentityResolver';
import {
  ECU_ENDPOINT_SOURCE_LABEL, ECU_REACHABILITY_LABEL,
} from '../obd/ecu/ecuEndpointModel';
import {
  ECU_ROLE_CONFIDENCE_LABEL, ECU_ROLE_EVIDENCE_LABEL,
} from '../obd/ecu/ecuRoleEvidenceModel';
import { VARIANT_MATCH_LABEL } from '../obd/ecu/ecuVariantMatch';
import { ECU_ROLE_LABEL } from '../obd/ecuRoleModel';
import { GAP_LEDGER_SCOPE_LABEL } from '../obd/gapLedgerScope';
import { STORE_HEALTH_LABEL } from '../obd/capability/capabilityStore';

const SRC = 'obd/ecu/ecuIdentityResolver';

export type EcuEndpointCardId =
  | 'coverage' | 'discovery' | 'endpoints' | 'learning';

export const ECU_ENDPOINT_CARD_ORDER: readonly EcuEndpointCardId[] =
  ['coverage', 'discovery', 'endpoints', 'learning'] as const;

export const ECU_ENDPOINT_CARD_TITLE:
Readonly<Record<EcuEndpointCardId, string>> = {
  coverage:  '1 · Kapsam Özeti',
  discovery: '2 · Uç Nokta Keşfi',
  endpoints: '3 · Uç Nokta Başına Kimlik ve Rol',
  learning:  '4 · Rol Öğrenmesi (araç bölümü)',
} as const;

export interface EcuEndpointCard {
  readonly id: EcuEndpointCardId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

/* ══════════════════════════════════════════════════════════════════════════
   1) HÜKÜM
   ══════════════════════════════════════════════════════════════════════════ */

export type EcuEndpointVerdict =
  | 'NEVER_EVALUATED' | 'BLOCKED' | 'DEFERRED'
  | 'ENDPOINTS_ONLY' | 'CONFLICT' | 'IDENTIFIED';

export const ECU_ENDPOINT_VERDICT_LABEL:
Readonly<Record<EcuEndpointVerdict, string>> = {
  NEVER_EVALUATED: 'HİÇ DEĞERLENDİRİLMEDİ — ölçüm yok, "ECU yok" DEĞİL',
  BLOCKED:         'ENGELLENDİ — yapısal ön koşul yok, hatta tek bayt çıkmadı',
  DEFERRED:        'ERTELENDİ — kullanıcı tanısı önce; bütçe payı yetmedi',
  ENDPOINTS_ONLY:  'UÇ NOKTALAR VAR, ROL YOK — kimlik kanıtı ölçülemedi',
  CONFLICT:        'ÇELİŞKİ — iki güçlü kanıt farklı rol söylüyor (fail-closed)',
  IDENTIFIED:      'KİMLİKLENDİ — en az bir uç nokta kanıtla çözüldü',
} as const;

export interface EcuEndpointVerdictResult {
  readonly status: EcuEndpointVerdict;
  readonly reasons: readonly string[];
}

/** Rolü kanıtla çözülmüş kayıtlar (aday/bilinmiyor SAYILMAZ). */
export function identifiedRecords(
  rows: readonly CanonicalEcuRecord[],
): readonly CanonicalEcuRecord[] {
  return rows.filter((r) =>
    r.roleConfidence === 'PROVEN' || r.roleConfidence === 'STRONG');
}

export function unknownRoleRecords(
  rows: readonly CanonicalEcuRecord[],
): readonly CanonicalEcuRecord[] {
  return rows.filter((r) => r.roleConfidence === 'UNKNOWN');
}

export function conflictRecords(
  rows: readonly CanonicalEcuRecord[],
): readonly CanonicalEcuRecord[] {
  return rows.filter((r) => r.roleConfidence === 'CONFLICT');
}

export function deriveEcuEndpointVerdict(
  s: EcuEndpointRawSnapshot,
): EcuEndpointVerdictResult {
  const reasons: string[] = [];
  const run = s.lastRun;
  if (s.everEvaluated !== true || run === null) {
    reasons.push('Uç nokta kimlik çözümü bu oturumda hiç değerlendirilmedi.');
    reasons.push('Bu bir BAŞARISIZLIK DEĞİLDİR — ölçüm yokluğudur.');
    return { status: 'NEVER_EVALUATED', reasons };
  }
  if (conflictRecords(run.records).length > 0) {
    reasons.push(`${conflictRecords(run.records).length} uç noktada rol çelişkisi var.`);
    reasons.push('Biri seçilmedi: yanlış rol, rolsüzlükten tehlikelidir.');
    return { status: 'CONFLICT', reasons };
  }
  if (run.admission === 'BLOCKED') {
    reasons.push(run.reason);
    reasons.push('Hiçbir kimlik isteği gönderilmedi; araç hakkında hüküm ÜRETİLMEDİ.');
    return { status: 'BLOCKED', reasons };
  }
  if (run.admission === 'DEFERRED') {
    reasons.push(run.reason);
    reasons.push('Uç noktalar yine de envanterde KALDI — çöpe atılmadı.');
    return { status: 'DEFERRED', reasons };
  }
  const ident = identifiedRecords(run.records);
  if (ident.length === 0) {
    reasons.push(`${run.endpointsSeen} uç nokta ölçüldü ama hiçbirinin rolü kanıtlanamadı.`);
    reasons.push('Adresten rol TÜRETİLMEDİ — bilmediğimizi söylüyoruz.');
    return { status: 'ENDPOINTS_ONLY', reasons };
  }
  reasons.push(`${ident.length}/${run.endpointsSeen} uç nokta kanıtla kimliklendi.`);
  const unknown = unknownRoleRecords(run.records).length;
  if (unknown > 0) {
    reasons.push(`${unknown} uç nokta rolsüz KALDI ve envanterde duruyor `
      + '("kim olduğunu bilmiyorum" ≠ "ECU yok").');
  }
  return { status: 'IDENTIFIED', reasons };
}

/* ══════════════════════════════════════════════════════════════════════════
   2) KARTLAR
   ══════════════════════════════════════════════════════════════════════════ */

function _f(id: string, label: string, note: string, value: unknown): InspectorField {
  return value === null || value === undefined
    ? unavailable({ id, label, source: SRC, note }, `${note} · ölçüm yok.`)
    : observed({ id, label, source: SRC, note }, value);
}

/** Ölçüm HİÇ yapılmadıysa sayı yerine KAYNAK YOK — `0` bir ölçümdür. */
function _count(
  id: string, label: string, note: string, value: number | null, blind: boolean,
): InspectorField {
  if (blind || value === null) {
    return unavailable({ id, label, source: SRC, note },
      'Ölçüm yapılmadı — `0` bir ölçüm sonucu olurdu.');
  }
  return observed({ id, label, source: SRC, note }, value);
}

export function buildEcuEndpointCards(
  s: EcuEndpointRawSnapshot,
): readonly EcuEndpointCard[] {
  const run = s.lastRun;
  const blind = s.everEvaluated !== true || run === null;
  const rows = run?.records ?? [];

  /* ── 1) KAPSAM ──────────────────────────────────────────────────────── */
  const coverage: InspectorField[] = [
    _f('evaluated', 'değerlendirildi mi',
      'DENENMEDİ ile KAYNAK YOK aynı şey değildir.',
      s.everEvaluated === null ? null : (s.everEvaluated ? 'EVET' : 'HAYIR')),
    _f('admission', 'admisyon',
      'F1-A/diagnosticAdmission kararı — kural burada kopyalanmaz.',
      blind ? null : IDENTITY_ADMISSION_LABEL[run.admission]),
    _f('reason', 'gerekçe', 'Sessiz ret YASAK.', blind ? null : run.reason),
    _count('endpoints', 'ölçülmüş uç nokta',
      'Cevap veren tanı uç noktası sayısı (rol DEĞİL, adres kanıtı).',
      run?.endpointsSeen ?? null, blind),
    _count('identified', 'kimliklenen ECU',
      'Rolü KANITLA çözülmüş (PROVEN/STRONG) uç nokta.',
      blind ? null : identifiedRecords(rows).length, blind),
    _count('unknown', 'rolü BİLİNMEYEN uç nokta',
      'Envanterde KALIR: "kim olduğunu bilmiyorum" ≠ "ECU yok".',
      blind ? null : unknownRoleRecords(rows).length, blind),
    _count('conflict', 'rol çelişkisi',
      'İki güçlü kanıt farklı rol söylüyor → fail-closed.',
      blind ? null : conflictRecords(rows).length, blind),
    _count('requests', 'harcanan kimlik isteği',
      'Hatta GERÇEKTEN çıkan salt-okunur DID okuması.',
      run?.usedRequests ?? null, blind),
    derived({
      id: 'cap', label: 'uç nokta tavanı', source: SRC,
      note: 'Sınırsız keşif bir DoS\'tur; tavan aşılırsa kalanlar YARIM KALDI olur.',
    }, IDENTITY_MAX_ENDPOINTS),
  ];

  /* ── 2) KEŞİF ───────────────────────────────────────────────────────── */
  const discovery: InspectorField[] = [
    _f('protocol', 'aktif protokol', 'ATDPN ölçümü.', s.protocol),
    _f('protocol-class', 'protokol sınıfı',
      'Aday uzayı adresleme ailesine göre KAPALIDIR (kör tarama YOK).',
      s.protocolClass),
    _f('bridge', 'genel PDU köprüsü',
      'Köprü yoksa bu ARAÇ kararı DEĞİL, bizim sınırımızdır.',
      s.bridgeAvailable === null ? null : (s.bridgeAvailable ? 'VAR' : 'YOK')),
    _count('phys-probes', 'standart fiziksel yoklama',
      'ISO 15765-4 7E1..7E7 — marka tablosu DEĞİL, standardın metni.',
      s.physicalProbes.length, s.physicalProbes.length === 0),
    _count('phys-skipped', 'bütçe nedeniyle sorulmayan adres',
      'Sessiz kırpma YASAK.', s.physicalProbeSkipped,
      s.physicalProbeSkipped === null),
    /* ── P0-VDK-B7 · SESSİZ ADRES ELEME MERDİVENİ (salt-okuma) ─────────────
       SAHA (2026-08-30): ana ekranda 10 dk'da 712 × `1902FF`, hepsi NO DATA,
       hattın %83'ü boşa. Merdiven artık doğrulanmış sessizliği zaman aşımlı
       bastırıyor; bu alanlar NEDEN ve NE KADAR tasarruf edildiğini gösterir.
       Bastırma bir HÜKÜM DEĞİLDİR: `ABSENT`/`UNSUPPORTED` demez. */
    ...(s.probeSuppression === null
      ? [unavailable({
        id: 'b7-state', label: 'sessiz adres merdiveni', source: SRC,
        note: 'Merdiven durumu OKUNAMADI — "bastırma yok" DEMEK DEĞİLDİR.',
      }, 'kaynak yok')]
      : [
        _f('b7-threshold', 'bastırma için gereken sessizlik',
          'Tek NO DATA eleme YAPMAZ; bu sayıda ARDIŞIK ve DOĞRULANMIŞ sessizlik gerekir. '
          + 'Hat/çözümleme hatası (transport_error · malformed) bu sayaca GİRMEZ.',
          `${s.silenceConfirmThreshold} ardışık sessizlik`),
        _count('b7-suppressed', 'şu an bastırılan adres',
          'Zaman aşımlı bastırma — terminal kara liste YOKTUR. Süre dolunca adres '
          + 'YENİDEN ölçülür; ECU sonradan cevap verirse bastırma tümüyle SİLİNİR.',
          s.probeSavings?.suppressedAddresses ?? 0, s.probeSavings === null),
        _count('b7-saved-req', 'atlanan istek (tasarruf)',
          'Merdiven sayesinde hatta ÇIKMAYAN prob adedi.',
          s.probeSavings?.savedRequests ?? 0, s.probeSavings === null),
        (s.probeSavings === null || s.probeSavings.savedMs === null
          ? unavailable({
            id: 'b7-saved-ms', label: 'kazanılan süre', source: SRC,
            note: 'Prob süresi henüz ÖLÇÜLMEDİ — tahmin ÜRETİLMEZ (sahte 0 YOK).',
          }, 'ölçülmedi')
          : _f('b7-saved-ms', 'kazanılan süre',
            'Atlanan istek adedi × ölçülen ortalama prob süresi. Tahmin ancak '
            + 'gerçek ölçüm varsa üretilir.',
            `${s.probeSavings.savedMs} ms (ort. ${s.probeSavings.avgProbeMs} ms/prob)`)),
      ]),
    ...((s.suppressedNow ?? []).map((x, i) => _f(
      `b7-now-${i}`, `bastırılan · ${x.txHeader}`,
      'Bu adres son planlamada SORULMADI. Gerekçe ölçümdür, hüküm DEĞİL: '
      + 'adreste ECU olmadığı İDDİA EDİLMEZ — yalnız doğrulanmış sessizlik sayıldı.',
      `${x.reason} · ${x.silentStreak} sessizlik · ${Math.round(x.remainingMs / 1000)} sn sonra yeniden ölçülür`,
    ))),
    ...((s.probeSuppression ?? []).filter((x) => x.inconclusiveCount > 0).map((x, i) => _f(
      `b7-incon-${i}`, `öğrenmeye girmeyen deneme · ${x.txHeader}`,
      'Hat/çözümleme sorunu (kopma · malformed) ECU YOKLUĞU SAYILMAZ ve bastırma '
      + 'ÜRETMEZ. Adaptör koparsa yedi adres birden "yok" öğrenilemez.',
      `${x.inconclusiveCount} deneme · sessizlik sayacı ${x.silentStreak}`,
    ))),
    _f('variant-match', 'CDDL varyant deseni',
      'Birden çok desen tutarsa İLKİ SEÇİLMEZ (BELİRSİZ).',
      blind || run.variantMatch === null
        ? null : VARIANT_MATCH_LABEL[run.variantMatch.outcome]),
  ];

  /* ── 3) UÇ NOKTA BAŞINA ─────────────────────────────────────────────── */
  const endpoints: InspectorField[] = rows.length === 0
    ? [unavailable({
      id: 'no-endpoint', label: 'uç nokta', source: SRC,
      note: 'Ölçüm yapılmadı ya da hiçbir uç nokta cevap vermedi. '
        + '"Cevap yok" ile "araçta ECU yok" AYNI ŞEY DEĞİLDİR.',
    })]
    : [...rows]
      .sort((a, b) => a.endpointKey.localeCompare(b.endpointKey))
      .slice(0, 24)
      .flatMap((r) => {
        const didCount = r.identityProbes.filter((p) => p.sent).length;
        const evidenceKinds = [...new Set(r.roleEvidence.map((e) => e.kind))]
          .map((k) => ECU_ROLE_EVIDENCE_LABEL[k]).join(' · ');
        const note = [
          `${ECU_REACHABILITY_LABEL[r.reachability]}`,
          `${ECU_ENDPOINT_SOURCE_LABEL[r.endpointSource]}`,
          `${r.addressing}${r.protocol === null ? '' : ` · protokol ${r.protocol}`}`,
          `kimlik DID okuması: ${didCount}`,
          `ölçülen servis: ${Object.values(r.servicesMeasured)
            .filter((v) => v !== null).length}`,
          r.reusedFromLearning ? 'ÖĞRENMEDEN geldi (bu turda ölçülemedi)' : null,
          r.roleWrite === null ? null : `öğrenme yazımı: ${r.roleWrite}`,
          r.unresolvedReason,
        ].filter((x) => x !== null).join(' · ');

        const value = `${ECU_ROLE_LABEL[r.role]} — `
          + `${ECU_ROLE_CONFIDENCE_LABEL[r.roleConfidence]}`;
        const input = {
          id: `ep-${r.endpointKey}`,
          label: `${r.txHeader} → ${r.rxHeader}`,
          source: `${SRC} · ${r.endpointKey}`,
          note: evidenceKinds.length > 0 ? `${evidenceKinds} · ${note}` : note,
        };
        /* Kanıtla çözülen rol ÖLÇÜLDÜ; aday/öğrenilmiş rol TÜRETİLDİ. */
        return [
          r.roleConfidence === 'PROVEN' || r.roleConfidence === 'STRONG'
            ? observed(input, value) : derived(input, value),
        ];
      });

  /* ── 4) ÖĞRENME ─────────────────────────────────────────────────────── */
  const learning: InspectorField[] = [
    _f('role-scope', 'rol deposu kapsamı',
      'Zayıf kimlik ve replay ürün bölümü AÇAMAZ.',
      s.roleScope === null ? null : GAP_LEDGER_SCOPE_LABEL[s.roleScope.state]),
    _f('role-health', 'rol deposu sağlığı',
      'Bozuk/uyumsuz/SAHİBİ BAŞKA dosya yok sayılır ve üstüne YAZILMAZ.',
      s.roleHealth === null ? null : STORE_HEALTH_LABEL[s.roleHealth]),
    _f('parity', 'bölüm paritesi',
      'Rol deposu ile yetenek deposu AYNI araca bakmalıdır (F5-G invaryantı).',
      s.roleScope === null || s.capabilityScope === null ? null
        : (s.roleScope.vehicleRef === s.capabilityScope.vehicleRef
          ? 'EŞİT' : 'AYRIŞTI — fail-closed incelenmeli')),
    _count('learned', 'öğrenilmiş rol',
      'YALNIZ canlı kanıtla ve YALNIZ eyleme geçirilebilir güvende yazılır.',
      s.learnedRoles.length, s.learnedRoles.length === 0),
    _count('blocked', 'engellenen yazım',
      'Kapsam/kimlik yetersizse yazım engellenir — sessiz engelleme YASAK.',
      s.roleBlockedWrites, s.roleBlockedWrites === null),
    ...s.learnedRoles.slice(0, 12).map((r) => observed({
      id: `learned-${r.ecuFingerprint}`,
      label: `${r.rxHeader} · ${r.ecuFingerprint.slice(0, 8)}`,
      source: 'obd/ecu/ecuRoleStore',
      note: `${r.confidence} · ${r.evidenceKinds.join(' · ')} · ${r.reason}`,
    }, ECU_ROLE_LABEL[r.role])),
  ];

  return [
    { id: 'coverage', title: ECU_ENDPOINT_CARD_TITLE.coverage, fields: coverage },
    { id: 'discovery', title: ECU_ENDPOINT_CARD_TITLE.discovery, fields: discovery },
    { id: 'endpoints', title: ECU_ENDPOINT_CARD_TITLE.endpoints, fields: endpoints },
    { id: 'learning', title: ECU_ENDPOINT_CARD_TITLE.learning, fields: learning },
  ];
}

export function countByEcuEndpointClass(
  cards: readonly EcuEndpointCard[],
): Readonly<Record<'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE', number>> {
  const out = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  for (const c of cards) for (const f of c.fields) out[f.klass]++;
  return out;
}
