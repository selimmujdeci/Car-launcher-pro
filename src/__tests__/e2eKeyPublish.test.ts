/**
 * e2eKeyPublish.test.ts — P0-001B · E2E AÇIK ANAHTAR YAYINI + LAB MODELİ.
 *
 * ── ÖLÇÜLEN KUSUR (canlı Carospro, 2026-08-22) ────────────────────────────
 * `vehicles.e2e_public_key` / `e2e_key_alg` kolonları üretimde HİÇ YOKTU.
 * Araç her bağlantıda o kolonlara UPSERT etmeye çalışıyordu; hata `catch`
 * içinde yutuluyordu. Telefon tarafı da anahtarı bulamayınca komutu hiç
 * göndermiyordu (fail-closed, doğru davranış).
 *
 * Sonuç: `lock · unlock · horn · alarm_on · alarm_off · lights_on · clear_dtc`
 * ÜRETİMDE HİÇ ÇALIŞMADI.
 *
 * İkinci kusur: kolon eklense bile araç Supabase'e `anon` ile bağlandığı için
 * `vehicles` UPDATE politikası (`auth.uid()` tabanlı) UPSERT'i 0 satırda
 * bırakırdı. Yayın bu yüzden RPC'ye taşındı.
 *
 * Bu dosya İKİ şeyi kilitler:
 *   ① araç yayını GERÇEKTEN RPC ile yapıyor ve sonucu ÖLÇÜYOR,
 *   ② LAB modeli kanıt yokken "çalışıyor" DEMİYOR (fail-closed hüküm).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildE2eLines, buildIdentityLines, overallVerdict,
} from '../platform/devtools/deviceIdentityLabModel';

/* ══════════════════════════════════════════════════════════════════════════
 * BÖLÜM 1 — LAB MODELİ (saf; mock gerekmez)
 * ══════════════════════════════════════════════════════════════════════════ */

