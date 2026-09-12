/**
 * capabilityLearningLab.test — P0-VDK-F4C · LAB gözlem yüzeyi kilitleri.
 *
 * EN KRİTİK İKİ KİLİT:
 *  1. Hiç öğrenme yoksa ekran `0` GÖSTERMEZ (`KAYNAK YOK`).
 *  2. **Bozuk/uyumsuz depo "öğrendik" DEMEZ** — sayaçlar da gösterilmez.
 *     Güvenilmeyen bir belleğin sayısı, sayı değildir.
 */

import { describe, it, expect } from 'vitest';

import {
  buildLearningCards, deriveLearningVerdict, countByLearningClass,
  LEARNING_CARD_ORDER,
} from '../platform/devtools/capabilityLearningModel';
import type { CapabilityLearningRawSnapshot } from '../platform/devtools/capabilityLearningSources';
import {
  mergeCapabilityObservation, summarizeGraph, CAPABILITY_FRESH_MS,
  type CapabilityEdge, type CapabilityObservationInput,
} from '../platform/obd/capability/capabilityGraph';
import { CAPABILITY_SCHEMA_VERSION } from '../platform/obd/capability/capabilityStore';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';

const T0 = 1_000_000;

const OBS = (over: Partial<CapabilityObservationInput> = {}): CapabilityObservationInput => ({
  vehicleId: 'V1', ecuId: 'E1', service: '19', subFunction: '02',
  presence: 'PRESENT', provenance: 'live', protocol: '6',
  transport: { genericBridge: true, routePolicy: 'generic_only', adapterHash: null },
  evidenceRef: 'c1', nrc: null, atMs: T0, ...over,
});

const EDGE = (over: Partial<CapabilityObservationInput> = {}): CapabilityEdge =>
  mergeCapabilityObservation(null, OBS(over));

function snap(over: Partial<CapabilityLearningRawSnapshot> = {}): CapabilityLearningRawSnapshot {
  const edges = over.edges ?? [];
  return {
    readAt: T0 + 100, edges,
    summary: summarizeGraph(edges, T0 + 100),
    health: 'OK', loaded: true,
    savedRequests: 0, reusedProbes: 0, dropped: 0,
    schemaVersion: CAPABILITY_SCHEMA_VERSION,
    ...over,
  };
}

