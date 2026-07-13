/**
 * diagnosticDeliveryTruth.test.ts — Diagnostics PR-3 "Delivery Truth".
 *
 * "Kuyruğa kabul edildi" ile "sunucuya gerçekten teslim edildi"nin AYRILDIĞINI
 * ve UI'nın artık yalancı "Gönderildi" DEMEDİĞİNİ kilitler.
 *
 * PART A — SAF motor (classifyHttpOutcome + teslimat defteri + idempotency + TTL).
 * PART B — connectivityService entegrasyonu (fake IDB + mock fetch): sunucu
 *          yanıtına göre kuyruk KEEP/DELETE gerçeği (rate-limit sessizce silinmez).
 *
 * Sunucu sözleşmesi (push_vehicle_event): RETURNS uuid · rate-limit RETURN NULL ·
 * invalid_api_key → 4xx · 64KB aşımı → kırpılmış stub ama yine uuid.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  classifyHttpOutcome, extractServerReportId,
  beginDelivery, applyOutcome, markSending, getDelivery, shouldKeepInQueue,
  deriveReportId, deliveryLabel, isTerminal, isDelivered,
  SERVER_MAX_BYTES, MAX_DELIVERY_ATTEMPTS, DELIVERY_TTL_MS,
  _resetDeliveryLedgerForTest,
  type DeliveryClassification,
} from '../platform/diagnosticDelivery';

const UUID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

beforeEach(() => { _resetDeliveryLedgerForTest(); });

/* ══════════════ PART A — SAF MOTOR ══════════════ */

describe('extractServerReportId — teslim kanıtı UUID çıkarımı', () => {
  it('JSON string uuid ("<uuid>")', () => {
    expect(extractServerReportId(JSON.stringify(UUID))).toBe(UUID);
  });
  it('ham uuid (tırnaksız)', () => {
    expect(extractServerReportId(UUID)).toBe(UUID);
  });
  it('rate-limit RETURN NULL → gövde "null" → UUID YOK', () => {
    expect(extractServerReportId('null')).toBeNull();
  });
  it('boş gövde → null', () => {
    expect(extractServerReportId('')).toBeNull();
    expect(extractServerReportId(undefined)).toBeNull();
  });
  it('dizi / obje sarmalı çözülür', () => {
    expect(extractServerReportId(JSON.stringify([{ id: UUID }]))).toBe(UUID);
    expect(extractServerReportId(JSON.stringify({ push_vehicle_event: UUID }))).toBe(UUID);
  });
  it('uuid olmayan çöp → null (kanıt yok)', () => {
    expect(extractServerReportId('"ok"')).toBeNull();
    expect(extractServerReportId('{"foo":1}')).toBeNull();
  });
});

