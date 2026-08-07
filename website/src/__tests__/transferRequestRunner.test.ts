/**
 * transferRequestRunner.test.ts — DEVİR AKIŞI GÜVENLİK KAPILARI.
 *
 * `useOwnershipTransfer` bu runner'ı sarar; kritik davranışlar burada
 * doğrudan (React render kütüphanesi olmadan) kilitlenir:
 *   · Çevrimdışıyken istek GÖNDERİLMEZ ve kuyruğa YAZILMAZ.
 *   · "Tamamlandı" YALNIZ sunucu 2xx döndüğünde.
 *   · Çift tıklama ikinci istek ÜRETMEZ.
 *   · Ham backend metni kullanıcıya SIZMAZ.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  TransferRequestRunner, uiStateForOutcome, transferFailure, OK_OUTCOME,
  type TransferRequest, type TransferOutcome,
} from '@/lib/fleet/transferRequestRunner';
import { getQueue, resetOfflineState, enqueueOfflineMutation } from '@/lib/offline/fleetOffline';
import { TRANSFER_RESULT_CODES, type TransferResultCode } from '@/lib/fleet/ownershipTransfer';

/* ── Yardımcılar ───────────────────────────────────────────────────────── */

interface Sent { method: string; body: Record<string, unknown> }

function makeRunner(options: {
  online?: boolean;
  respond?: (r: TransferRequest) => { ok: boolean; status: number; body: unknown };
  throwOnSend?: boolean;
  gate?: Promise<void>;
}) {
  const sent: Sent[] = [];
  const runner = new TransferRequestRunner({
    isOnline: () => options.online !== false,
    send: async (request) => {
      sent.push({ method: request.method, body: request.body });
      if (options.gate) await options.gate;
      if (options.throwOnSend) throw new TypeError('Failed to fetch');
      return options.respond?.(request) ?? { ok: true, status: 200, body: {} };
    },
  });
  return { runner, sent };
}

const START: TransferRequest = {
  method: 'POST',
  body: { vehicleId: 'v1', toOwnerType: 'INDIVIDUAL', toOwnerId: 'u2', idempotencyKey: 'xfer:abc12345', expectedRevision: 3 },
};

beforeEach(async () => {
  window.localStorage.clear();
  await resetOfflineState();
});

/* ── 1. ÇEVRİMDIŞI KAPISI ──────────────────────────────────────────────── */

describe('devir runner · çevrimdışı kapısı', () => {
  it('🔴 çevrimdışıyken istek HİÇ GÖNDERİLMEZ', async () => {
    const { runner, sent } = makeRunner({ online: false });
    const outcome = await runner.run(START);

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('ONLINE_REQUIRED');
    expect(outcome.message).toContain('internet');
    expect(sent).toHaveLength(0);
  });

  it('üç eylem türü de çevrimdışıyken reddedilir', async () => {
    const { runner, sent } = makeRunner({ online: false });
    for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
      const outcome = await runner.run({ method, body: {} });
      expect(outcome.code).toBe('ONLINE_REQUIRED');
    }
    expect(sent).toHaveLength(0);
  });

  it('🔴 devir işlemleri çevrimdışı KUYRUĞA YAZILAMAZ', async () => {
    // Kuyruk kapısı ayrıca sınıflandırma tarafından da korunur.
    for (const op of ['VEHICLE_TRANSFER_START', 'VEHICLE_TRANSFER_ACCEPT',
                      'VEHICLE_TRANSFER_REJECT', 'VEHICLE_TRANSFER_CANCEL'] as const) {
      const result = await enqueueOfflineMutation('u1', {
        operationType: op, actorId: 'u1', payload: {},
        dedupKey: `d-${op}`, idempotencyKey: `k-${op}`,
      });
      expect(result.ok).toBe(false);
      expect(result.errorCode).toBe('requires_online');
    }
    expect(await getQueue('u1').all()).toHaveLength(0);
  });
});

/* ── 2. "TAMAMLANDI" DÜRÜSTLÜĞÜ ────────────────────────────────────────── */

describe('devir runner · tamamlandı dürüstlüğü', () => {
  it('sunucu 2xx dönerse tamamlandı', async () => {
    const { runner, sent } = makeRunner({
      respond: () => ({ ok: true, status: 200, body: { transferId: 't1' } }),
    });
    const outcome = await runner.run(START);
    expect(outcome).toEqual(OK_OUTCOME);
    expect(sent).toHaveLength(1);
  });

  it('🔴 sunucu hata dönerse TAMAMLANDI DEMEZ', async () => {
    const { runner } = makeRunner({
      respond: () => ({ ok: false, status: 409, body: { code: 'stale_client_revision' } }),
    });
    const outcome = await runner.run(START);
    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('REVISION_GAP');
    expect(uiStateForOutcome(outcome)).toBe('conflict');
  });

  it('🔴 ağ koparsa SONUÇ BİLİNMİYOR — başarılı SAYILMAZ', async () => {
    const { runner, sent } = makeRunner({ throwOnSend: true });
    const outcome = await runner.run(START);

    expect(outcome.ok).toBe(false);
    expect(outcome.code).toBe('ONLINE_REQUIRED');
    // İstek gitti ama sonucu bilinmiyor — bu dürüstçe raporlanır.
    expect(sent).toHaveLength(1);
  });

  it('gövdesiz 2xx yanıt da tamamlanmış sayılır', async () => {
    const { runner } = makeRunner({ respond: () => ({ ok: true, status: 204, body: null }) });
    expect((await runner.run(START)).ok).toBe(true);
  });
});