describe('P0-001B · LAB modeli fail-closed hüküm verir', () => {
  it('gözlem YOKSA "çalışıyor" demez → UNAVAILABLE', () => {
    const lines = buildE2eLines(null);
    expect(lines[0].verdict).toBe('UNAVAILABLE');
  });

  it('hiç yayın DENENMEMİŞSE bu "başarısız" değil UNAVAILABLE sayılır', () => {
    /* "Denenmedi" ile "denendi ve düştü" AYNI ŞEY DEĞİLDİR; karıştırmak
       kusurun kökünü gizler (tam olarak bu kusurda olan şey). */
    const lines = buildE2eLines({
      runs: 0, ok: 0, outcome: null, reason: null, lastAgeMs: null, cryptoFailed: 0,
    });
    expect(lines).toHaveLength(1);
    expect(lines[0].verdict).toBe('UNAVAILABLE');
    expect(lines[0].value).toContain('DENENMEDİ');
  });

  it('başarılı yayın OK, reddedilen yayın BAD üretir', () => {
    const ok = buildE2eLines({
      runs: 1, ok: 1, outcome: 'ok', reason: null, lastAgeMs: 10, cryptoFailed: 0,
    });
    expect(ok[0].verdict).toBe('OK');

    const bad = buildE2eLines({
      runs: 1, ok: 0, outcome: 'rejected', reason: 'INVALID_KEY_FORMAT',
      lastAgeMs: 10, cryptoFailed: 0,
    });
    expect(bad[0].verdict).toBe('BAD');
    expect(bad.some((l) => l.value === 'INVALID_KEY_FORMAT')).toBe(true);
  });

  it('`no_key` bir HATA değildir — WARN, BAD değil', () => {
    const lines = buildE2eLines({
      runs: 1, ok: 0, outcome: 'no_key', reason: null, lastAgeMs: 5, cryptoFailed: 0,
    });
    expect(lines[0].verdict).toBe('WARN');
    expect(lines[0].note).toContain('deneme yapılamadı');
  });

  it('şifreleme kapısında reddedilen komut varsa BAD satırı üretir', () => {
    /* Bu sayaç sıfırdan büyükse gönderen uç ile araç AYRIŞMIŞ demektir —
       tam olarak bu turun düzelttiği kusurun imzası. */
    const lines = buildE2eLines({
      runs: 1, ok: 1, outcome: 'ok', reason: null, lastAgeMs: 1, cryptoFailed: 3,
    });
    expect(lines.some((l) => l.verdict === 'BAD' && l.value === '3')).toBe(true);
  });

  it('kimlik: RANDOM_FALLBACK reinstall güvenli SAYILMAZ', () => {
    const lines = buildIdentityLines({
      source: 'RANDOM_FALLBACK', reinstallSafe: false,
      registeredWithoutKey: false, weakRandomUsed: false,
    });
    expect(lines[0].verdict).toBe('WARN');
    expect(lines[1].value).toBe('HAYIR');
    expect(lines[1].note).toContain('YENİ bir araç açar');
  });

  it('kimlik: anahtarsız kayıt BAD olarak yükselir', () => {
    const lines = buildIdentityLines({
      source: 'DERIVED_SSAID', reinstallSafe: true,
      registeredWithoutKey: true, weakRandomUsed: false,
    });
    expect(lines.some((l) => l.verdict === 'BAD')).toBe(true);
  });

  it('genel hüküm EN KÖTÜ satırı yansıtır (iyi haber kötüyü gölgeleyemez)', () => {
    const good = buildE2eLines({
      runs: 1, ok: 1, outcome: 'ok', reason: null, lastAgeMs: 1, cryptoFailed: 0,
    });
    const bad = buildIdentityLines({
      source: 'STORED', reinstallSafe: true,
      registeredWithoutKey: true, weakRandomUsed: false,
    });
    expect(overallVerdict([good, bad])).toBe('BAD');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * BÖLÜM 2 — ARAÇ TARAFI YAYIN (commandListener → RPC)
 * ══════════════════════════════════════════════════════════════════════════ */

const M = vi.hoisted(() => ({
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  rpcResult: null as unknown,
  rpcThrows: false,
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  callVehicleRpc: vi.fn(async (fn: string, args: Record<string, unknown>) => {
    M.rpcCalls.push({ fn, args });
    if (M.rpcThrows) throw new Error('network');
    return M.rpcResult;
  }),
  updateRemoteCommandStatus: vi.fn(async () => {}),
}));

vi.mock('../platform/commandCrypto', () => ({
  loadOrCreateDeviceKey: vi.fn(async () => ({ pubKeyB64: 'MFkwEwYHKoZIzj0CAQ_TEST_KEY' })),
  getCarPrivateKey: vi.fn(() => null),
  isE2EPayload: vi.fn(() => false),
  isEncryptedPayload: vi.fn(() => false),
  decryptE2EPayload: vi.fn(async () => ({})),
  decryptPayload: vi.fn(async () => ({})),
}));

describe('P0-001B · araç yayını RPC ile yapar ve sonucu ÖLÇER', () => {
  beforeEach(() => {
    vi.resetModules();
    M.rpcCalls = [];
    M.rpcResult = { ok: true, rotated: true };
    M.rpcThrows = false;
  });

  afterEach(() => { vi.restoreAllMocks(); });

  it("KİLİT: yayın `publish_device_public_key` RPC'sine gider (tabloya UPSERT DEĞİL)", async () => {
    const mod = await import('../platform/commandListener');
    const listener = new mod.CommandListener('veh-1');

    /* `connect()` Supabase istemcisi ister; yayın adımı ondan bağımsız
       çağrılabilsin diye ayrı metottur. Özel metoda erişim testin
       gerçeği ölçmesi için bilinçlidir — alternatifi tüm Realtime
       yığınını taklit etmekti ve o, kusuru ölçmezdi. */
    await (listener as unknown as { publishPublicKey(): Promise<void> }).publishPublicKey();

    expect(M.rpcCalls).toHaveLength(1);
    expect(M.rpcCalls[0].fn).toBe('publish_device_public_key');
    expect(M.rpcCalls[0].args.p_public_key).toBe('MFkwEwYHKoZIzj0CAQ_TEST_KEY');
    expect(M.rpcCalls[0].args.p_alg).toBe('ECDH-P256-AES-GCM-256');
    /* Ham cihaz anahtarı ÇAĞRIDA yok — `callVehicleRpc` onu kendi ekler. */
    expect(M.rpcCalls[0].args.p_api_key).toBeUndefined();
  });

  it('başarılı yayın kanıta ROTASYON olarak yazılır', async () => {
    const mod = await import('../platform/commandListener');
    const listener = new mod.CommandListener('veh-1');
    await (listener as unknown as { publishPublicKey(): Promise<void> }).publishPublicKey();

    const e = mod.getCommandEvidence();
    expect(e.keyPublishRuns).toBe(1);
    expect(e.keyPublishOk).toBe(1);
    expect(e.keyPublishOutcome).toBe('rotated');
    expect(e.keyPublishReason).toBeNull();
  });

  it('sunucu REDDEDERSE gerekçe kanıta yazılır ve başarı sayılmaz', async () => {
    M.rpcResult = { ok: false, reason: 'INVALID_KEY_FORMAT' };
    const mod = await import('../platform/commandListener');
    const listener = new mod.CommandListener('veh-1');
    await (listener as unknown as { publishPublicKey(): Promise<void> }).publishPublicKey();

    const e = mod.getCommandEvidence();
    expect(e.keyPublishOk).toBe(0);
    expect(e.keyPublishOutcome).toBe('rejected');
    expect(e.keyPublishReason).toBe('INVALID_KEY_FORMAT');
  });

  it('anahtar/yapılandırma yoksa `no_key` — "hata" DEĞİL', async () => {
    M.rpcResult = null;
    const mod = await import('../platform/commandListener');
    const listener = new mod.CommandListener('veh-1');
    await (listener as unknown as { publishPublicKey(): Promise<void> }).publishPublicKey();

    const e = mod.getCommandEvidence();
    expect(e.keyPublishOutcome).toBe('no_key');
    expect(e.keyPublishOk).toBe(0);
  });

  it('ağ hatası yayını ÇÖKERTMEZ ama SESSİZ de kalmaz', async () => {
    M.rpcThrows = true;
    const mod = await import('../platform/commandListener');
    const listener = new mod.CommandListener('veh-1');

    await expect(
      (listener as unknown as { publishPublicKey(): Promise<void> }).publishPublicKey(),
    ).resolves.toBeUndefined();

    expect(mod.getCommandEvidence().keyPublishOutcome).toBe('error');
  });
});