describe('classifyHttpOutcome — sunucu sözleşmesi karar tablosu', () => {
  const small = 100, huge = SERVER_MAX_BYTES + 1;

  it('#2 2xx + UUID + ≤64KB → delivered (sil, kanıt dolu)', () => {
    const c = classifyHttpOutcome({ status: 200, bodyText: JSON.stringify(UUID), sentBytes: small });
    expect(c.state).toBe('delivered');
    expect(c.serverReportId).toBe(UUID);
    expect(c.keepInQueue).toBe(false);
  });

  it('#4 2xx + UUID + >64KB → truncated (başarı DEĞİL, kullanıcı uyarılır)', () => {
    const c = classifyHttpOutcome({ status: 200, bodyText: JSON.stringify(UUID), sentBytes: huge });
    expect(c.state).toBe('truncated');
    expect(isDelivered(c.state)).toBe(false); // truncated ≠ başarı
    expect(c.userVisible).toBe(true);
    expect(c.serverReportId).toBe(UUID);
  });

  it('#3/#5 2xx + null (RPC NULL) → rate_limited (KUYRUKTA KALIR, görünür)', () => {
    const c = classifyHttpOutcome({ status: 200, bodyText: 'null', sentBytes: small });
    expect(c.state).toBe('rate_limited');
    expect(c.keepInQueue).toBe(true);   // sessizce SİLİNMEZ
    expect(c.userVisible).toBe(true);
    expect(isDelivered(c.state)).toBe(false); // RPC NULL ≠ başarı
  });

  it('2xx + kanıtsız gövde → failed (yalancı başarı reddi)', () => {
    const c = classifyHttpOutcome({ status: 200, bodyText: '"ok"', sentBytes: small });
    expect(c.state).toBe('failed');
    expect(isDelivered(c.state)).toBe(false);
  });

  it('429 → rate_limited (kuyrukta kal)', () => {
    const c = classifyHttpOutcome({ status: 429, bodyText: '', sentBytes: small });
    expect(c.state).toBe('rate_limited');
    expect(c.keepInQueue).toBe(true);
  });

  it('#7 4xx (invalid_api_key) → rejected (sil, görünür)', () => {
    for (const s of [400, 401, 403, 404]) {
      const c = classifyHttpOutcome({ status: s, bodyText: '{"message":"invalid_api_key"}', sentBytes: small });
      expect(c.state).toBe('rejected');
      expect(c.keepInQueue).toBe(false);
      expect(c.userVisible).toBe(true);
    }
  });

  it('#6 5xx → retry_scheduled (kuyrukta kal, sessiz)', () => {
    for (const s of [500, 502, 503]) {
      const c = classifyHttpOutcome({ status: s, bodyText: '', sentBytes: small });
      expect(c.state).toBe('retry_scheduled');
      expect(c.keepInQueue).toBe(true);
    }
  });

  it('#8 ağ hatası → retry_scheduled (kuyrukta kal)', () => {
    const c = classifyHttpOutcome({ networkError: true, sentBytes: small });
    expect(c.state).toBe('retry_scheduled');
    expect(c.keepInQueue).toBe(true);
  });
});

describe('teslimat defteri — durum makinesi + monotoniklik', () => {
  const T0 = 1_000_000;

  it('#1 beginDelivery → queued', () => {
    const { record, isDuplicate } = beginDelivery('r1', 'support_snapshot', T0);
    expect(record.state).toBe('queued');
    expect(isDuplicate).toBe(false);
  });

  it('#9/#10 idempotency: aynı reportId ikinci kez → duplicate (tek kayıt)', () => {
    beginDelivery('r1', 'support_snapshot', T0);
    const second = beginDelivery('r1', 'support_snapshot', T0 + 5);
    expect(second.isDuplicate).toBe(true);
    expect(second.record.state).toBe('queued'); // yeni kayıt oluşmaz
  });

  it('#2 delivered TERMİNAL: sonraki sonuç durumu DEĞİŞTİRMEZ (geç retry düşüremez)', () => {
    beginDelivery('r1', 'support_snapshot', T0);
    const delivered: DeliveryClassification = { state: 'delivered', serverReportId: UUID, keepInQueue: false, userVisible: false };
    applyOutcome('r1', delivered, T0 + 1);
    expect(getDelivery('r1')!.state).toBe('delivered');
    // geç gelen retry_scheduled → yok sayılır (monotonik)
    applyOutcome('r1', { state: 'retry_scheduled', serverReportId: null, keepInQueue: true, userVisible: false }, T0 + 2);
    expect(getDelivery('r1')!.state).toBe('delivered');
    expect(getDelivery('r1')!.serverReportId).toBe(UUID);
  });

  it('#11 retry tavanı: MAX_DELIVERY_ATTEMPTS denemeden sonra → failed', () => {
    beginDelivery('r1', 'support_snapshot', T0);
    const retry: DeliveryClassification = { state: 'retry_scheduled', serverReportId: null, keepInQueue: true, userVisible: false };
    let last = getDelivery('r1')!;
    for (let i = 0; i < MAX_DELIVERY_ATTEMPTS; i++) last = applyOutcome('r1', retry, T0 + i)!;
    expect(last.state).toBe('failed');       // tavana ulaşınca kalıcı başarısız
    expect(isTerminal(last.state)).toBe(true);
  });

  it('#12 TTL: yaş tavanı aşılınca retry → failed', () => {
    beginDelivery('r1', 'support_snapshot', T0);
    const retry: DeliveryClassification = { state: 'retry_scheduled', serverReportId: null, keepInQueue: true, userVisible: false };
    const rec = applyOutcome('r1', retry, T0 + DELIVERY_TTL_MS + 1)!;
    expect(rec.state).toBe('failed');
  });

  it('rate_limited terminal DEĞİL — tavana kadar geçici kalır', () => {
    beginDelivery('r1', 'support_snapshot', T0);
    const rec = applyOutcome('r1', { state: 'rate_limited', serverReportId: null, keepInQueue: true, userVisible: true }, T0 + 1)!;
    expect(rec.state).toBe('rate_limited');
    expect(isTerminal(rec.state)).toBe(false);
  });

  it('markSending terminal kaydı değiştirmez', () => {
    beginDelivery('r1', 'support_snapshot', T0);
    applyOutcome('r1', { state: 'rejected', serverReportId: null, keepInQueue: false, userVisible: true }, T0 + 1);
    markSending('r1', T0 + 2);
    expect(getDelivery('r1')!.state).toBe('rejected'); // sending'e düşmez
  });
});

