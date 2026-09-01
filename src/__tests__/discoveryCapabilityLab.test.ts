/**
 * discoveryCapabilityLab.test — P0-VDK-F4B · LAB gözlem yüzeyi kilitleri.
 *
 * EN KRİTİK KİLİT: **hiç yoklama yapılmadıysa ekran `0` GÖSTERMEZ.**
 * `0` bir ölçümdür ("sorduk, bulamadık"); ölçüm yokluğu `KAYNAK YOK`tur.
 * İkisini karıştırmak, bu ekranın var oluş amacını yok eder.
 */

import { describe, it, expect } from 'vitest';

import {
  buildDiscoveryCards, deriveDiscoveryVerdict, countByDiscoveryClass,
  DISCOVERY_CARD_ORDER,
} from '../platform/devtools/discoveryCapabilityModel';
import type { DiscoveryCapabilityRawSnapshot } from '../platform/devtools/discoveryCapabilitySources';
import type { ProbeRecord } from '../platform/obd/discovery/serviceProbeModel';
import { summarizeProbes } from '../platform/obd/discovery/serviceProbeModel';
import { CAROS_LAB_TOOLS } from '../platform/devtools/carosLabCatalog';

const REC = (over: Partial<ProbeRecord> = {}): ProbeRecord => ({
  ecuKey: 'ECM@7E0', ecuLabel: 'ECM', txHeader: '7E0', rxHeader: '7E8',
  service: '19', subFunction: '02', serviceDefId: 'uds_read_dtc_information',
  requestIdentity: '1902FF', outcome: 'POSITIVE', nrc: null, latencyMs: 11,
  sessionOpened: null, sessionCommand: null, transportKind: 'ok',
  traceCorrelationId: 'c1', protocol: '6',
  classification: 'PRESENT', reason: 'pozitif yanıt geldi', atMs: 1_000, count: 1,
  ...over,
});

function snap(over: Partial<DiscoveryCapabilityRawSnapshot> = {}): DiscoveryCapabilityRawSnapshot {
  const records = over.records ?? [];
  return {
    readAt: 5_000, records, exclusions: [],
    summary: summarizeProbes(records),
    runCount: records.length > 0 ? 1 : 0,
    dropped: 0, gapCounts: {}, genericBridge: true, routePolicy: 'legacy_first',
    ...over,
  };
}

describe('F4B LAB · hiç yoklama yoksa 0 DEĞİL KAYNAK YOK', () => {
  it('boş defterde sayaç alanları UNAVAILABLE olur', () => {
    const cards = buildDiscoveryCards(snap());
    const coverage = cards.find((c) => c.id === 'coverage')!;
    expect(coverage.fields.length).toBeGreaterThan(0);
    expect(coverage.fields.every((f) => f.klass === 'UNAVAILABLE')).toBe(true);
    /* Hiçbir alan "0" değerini SAYIYMIŞ gibi göstermez. */
    expect(coverage.fields.every((f) => f.value === '—')).toBe(true);
  });

  it('yoklama varsa sayaçlar ÖLÇÜLDÜ olarak görünür', () => {
    const cards = buildDiscoveryCards(snap({ records: [REC()] }));
    const coverage = cards.find((c) => c.id === 'coverage')!;
    const present = coverage.fields.find((f) => f.id === 'present')!;
    expect(present.klass).toBe('OBSERVED');
    expect(present.value).toBe('1');
    /* GERÇEK sıfır — "ABSENT 0" ölçülmüş bir sonuçtur ve gösterilir. */
    const absent = coverage.fields.find((f) => f.id === 'absent')!;
    expect(absent.klass).toBe('OBSERVED');
    expect(absent.value).toBe('0');
  });

  it('hüküm: yoklama yoksa NEVER_PROBED, köprü yoksa NO_BRIDGE', () => {
    expect(deriveDiscoveryVerdict(snap()).status).toBe('NEVER_PROBED');
    expect(deriveDiscoveryVerdict(snap({ genericBridge: false })).status).toBe('NO_BRIDGE');
  });

  it('hüküm: yarım kalan tur INCOMPLETE, tam tur MEASURED', () => {
    const deferred = snap({ records: [REC(), REC({ subFunction: '0A', classification: 'DEFERRED' })] });
    expect(deriveDiscoveryVerdict(deferred).status).toBe('INCOMPLETE');
    expect(deriveDiscoveryVerdict(snap({ records: [REC()] })).status).toBe('MEASURED');
  });
});

