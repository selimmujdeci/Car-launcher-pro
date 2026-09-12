/**
 * fleetOfflinePairingWiring.test.ts — ÇEVRİMDIŞI EŞLEŞTİRMENİN ÜRÜN YOLU.
 *
 * `fleetOfflineQueue.test.ts` saf sözleşmeyi (isSendable/expireOverdue) kilitler.
 * BU dosya, o sözleşmenin gerçekten ÜRÜNE bağlandığını kilitler: claim üretimi,
 * TTL reddi, tekrar (replay) koruması, ağ hatası ile sunucu reddinin AYRIMI,
 * çıkış temizliği ve LAB'ın salt-okunurluğu.
 *
 * NEDEN GEREKLİ: önceki turda `offlinePairing.ts` yazılmış ama hiçbir ekran onu
 * ÇAĞIRMIYORDU — yani çevrimdışı eşleştirme testte yeşil, üründe YOKtu.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPendingPairing,
  submitPendingPairings,
  expirePendingPairings,
  listPendingPairings,
  readPairingCounts,
  resetPendingPairingStore,
  pairingNamespace,
  DEVICE_NAMESPACE,
  type PairingSubmitOutcome,
} from '@/lib/offline/pendingPairingService';
import { clearAllPendingPairings, type SecureCipher } from '@/lib/offline/offlinePairing';

/**
 * Testte WebCrypto/PBKDF2 çalıştırmayız (100k iterasyon testi yavaşlatır).
 * Sahte şifreleyici GERÇEKTEN gizler (base64) — böylece "diske düz metin
 * yazılmıyor" iddiası anlamlı biçimde doğrulanabilir.
 */
const cipher: SecureCipher = {
  async encrypt(plain: string) { return `enc.${btoa(plain)}`; },
  async decrypt(value: string) {
    if (!value.startsWith('enc.')) return null;
    try { return atob(value.slice(4)); } catch { return null; }
  },
};

const NS = 'user-1';
const T0 = 1_700_000_000_000;

/** Taşıyıcı sahtesi — çağrıları sayar ki "iki kez gönderildi mi" görülebilsin. */
function transport(outcome: PairingSubmitOutcome) {
  const calls: string[] = [];
  return {
    calls,
    submit: async (code: string) => { calls.push(code); return outcome; },
  };
}

const OK_OUTCOME:      PairingSubmitOutcome = { ok: true,  offline: false, code: null, vehicleId: 'v1' };
const OFFLINE_OUTCOME: PairingSubmitOutcome = { ok: false, offline: true,  code: null, vehicleId: null };

beforeEach(() => {
  window.localStorage.clear();
  clearAllPendingPairings();
  resetPendingPairingStore();
});

describe('çevrimdışı eşleştirme — claim üretimi', () => {
  it('claim SAHİPLİK DEĞİLDİR: durum PENDING_SERVER_VERIFICATION', async () => {
    const claim = await createPendingPairing({
      namespace: NS, userId: NS, code: '123456', now: T0, cipher,
    });

    expect(claim.status).toBe('PENDING_SERVER_VERIFICATION');
    // "VERIFIED" hiçbir koşulda sunucuya sorulmadan üretilmez.
    expect(claim.status).not.toBe('VERIFIED');
  });

  it('kod DÜZ METİN olarak diske yazılmaz', async () => {
    await createPendingPairing({ namespace: NS, userId: NS, code: '424242', now: T0, cipher });

    const raw = window.localStorage.getItem(`caros.fleet.pairing.${NS}`) ?? '';
    // Kod hiçbir alanda (idempotencyKey dahil) düz metin GEÇMEZ.
    expect(raw).not.toContain('424242');
    expect(raw).toContain('enc.');
  });

  it('aynı kod iki kez kaydedilse bile TEK claim kalır (idempotency)', async () => {
    await createPendingPairing({ namespace: NS, userId: NS, code: '111111', now: T0, cipher });
    await createPendingPairing({ namespace: NS, userId: NS, code: '111111', now: T0 + 5, cipher });

    const list = await listPendingPairings(NS, cipher);
    expect(list).toHaveLength(1);
  });
});

