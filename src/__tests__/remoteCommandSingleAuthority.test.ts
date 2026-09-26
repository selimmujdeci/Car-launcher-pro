/**
 * remoteCommandSingleAuthority.test.ts — F0.2 TEK YÜRÜTME OTORİTESİ KİLİDİ.
 *
 * ── ÖLÇÜLEN KUSUR ────────────────────────────────────────────────────────
 * `remoteCommandService` ve `commandListener` aynı `vehicle_commands` satırını
 * birbirinden habersiz işleyebiliyordu (ayrı realtime kanalları, ayrı RAM
 * dedup'ları, ortak DB claim YOK). Arabam Cebimde INSERT'i yalnız `type`
 * yazdığı için bu servis `intent`i bulamayıp `failed` yazarken diğeri komutu
 * yürütüp `completed` yazıyordu: aynı satır, iki gerçek.
 *
 * ── KİLİTLENEN INVARIANTLAR ─────────────────────────────────────────────
 *   2 · Bir komut ID'si İKİ bağımsız fiziksel executor tarafından yürütülemez.
 *   3 · `type`/`intent` farkı aynı komutu iki ayrı yoruma AYIRAMAZ.
 *
 * Testler DAVRANIŞA bakar (fonksiyon çağrıldı mı), yalnız kaynak metnine değil.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* ── Yürütme yüzeylerinin casusları ──────────────────────────────────────
   Bunlardan HERHANGİ biri çağrılırsa, servis hâlâ bir executor demektir. */
const spies = vi.hoisted(() => ({
  executeIntent:              vi.fn(async () => undefined),
  updateRemoteCommandStatus:  vi.fn(async () => undefined),
  pushVehicleEvent:           vi.fn(async () => undefined),
}));

vi.mock('../platform/commandExecutor', () => ({
  executeIntent: spies.executeIntent,
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  updateRemoteCommandStatus: spies.updateRemoteCommandStatus,
  pushVehicleEvent:          spies.pushVehicleEvent,
  getVehicleIdentity:        vi.fn(async () => ({ vehicleId: 'veh-1', apiKey: 'k' })),
}));

/* Realtime kanalı: `.on()` ile kaydedilen geri çağrıyı yakalarız; testte
   satırı o geri çağrıya vererek GERÇEK teslimat yolunu kullanırız. */
const bus = vi.hoisted(() => ({
  handler: null as null | ((evt: { new: Record<string, unknown> }) => void),
  channelTopics: [] as string[],
}));

vi.mock('../platform/supabaseClient', () => ({
  getSupabaseClient: () => ({
    channel: (topic: string) => {
      bus.channelTopics.push(topic);
      const ch = {
        on: (_e: string, _f: unknown, cb: (evt: { new: Record<string, unknown> }) => void) => {
          bus.handler = cb;
          return ch;
        },
        subscribe: (_cb?: (s: string) => void) => ch,
        unsubscribe: () => undefined,
      };
      return ch;
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            gte: () => ({ order: () => ({ limit: async () => ({ data: [] }) }) }),
          }),
        }),
      }),
    }),
  }),
}));

vi.mock('../platform/sensitiveKeyStore', () => ({
  sensitiveKeyStore: { get: vi.fn(async () => 'api-key') },
}));

/** Bağlantı KAPALI: çevrimdışı defter dalını da aynı testte kanıtlayabilelim. */
const connectivity = vi.hoisted(() => ({ allowed: true }));
vi.mock('../platform/connectivity/connectivityGate', () => ({
  allowsConnectivity: () => connectivity.allowed,
  subscribeConnectivity: () => () => undefined,
}));

const LOCK_ROW = {
  id:         'cmd-1',
  vehicle_id: 'veh-1',
  status:     'pending',
  type:       'lock',
  intent:     'HARDWARE_LOCK',
  payload:    {},
  created_at: new Date().toISOString(),
  ttl:        new Date(Date.now() + 60_000).toISOString(),
};

