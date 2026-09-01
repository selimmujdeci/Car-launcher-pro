/**
 * vdkReplayFaultMatrix.test.ts — P0-VDK-F2B · ARIZA MATRİSİ.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * TEK KURAL (bu dosyanın varlık sebebi)
 * ══════════════════════════════════════════════════════════════════════════
 * **HİÇBİR arıza "DTC yok / araç temiz" sonucu ÜRETEMEZ.**
 *
 * Ürünün en pahalı kusur sınıfı budur: ECU sustuğunda, hat düştüğünde ya da
 * gövde yarıda kesildiğinde ekranda "sorun bulunamadı" yazması. Replay bu
 * durumları araç OLMADAN yeniden üretebildiğine göre, kilitlemek de zorundadır.
 *
 * Bozuk PAKET reddi (`duplicate` · `gap` · `checksum` · bilinmeyen şema) zaten
 * F2-A import kapısındadır; burada o kapının GERÇEKTEN kapalı olduğu doğrulanır
 * — replay motoru asla bozuk bir izle çalıştırılamamalıdır.
 */
import { describe, it, expect } from 'vitest';

import {
  openReplayRun, replayRequest, cancelReplayRun, replayRunStats,
  type ReplayRequest,
} from '../platform/obd/virtualTransport';
import { TRACE_SCHEMA_VERSION, type TraceEvent } from '../platform/obd/canonicalTrace';
import { importTracePackage, buildTracePackage, fnv1a32, canonicalizeEvents } from '../platform/obd/traceExport';
import { classifyTransportOutcome, isTransportCoverageLoss } from '../platform/obd/isoTpTuningPolicy';
import { validateUdsDtcResponse, parseUdsDtcResponse } from '../platform/obd/udsDtc';

/* ── İz kurucu (yalnız bu dosya için; ürün yolu ayrı dosyada) ───────────── */
let _seq = 0;
function ev(p: Partial<TraceEvent>): TraceEvent {
  _seq++;
  return {
    schemaVersion: TRACE_SCHEMA_VERSION, traceId: 'T', eventId: `T-e${_seq}`,
    sequence: _seq, wallTime: 1_700_000_000_000 + _seq, monotonicTime: _seq * 10,
    transactionId: 'X', evidenceCorrelationId: 'C', sessionEpoch: 1,
    ecuTxHeader: '7E0', ecuRxHeader: '7E8', ecuLabel: 'Motor (ECM)', protocol: '6',
    transport: 'elm327_classic', direction: 'request_response',
    operation: 'uds_19', subFunction: '02', rawRequest: '1902FF', rawResponse: null,
    transportOutcome: null, nrc: null, latencyMs: 50, byteCount: null, frameCount: null,
    sessionLeaseRef: null, adapterKind: 'GENUINE', isoTpTuningRef: null,
    provenance: 'imported', redactionState: 'CLEAN',
    ...p,
  };
}
function reseq(events: TraceEvent[]): TraceEvent[] {
  return events.map((e, i) => ({ ...e, sequence: i + 1, monotonicTime: (i + 1) * 10 }));
}
function run(events: TraceEvent[], id = 'R') {
  _seq = 0;
  const r = openReplayRun({ events: reseq(events), mode: 'FAST', replayRunId: id });
  expect(r.ok, r.ok ? '' : r.detail).toBe(true);
  if (!r.ok) throw new Error('unreachable');
  return r.run;
}
const REQ: ReplayRequest = {
  operation: 'uds_19', subFunction: '02', rawRequest: '1902FF',
  ecuTxHeader: '7E0', ecuRxHeader: '7E8',
};

