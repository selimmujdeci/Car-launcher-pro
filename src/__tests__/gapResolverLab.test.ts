/**
 * gapResolverLab.test — P0-VDK-F5A · LAB gözlem yüzeyi kilitleri.
 *
 * EN KRİTİK İKİ KİLİT:
 *  1. Çözücü hiç koşmadıysa ekran `0` GÖSTERMEZ → `KAYNAK YOK`.
 *  2. Çözücü koştu ve açık boşluk gerçekten 0 ise → `AÇIK GAP 0 — ÖLÇÜLDÜ`.
 *     Bu ikisi aynı `0` ile gösterilirse ölçülmemiş bir sistem sağlıklı ilan
 *     edilmiş olur — bu, bu ekranın engellemek için var olduğu hatadır.
 *
 * LAB HİÇBİR İŞLEM TETİKLEMEZ: model saftır, kaynak katmanı yalnız okur.
 */

import { describe, it, expect } from 'vitest';

import {
  buildResolverCards, buildResolverRows, deriveResolverVerdict,
  RESOLVER_CARD_ORDER, RESOLVER_VERDICT_LABEL, MAX_RESOLVER_ROWS,
} from '../platform/devtools/gapResolverModel';
import type { GapResolverRawSnapshot } from '../platform/devtools/gapResolverSources';
import {
  initialGapState, summarizeGapStates,
  type GapState, type ResolvableGap,
} from '../platform/obd/healing/gapModel';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';
import { readGapResolverSnapshot } from '../platform/devtools/gapResolverSources';
import {
  getHealingTriggerEvidence, _resetHealingTriggerForTest,
  HEALING_BUDGET_SHARE, HEALING_MIN_RESERVE_REQUESTS, MAX_HEALING_RUNS_PER_EPOCH,
  type HealingTriggerEvidence,
} from '../platform/obd/healing/selfHealingTrigger';
import {
  DISCOVERY_BUDGET_SHARE, DISCOVERY_MIN_RESERVE_REQUESTS, DISCOVERY_MAX_ECUS,
  _resetProductionDiscoveryForTest, getProductionDiscoveryEvidence,
  type ProductionDiscoveryEvidence,
} from '../platform/obd/healing/productionDiscovery';
import {
  SESSION_CHAIN_COST, _resetSessionHealingForTest, getSessionHealingEvidence,
  type SessionHealingEvidence,
} from '../platform/obd/healing/sessionHealing';

const T0 = 1_000_000;

const gap = (over: Partial<ResolvableGap> = {}): ResolvableGap => ({
  key: 'K1', origin: 'REGISTRY', gapClass: 'UNKNOWN_SERVICE', scope: 'AUTHORITY',
  target: { ecuKey: 'ECM@7E0', service: '19', subFunction: '02' },
  context: 'discovery:1902', observations: 2, lastSeenMs: T0, lastNrc: null,
  transportLimited: false, sessionConditioned: false, ...over,
});

const state = (over: Partial<GapState> = {}): GapState => ({
  ...initialGapState(gap(), 'CAPABILITY_UNMEASURED'), ...over,
});