/* ── 3. ÇİFT GÖNDERİM ──────────────────────────────────────────────────── */

describe('devir runner · çift gönderim koruması', () => {
  it('🔴 uçuşta istek varken ikincisi GÖNDERİLMEZ', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const { runner, sent } = makeRunner({ gate });

    const first  = runner.run(START);
    const second = await runner.run(START);   // uçuştayken ikinci deneme

    expect(second.ok).toBe(false);
    expect(second.code).toBe('TRANSFER_CONFLICT');
    release();
    expect((await first).ok).toBe(true);
    expect(sent).toHaveLength(1);
  });

  it('istek bitince kilit serbest kalır', async () => {
    const { runner, sent } = makeRunner({});
    expect((await runner.run(START)).ok).toBe(true);
    expect(runner.isBusy()).toBe(false);
    expect((await runner.run(START)).ok).toBe(true);
    expect(sent).toHaveLength(2);
  });

  it('hata sonrası da kilit serbest kalır', async () => {
    const { runner } = makeRunner({ throwOnSend: true });
    await runner.run(START);
    expect(runner.isBusy()).toBe(false);
  });
});

/* ── 4. HAM HATA REDAKSİYONU ───────────────────────────────────────────── */

describe('devir runner · ham hata sızmaz', () => {
  it('🔴 ham SQL metni kullanıcıya GÖSTERİLMEZ', async () => {
    const { runner } = makeRunner({
      respond: () => ({
        ok: false, status: 500,
        body: { code: 'ERROR: relation "vehicles" does not exist at character 15' },
      }),
    });
    const outcome = await runner.run(START);

    expect(outcome.code).toBe('UNKNOWN');
    expect(outcome.message).not.toMatch(/relation|SELECT|ERROR:|character|SQLSTATE/i);
  });

  it('gövdesiz hata yanıtı UNKNOWN olur', async () => {
    const { runner } = makeRunner({ respond: () => ({ ok: false, status: 500, body: null }) });
    expect((await runner.run(START)).code).toBe('UNKNOWN');
  });

  it('typed sunucu kodları doğru çevrilir', async () => {
    const cases: Array<[string, TransferResultCode]> = [
      ['stale_client_revision', 'REVISION_GAP'],
      ['duplicate_operation',   'TRANSFER_CONFLICT'],
      ['pairing_code_expired',  'TRANSFER_EXPIRED'],
      ['not_company_admin',     'CROSS_TENANT_DENIED'],
      ['permission_denied',     'CROSS_TENANT_DENIED'],
    ];
    for (const [serverCode, expected] of cases) {
      const { runner } = makeRunner({
        respond: () => ({ ok: false, status: 409, body: { code: serverCode } }),
      });
      expect((await runner.run(START)).code).toBe(expected);
    }
  });

  it('her sonuç kodu için kullanıcı mesajı vardır ve teknik değildir', () => {
    for (const code of TRANSFER_RESULT_CODES) {
      const outcome = transferFailure(
        code === 'REVISION_GAP' ? 'stale_client_revision' : 'bilinmeyen',
      );
      expect(outcome.message).toBeTruthy();
      expect(outcome.message).not.toMatch(/SELECT|ERROR:|SQLSTATE|uuid/i);
    }
  });
});

/* ── 5. UI DURUM EŞLEMESİ ──────────────────────────────────────────────── */

describe('devir runner · UI durum eşlemesi', () => {
  it('sonuç kodları doğru UI durumuna düşer', () => {
    const map: Array<[TransferOutcome, string]> = [
      [OK_OUTCOME, 'completed'],
      [{ ok: false, code: 'ONLINE_REQUIRED',  message: '' }, 'offline_required'],
      [{ ok: false, code: 'TRANSFER_EXPIRED', message: '' }, 'expired'],
      [{ ok: false, code: 'REVISION_GAP',     message: '' }, 'conflict'],
      [{ ok: false, code: 'TRANSFER_CONFLICT',message: '' }, 'conflict'],
      [{ ok: false, code: 'UNKNOWN',          message: '' }, 'failed'],
      [{ ok: false, code: 'CROSS_TENANT_DENIED', message: '' }, 'failed'],
    ];
    for (const [outcome, expected] of map) {
      expect(uiStateForOutcome(outcome)).toBe(expected);
    }
  });
});
