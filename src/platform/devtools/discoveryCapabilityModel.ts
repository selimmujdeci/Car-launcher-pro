/**
 * discoveryCapabilityModel — CAROS LAB · Keşif / Yetenek SAF model katmanı.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * Gözlemlenebilirlik sınıflandırması `sessionInspectorModel` sözleşmesini
 * KULLANIR (`OBSERVED · DERIVED · UNAVAILABLE · STALE`) — paralel sistem YOK.
 *
 * ⚠️ EN ÖNEMLİ KURAL: **hiç yoklama yapılmadıysa sayı `0` GÖSTERİLMEZ.**
 * `0`, "sorduk ve bulamadık" demektir; "hiç sormadık" ise `KAYNAK YOK`tur.
 * İkisini aynı göstermek, bu ekranın var oluş amacına aykırıdır.
 */

import {
  observed, derived, unavailable, type InspectorField,
} from './sessionInspectorModel';
import type { DiscoveryCapabilityRawSnapshot } from './discoveryCapabilitySources';
import {
  SERVICE_PRESENCE_LABEL, type ServicePresence,
} from '../obd/ecuCapabilityModel';
import { PROBE_EXCLUSION_LABEL } from '../obd/discovery/serviceProbeModel';

const SRC = 'discovery/serviceDiscoveryRuntime';

export type DiscoveryCardId = 'run' | 'coverage' | 'transport' | 'services' | 'unknowns';

export const DISCOVERY_CARD_ORDER: readonly DiscoveryCardId[] =
  ['run', 'coverage', 'transport', 'services', 'unknowns'] as const;

export const DISCOVERY_CARD_TITLE: Readonly<Record<DiscoveryCardId, string>> = {
  run:       '1 · Keşif Turu',
  coverage:  '2 · Kapsam (ölçülen)',
  transport: '3 · Taşıma Sınırları',
  services:  '4 · Keşfedilen Servisler',
  unknowns:  '5 · Bilinmeyenler ve Elenenler',
} as const;