describe('shouldKeepInQueue — bounded retry + TTL kapısı (sonsuz retry yok)', () => {
  const T0 = 1_000_000;
  const keepCls: DeliveryClassification = { state: 'rate_limited', serverReportId: null, keepInQueue: true, userVisible: true };
  const dropCls: DeliveryClassification = { state: 'rejected', serverReportId: null, keepInQueue: false, userVisible: true };

  it('keepInQueue=false → her koşulda sil', () => {
    expect(shouldKeepInQueue(dropCls, 1, T0, T0)).toBe(false);
  });
  it('tavan altında → tut', () => {
    expect(shouldKeepInQueue(keepCls, 1, T0, T0 + 100)).toBe(true);
  });
  it('#11 attempts tavana ulaştı → artık tutma', () => {
    expect(shouldKeepInQueue(keepCls, MAX_DELIVERY_ATTEMPTS, T0, T0 + 100)).toBe(false);
  });
  it('#12 TTL aşıldı → artık tutma', () => {
    expect(shouldKeepInQueue(keepCls, 1, T0, T0 + DELIVERY_TTL_MS + 1)).toBe(false);
  });
});

describe('#14 UI truth — deliveryLabel yalancı "Gönderildi" üretmez', () => {
  it('yalnız delivered "Gönderildi" der', () => {
    expect(deliveryLabel('delivered')).toBe('Gönderildi');
  });
  it('queued/rate_limited/rejected/failed ASLA sade "Gönderildi" DEMEZ', () => {
    for (const s of ['queued', 'rate_limited', 'rejected', 'failed', 'retry_scheduled'] as const) {
      expect(deliveryLabel(s)).not.toBe('Gönderildi');
    }
  });
  it('truncated "Gönderildi" içerir ama kırpma uyarısı taşır (başarı değil)', () => {
    expect(deliveryLabel('truncated')).toContain('kısaltıldı');
  });
});

describe('#10 deriveReportId — deterministik idempotency anahtarı', () => {
  it('aynı (type, seed) → aynı anahtar', () => {
    expect(deriveReportId('support_snapshot', 'abc')).toBe(deriveReportId('support_snapshot', 'abc'));
  });
  it('farklı seed → farklı anahtar', () => {
    expect(deriveReportId('support_snapshot', 'a')).not.toBe(deriveReportId('support_snapshot', 'b'));
  });
});

/* ══════════════ PART B — connectivityService ENTEGRASYONU ══════════════ */

vi.mock('@capacitor/network', () => ({
  Network: {
    getStatus:   vi.fn(async () => ({ connected: true })),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
  },
}));
vi.mock('../platform/debug', () => ({ logInfo: vi.fn(), logError: vi.fn(), logWarn: vi.fn() }));

import { connectivityService } from '../platform/connectivityService';