function snap(over: Partial<GapResolverRawSnapshot> = {}): GapResolverRawSnapshot {
  const states = over.states ?? [];
  const ran = over.runCount !== undefined && over.runCount !== null
    ? over.runCount > 0 : false;
  return {
    readAt: T0 + 100,
    states,
    summary: summarizeGapStates(states, ran),
    runCount: 0,
    dropped: 0,
    registry: [],
    registryDropped: 0,
    evidenceCoverage: null,
    ledgerLoaded: false,
    ledgerHealth: null,
    ledgerSchemaVersion: 1,
    ledgerRestored: null,
    ledgerRestoredAt: null,
    ledgerSavedAt: null,
    ledgerLastSaveOk: null,
    ledgerNotPersisted: null,
    evicted: null,
    evictionReasons: null,
    maxEntries: 120,
    maxPerFamily: 8,
    maxPerEcu: 40,
    ledgerScope: null,
    ledgerBootAt: null,
    ledgerRestoreAttempted: false,
    ledgerSwitchCount: null,
    ledgerDetachedRef: null,
    ledgerBlockedWrites: null,
    legacyUnscopedPresent: null,
    capabilityScope: null,
    capabilityPartitionKey: null,
    capabilityHealth: null,
    capabilityEdgeCount: null,
    capabilityBlockedWrites: null,
    capabilitySwitchCount: null,
    partitionCatalogLoaded: null,
    partitionCatalogHealth: null,
    partitions: [],
    maxPartitions: 8,
    partitionLastGcAt: null,
    partitionEvictedTotal: null,
    partitionPartialGc: null,
    partitionCorrupt: null,
    capability: null,
    maxStates: 160,
    maxAttemptsPerTriple: 2,
    maxAttemptsPerGap: 4,
    maxGapsPerRun: 8,
    triggerEverEvaluated: false,
    lastTrigger: null,
    triggerHistory: [],
    budgetShare: HEALING_BUDGET_SHARE,
    budgetMaxRequests: 10,
    budgetReserve: HEALING_MIN_RESERVE_REQUESTS,
    maxRunsPerEpoch: MAX_HEALING_RUNS_PER_EPOCH,
    discoveryEverEvaluated: false,
    lastDiscovery: null,
    discoveryShare: DISCOVERY_BUDGET_SHARE,
    discoveryReserve: DISCOVERY_MIN_RESERVE_REQUESTS,
    discoveryMaxEcus: DISCOVERY_MAX_ECUS,
    sessionHealingEverEvaluated: false,
    lastSessionHealing: null,
    sessionChainCost: SESSION_CHAIN_COST,
    ...over,
  };
}

const ses = (over: Partial<SessionHealingEvidence> = {}): SessionHealingEvidence => ({
  gapKey: 'K1', decision: 'RUN', reason: 'ölçülmüş oturum komutu',
  evidenceSource: 'MEASURED_SESSION_COMMAND', sessionCommand: '1003',
  sessionOpen: 'POSITIVE', leaseState: 'ACTIVE',
  testerPresentRequired: true, testerPresent: 'POSITIVE',
  probeClassification: 'PRESENT', requestsUsed: 2, atMs: T0, ...over,
});

const dsc = (over: Partial<ProductionDiscoveryEvidence> = {}): ProductionDiscoveryEvidence => ({
  decision: 'RUN', reason: 'kalan 160 istekten 12 pay ayrıldı · 1 ölçülmüş hedef',
  allocatedRequests: 12, usedRequests: 5, ecusProbed: 1, reusedProbes: 2,
  gapsProduced: 3, fingerprintReusable: true, atMs: T0, sessionEpoch: 0, ...over,
});

const trg = (over: Partial<HealingTriggerEvidence> = {}): HealingTriggerEvidence => ({
  trigger: 'AFTER_FULL_VEHICLE_SCAN', decision: 'RUN',
  reason: 'kalan 160 istekten 10 pay ayrıldı', allocatedRequests: 10,
  allocatedTimeMs: 50_000, usedRequests: 4, resolvedGaps: 1, openGaps: 2,
  savedRequests: 3, atMs: T0, sessionEpoch: 0, ...over,
});

