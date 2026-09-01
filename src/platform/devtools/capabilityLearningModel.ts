/**
 * capabilityLearningModel — CAROS LAB · Araç Öğrenmesi SAF model katmanı.
 *
 * SAF: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 * Sınıflandırma `sessionInspectorModel` sözleşmesini KULLANIR — paralel sistem YOK.
 *
 * ⚠️ EN ÖNEMLİ KURAL: **hiç öğrenme yoksa sayı `0` GÖSTERİLMEZ.**
 * `0` bir ölçümdür ("öğrendik ve boş"); ölçüm yokluğu `KAYNAK YOK`tur.
 * Bozuk/uyumsuz depoda da sayaç gösterilmez — güvenilmeyen bir belleğin
 * sayısı, sayı değildir.
 */

import {
  observed, derived, unavailable, type InspectorField,
} from './sessionInspectorModel';
import type { CapabilityLearningRawSnapshot } from './capabilityLearningSources';
import {
  STORE_HEALTH_LABEL, isStoreTrustworthy,
} from '../obd/capability/capabilityStore';
import {
  CAPABILITY_CONFLICT_LABEL, CAPABILITY_PROVENANCE_LABEL, CAPABILITY_FRESH_MS,
} from '../obd/capability/capabilityGraph';
import { SERVICE_PRESENCE_LABEL } from '../obd/ecuCapabilityModel';

const SRC = 'obd/capability/capabilityStore';

export type LearningCardId = 'store' | 'graph' | 'savings' | 'conflicts' | 'capabilities';

export const LEARNING_CARD_ORDER: readonly LearningCardId[] =
  ['store', 'graph', 'savings', 'conflicts', 'capabilities'] as const;

export const LEARNING_CARD_TITLE: Readonly<Record<LearningCardId, string>> = {
  store:        '1 · Depo Sağlığı',
  graph:        '2 · Yetenek Çizgesi',
  savings:      '3 · Yoklama Tasarrufu',
  conflicts:    '4 · Çelişkiler',
  capabilities: '5 · Öğrenilmiş Yetenekler',
} as const;

export interface LearningCard {
  readonly id: LearningCardId;
  readonly title: string;
  readonly fields: readonly InspectorField[];
}

export type LearningVerdict =
  | 'NEVER_LEARNED' | 'STORE_UNTRUSTWORTHY' | 'CONFLICTED' | 'UNTRUSTED_ONLY' | 'LEARNED';

export const LEARNING_VERDICT_LABEL: Readonly<Record<LearningVerdict, string>> = {
  NEVER_LEARNED:       'HİÇ ÖĞRENME YOK — yeniden kullanılacak kanıt yok',
  STORE_UNTRUSTWORTHY: 'DEPO GÜVENİLMEZ — temiz keşfe dönüldü, "öğrendik" DENMEZ',
  CONFLICTED:          'ÇELİŞKİ VAR — ilgili yetenekler yeniden ölçülecek',
  UNTRUSTED_ONLY:      'YALNIZ MASA BAŞI KANIT — ürün öğrenmesi sayılmaz',
  LEARNED:             'ÖĞRENİLDİ — canlı kanıtla yeniden kullanılabilir',
} as const;

export interface LearningVerdictResult {
  readonly status: LearningVerdict;
  readonly reasons: readonly string[];
}