describe('çevrimdışı eşleştirme — gönderim', () => {
  it('sunucu onaylayınca VERIFIED olur', async () => {
    await createPendingPairing({ namespace: NS, userId: NS, code: '123456', now: T0, cipher });
    const t = transport(OK_OUTCOME);

    const summary = await submitPendingPairings({
      namespace: NS, submit: t.submit, now: T0 + 1_000, cipher,
    });

    expect(summary.verified).toBe(1);
    expect((await listPendingPairings(NS, cipher))[0].status).toBe('VERIFIED');
  });

  it('AĞ HATASI red DEĞİLDİR — claim beklemede kalır, tekrar denenir', async () => {
    await createPendingPairing({ namespace: NS, userId: NS, code: '123456', now: T0, cipher });
    const t = transport(OFFLINE_OUTCOME);

    const summary = await submitPendingPairings({
      namespace: NS, submit: t.submit, now: T0 + 1_000, cipher,
    });

    expect(summary.deferred).toBe(1);
    expect(summary.rejected).toBe(0);
    const claim = (await listPendingPairings(NS, cipher))[0];
    expect(claim.status).toBe('PENDING_SERVER_VERIFICATION');
    expect(claim.attemptCount).toBe(1);
  });

  it('taşıyıcı istisna atarsa claim KAYBOLMAZ', async () => {
    await createPendingPairing({ namespace: NS, userId: NS, code: '123456', now: T0, cipher });

    const summary = await submitPendingPairings({
      namespace: NS,
      submit: async () => { throw new Error('boom'); },
      now: T0 + 1_000,
      cipher,
    });

    expect(summary.deferred).toBe(1);
    expect((await listPendingPairings(NS, cipher))[0].status).toBe('PENDING_SERVER_VERIFICATION');
  });
});

describe('çevrimdışı eşleştirme — TTL ve tekrar koruması', () => {
  it('süresi geçmiş kod SUNUCUYA GÖNDERİLMEZ, EXPIRED olur', async () => {
    await createPendingPairing({
      namespace: NS, userId: NS, code: '123456', now: T0, codeTtlMs: 60_000, cipher,
    });
    const t = transport(OK_OUTCOME);

    const summary = await submitPendingPairings({
      namespace: NS, submit: t.submit, now: T0 + 60_001, cipher,
    });

    expect(t.calls).toHaveLength(0);       // ← hiç gönderilmedi
    expect(summary.expired).toBe(1);
    expect((await listPendingPairings(NS, cipher))[0].status).toBe('EXPIRED');
  });

  it('EXPIRED claim sonraki turlarda tekrar denenmez', async () => {
    await createPendingPairing({
      namespace: NS, userId: NS, code: '123456', now: T0, codeTtlMs: 60_000, cipher,
    });
    await expirePendingPairings(NS, T0 + 60_001, cipher);

    const t = transport(OK_OUTCOME);
    const summary = await submitPendingPairings({
      namespace: NS, submit: t.submit, now: T0 + 70_000, cipher,
    });

    expect(t.calls).toHaveLength(0);
    expect(summary.attempted).toBe(0);
  });

  it('kod zaten kullanılmışsa REJECTED + PAIRING_CODE_ALREADY_USED conflict', async () => {
    await createPendingPairing({ namespace: NS, userId: NS, code: '123456', now: T0, cipher });
    const t = transport({
      ok: false, offline: false, code: 'pairing_code_already_used', vehicleId: null,
    });

    await submitPendingPairings({ namespace: NS, submit: t.submit, now: T0 + 1_000, cipher });

    const claim = (await listPendingPairings(NS, cipher))[0];
    expect(claim.status).toBe('REJECTED');
    expect(claim.conflictCode).toBe('PAIRING_CODE_ALREADY_USED');
  });

  it('araç başkasına aitse OTOMATİK DEVRALMA YOK — VEHICLE_ALREADY_OWNED', async () => {
    await createPendingPairing({ namespace: NS, userId: NS, code: '123456', now: T0, cipher });
    const t = transport({
      ok: false, offline: false, code: 'vehicle_owned_by_another_user', vehicleId: null,
    });

    await submitPendingPairings({ namespace: NS, submit: t.submit, now: T0 + 1_000, cipher });

    const claim = (await listPendingPairings(NS, cipher))[0];
    expect(claim.status).toBe('REJECTED');
    expect(claim.conflictCode).toBe('VEHICLE_ALREADY_OWNED');
    // Sahiplik ÜRETİLMEDİ.
    expect(claim.status).not.toBe('VERIFIED');
  });

  it('TANINMAYAN sunucu reddi fail-closed REJECTED olur (kör retry YOK)', async () => {
    await createPendingPairing({ namespace: NS, userId: NS, code: '123456', now: T0, cipher });
    const t = transport({ ok: false, offline: false, code: null, vehicleId: null });

    await submitPendingPairings({ namespace: NS, submit: t.submit, now: T0 + 1_000, cipher });

    const claim = (await listPendingPairings(NS, cipher))[0];
    expect(claim.status).toBe('REJECTED');
    expect(claim.conflictCode).toBeNull();
  });

  it('reddedilmiş claim ikinci turda TEKRAR GÖNDERİLMEZ', async () => {
    await createPendingPairing({ namespace: NS, userId: NS, code: '123456', now: T0, cipher });
    const rejected = transport({
      ok: false, offline: false, code: 'pairing_code_already_used', vehicleId: null,
    });
    await submitPendingPairings({ namespace: NS, submit: rejected.submit, now: T0 + 1_000, cipher });

    const second = transport(OK_OUTCOME);
    await submitPendingPairings({ namespace: NS, submit: second.submit, now: T0 + 2_000, cipher });

    expect(second.calls).toHaveLength(0);
  });
});