/* ══════════════════════════════════════════════════════════════════════════
   1) İKİ FARKLI SIFIR
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A LAB · "hiç koşmadı" ile "açık gap 0" KARIŞTIRILMAZ', () => {
  it('hiç koşmadıysa hüküm KAYNAK YOK', () => {
    const v = deriveResolverVerdict(snap());
    expect(v.status).toBe('NEVER_RAN');
    expect(RESOLVER_VERDICT_LABEL[v.status]).toContain('KAYNAK YOK');
  });

  it('hiç koşmadıysa sayaçlar 0 DEĞİL UNAVAILABLE', () => {
    const cards = buildResolverCards(snap());
    const run = cards.find((c) => c.id === 'run')!;
    const runs = run.fields.find((f) => f.id === 'runs')!;
    expect(runs.klass).toBe('UNAVAILABLE');
    expect(runs.value).not.toBe('0');

    const budget = cards.find((c) => c.id === 'budget')!;
    expect(budget.fields.find((f) => f.id === 'spent')!.klass).toBe('UNAVAILABLE');
    expect(budget.fields.find((f) => f.id === 'saved')!.klass).toBe('UNAVAILABLE');
  });

  it('hiç koşmadıysa yaşam döngüsü kartı da UNAVAILABLE', () => {
    const life = buildResolverCards(snap()).find((c) => c.id === 'lifecycle')!;
    expect(life.fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
  });

  it('koştu ve boşluk yoksa hüküm AÇIK GAP 0 — ÖLÇÜLDÜ', () => {
    const v = deriveResolverVerdict(snap({ runCount: 1, states: [] }));
    expect(v.status).toBe('NO_GAPS_MEASURED');
    expect(RESOLVER_VERDICT_LABEL[v.status]).toContain('ÖLÇÜLDÜ');
    expect(v.reasons.join(' ')).toContain('ölçüm yokluğu değildir');
  });

  it('koştuysa sayaçlar GERÇEK ölçüm olarak gösterilir', () => {
    const cards = buildResolverCards(snap({
      runCount: 3, states: [state({ requestsSpent: 5, requestsSaved: 2 })],
    }));
    const run = cards.find((c) => c.id === 'run')!;
    expect(run.fields.find((f) => f.id === 'runs')!.value).toBe('3');
    const budget = cards.find((c) => c.id === 'budget')!;
    expect(budget.fields.find((f) => f.id === 'spent')!.value).toBe('5');
    expect(budget.fields.find((f) => f.id === 'saved')!.value).toBe('2');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   2) HÜKÜM DALLARI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A LAB · hüküm dalları', () => {
  it('açık boşluk varsa ACTIVE', () => {
    expect(deriveResolverVerdict(snap({ runCount: 1, states: [state()] })).status)
      .toBe('ACTIVE');
  });

  it('canlı boşluk yok + tümü tükendiyse EXHAUSTED_ONLY', () => {
    const v = deriveResolverVerdict(snap({
      runCount: 1, states: [state({ lifecycle: 'EXHAUSTED' })],
    }));
    expect(v.status).toBe('EXHAUSTED_ONLY');
    expect(v.reasons.join(' ')).toContain('Yeni CANLI kanıt');
  });

  it('canlı boşluk yok + engelli varsa ALL_BLOCKED', () => {
    const v = deriveResolverVerdict(snap({
      runCount: 1, states: [state({ lifecycle: 'BLOCKED' })],
    }));
    expect(v.status).toBe('ALL_BLOCKED');
    expect(v.reasons.join(' ')).toContain('ön koşul');
  });

  it('hüküm etiketleri iddiayı kanıta bağlar', () => {
    expect(RESOLVER_VERDICT_LABEL.NEVER_RAN).toContain('hiç koşmadı');
    expect(RESOLVER_VERDICT_LABEL.EXHAUSTED_ONLY).toContain('tekrar YOK');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   3) SATIRLAR — görev listesinin istediği HER alan görünür
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A LAB · boşluk satırları', () => {
  const rows = () => buildResolverRows(snap({
    runCount: 1,
    states: [state({
      lifecycle: 'RESOLVED', selected: 'REPROBE_SERVICE',
      selectionReason: 'bilgi kazancı 8/10 · maliyet 1 istek',
      attempts: 1, lastOutcome: 'PRESENT:-',
      outcomeDetail: 'canlı kanıt: PRESENT — servis MEVCUT',
      requestsSpent: 1, requestsSaved: 3,
    })],
  }));

  it('gap türü · kök katman · kök neden gösterilir', () => {
    const r = rows()[0];
    expect(r.gapClass).toBe('UNKNOWN_SERVICE');
    expect(r.rootLayer).toBe('AUTHORITY');
    expect(r.rootCause).toContain('ÖLÇÜLMEDİ');
  });

  it('seçilen ölçüm ve NEDEN seçildiği gösterilir', () => {
    const r = rows()[0];
    expect(r.selected).toContain('yeniden yokla');
    expect(r.selectionReason).toContain('bilgi kazancı');
  });

  it('attempt · son sonuç · istek bütçesi gösterilir', () => {
    const r = rows()[0];
    expect(r.attempts).toBe('1');
    expect(r.lastOutcome).toBe('PRESENT:-');
    expect(r.requests).toContain('1 harcandı');
    expect(r.requests).toContain('3 kazanıldı');
  });

  it('RESOLVED/BLOCKED/EXHAUSTED durumu gösterilir', () => {
    expect(rows()[0].lifecycle).toContain('KAPANDI');
  });

  it('hedefsiz boşlukta "HEDEF YOK" yazar (uydurma hedef yok)', () => {
    const r = buildResolverRows(snap({
      runCount: 1,
      states: [state({
        gap: gap({ target: { ecuKey: null, service: null, subFunction: null } }),
      })],
    }))[0];
    expect(r.target).toBe('HEDEF YOK');
  });

  it('satır listesi tavanlıdır (gürültü değil gözlem)', () => {
    const many = Array.from({ length: MAX_RESOLVER_ROWS + 20 }, (_, i) =>
      state({ gap: gap({ key: `K${i}` }) }));
    expect(buildResolverRows(snap({ runCount: 1, states: many })))
      .toHaveLength(MAX_RESOLVER_ROWS);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   4) KART DÜZENİ ve KATALOG
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5A LAB · kart düzeni ve katalog dürüstlüğü', () => {
  it('kart sırası sabit', () => {
    expect(buildResolverCards(snap()).map((c) => c.id))
      .toEqual([...RESOLVER_CARD_ORDER]);
  });

  it('öğrenme yoksa etki kartı KAYNAK YOK der', () => {
    const impact = buildResolverCards(snap()).find((c) => c.id === 'impact')!;
    expect(impact.fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
  });

  it('öğrenme varsa yetenek çizgesi etkisi ölçüm olarak gösterilir', () => {
    const impact = buildResolverCards(snap({
      runCount: 1,
      capability: {
        vehicles: 1, ecus: 1, edges: 4, trusted: 3, untrusted: 1,
        conflicts: 1, stale: 2, neverLearned: false,
      },
    })).find((c) => c.id === 'impact')!;
    expect(impact.fields.find((f) => f.id === 'edges')!.value).toBe('4');
    expect(impact.fields.find((f) => f.id === 'conf')!.value).toBe('1');
  });

  it('anti-döngü tavanları ekranda AÇIKÇA yazılı', () => {
    const budget = buildResolverCards(snap()).find((c) => c.id === 'budget')!;
    expect(budget.fields.find((f) => f.id === 'ceil1')!.value).toBe('2');
    expect(budget.fields.find((f) => f.id === 'ceil2')!.value).toBe('4');
  });

  it('katalog kaydı AVAILABLE ve notunda güvenlik/dürüstlük sınırları yazılı', () => {
    const t = CAROS_LAB_TOOLS.find((x) => x.id === 'gap-resolver');
    expect(t).toBeDefined();
    expect(t?.status).toBe('AVAILABLE');
    expect(t?.note).toContain('KENDİ ÖLÇÜM MOTORUNU KURMAZ');
    expect(t?.note).toContain('destructive hiçbir aksiyon üretilemez');
    expect(t?.note).toContain('Kör ECU/adres taraması YOKTUR');
    expect(t?.note).toContain('TAŞIMA sınırı araç sınırı SAYILMAZ');
    expect(t?.note).toContain('replay/sentetik');
    expect(t?.note).toContain('EXHAUSTED');
    expect(t?.note).toContain('KAYNAK YOK');
    expect(t?.note).toContain('Gerçek araç doğrulaması YAPILMADI');
  });

  it('LAB hiçbir aktif komut adı taşımaz (salt-okunur sözleşmesi)', () => {
    const t = CAROS_LAB_TOOLS.find((x) => x.id === 'gap-resolver');
    expect(t?.note).toContain('Hiçbir şey BAŞLATMAZ');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   5) P0-VDK-F5B · ÜRETİM TETİĞİ KARTI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B LAB · üretim tetiği görünür', () => {
  it('tetik hiç değerlendirilmediyse KAYNAK YOK (0 değil)', () => {
    const c = buildResolverCards(snap()).find((x) => x.id === 'trigger')!;
    expect(c.fields.every((f) => f.klass === 'UNAVAILABLE' || f.klass === 'DERIVED'))
      .toBe(true);
    expect(c.fields.find((f) => f.id === 'trg')!.klass).toBe('UNAVAILABLE');
  });

  it('neden tekrar çalışmadığı AÇIKÇA yazılı', () => {
    const c = buildResolverCards(snap()).find((x) => x.id === 'trigger')!;
    expect(c.fields.find((f) => f.id === 'trgwhy')!.value.length).toBeGreaterThan(0);
  });

  it('çalışan tur: tetik nedeni · sonuç · ayrılan ve kullanılan bütçe görünür', () => {
    const c = buildResolverCards(snap({
      runCount: 1, triggerEverEvaluated: true, lastTrigger: trg(),
    })).find((x) => x.id === 'trigger')!;
    const get = (id: string) => c.fields.find((f) => f.id === id)!;
    expect(get('trg').value).toContain('tam araç taraması');
    expect(get('trgres').value).toContain('ÇALIŞTI');
    expect(get('trgalloc').value).toContain('10 istek');
    expect(get('trgused').value).toBe('4');
    expect(get('trgres2').value).toBe('1');
    expect(get('trgopen').value).toBe('2');
    expect(get('trgsaved').value).toBe('3');
  });

  it('ertelenen turda kullanılan istek KAYNAK YOK (sahte 0 yok)', () => {
    const c = buildResolverCards(snap({
      runCount: 1, triggerEverEvaluated: true,
      lastTrigger: trg({ decision: 'DEFERRED', usedRequests: null,
        resolvedGaps: null, savedRequests: null }),
    })).find((x) => x.id === 'trigger')!;
    expect(c.fields.find((f) => f.id === 'trgused')!.klass).toBe('UNAVAILABLE');
    expect(c.fields.find((f) => f.id === 'trgres2')!.klass).toBe('UNAVAILABLE');
  });

  it('damga yoksa sahte tarih ÜRETİLMEZ', () => {
    const c = buildResolverCards(snap({
      runCount: 1, triggerEverEvaluated: true, lastTrigger: trg({ atMs: null }),
    })).find((x) => x.id === 'trigger')!;
    expect(c.fields.find((f) => f.id === 'trgat')!.klass).toBe('UNAVAILABLE');
  });

  it('mühür ölçülemediyse ÖLÇÜLEMEDİ yazar', () => {
    const c = buildResolverCards(snap({
      runCount: 1, triggerEverEvaluated: true, lastTrigger: trg({ sessionEpoch: -1 }),
    })).find((x) => x.id === 'trigger')!;
    expect(c.fields.find((f) => f.id === 'trgepoch')!.value).toBe('ÖLÇÜLEMEDİ');
  });

  it('bütçe kartı pay · rezerv · anti-storm tavanını gösterir', () => {
    const b = buildResolverCards(snap()).find((x) => x.id === 'budget')!;
    expect(b.fields.find((f) => f.id === 'share')!.value).toContain('%25');
    expect(b.fields.find((f) => f.id === 'reserve')!.value)
      .toContain(String(HEALING_MIN_RESERVE_REQUESTS));
    expect(b.fields.find((f) => f.id === 'epochcap')!.value)
      .toBe(String(MAX_HEALING_RUNS_PER_EPOCH));
  });
});

describe('F5B LAB · ekranı OKUMAK hiçbir şey tetiklemez', () => {
  it('anlık görüntü okumak tetik defterine kayıt EKLEMEZ', () => {
    _resetHealingTriggerForTest();
    expect(getHealingTriggerEvidence()).toHaveLength(0);
    readGapResolverSnapshot();
    readGapResolverSnapshot();
    readGapResolverSnapshot();
    expect(getHealingTriggerEvidence()).toHaveLength(0);
  });

  it('anlık görüntü iki kez okununca aynı sayaçları verir (yan etki yok)', () => {
    _resetHealingTriggerForTest();
    const a = readGapResolverSnapshot();
    const b = readGapResolverSnapshot();
    expect(b.runCount).toBe(a.runCount);
    expect(b.states.length).toBe(a.states.length);
    expect(b.triggerEverEvaluated).toBe(a.triggerEverEvaluated);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   6) P0-VDK-F5B.1 · ÜRETİM SERVİS KEŞFİ KARTI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5B.1 LAB · üretim servis keşfi görünür', () => {
  it('keşif hiç değerlendirilmediyse KAYNAK YOK (0 değil)', () => {
    const c = buildResolverCards(snap()).find((x) => x.id === 'discovery')!;
    expect(c.fields.find((f) => f.id === 'dsc')!.klass).toBe('UNAVAILABLE');
    expect(c.fields.find((f) => f.id === 'dscwhy')!.value.length).toBeGreaterThan(0);
  });

  it('çalıştıysa ECU · istek · reuse · gap · parmak izi ölçüm olarak görünür', () => {
    const c = buildResolverCards(snap({
      discoveryEverEvaluated: true, lastDiscovery: dsc(),
    })).find((x) => x.id === 'discovery')!;
    const get = (id: string) => c.fields.find((f) => f.id === id)!;
    expect(get('dsc').value).toContain('ÇALIŞTI');
    expect(get('dscalloc').value).toBe('12');
    expect(get('dscused').value).toBe('5');
    expect(get('dscecus').value).toContain('1');
    expect(get('dscreuse').value).toBe('2');
    expect(get('dscgaps').value).toBe('3');
    expect(get('dscfp').value).toContain('EVET');
  });

  it('engellenen turda ölçüm alanları KAYNAK YOK', () => {
    const c = buildResolverCards(snap({
      discoveryEverEvaluated: true,
      lastDiscovery: dsc({ decision: 'BLOCKED', usedRequests: null,
        ecusProbed: null, reusedProbes: null, gapsProduced: null }),
    })).find((x) => x.id === 'discovery')!;
    for (const id of ['dscused', 'dscecus', 'dscreuse', 'dscgaps']) {
      expect(c.fields.find((f) => f.id === id)!.klass).toBe('UNAVAILABLE');
    }
  });

  it('parmak izi zayıfsa fail-closed yeniden ölçüm YAZAR', () => {
    const c = buildResolverCards(snap({
      discoveryEverEvaluated: true, lastDiscovery: dsc({ fingerprintReusable: false }),
    })).find((x) => x.id === 'discovery')!;
    expect(c.fields.find((f) => f.id === 'dscfp')!.value).toContain('fail-closed');
  });

  it('kart sırası: keşif → tetik → çözüm (üretim akış sırası)', () => {
    const ids = buildResolverCards(snap()).map((c) => c.id);
    expect(ids.indexOf('discovery')).toBeLessThan(ids.indexOf('trigger'));
    expect(ids.indexOf('trigger')).toBeLessThan(ids.indexOf('run'));
  });

  it('LAB okumak keşif defterine kayıt EKLEMEZ (PDU gönderemez)', () => {
    _resetProductionDiscoveryForTest();
    expect(getProductionDiscoveryEvidence()).toHaveLength(0);
    readGapResolverSnapshot();
    readGapResolverSnapshot();
    expect(getProductionDiscoveryEvidence()).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
   7) P0-VDK-F5C · OTURUM-KOŞULLU İYİLEŞTİRME KARTI
   ══════════════════════════════════════════════════════════════════════════ */

