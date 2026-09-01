/**
 * canonicalTrace.test.ts — P0-VDK-F2A · KANONİK İZ + EXPORT/IMPORT KİLİTLERİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ÖLÇÜLEN KANIT BORCU
 * ══════════════════════════════════════════════════════════════════════════
 * Ürünün YEDİ ayrı kanıt defteri var ve hiçbiri diğerinin zamanını bilmiyor.
 * Ham `obdTraffic` olayı native'de TAM OLARAK `{cmd, resp, ms, ts}` taşır —
 * yön · protokol · oturum · korelasyon YOK. `rawTrafficExport` VAR ama
 * **checksum'ı, import'u ve doğrulaması YOK**: dışarı çıkan bir dosyanın
 * bozulmadığı ya da tahrif edilmediği KANITLANAMIYORDU.
 */
import { describe, it, expect, beforeEach } from 'vitest';

import {
  recordTraceEvent, getTraceEvents, getTransactionTrace, getDroppedEventCount,
  checkTraceIntegrity, summarizeTrace, beginTrace, getTraceId,
  MAX_TRACE_EVENTS, TRACE_SCHEMA_VERSION,
  _resetTraceForTest, _setTraceClocksForTest,
  type TraceEvent, type TraceEventInput,
} from '../platform/obd/canonicalTrace';
import {
  buildTracePackage, importTracePackage, fnv1a32, canonicalizeEvents,
  buildTracePackageFileName, TRACE_PACKAGE_SCHEMA,
} from '../platform/obd/traceExport';

const wall = { t: 1_700_000_000_000 };
const mono = { t: 0 };

beforeEach(() => {
  _resetTraceForTest('trace-T');
  wall.t = 1_700_000_000_000;
  mono.t = 0;
  _setTraceClocksForTest(() => wall.t, () => mono.t);
});

function ev(over: Partial<TraceEventInput> = {}): TraceEvent {
  mono.t += 10; wall.t += 10;
  return recordTraceEvent({
    transactionId: 'txn-1', evidenceCorrelationId: 'txn-1', sessionEpoch: 0,
    ecuTxHeader: '7E0', ecuRxHeader: '7E8', ecuLabel: 'Motor (ECM)',
    protocol: '6', transport: 'elm327_ble', direction: 'request_response',
    operation: 'uds_19', subFunction: '02',
    rawRequest: '1902FF', rawResponse: 'FF038011 09',
    transportOutcome: 'ok', nrc: null, latencyMs: 42,
    byteCount: 5, frameCount: 1,
    sessionLeaseRef: null, adapterKind: 'elm327', isoTpTuningRef: null,
    redactionState: 'CLEAN', ...over,
  })!;
}