describe('F4B LAB · sınıflandırma ekrana DOĞRU sınıfla düşer', () => {
  it('PRESENT/ABSENT ÖLÇÜLDÜ · koşullu TÜRETİLDİ · bilinmeyen KAYNAK YOK', () => {
    const cards = buildDiscoveryCards(snap({
      records: [
        REC({ subFunction: '01', classification: 'PRESENT' }),
        REC({ subFunction: '02', classification: 'ABSENT', nrc: 0x11 }),
        REC({ subFunction: '03', classification: 'PRESENT_BUT_CONDITIONED', nrc: 0x31 }),
        REC({ subFunction: '06', classification: 'UNKNOWN_TRANSPORT_LIMIT' }),
        REC({ subFunction: '0A', classification: 'DEFERRED' }),
      ],
    }));
    const svc = cards.find((c) => c.id === 'services')!;
    const by = new Map(svc.fields.map((f) => [f.label, f.klass]));
    expect(by.get('19-01')).toBe('OBSERVED');
    expect(by.get('19-02')).toBe('OBSERVED');
    expect(by.get('19-03')).toBe('DERIVED');
    expect(by.get('19-06')).toBe('UNAVAILABLE');
    expect(by.get('19-0A')).toBe('UNAVAILABLE');
  });

  it('en son NRC kanıt olarak taşınır; hiç NRC yoksa KAYNAK YOK', () => {
    const withNrc = buildDiscoveryCards(snap({
      records: [REC({ classification: 'ABSENT', nrc: 0x11, atMs: 2_000 })],
    }));
    const f = withNrc.find((c) => c.id === 'run')!.fields.find((x) => x.id === 'last-nrc')!;
    expect(f.klass).toBe('OBSERVED');
    expect(f.value).toBe('0x11');

    const none = buildDiscoveryCards(snap({ records: [REC()] }));
    const g = none.find((c) => c.id === 'run')!.fields.find((x) => x.id === 'last-nrc')!;
    expect(g.klass).toBe('UNAVAILABLE');
  });

  it('taşıma kartı köprü yokluğunu ARAÇ sınırı gibi göstermez', () => {
    const cards = buildDiscoveryCards(snap({ genericBridge: false }));
    const t = cards.find((c) => c.id === 'transport')!;
    const bridge = t.fields.find((f) => f.id === 'bridge')!;
    expect(bridge.value).toBe('YOK');
    expect(bridge.note).toContain('APK sınırıdır');
  });

  it('tüm kartlar üretilir ve sıra sabittir', () => {
    const ids = buildDiscoveryCards(snap({ records: [REC()] })).map((c) => c.id);
    expect(ids).toEqual([...DISCOVERY_CARD_ORDER]);
  });

  it('sınıf sayacı alan sayısıyla tutarlıdır', () => {
    const cards = buildDiscoveryCards(snap({ records: [REC()] }));
    const counts = countByDiscoveryClass(cards);
    const total = counts.OBSERVED + counts.DERIVED + counts.UNAVAILABLE + counts.STALE;
    expect(total).toBe(cards.reduce((n, c) => n + c.fields.length, 0));
  });
});

describe('F4B LAB · katalog kaydı dürüst', () => {
  it('araç AVAILABLE ve notunda kör tarama/destructive yasağı yazılı', () => {
    const tool = CAROS_LAB_TOOLS.find((t) => t.id === 'discovery-capability');
    expect(tool).toBeDefined();
    expect(tool?.status).toBe('AVAILABLE');
    expect(tool?.category).toBe('vehicle');
    expect(tool?.note).toContain('KÖR TARAMA YOK');
    expect(tool?.note).toContain('0x11');
    expect(tool?.note).toContain('Gerçek araç doğrulaması YAPILMADI');
  });
});