describe('F5C LAB · oturum-koşullu iyileştirme görünür', () => {
  it('hiç değerlendirilmediyse KAYNAK YOK (0 değil)', () => {
    const c = buildResolverCards(snap()).find((x) => x.id === 'session')!;
    expect(c.fields.find((f) => f.id === 'ses')!.klass).toBe('UNAVAILABLE');
  });

  it('çalışan zincir: kanıt · komut · oturum sonucu · kira · 3E · asıl yoklama', () => {
    const c = buildResolverCards(snap({
      sessionHealingEverEvaluated: true, lastSessionHealing: ses(),
    })).find((x) => x.id === 'session')!;
    const get = (id: string) => c.fields.find((f) => f.id === id)!;
    expect(get('sesev').value).toContain('ölçülmüş oturum komutu');
    expect(get('sescmd').value).toBe('1003');
    expect(get('sesopen').value).toContain('AÇILDI');
    expect(get('seslease').value).toBe('ACTIVE');
    expect(get('sestpreq').value).toBe('EVET');
    expect(get('sestp').value).toBe('POSITIVE');
    expect(get('sesprobe').value).toBe('PRESENT');
    expect(get('sescost').value).toBe('2');
  });

  it('oturum komutu ölçülmediyse UYDURULMAZ (KAYNAK YOK)', () => {
    const c = buildResolverCards(snap({
      sessionHealingEverEvaluated: true,
      lastSessionHealing: ses({ sessionCommand: null }),
    })).find((x) => x.id === 'session')!;
    const f = c.fields.find((x) => x.id === 'sescmd')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.note).toContain('uydurulmaz');
  });

  it('3E gönderilmediyse "başarısız" DEĞİL, KAYNAK YOK', () => {
    const c = buildResolverCards(snap({
      sessionHealingEverEvaluated: true,
      lastSessionHealing: ses({ testerPresent: null }),
    })).find((x) => x.id === 'session')!;
    const f = c.fields.find((x) => x.id === 'sestp')!;
    expect(f.klass).toBe('UNAVAILABLE');
    expect(f.note).toContain('gönderilmedi ≠ başarısız');
  });

  it('BLOCKED kararda ölçüm alanları KAYNAK YOK kalır', () => {
    const c = buildResolverCards(snap({
      sessionHealingEverEvaluated: true,
      lastSessionHealing: ses({
        decision: 'BLOCKED', sessionOpen: null, leaseState: null,
        probeClassification: null, requestsUsed: null, testerPresent: null,
      }),
    })).find((x) => x.id === 'session')!;
    for (const id of ['sesopen', 'seslease', 'sesprobe', 'sescost']) {
      expect(c.fields.find((f) => f.id === id)!.klass).toBe('UNAVAILABLE');
    }
  });

  it('kart sırası üretim akışını izler: keşif → tetik → oturum → çözüm', () => {
    const ids = buildResolverCards(snap()).map((c) => c.id);
    expect(ids.indexOf('discovery')).toBeLessThan(ids.indexOf('trigger'));
    expect(ids.indexOf('trigger')).toBeLessThan(ids.indexOf('session'));
    expect(ids.indexOf('session')).toBeLessThan(ids.indexOf('run'));
  });

  it('LAB okumak oturum/PDU TETİKLEMEZ', () => {
    _resetSessionHealingForTest();
    expect(getSessionHealingEvidence()).toHaveLength(0);
    readGapResolverSnapshot();
    readGapResolverSnapshot();
    expect(getSessionHealingEvidence()).toHaveLength(0);
  });
});