/* Compact in-memory IndexedDB shim (soak testinin deseni; yalnız kullanılan yüzey). */
function installFakeIDB(): { clear: () => void } {
  const data = new Map<string, { id: string }>();
  const makeStore = () => ({
    createIndex: () => {},
    getAll: () => {
      const req: Record<string, unknown> = { result: undefined, onsuccess: null, onerror: null };
      queueMicrotask(() => { req.result = [...data.values()]; (req.onsuccess as (() => void) | null)?.(); });
      return req;
    },
    put:    (e: { id: string }) => { data.set(e.id, e); },
    delete: (id: string) => { data.delete(id); },
  });
  const makeTx = () => {
    const tx: Record<string, unknown> = { objectStore: () => makeStore(), oncomplete: null, onerror: null };
    queueMicrotask(() => { (tx.oncomplete as (() => void) | null)?.(); });
    return tx;
  };
  const db = {
    createObjectStore: () => makeStore(),
    transaction: () => makeTx(),
    close: () => {},
    onclose: null, onversionchange: null,
  };
  (globalThis as unknown as { indexedDB: unknown }).indexedDB = {
    open: () => {
      const req: Record<string, unknown> = { result: db, error: null, onsuccess: null, onerror: null, onupgradeneeded: null };
      queueMicrotask(() => { (req.onupgradeneeded as (() => void) | null)?.(); (req.onsuccess as (() => void) | null)?.(); });
      return req;
    },
  };
  return { clear: () => data.clear() };
}

/** Mikrotask kuyruğunu birkaç tur boşalt (fake IDB queueMicrotask zinciri için). */
async function flush(n = 12): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

function mockFetch(status: number, body: string): void {
  (globalThis as unknown as { fetch: unknown }).fetch = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  }));
}

describe('connectivityService — teslimat gerçeği KEEP/DELETE', () => {
  let idb: { clear: () => void };
  const URL = 'https://x.test/rpc/push_vehicle_event';

  beforeEach(async () => {
    _resetDeliveryLedgerForTest();
    idb = installFakeIDB();
    await connectivityService.init();
  });
  afterEach(() => {
    connectivityService.destroy();
    idb.clear();
    vi.restoreAllMocks();
  });

  it('#2 UUID → delivered ve kuyruktan SİLİNİR; defter delivered', async () => {
    mockFetch(200, JSON.stringify(UUID));
    beginDelivery('rid-ok', 'telemetry', Date.now());
    await connectivityService.enqueue(URL, 'POST', {}, { p: 1 }, 'normal', 'telemetry', 'rid-ok');
    await flush();
    expect(await connectivityService.queueSize()).toBe(0);          // teslim → silindi
    expect(getDelivery('rid-ok')!.state).toBe('delivered');
    expect(getDelivery('rid-ok')!.serverReportId).toBe(UUID);
  });

  it('#3/#5 RPC NULL (rate limit) → KUYRUKTA KALIR (sessiz kayıp YOK); defter rate_limited', async () => {
    mockFetch(200, 'null');
    beginDelivery('rid-rl', 'telemetry', Date.now());
    await connectivityService.enqueue(URL, 'POST', {}, { p: 1 }, 'normal', 'telemetry', 'rid-rl');
    await flush();
    expect(await connectivityService.queueSize()).toBe(1);          // silinmedi
    expect(getDelivery('rid-rl')!.state).toBe('rate_limited');
  });

  it('#7 4xx → rejected ve kuyruktan silinir; defter rejected', async () => {
    mockFetch(400, '{"message":"invalid_api_key"}');
    beginDelivery('rid-4xx', 'telemetry', Date.now());
    await connectivityService.enqueue(URL, 'POST', {}, { p: 1 }, 'normal', 'telemetry', 'rid-4xx');
    await flush();
    expect(await connectivityService.queueSize()).toBe(0);
    expect(getDelivery('rid-4xx')!.state).toBe('rejected');
  });

  it('#6 5xx → retry: kuyrukta KALIR; defter retry_scheduled', async () => {
    mockFetch(503, '');
    beginDelivery('rid-5xx', 'telemetry', Date.now());
    await connectivityService.enqueue(URL, 'POST', {}, { p: 1 }, 'normal', 'telemetry', 'rid-5xx');
    await flush();
    expect(await connectivityService.queueSize()).toBe(1);
    expect(getDelivery('rid-5xx')!.state).toBe('retry_scheduled');
  });

  it('reportId YOK (bulk telemetri) → defter izlemez ama kuyruk davranışı aynı (delivered sil)', async () => {
    mockFetch(200, JSON.stringify(UUID));
    await connectivityService.enqueue(URL, 'POST', {}, { p: 1 }, 'normal', 'telemetry'); // reportId yok
    await flush();
    expect(await connectivityService.queueSize()).toBe(0);
  });
});