describe('F0.2 · remoteCommandService fiziksel executor DEĞİLDİR', () => {
  beforeEach(() => {
    bus.handler = null;
    bus.channelTopics.length = 0;
    connectivity.allowed = true;
    spies.executeIntent.mockClear();
    spies.updateRemoteCommandStatus.mockClear();
    spies.pushVehicleEvent.mockClear();
    vi.resetModules();
  });

  afterEach(() => { vi.restoreAllMocks(); });

  async function bootService() {
    const mod = await import('../platform/remoteCommandService');
    await mod.startRemoteCommands();
    return mod;
  }

  it('INVARIANT 2 — teslim edilen komut için executeIntent ASLA çağrılmaz', async () => {
    const mod = await bootService();
    mod.setRemoteCommandContext({} as never);
    expect(bus.handler).toBeTruthy();

    bus.handler!({ new: { ...LOCK_ROW } });
    await Promise.resolve(); await Promise.resolve();

    expect(spies.executeIntent).not.toHaveBeenCalled();
  });

  it('INVARIANT 2 — satırın DURUMUNA da yazmaz (tek satır, tek yaşam döngüsü sahibi)', async () => {
    const mod = await bootService();
    mod.setRemoteCommandContext({} as never);

    bus.handler!({ new: { ...LOCK_ROW } });
    await Promise.resolve(); await Promise.resolve();

    expect(spies.updateRemoteCommandStatus).not.toHaveBeenCalled();
    expect(spies.pushVehicleEvent).not.toHaveBeenCalled();
  });

  it('INVARIANT 3 — `type` VAR / `intent` YOK satırı "Unknown intent → failed" ÜRETMEZ', async () => {
    /* Arabam Cebimde INSERT'inin GERÇEK şekli budur (yalnız `type`).
       Eski davranışta bu satır `failed` yazdırıyordu. */
    const mod = await bootService();
    mod.setRemoteCommandContext({} as never);

    const { intent: _drop, ...typeOnlyRow } = LOCK_ROW;
    bus.handler!({ new: typeOnlyRow });
    await Promise.resolve(); await Promise.resolve();

    expect(spies.updateRemoteCommandStatus).not.toHaveBeenCalled();
    expect(spies.executeIntent).not.toHaveBeenCalled();
  });

  it('INVARIANT 3 — `intent` VAR / `type` YOK satırı da AYNI şekilde yürütülmez', async () => {
    const mod = await bootService();
    mod.setRemoteCommandContext({} as never);

    const { type: _drop, ...intentOnlyRow } = LOCK_ROW;
    bus.handler!({ new: intentOnlyRow });
    await Promise.resolve(); await Promise.resolve();

    expect(spies.executeIntent).not.toHaveBeenCalled();
    expect(spies.updateRemoteCommandStatus).not.toHaveBeenCalled();
  });

  it('teslim edilen komut sayılır — kanal hâlâ TAŞIMA olarak çalışıyor', async () => {
    const mod = await bootService();
    const before = mod.getDelegatedCommandCount();

    bus.handler!({ new: { ...LOCK_ROW, id: 'cmd-count-1' } });
    await Promise.resolve(); await Promise.resolve();

    expect(mod.getDelegatedCommandCount()).toBe(before + 1);
  });

  it('çevrimdışı kritik komut yalnız YEREL deftere alınır, DB\'ye yazılmaz', async () => {
    connectivity.allowed = false;
    await bootService();

    bus.handler!({ new: { ...LOCK_ROW, id: 'cmd-offline-1' } });
    await Promise.resolve(); await Promise.resolve();

    expect(spies.updateRemoteCommandStatus).not.toHaveBeenCalled();
    expect(spies.executeIntent).not.toHaveBeenCalled();
  });
});

describe('F0.2 · kaynak sözleşmesi (geri dönüşü kilitler)', () => {
  const SRC = readFileSync(
    resolve(process.cwd(), 'src', 'platform', 'remoteCommandService.ts'), 'utf8',
  );
  const EXEC = SRC.split('\n')
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith('*') && !t.startsWith('//') && !t.startsWith('/*');
    })
    .join('\n');

  it('eski yürütücü gövdesinin ÇAĞRISI YOKTUR (yalnız `void` referansı)', () => {
    expect(EXEC).toMatch(/void _legacyExecuteCommandDisabled;/);

    /* `void f;` referanstır; `f(` ÇAĞRIDIR. Tanım satırı (`async function f(`)
       doğal olarak parantez içerir → onu çıkarıp kalan her `f(` bir çağrıdır.
       Çağrı geri gelirse ikinci fiziksel executor de geri gelir. */
    const withoutDeclaration = EXEC.replace(
      /async function _legacyExecuteCommandDisabled\s*\(/, '«decl»',
    );
    expect(withoutDeclaration).not.toMatch(/_legacyExecuteCommandDisabled\s*\(/);

    /* İsim tam olarak İKİ kez geçmeli: tanım + `void` referansı. */
    const occurrences = EXEC.match(/_legacyExecuteCommandDisabled/g) ?? [];
    expect(occurrences).toHaveLength(2);
  });

  it('yürütme yüzeyleri aktif `_processCommand` içinde kullanılmaz', () => {
    const start = EXEC.indexOf('async function _processCommand(');
    const end   = EXEC.indexOf('async function _legacyExecuteCommandDisabled(');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const active = EXEC.slice(start, end);
    expect(active).not.toMatch(/executeIntent\s*\(/);
    expect(active).not.toMatch(/updateRemoteCommandStatus\s*\(/);
    expect(active).not.toMatch(/pushVehicleEvent\s*\(/);
  });

  it('kanonik otorite `commandListener` yürütmeyi KORUR (devir tek yönlü)', () => {
    const listener = readFileSync(
      resolve(process.cwd(), 'src', 'platform', 'commandListener.ts'), 'utf8',
    );
    /* Fiziksel komut yolu ve E2E zorunluluğu kanonik otoritede DURMALI. */
    expect(listener).toMatch(/executeMcuCommand/);
    expect(listener).toMatch(/E2E_REQUIRED_COMMANDS/);
    expect(listener).toMatch(/MCU_COMMANDS/);
  });
});