export function deriveLearningVerdict(
  s: CapabilityLearningRawSnapshot,
): LearningVerdictResult {
  const reasons: string[] = [];
  if (s.health !== null && !isStoreTrustworthy(s.health)) {
    reasons.push(`Depo durumu: ${STORE_HEALTH_LABEL[s.health]}.`);
    reasons.push('Güvenilmeyen bellek okunmaz ve üstüne YAZILMAZ.');
    return { status: 'STORE_UNTRUSTWORTHY', reasons };
  }
  const sum = s.summary;
  if (sum === null || sum.neverLearned) {
    reasons.push('Bu cihazda tek bir yetenek bile öğrenilmedi.');
    reasons.push('Sayaçlar `0` DEĞİL `KAYNAK YOK` gösterir.');
    return { status: 'NEVER_LEARNED', reasons };
  }
  if (sum.conflicts > 0) {
    reasons.push(`${sum.conflicts} kenarda çözülmemiş çelişki var.`);
    reasons.push('Çelişkili kayıt yeniden kullanılmaz — yoklama tekrarlanır.');
    return { status: 'CONFLICTED', reasons };
  }
  if (sum.trusted === 0) {
    reasons.push(`${sum.untrusted} kenar var ama hiçbiri CANLI kanıt değil.`);
    reasons.push('Replay/sentetik veri ürün öğrenmesi üretmez.');
    return { status: 'UNTRUSTED_ONLY', reasons };
  }
  reasons.push(`${sum.trusted} kenar canlı kanıtla öğrenildi (${sum.vehicles} araç · ${sum.ecus} ECU).`);
  if (sum.stale > 0) reasons.push(`${sum.stale} kenar bayat — yeniden ölçülecek.`);
  return { status: 'LEARNED', reasons };
}

/** Öğrenme yoksa ya da depo güvenilmezse sayı yerine KAYNAK YOK. */
function _count(
  id: string, label: string, note: string,
  value: number | null, blind: boolean,
): InspectorField {
  if (blind || value === null) {
    return unavailable({ id, label, source: SRC, note },
      'Öğrenme kanıtı yok ya da depo güvenilmez — `0` bir ölçüm olurdu.');
  }
  return observed({ id, label, source: SRC, note }, value);
}