describe('hesap izolasyonu ve çıkış temizliği', () => {
  it('başka kullanıcının claim kapsamı OKUNMAZ', async () => {
    await createPendingPairing({ namespace: 'user-a', userId: 'user-a', code: '111111', now: T0, cipher });

    const other = await listPendingPairings('user-b', cipher);
    expect(other).toHaveLength(0);
  });

  it('çıkışta TÜM kapsamların claim kayıtları silinir', async () => {
    await createPendingPairing({ namespace: 'user-a', userId: 'user-a', code: '111111', now: T0, cipher });
    await createPendingPairing({ namespace: DEVICE_NAMESPACE, userId: null, code: '222222', now: T0, cipher });

    clearAllPendingPairings();

    expect(await listPendingPairings('user-a', cipher)).toHaveLength(0);
    expect(await listPendingPairings(DEVICE_NAMESPACE, cipher)).toHaveLength(0);
  });

  it('oturumsuz PWA eşleştirmesi cihaz kapsamına yazar', () => {
    expect(pairingNamespace(null)).toBe(DEVICE_NAMESPACE);
    expect(pairingNamespace('')).toBe(DEVICE_NAMESPACE);
    expect(pairingNamespace('user-9')).toBe('user-9');
  });
});

describe('CAROS LAB — salt-okunur gözlem', () => {
  it('adetleri KODU ÇÖZMEDEN okur', async () => {
    await createPendingPairing({ namespace: NS, userId: NS, code: '123456', now: T0, cipher });

    const counts = readPairingCounts(NS);
    expect(counts).not.toBeNull();
    expect(counts?.pending).toBe(1);
    expect(counts?.total).toBe(1);
  });

  it('okuma hiçbir claim durumunu DEĞİŞTİRMEZ', async () => {
    await createPendingPairing({ namespace: NS, userId: NS, code: '123456', now: T0, cipher });

    readPairingCounts(NS);
    readPairingCounts(pairingNamespace(null));

    const list = await listPendingPairings(NS, cipher);
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('PENDING_SERVER_VERIFICATION');
  });

  it('boş kapsam sahte veri değil, gerçek sıfır döner', () => {
    const counts = readPairingCounts('bos-kapsam');
    expect(counts).toEqual({ pending: 0, verified: 0, rejected: 0, expired: 0, total: 0 });
  });
});