/* ═══════════════════════════════════════════════════════════════════════════
   A) TAŞIMA ARIZALARI — ölçülmüş yanıtsızlık AYNEN geri gelir
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · A) taşıma arızaları replay edilir', () => {
  const CASES: ReadonlyArray<readonly [name: string, outcome: string, raw: string | null, nrc: number | null]> = [
    ['tek çerçeve',          'ok',              'FF08332909', null],
    ['çok çerçeve (tam)',    'ok',              'FF' + '083329090833290908332909', null],
    ['timeout',              'timeout',          null, null],
    ['yanıt yok',            'no_response',      null, null],
    ['NRC 11 (servis yok)',  'negative_nrc',     '7F1911', 0x11],
    ['NRC 22 (koşul yok)',   'negative_nrc',     '7F1922', 0x22],
    ['NRC 31 (istek dışı)',  'negative_nrc',     '7F1931', 0x31],
    ['NRC 78 (beklemede)',   'negative_nrc',     '7F1978', 0x78],
    ['bozuk gövde',          'malformed',        'ZZZZ', null],
    ['kırpılmış gövde',      'ok',               'FF0833', null],
    ['BUFFER FULL',          'transport_error',  'BUFFER FULL', null],
    ['oturum gerekli',       'negative_nrc',     '7F197F', 0x7f],
  ];

  for (const [name, outcome, raw, nrc] of CASES) {
    it(`🔒 ${name}: ölçülen sonuç BİREBİR teslim edilir (uydurma YOK)`, () => {
      const r = run([ev({ transportOutcome: outcome, rawResponse: raw, nrc })]);
      const d = replayRequest(r, REQ);
      expect(d.outcome).toBe('MATCHED');
      expect(d.event!.transportOutcome).toBe(outcome);
      expect(d.event!.rawResponse).toBe(raw);
      expect(d.event!.nrc).toBe(nrc);
    });
  }

  it('🔒 ANA KİLİT: hiçbir arıza "kod yok / temiz" sonucuna DÖNÜŞMEZ', () => {
    for (const [name, outcome, raw] of CASES) {
      if (outcome === 'ok' && raw !== null && raw.startsWith('FF08')) continue;   // gerçekten kod TAŞIYAN durumlar
      const r = run([ev({ transportOutcome: outcome, rawResponse: raw })], `c-${name}`);
      const d = replayRequest(r, REQ);
      expect(d.outcome).toBe('MATCHED');

      /* Ürünün gerçek sınıflandırıcısı çalıştırılır — ikinci sözlük KURULMAZ. */
      const cls = classifyTransportOutcome(outcome, raw, null, 4);
      expect(isTransportCoverageLoss(cls) || cls === 'TRUNCATED',
        `"${name}" kapsam kaybı sayılmadı → sessizce TEMİZ görünür (sınıf: ${cls})`).toBe(true);
    }
  });

  it('🔒 KİLİT: KIRPILMIŞ gövde parser tarafından da yakalanır (yalancı kod YOK)', () => {
    /* 3 bayt: bir UDS kaydı (4 bayt) için EKSİK → gövde sınırına oturmuyor. */
    const truncated = 'FF' + '0833';
    expect(validateUdsDtcResponse(truncated).valid).toBe(false);
    /* Kırpılmış gövdeden UYDURMA kod türetilmez. */
    expect(parseUdsDtcResponse(truncated).length).toBeLessThanOrEqual(0);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   B) OTURUM VE TUNING ARIZALARI
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · B) oturum · tuning arızaları', () => {
  it('🔒 TesterPresent POZİTİF replay edilir', () => {
    const r = run([ev({
      operation: 'tester_present', subFunction: null, rawRequest: '3E00',
      rawResponse: '7E00', transportOutcome: 'POSITIVE',
    })]);
    const d = replayRequest(r, { operation: 'tester_present', subFunction: null, rawRequest: '3E00', ecuTxHeader: '7E0', ecuRxHeader: '7E8' });
    expect(d.outcome).toBe('MATCHED');
    expect(d.event!.transportOutcome).toBe('POSITIVE');
  });

  it('🔒 TesterPresent YANITSIZ replay edilir — "oturum canlı" DENMEZ', () => {
    const r = run([ev({
      operation: 'tester_present', subFunction: null, rawRequest: '3E00',
      rawResponse: null, transportOutcome: 'NO_RESPONSE',
    })]);
    const d = replayRequest(r, { operation: 'tester_present', subFunction: null, rawRequest: '3E00', ecuTxHeader: '7E0', ecuRxHeader: '7E8' });
    expect(d.outcome).toBe('MATCHED');
    expect(d.event!.rawResponse).toBeNull();
    expect(d.event!.transportOutcome).toBe('NO_RESPONSE');
  });

  it('🔒 ISO-TP DESTEKLENMİYOR ("?") replay edilir', () => {
    const r = run([ev({
      operation: 'isotp_tuning_apply', direction: 'observation', subFunction: '02',
      rawRequest: 'ATFCSH7E0=OK|ATFCSD300000=?', rawResponse: null,
      transportOutcome: 'NOT_APPLIED', isoTpTuningRef: 'APPLY',
    })]);
    const found = r.events.find((e) => e.operation === 'isotp_tuning_apply')!;
    expect(found.transportOutcome).toBe('NOT_APPLIED');
  });

  it('🔒 RESTORE DÜŞTÜ replay edilir — adaptör "temiz" SAYILMAZ', () => {
    const r = run([ev({
      operation: 'isotp_tuning_restore', direction: 'observation', subFunction: '02',
      rawRequest: 'ATFCSM0', rawResponse: 'NO DATA',
      transportOutcome: 'RESTORE_FAILED', isoTpTuningRef: 'APPLY',
    })]);
    const found = r.events.find((e) => e.operation === 'isotp_tuning_restore')!;
    expect(found.transportOutcome).toBe('RESTORE_FAILED');
    expect(found.transportOutcome).not.toBe('RESTORED');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   C) REPLAY MOTORU FAIL-CLOSED
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · C) replay fail-closed', () => {
  it('🔒 BEKLENMEYEN İSTEK → REQUEST_MISMATCH (yanıt UYDURULMAZ)', () => {
    const r = run([ev({ transportOutcome: 'ok', rawResponse: 'FF08332909' })]);
    const d = replayRequest(r, { ...REQ, rawRequest: '190AFF' });
    expect(d.outcome).toBe('REQUEST_MISMATCH');
    expect(d.event).toBeNull();
  });

  it('🔒 "sıradakini ver" YAKLAŞIMI YOK — yanlış künye eşleşmez', () => {
    /* İzde TEK yanıt var ama künyesi FARKLI bir ECU'ya ait. */
    const r = run([ev({ ecuTxHeader: '7E1', ecuRxHeader: '7E9', transportOutcome: 'ok', rawResponse: 'FF08332909' })]);
    const d = replayRequest(r, REQ);
    expect(d.outcome).toBe('REQUEST_MISMATCH');
    expect(d.event).toBeNull();
  });

  it('🔒 İZ TÜKENDİ → TRACE_EXHAUSTED', () => {
    const r = run([ev({ transportOutcome: 'ok', rawResponse: 'FF08332909' })]);
    expect(replayRequest(r, REQ).outcome).toBe('MATCHED');
    const d = replayRequest(r, REQ);
    expect(d.outcome).toBe('TRACE_EXHAUSTED');
    expect(d.event).toBeNull();
  });

  it('🔒 YANIT ÖLÇÜLMEMİŞ → NO_RECORDED_RESPONSE (boş yanıt DEĞİL)', () => {
    const r = run([ev({ transportOutcome: null, rawResponse: null })]);
    const d = replayRequest(r, REQ);
    expect(d.outcome).toBe('NO_RECORDED_RESPONSE');
    expect(d.gapSignal).toBe('UNKNOWN_RESPONSE_SHAPE');
  });

  it('🔒 İPTAL → CANCELLED, sonraki her istek de CANCELLED', () => {
    const r = run([ev({ transportOutcome: 'ok', rawResponse: 'FF08332909' })]);
    cancelReplayRun(r);
    expect(replayRequest(r, REQ).outcome).toBe('CANCELLED');
    expect(replayRequest(r, REQ).outcome).toBe('CANCELLED');
    expect(replayRunStats(r).matched).toBe(0);
  });

  it('🔒 TUR ORTASINDA iptal — o ana kadarki teslimler KORUNUR', () => {
    const r = run([
      ev({ transportOutcome: 'ok', rawResponse: 'FF08332909' }),
      ev({ subFunction: '0A', rawRequest: '190A', transportOutcome: 'ok', rawResponse: 'FF08332909' }),
    ]);
    expect(replayRequest(r, REQ).outcome).toBe('MATCHED');
    cancelReplayRun(r);
    expect(replayRequest(r, { ...REQ, subFunction: '0A', rawRequest: '190A' }).outcome).toBe('CANCELLED');
    const s = replayRunStats(r);
    expect(s.matched).toBe(1);
    expect(s.cancelled).toBe(1);
    expect(s.unconsumed).toBe(1);        // ikinci olay HİÇ tüketilmedi — sessiz DEĞİL
  });

  it('🔒 CANLI olay replay girdisi OLAMAZ (NOT_IMPORTED)', () => {
    const r = openReplayRun({
      events: reseq([ev({ provenance: 'live' })]), mode: 'FAST', replayRunId: 'L',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('NOT_IMPORTED');
  });

  it('🔒 BOŞ iz reddedilir', () => {
    const r = openReplayRun({ events: [], mode: 'FAST', replayRunId: 'E' });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('EMPTY_TRACE');
  });

  it('🔒 ZAMAN GERİ GİDERSE koşu açılmaz (TIMING_INVALID)', () => {
    _seq = 0;
    const a = ev({}); const b = ev({});
    const r = openReplayRun({
      events: [{ ...a, sequence: 1, monotonicTime: 100 }, { ...b, sequence: 2, monotonicTime: 50 }],
      mode: 'FAST', replayRunId: 'TI',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('TIMING_INVALID');
  });

  it('🔒 SIRA monotonik değilse koşu açılmaz', () => {
    _seq = 0;
    const a = ev({}); const b = ev({});
    const r = openReplayRun({
      events: [{ ...a, sequence: 5, monotonicTime: 10 }, { ...b, sequence: 5, monotonicTime: 20 }],
      mode: 'FAST', replayRunId: 'SU',
    });
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('SEQUENCE_UNSORTED');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   D) BOZUK PAKET — F2-A İMPORT KAPISI GERÇEKTEN KAPALI
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · D) bozuk paket replay’e ULAŞAMAZ', () => {
  function pkgOf(events: TraceEvent[]) {
    const r = buildTracePackage(reseq(events), 0, 'T', 1_700_000_000_000);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('unreachable');
    return r;
  }

  it('🔒 CHECKSUM uyuşmazlığı reddedilir', () => {
    _seq = 0;
    const { pkg } = pkgOf([ev({ transportOutcome: 'ok', rawResponse: 'FF08332909' })]);
    const tampered = {
      ...pkg,
      events: pkg.events.map((e) => ({ ...e, rawResponse: 'FF08332900' })),   // TAHRİF
    };
    const r = importTracePackage(JSON.stringify(tampered));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('CHECKSUM_MISMATCH');
  });

  it('🔒 SIRA BOŞLUĞU reddedilir', () => {
    _seq = 0;
    const a = ev({ transportOutcome: 'ok', rawResponse: 'R1' });
    const b = ev({ transportOutcome: 'ok', rawResponse: 'R2' });
    const events = [{ ...a, sequence: 1, monotonicTime: 10 }, { ...b, sequence: 5, monotonicTime: 20 }];
    const manifest = {
      schema: 'caros.vdk.tracepkg.v1', eventSchema: TRACE_SCHEMA_VERSION, traceId: 'T',
      generatedAtWallMs: 1, eventCount: 2, firstSequence: 1, lastSequence: 5,
      droppedCount: 0, truncated: false, transactionIds: ['X'],
      redactedCount: 0, notRedactedCount: 0, checksum: fnv1a32(canonicalizeEvents(events)),
    };
    const r = importTracePackage(JSON.stringify({ manifest, events }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('SEQUENCE_GAP');
  });

  it('🔒 TEKRARLI SIRA reddedilir', () => {
    _seq = 0;
    const a = ev({ transportOutcome: 'ok', rawResponse: 'R1' });
    const b = ev({ transportOutcome: 'ok', rawResponse: 'R2' });
    const events = [{ ...a, sequence: 1, monotonicTime: 10 }, { ...b, sequence: 1, monotonicTime: 20 }];
    const manifest = {
      schema: 'caros.vdk.tracepkg.v1', eventSchema: TRACE_SCHEMA_VERSION, traceId: 'T',
      generatedAtWallMs: 1, eventCount: 2, firstSequence: 1, lastSequence: 1,
      droppedCount: 0, truncated: false, transactionIds: ['X'],
      redactedCount: 0, notRedactedCount: 0, checksum: fnv1a32(canonicalizeEvents(events)),
    };
    const r = importTracePackage(JSON.stringify({ manifest, events }));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('DUPLICATE_SEQUENCE');
  });

  it('🔒 BİLİNMEYEN ŞEMA reddedilir (ileri uyumluluk YOK — fail-closed)', () => {
    _seq = 0;
    const { pkg } = pkgOf([ev({ transportOutcome: 'ok', rawResponse: 'R' })]);
    const future = { ...pkg, manifest: { ...pkg.manifest, schema: 'caros.vdk.tracepkg.v9' } };
    const r = importTracePackage(JSON.stringify(future));
    expect(r.ok).toBe(false);
    if (r.ok) throw new Error('unreachable');
    expect(r.rejection).toBe('UNKNOWN_PACKAGE_SCHEMA');
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   E) YAPISAL BOŞLUK SİNYALLERİ — bugün çözülmez, KAYBOLMAZ
   ═══════════════════════════════════════════════════════════════════════════ */
describe('P0-VDK-F2B · E) gelecek VDK için boşluk sinyalleri', () => {
  it('🔒 BİLİNMEYEN ECU sorulursa UNKNOWN_ECU_VARIANT işaretlenir', () => {
    const r = run([ev({ transportOutcome: 'ok', rawResponse: 'R' })]);
    const d = replayRequest(r, { ...REQ, ecuTxHeader: '7E5', ecuRxHeader: '7ED' });
    expect(d.outcome).toBe('REQUEST_MISMATCH');
    expect(d.gapSignal).toBe('UNKNOWN_ECU_VARIANT');
    expect(replayRunStats(r).gapSignals).toContain('UNKNOWN_ECU_VARIANT');
  });

  it('🔒 BİLİNMEYEN SERVİS sorulursa UNKNOWN_SERVICE işaretlenir', () => {
    const r = run([ev({ transportOutcome: 'ok', rawResponse: 'R' })]);
    const d = replayRequest(r, { ...REQ, operation: 'kwp_18', subFunction: '18', rawRequest: '1800FF00' });
    expect(d.gapSignal).toBe('UNKNOWN_SERVICE');
  });

  it('🔒 BİLİNMEYEN ALT FONKSİYON sorulursa UNKNOWN_SUBFUNCTION işaretlenir', () => {
    const r = run([ev({ transportOutcome: 'ok', rawResponse: 'R' })]);
    const d = replayRequest(r, { ...REQ, subFunction: '0A', rawRequest: '190A' });
    expect(d.gapSignal).toBe('UNKNOWN_SUBFUNCTION');
  });

  it('🔒 AYNI servis/alt fonksiyon ama FARKLI gövde → CAPABILITY_GAP', () => {
    const r = run([ev({ transportOutcome: 'ok', rawResponse: 'R' })]);
    const d = replayRequest(r, { ...REQ, rawRequest: '190200' });
    expect(d.gapSignal).toBe('CAPABILITY_GAP');
  });
});