export function buildLearningCards(
  s: CapabilityLearningRawSnapshot,
): readonly LearningCard[] {
  const sum = s.summary;
  const untrusted = s.health !== null && !isStoreTrustworthy(s.health);
  const blind = untrusted || sum === null || sum.neverLearned;

  const store: InspectorField[] = [
    s.health === null
      ? unavailable({ id: 'health', label: 'depo sağlığı', source: SRC, note: 'Okunamadı.' })
      : observed({
        id: 'health', label: 'depo sağlığı', source: SRC,
        note: 'Bozuk/uyumsuz depo yok sayılır ve ÖĞRENME İDDİA EDİLMEZ.',
      }, STORE_HEALTH_LABEL[s.health]),
    observed({
      id: 'schema', label: 'şema sürümü', source: SRC,
      note: 'Bilinmeyen sürüm fail-closed reddedilir; geriye dönük tahmin YOK.',
    }, s.schemaVersion),
    s.loaded === null
      ? unavailable({ id: 'loaded', label: 'yüklendi mi', source: SRC, note: 'Okunamadı.' })
      : derived({
        id: 'loaded', label: 'yüklendi mi', source: SRC,
        note: 'Depo bu süreçte okundu mu.',
      }, s.loaded ? 'EVET' : 'HAYIR'),
    _count('dropped', 'tavan taşması', 'Tavan aşıldığı için saklanamayan kenar.',
      s.dropped, untrusted),
  ];

  const graph: InspectorField[] = [
    _count('vehicles', 'öğrenilmiş araç', 'Kaç farklı araç parmak izi.', sum?.vehicles ?? null, blind),
    _count('ecus', 'öğrenilmiş ECU', 'Kaç farklı ECU parmak izi.', sum?.ecus ?? null, blind),
    _count('edges', 'öğrenilmiş yetenek', 'Servis/alt fonksiyon kenar sayısı.', sum?.edges ?? null, blind),
    _count('trusted', 'ÜRÜN-GÜVENİLİR (canlı)', 'Yalnız canlı araç kanıtı sayılır.',
      sum?.trusted ?? null, blind),
    _count('untrusted', 'güvenilmez (replay/sentetik)', 'Masa başı kanıt — yeniden kullanılamaz.',
      sum?.untrusted ?? null, blind),
    _count('stale', 'bayat kayıt', `Tazelik penceresi ${Math.round(CAPABILITY_FRESH_MS / 86_400_000)} gün.`,
      sum?.stale ?? null, blind),
  ];

  const savings: InspectorField[] = [
    _count('reused', 'atlanan yoklama', 'Öğrenme sayesinde HİÇ gönderilmeyen istek.',
      s.reusedProbes ?? null, untrusted || (s.reusedProbes ?? 0) === 0),
    _count('saved', 'tasarruf edilen istek', 'Hatta çıkmayan PDU sayısı (ölçüm).',
      s.savedRequests ?? null, untrusted || (s.savedRequests ?? 0) === 0),
  ];

  const conflictEdges = s.edges.filter((e) => e.conflict !== null);
  const conflicts: InspectorField[] = conflictEdges.length === 0
    ? [blind
      ? unavailable({ id: 'no-conflict', label: 'çelişki', source: SRC, note: 'Öğrenme yok.' })
      : observed({
        id: 'no-conflict', label: 'çelişki', source: SRC,
        note: 'Çelişki sessizce çözülmez; olsaydı burada sayılırdı.',
      }, 0)]
    : conflictEdges.slice(0, 20).map((e) => observed({
      id: `conf-${e.ecuId}-${e.service}${e.subFunction ?? ''}`,
      label: `${e.service}${e.subFunction === null ? '' : `-${e.subFunction}`}`,
      source: `${SRC} · ${e.ecuId}`,
      note: `${CAPABILITY_CONFLICT_LABEL[e.conflict!.kind]} · kotaya kalan ${e.conflict!.quorumRemaining}`,
    }, `${SERVICE_PRESENCE_LABEL[e.conflict!.previous]} → ${SERVICE_PRESENCE_LABEL[e.conflict!.observed]}`));

  const capabilities: InspectorField[] = s.edges.length === 0
    ? [unavailable({
      id: 'no-cap', label: 'öğrenilmiş yetenek', source: SRC,
      note: 'Ölçüm olmadan yetenek öğrenilmez.',
    }, 'Hiç öğrenme yok.')]
    : [...s.edges]
      .sort((a, b) => (a.ecuId + a.service + (a.subFunction ?? ''))
        .localeCompare(b.ecuId + b.service + (b.subFunction ?? '')))
      .slice(0, 40)
      .map((e) => {
        const input = {
          id: `cap-${e.ecuId}-${e.service}${e.subFunction ?? ''}`,
          label: `${e.service}${e.subFunction === null ? '' : `-${e.subFunction}`}`,
          source: `${SRC} · ${e.ecuId}`,
          note: `${CAPABILITY_PROVENANCE_LABEL[e.provenance]} · ${e.observationCount}× gözlem`
            + (e.productTrusted ? '' : ' · ÜRÜN ÖĞRENMESİ DEĞİL'),
        };
        const value = SERVICE_PRESENCE_LABEL[e.presence];
        /* Yalnız CANLI kanıt ÖLÇÜLDÜ sayılır; masa başı kanıt TÜRETİLDİ'dir. */
        return e.productTrusted ? observed(input, value) : derived(input, value);
      });

  return [
    { id: 'store', title: LEARNING_CARD_TITLE.store, fields: store },
    { id: 'graph', title: LEARNING_CARD_TITLE.graph, fields: graph },
    { id: 'savings', title: LEARNING_CARD_TITLE.savings, fields: savings },
    { id: 'conflicts', title: LEARNING_CARD_TITLE.conflicts, fields: conflicts },
    { id: 'capabilities', title: LEARNING_CARD_TITLE.capabilities, fields: capabilities },
  ];
}

export function countByLearningClass(
  cards: readonly LearningCard[],
): Readonly<Record<'OBSERVED' | 'DERIVED' | 'UNAVAILABLE' | 'STALE', number>> {
  const out = { OBSERVED: 0, DERIVED: 0, UNAVAILABLE: 0, STALE: 0 };
  for (const c of cards) for (const f of c.fields) out[f.klass]++;
  return out;
}