/* ═══════════════════════════════════════════════════════════════════════════
   A) APPEND-ONLY + MONOTONİK SIRA
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2A · A) append-only defter', () => {
  it('🔒 ANA KİLİT: sıra MONOTONİK artar ve eski olay DEĞİŞTİRİLMEZ', () => {
    const a = ev(); const b = ev(); const c = ev();
    expect([a.sequence, b.sequence, c.sequence]).toEqual([1, 2, 3]);
    /* Defterdeki ilk olay hâlâ aynı — üzerine yazılmadı. */
    const stored = getTraceEvents();
    expect(stored[0]!.eventId).toBe(a.eventId);
    expect(stored[0]!.sequence).toBe(1);
    expect(stored).toHaveLength(3);
  });

  it('🔒 KİLİT: her olay şema sürümü ve iz kimliği taşır', () => {
    const e = ev();
    expect(e.schemaVersion).toBe(TRACE_SCHEMA_VERSION);
    expect(e.traceId).toBe('trace-T');
    expect(e.provenance).toBe('live');
  });

  it('🔒 KİLİT: MONOTONİK zaman duvar saatinden AYRI taşınır', () => {
    const a = ev();
    /* Duvar saati GERİ atlasın (NTP/araç aküsü) — monotonik zaman etkilenmez. */
    wall.t -= 100_000;
    const b = ev();
    expect(b.wallTime!).toBeLessThan(a.wallTime!);
    expect(b.monotonicTime).toBeGreaterThan(a.monotonicTime);
  });

  it('🔒 ANA KİLİT: TAVAN aşımında kayıp SESSİZ DEĞİLDİR', () => {
    for (let i = 0; i < MAX_TRACE_EVENTS + 5; i++) ev();
    expect(getTraceEvents()).toHaveLength(MAX_TRACE_EVENTS);
    expect(getDroppedEventCount()).toBe(5);
    const integ = checkTraceIntegrity(getTraceEvents(), getDroppedEventCount());
    expect(integ.truncated).toBe(true);
    /* KIRPMA ≠ BOŞLUK: düşen olaylar `gaps`e YAZILMAZ. */
    expect(integ.gaps).toEqual([]);
    expect(integ.firstSequence).toBe(6);
  });

  it('sıra numarası kırpmadan sonra YENİDEN KULLANILMAZ', () => {
    for (let i = 0; i < MAX_TRACE_EVENTS + 3; i++) ev();
    const seqs = getTraceEvents().map((e) => e.sequence);
    expect(new Set(seqs).size).toBe(seqs.length);
    expect(Math.min(...seqs)).toBeGreaterThan(1);
  });

  it('beginTrace yeni iz kimliği verir', () => {
    beginTrace('trace-X');
    expect(getTraceId()).toBe('trace-X');
    expect(ev().traceId).toBe('trace-X');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) BÜTÜNLÜK — boşluk / tekrar
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2A · B) bütünlük', () => {
  it('🔒 ANA KİLİT: SIRA BOŞLUĞU tespit edilir', () => {
    const a = ev(); const b = ev(); const c = ev();
    const integ = checkTraceIntegrity([a, c]);   // b düştü
    expect(integ.gaps).toEqual([b.sequence]);
  });

  it('🔒 ANA KİLİT: TEKRARLI sıra tespit edilir', () => {
    const a = ev();
    expect(checkTraceIntegrity([a, a]).duplicates).toEqual([a.sequence]);
  });

  it('temiz izde boşluk ve tekrar YOK', () => {
    ev(); ev(); ev();
    const integ = checkTraceIntegrity(getTraceEvents());
    expect(integ.gaps).toEqual([]);
    expect(integ.duplicates).toEqual([]);
  });

  it('ham ölçümü olmayan olaylar sayılır', () => {
    ev(); ev({ rawRequest: null, rawResponse: null });
    expect(checkTraceIntegrity(getTraceEvents()).missingRawCount).toBe(1);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) İŞLEM KORELASYONU
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2A · C) işlem korelasyonu', () => {
  it('🔒 ANA KİLİT: bir işlemin TAM kronolojisi sırayla okunur', () => {
    ev({ transactionId: 'A', operation: 'transaction_boundary', subFunction: 'begin' });
    ev({ transactionId: 'A', operation: 'session_open' });
    ev({ transactionId: 'A', operation: 'isotp_tuning_apply' });
    ev({ transactionId: 'A', operation: 'uds_19' });
    ev({ transactionId: 'A', operation: 'tester_present' });
    ev({ transactionId: 'A', operation: 'transaction_boundary', subFunction: 'end' });

    const chain = getTransactionTrace('A').map((e) => e.operation);
    expect(chain).toEqual([
      'transaction_boundary', 'session_open', 'isotp_tuning_apply',
      'uds_19', 'tester_present', 'transaction_boundary',
    ]);
  });

  it('🔒 ANA KİLİT: İKİ işlem birbirine KARIŞMAZ', () => {
    ev({ transactionId: 'A', operation: 'mode03' });
    ev({ transactionId: 'B', operation: 'mode07' });
    ev({ transactionId: 'A', operation: 'uds_19' });

    expect(getTransactionTrace('A').map((e) => e.operation)).toEqual(['mode03', 'uds_19']);
    expect(getTransactionTrace('B').map((e) => e.operation)).toEqual(['mode07']);
  });

  it('işlemsiz olay korelasyon UYDURMAZ', () => {
    const e = ev({ transactionId: null, evidenceCorrelationId: null });
    expect(e.transactionId).toBeNull();
    expect(e.evidenceCorrelationId).toBeNull();
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) HAM BAYT KORUNUMU + SONUÇ AYRIMI
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2A · D) ham bayt ve sonuç ayrımı', () => {
  it('🔒 ANA KİLİT: ham istek/yanıt BİREBİR korunur (protokol payload’ı maskelenmez)', () => {
    const e = ev({ rawRequest: '1902FF', rawResponse: 'FF0380110938001209' });
    expect(e.rawRequest).toBe('1902FF');
    expect(e.rawResponse).toBe('FF0380110938001209');
    expect(e.redactionState).toBe('CLEAN');
  });

  it('🔒 KİLİT: timeout · no_response · NRC · malformed AYRI taşınır', () => {
    const t = ev({ transportOutcome: 'TIMEOUT', rawResponse: null });
    const n = ev({ transportOutcome: 'no_response', rawResponse: null });
    const r = ev({ transportOutcome: 'negative_nrc', nrc: 0x12, rawResponse: null });
    const m = ev({ transportOutcome: 'MALFORMED', rawResponse: 'ZZ' });
    expect([t.transportOutcome, n.transportOutcome, r.transportOutcome, m.transportOutcome])
      .toEqual(['TIMEOUT', 'no_response', 'negative_nrc', 'MALFORMED']);
    expect(r.nrc).toBe(0x12);
    expect(t.nrc).toBeNull();
  });

  it('🔒 KİLİT: ölçülmeyen alan `null` KALIR (sahte 0 YASAK)', () => {
    const e = ev({ latencyMs: null, byteCount: null, frameCount: null, protocol: null });
    expect(e.latencyMs).toBeNull();
    expect(e.byteCount).toBeNull();
    expect(e.frameCount).toBeNull();
    expect(e.protocol).toBeNull();
  });

  it('BUFFER_FULL ve TRUNCATED ayrı sonuç olarak taşınır', () => {
    expect(ev({ transportOutcome: 'BUFFER_FULL' }).transportOutcome).toBe('BUFFER_FULL');
    expect(ev({ transportOutcome: 'TRUNCATED' }).transportOutcome).toBe('TRUNCATED');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) EXPORT — fail-closed
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2A · E) export', () => {
  it('🔒 ANA KİLİT: temiz iz paketlenir ve CHECKSUM üretir', () => {
    ev(); ev(); ev();
    const r = buildTracePackage(getTraceEvents(), 0, 'trace-T', wall.t);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pkg.manifest.schema).toBe(TRACE_PACKAGE_SCHEMA);
    expect(r.pkg.manifest.eventCount).toBe(3);
    expect(r.pkg.manifest.checksum).toMatch(/^[0-9a-f]{8}$/);
    expect(r.pkg.manifest.transactionIds).toEqual(['txn-1']);
  });

  it('🔒 ANA KİLİT: MASKELENMEMİŞ olay varsa export REDDEDİLİR', () => {
    ev(); ev({ redactionState: 'NOT_APPLIED' });
    const r = buildTracePackage(getTraceEvents(), 0, 'trace-T', wall.t);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.rejection).toBe('REDACTION_NOT_APPLIED');
  });

  it('🔒 KİLİT: BOŞ iz export EDİLEMEZ', () => {
    const r = buildTracePackage([], 0, 'trace-T', wall.t);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.rejection).toBe('EMPTY');
  });

  it('🔒 KİLİT: bütünlük ihlali export’u BLOKLAR', () => {
    const a = ev(); const b = ev(); const c = ev();
    expect(buildTracePackage([a, c], 0, 'trace-T', wall.t).ok).toBe(false);      // boşluk
    expect(buildTracePackage([a, a, b], 0, 'trace-T', wall.t).ok).toBe(false);   // tekrar
  });

  it('kırpma manifestte GÖRÜNÜR (sessiz kayıp yok)', () => {
    ev(); ev();
    const r = buildTracePackage(getTraceEvents(), 7, 'trace-T', wall.t);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.pkg.manifest.droppedCount).toBe(7);
    expect(r.pkg.manifest.truncated).toBe(true);
  });

  it('checksum DETERMİNİSTİKTİR (aynı girdi → aynı çıktı)', () => {
    ev(); ev();
    const evs = getTraceEvents();
    expect(fnv1a32(canonicalizeEvents(evs))).toBe(fnv1a32(canonicalizeEvents(evs)));
    /* Alan sırası SABİT — JSON anahtar sırasına bağlı DEĞİL. */
    expect(canonicalizeEvents(evs)).toBe(canonicalizeEvents([...evs]));
  });

  it('dosya adı ölçülemeyen zamanda UYDURULMAZ', () => {
    expect(buildTracePackageFileName(null)).toBe('caros-trace-unknown.json');
    expect(buildTracePackageFileName(wall.t)).toMatch(/^caros-trace-\d{8}-\d{6}\.json$/);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   F) IMPORT — fail-closed doğrulama
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2A · F) import', () => {
  function pkgBody(): string {
    ev(); ev(); ev();
    const r = buildTracePackage(getTraceEvents(), 0, 'trace-T', wall.t);
    if (!r.ok) throw new Error('export başarısız');
    return r.body;
  }

  it('🔒 ANA KİLİT: geçerli paket kabul edilir ve bütünlüğü doğrulanır', () => {
    const res = importTracePackage(pkgBody());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events).toHaveLength(3);
    expect(res.integrity.gaps).toEqual([]);
    expect(res.integrity.duplicates).toEqual([]);
  });

  it('🔒 ANA KİLİT: İÇE AKTARILAN VERİ CANLI ARAÇ VERİSİ SAYILMAZ', () => {
    const res = importTracePackage(pkgBody());
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.events.every((e) => e.provenance === 'imported')).toBe(true);
    /* Ürünün CANLI defteri DEĞİŞMEDİ — import ona yazmaz. */
    expect(getTraceEvents().every((e) => e.provenance === 'live')).toBe(true);
  });

  it('🔒 ANA KİLİT: TAHRİF EDİLMİŞ paket checksum’dan REDDEDİLİR', () => {
    const body = pkgBody();
    /* Ham yanıtın tek baytını değiştir — checksum tutmaz. */
    const tampered = body.replace('FF038011 09', 'FF038011 0A');
    expect(tampered).not.toBe(body);
    const res = importTracePackage(tampered);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection).toBe('CHECKSUM_MISMATCH');
  });

  it('🔒 ANA KİLİT: BİLİNMEYEN şema fail-closed REDDEDİLİR', () => {
    const body = pkgBody();
    const future = body.replace(TRACE_PACKAGE_SCHEMA, 'caros.vdk.tracepkg.v99');
    const res = importTracePackage(future);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection).toBe('UNKNOWN_PACKAGE_SCHEMA');
  });

  it('🔒 KİLİT: bilinmeyen OLAY şeması da reddedilir', () => {
    const body = pkgBody().replace(`"eventSchema":"${TRACE_SCHEMA_VERSION}"`,
      '"eventSchema":"caros.vdk.trace.v99"');
    const res = importTracePackage(body);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection).toBe('UNKNOWN_EVENT_SCHEMA');
  });

  it('🔒 KİLİT: BOZUK JSON reddedilir', () => {
    const res = importTracePackage('{ bu json değil');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection).toBe('PARSE_ERROR');
  });

  it('🔒 KİLİT: manifest eksikse reddedilir', () => {
    const res = importTracePackage(JSON.stringify({ events: [] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection).toBe('MISSING_MANIFEST');
  });

  it('🔒 KİLİT: olay adedi manifestle uyuşmazsa reddedilir', () => {
    const body = pkgBody();
    const obj = JSON.parse(body) as { events: unknown[] };
    obj.events.pop();
    const res = importTracePackage(JSON.stringify(obj));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.rejection).toBe('COUNT_MISMATCH');
  });

  it('export → import gidiş-dönüşü ham baytları BİREBİR korur', () => {
    const e = ev({ rawResponse: 'FF0380110938001209' });
    const r = buildTracePackage([e], 0, 'trace-T', wall.t);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const back = importTracePackage(r.body);
    expect(back.ok).toBe(true);
    if (!back.ok) return;
    expect(back.events[0]!.rawResponse).toBe('FF0380110938001209');
    expect(back.events[0]!.monotonicTime).toBe(e.monotonicTime);
    expect(back.events[0]!.sequence).toBe(e.sequence);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   G) ÖZET / EXPORT HAZIRLIĞI
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2A · G) özet', () => {
  it('🔒 KİLİT: maskelenmemiş olay export hazırlığını BLOKLAR', () => {
    ev(); ev({ redactionState: 'NOT_APPLIED' });
    const s = summarizeTrace(getTraceEvents(), 0);
    expect(s.exportReady).toBe(false);
    expect(s.notRedactedCount).toBe(1);
    expect(s.exportBlockReason).toContain('maskeleme');
  });

  it('temiz iz export’a HAZIR', () => {
    ev(); ev();
    const s = summarizeTrace(getTraceEvents(), 0);
    expect(s.exportReady).toBe(true);
    expect(s.exportBlockReason).toBeNull();
    expect(s.transactionCount).toBe(1);
    expect(s.rawCoverage).toBe(1);
  });

  it('boş izde ham kapsam `null` (sahte %0 YASAK)', () => {
    expect(summarizeTrace([], 0).rawCoverage).toBeNull();
  });
});