export interface DiscoveryCard {
  readonly id: DiscoveryCardId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

/** Ekranın tek cümlelik dürüst hükmü. */
export type DiscoveryVerdict =
  | 'NEVER_PROBED' | 'NO_BRIDGE' | 'INCOMPLETE' | 'MEASURED';

export const DISCOVERY_VERDICT_LABEL: Readonly<Record<DiscoveryVerdict, string>> = {
  NEVER_PROBED: 'HİÇ YOKLANMADI — bu araç hakkında yetenek kanıtı YOK',
  NO_BRIDGE:    'GENEL KÖPRÜ YOK — keşif yapılamaz (eski APK)',
  INCOMPLETE:   'YARIM — bütçe/oturum nedeniyle tamamlanmadı',
  MEASURED:     'ÖLÇÜLDÜ — harita kanıta dayanıyor',
} as const;

export interface DiscoveryVerdictResult {
  readonly status: DiscoveryVerdict;
  readonly reasons: readonly string[];
}

export function deriveDiscoveryVerdict(
  s: DiscoveryCapabilityRawSnapshot,
): DiscoveryVerdictResult {
  const reasons: string[] = [];
  if (s.genericBridge === false) {
    reasons.push('`sendDiagnosticPdu` bu APK\'da yok — genel köprü taşınmıyor.');
    return { status: 'NO_BRIDGE', reasons };
  }
  if (s.summary === null || s.summary.neverProbed) {
    reasons.push('Bu oturumda tek bir yoklama bile yapılmadı.');
    reasons.push('Sayaçlar `0` DEĞİL `KAYNAK YOK` gösterir — ikisi aynı şey değildir.');
    return { status: 'NEVER_PROBED', reasons };
  }
  if (s.summary.deferred > 0) {
    reasons.push(`${s.summary.deferred} aday bütçe/oturum nedeniyle YOKLANMADI.`);
    reasons.push('Yarım kalan tarama, servis yokluğunun kanıtı DEĞİLDİR.');
    return { status: 'INCOMPLETE', reasons };
  }
  reasons.push(`${s.summary.present} servis kanıtlı MEVCUT, ${s.summary.absent} kanıtlı YOK.`);
  if (s.summary.unknown + s.summary.transportLimited > 0) {
    reasons.push(`${s.summary.unknown + s.summary.transportLimited} aday hakkında ölçüm YOK.`);
  }
  return { status: 'MEASURED', reasons };
}

/** Yoklanmadıysa sayı yerine KAYNAK YOK — bu ekranın ana dürüstlük kuralı. */
function _count(
  id: string, label: string, note: string,
  value: number | null, neverProbed: boolean,
): InspectorField {
  if (neverProbed || value === null) {
    return unavailable({ id, label, source: SRC, note },
      'Hiç yoklama yapılmadı — `0` bir ölçüm olurdu, burada ölçüm YOK.');
  }
  return observed({ id, label, source: SRC, note }, value);
}

export function buildDiscoveryCards(
  s: DiscoveryCapabilityRawSnapshot,
): readonly DiscoveryCard[] {
  const sum = s.summary;
  const never = sum === null || sum.neverProbed;

  const run: InspectorField[] = [
    _count('run-count', 'keşif turu sayısı',
      'Bu süreçte kaç kez keşif koşuldu.', s.runCount, (s.runCount ?? 0) === 0),
    _count('probed', 'yoklanan aday',
      'Gerçekten istek gönderilen + korpus dışı bırakılan kayıt sayısı.',
      sum?.probed ?? null, never),
    _count('dropped', 'defter taşması',
      'Tavan aşıldığı için kaydedilemeyen yoklama.', s.dropped, (s.runCount ?? 0) === 0),
    sum?.lastNrc != null
      ? observed({
        id: 'last-nrc', label: 'en son NRC', source: SRC,
        note: 'ECU\'nun en son verdiği negatif yanıt kodu — kanıt.',
      }, `0x${sum.lastNrc.toString(16).toUpperCase().padStart(2, '0')}`)
      : unavailable({
        id: 'last-nrc', label: 'en son NRC', source: SRC,
        note: 'Negatif yanıt görülmediyse NRC de yoktur.',
      }, 'Bu turda hiç NRC ölçülmedi.'),
  ];

  const coverage: InspectorField[] = [
    _count('present', 'VAR (pozitif yanıt)',
      'Servis kanıtlı mevcut.', sum?.present ?? null, never),
    _count('absent', 'YOK (7F-11)',
      'YALNIZ NRC 0x11 bu kutuya düşer — başka hiçbir sonuç "yok" sayılmaz.',
      sum?.absent ?? null, never),
    _count('conditioned', 'VAR ama koşullu',
      'ECU negatif yanıt verdi ama gerekçe "servis yok" değil → servis MEVCUT.',
      sum?.conditioned ?? null, never),
    _count('unknown', 'BİLİNMİYOR',
      'ECU sustu / zaman aşımı / hat hatası — araç hakkında iddia YOK.',
      sum?.unknown ?? null, never),
    _count('deferred', 'YARIM KALDI',
      'Bütçe ya da oturum nedeniyle yoklanmadı. "Yok" DEĞİLDİR.',
      sum?.deferred ?? null, never),
    _count('forbidden', 'YOKLANMAZ (güvenlik)',
      'Güvenlik kapısı korpusa almadı — bilinçli üründür kararı.',
      sum?.forbidden ?? null, never),
  ];

  const transport: InspectorField[] = [
    s.genericBridge === null
      ? unavailable({
        id: 'bridge', label: 'genel PDU köprüsü', source: 'genericPduTransport',
        note: 'Köprü varlığı okunamadı.',
      })
      : observed({
        id: 'bridge', label: 'genel PDU köprüsü', source: 'genericPduTransport',
        note: 'Yoksa keşif yapılamaz; bu ARAÇ sınırı değil APK sınırıdır.',
      }, s.genericBridge ? 'VAR' : 'YOK'),
    s.routePolicy === null
      ? unavailable({
        id: 'policy', label: 'yönlendirme politikası', source: 'pduRouting',
        note: 'Politika okunamadı.',
      })
      : derived({
        id: 'policy', label: 'yönlendirme politikası', source: 'pduRouting',
        note: 'Keşif genel köprüyü kullanır; legacy yol parity tanığı olarak durur.',
      }, s.routePolicy),
    _count('transport-limited', 'köprü taşıyamadı',
      'ARAÇ desteklemiyor DEĞİL — bizim taşıma sınırımız.',
      sum?.transportLimited ?? null, never),
    s.gapCounts === null
      ? unavailable({
        id: 'gap-transport', label: 'sicilde TRANSPORT_LIMITATION', source: 'gapRegistry',
        note: 'Sicil okunamadı.',
      })
      : observed({
        id: 'gap-transport', label: 'sicilde TRANSPORT_LIMITATION', source: 'gapRegistry',
        note: 'Boşluk sicili mevcut sözlüğü kullanır; yeni sinyal tanımlanmadı.',
      }, s.gapCounts.TRANSPORT_LIMITATION ?? 0),
  ];

  /* Servis satırları — her biri kendi kanıtıyla. */
  const services: InspectorField[] = s.records.length === 0
    ? [unavailable({
      id: 'no-service', label: 'servis haritası', source: SRC,
      note: 'Yoklama yapılmadan harita üretilmez.',
    }, 'Hiç yoklama yok.')]
    : [...s.records]
      .sort((a, b) => (a.service + (a.subFunction ?? '')).localeCompare(
        b.service + (b.subFunction ?? '')))
      .slice(0, 40)
      .map((r) => {
        const id = `svc-${r.service}${r.subFunction ?? ''}`;
        const label = `${r.service}${r.subFunction === null ? '' : `-${r.subFunction}`}`;
        const note = `${r.reason}${r.count > 1 ? ` · ${r.count}× soruldu` : ''}`;
        const value = `${SERVICE_PRESENCE_LABEL[r.classification]} · ${r.requestIdentity}`;
        const input = { id, label, source: `${SRC} · ${r.ecuKey ?? 'FUNC'}`, note };
        /* Ölçülmüş sonuç OBSERVED, çıkarım DERIVED, ölçüm yokluğu UNAVAILABLE. */
        if (r.classification === 'PRESENT' || r.classification === 'ABSENT') {
          return observed(input, value);
        }
        if (r.classification === 'PRESENT_BUT_CONDITIONED') return derived(input, value);
        return unavailable(input, note);
      });

  const byReason = new Map<string, number>();
  for (const e of s.exclusions) {
    byReason.set(e.reason, (byReason.get(e.reason) ?? 0) + 1);
  }
  const unknowns: InspectorField[] = byReason.size === 0
    ? [unavailable({
      id: 'no-excl', label: 'elenen aday', source: SRC,
      note: 'Korpus dışı bırakılan aday kaydı yok.',
    })]
    : [...byReason.entries()].map(([reason, n]) => observed({
      id: `excl-${reason}`,
      label: PROBE_EXCLUSION_LABEL[reason as keyof typeof PROBE_EXCLUSION_LABEL] ?? reason,
      source: SRC,
      note: 'Sessiz eleme YASAK: elenen her aday gerekçesiyle sayılır.',
    }, n));

  return [
    { id: 'run', title: DISCOVERY_CARD_TITLE.run, fields: run },
    { id: 'coverage', title: DISCOVERY_CARD_TITLE.coverage, fields: coverage },
    { id: 'transport', title: DISCOVERY_CARD_TITLE.transport, fields: transport },
    { id: 'services', title: DISCOVERY_CARD_TITLE.services, fields: services },
    { id: 'unknowns', title: DISCOVERY_CARD_TITLE.unknowns, fields: unknowns },
  ];
}

/** Sınıf dağılımı — başlık şeridi için. */
export function countByDiscoveryClass(
  cards: readonly DiscoveryCard[],
): Readonly<Record<'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE', number>> {
  const out = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  for (const c of cards) for (const f of c.fields) out[f.klass]++;
  return out;
}

/** Ekranda gösterilecek varlık etiketleri (test ve UI listeleri için). */
export const DISCOVERY_PRESENCE_ORDER: readonly ServicePresence[] = [
  'PRESENT', 'PRESENT_BUT_CONDITIONED', 'ABSENT', 'UNKNOWN',
  'UNKNOWN_TRANSPORT_LIMIT', 'UNKNOWN_ADDRESSING', 'UNKNOWN_RESPONSE_SHAPE',
  'DEFERRED', 'PROBE_FORBIDDEN', 'NOT_PROBED',
] as const;