describe('F4C LAB · hiç öğrenme yoksa 0 DEĞİL KAYNAK YOK', () => {
  it('boş çizgede çizge sayaçları UNAVAILABLE olur', () => {
    const graph = buildLearningCards(snap()).find((c) => c.id === 'graph')!;
    expect(graph.fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
    expect(graph.fields.every((f) => f.value === '—')).toBe(true);
    expect(deriveLearningVerdict(snap()).status).toBe('NEVER_LEARNED');
  });

  it('öğrenme varsa sayaçlar ÖLÇÜLDÜ olur', () => {
    const graph = buildLearningCards(snap({ edges: [EDGE()] })).find((c) => c.id === 'graph')!;
    expect(graph.fields.find((f) => f.id === 'edges')?.value).toBe('1');
    expect(graph.fields.find((f) => f.id === 'trusted')?.value).toBe('1');
    /* GERÇEK sıfır ölçümdür ve gösterilir. */
    expect(graph.fields.find((f) => f.id === 'untrusted')?.klass).toBe('OBSERVED');
    expect(graph.fields.find((f) => f.id === 'untrusted')?.value).toBe('0');
  });
});

describe('F4C LAB · güvenilmez depo "öğrendik" demez', () => {
  it('BOZUK depoda hüküm STORE_UNTRUSTWORTHY ve sayaçlar KAYNAK YOK', () => {
    const s = snap({ health: 'CORRUPT', edges: [EDGE()] });
    expect(deriveLearningVerdict(s).status).toBe('STORE_UNTRUSTWORTHY');
    const graph = buildLearningCards(s).find((c) => c.id === 'graph')!;
    expect(graph.fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
  });

  it('ŞEMA UYUŞMAZLIĞI da güvenilmezdir', () => {
    expect(deriveLearningVerdict(snap({ health: 'SCHEMA_MISMATCH' })).status)
      .toBe('STORE_UNTRUSTWORTHY');
  });

  it('boş depo bir ARIZA değildir — hüküm NEVER_LEARNED', () => {
    expect(deriveLearningVerdict(snap({ health: 'EMPTY' })).status).toBe('NEVER_LEARNED');
  });
});

describe('F4C LAB · güven ve çelişki görünür', () => {
  it('yalnız replay kanıtı varsa hüküm UNTRUSTED_ONLY', () => {
    const s = snap({ edges: [EDGE({ provenance: 'replay' })] });
    expect(deriveLearningVerdict(s).status).toBe('UNTRUSTED_ONLY');
    const caps = buildLearningCards(s).find((c) => c.id === 'capabilities')!;
    /* Masa başı kanıt ÖLÇÜLDÜ değil TÜRETİLDİ'dir. */
    expect(caps.fields[0].klass).toBe('DERIVED');
    expect(caps.fields[0].note).toContain('ÜRÜN ÖĞRENMESİ DEĞİL');
  });

  it('çelişki kartta gerekçesiyle görünür ve hüküm CONFLICTED olur', () => {
    const conflicted = mergeCapabilityObservation(EDGE(),
      OBS({ presence: 'ABSENT', nrc: 0x11, atMs: T0 + 5 }));
    const s = snap({ edges: [conflicted] });
    expect(deriveLearningVerdict(s).status).toBe('CONFLICTED');
    const card = buildLearningCards(s).find((c) => c.id === 'conflicts')!;
    expect(card.fields[0].note).toContain('kanıtlı VAR iken YOK ölçüldü');
    expect(card.fields[0].note).toContain('kotaya kalan');
  });

  it('bayat kayıt hükümde belirtilir', () => {
    const s = snap({
      edges: [EDGE()],
      summary: summarizeGraph([EDGE()], T0 + CAPABILITY_FRESH_MS + 10),
    });
    const v = deriveLearningVerdict(s);
    expect(v.status).toBe('LEARNED');
    expect(v.reasons.join(' ')).toContain('bayat');
  });

  it('tasarruf sayaçları ölçüm yoksa KAYNAK YOK, varsa ÖLÇÜLDÜ', () => {
    const none = buildLearningCards(snap()).find((c) => c.id === 'savings')!;
    expect(none.fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
    const some = buildLearningCards(snap({
      edges: [EDGE()], reusedProbes: 2, savedRequests: 2,
    })).find((c) => c.id === 'savings')!;
    expect(some.fields.find((f) => f.id === 'saved')?.value).toBe('2');
  });

  it('tüm kartlar üretilir, sıra sabit, sayaç tutarlı', () => {
    const cards = buildLearningCards(snap({ edges: [EDGE()] }));
    expect(cards.map((c) => c.id)).toEqual([...LEARNING_CARD_ORDER]);
    const c = countByLearningClass(cards);
    expect(c.OBSERVED + c.DERIVED + c.UNAVAILABLE + c.STALE)
      .toBe(cards.reduce((n, x) => n + x.fields.length, 0));
  });
});

describe('F4C LAB · katalog kaydı dürüst', () => {
  it('araç AVAILABLE ve notunda yerel/gizlilik/güven sınırları yazılı', () => {
    const t = CAROS_LAB_TOOLS.find((x) => x.id === 'capability-learning');
    expect(t).toBeDefined();
    expect(t?.status).toBe('AVAILABLE');
    expect(t?.note).toContain('YALNIZ YEREL');
    expect(t?.note).toContain('ham VIN/MAC depoya GİRMEZ');
    expect(t?.note).toContain('replay/sentetik');
    expect(t?.note).toContain('Gerçek araç doğrulaması YAPILMADI');
  });
});
