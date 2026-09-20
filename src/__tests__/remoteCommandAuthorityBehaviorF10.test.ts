/**
 * remoteCommandAuthorityBehaviorF10.test.ts — MRI F-10 · #647 iddialarının
 * DAVRANIŞSAL kanıtı.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * NEDEN VAR
 *
 * `regression.guards.test.ts` içindeki "#647 Uzak komut yolu" kümesi dört
 * GÜÇLÜ DAVRANIŞ İDDİASI kuruyordu:
 *   ① bekleyen komutlar RPC ile okunur, tablo doğrudan sorgulanmaz
 *   ② komut durumu api_key RPC ile yazılır, REST PATCH yok
 *   ③ yoklama ASIL taşıyıcıdır (realtime tek yol değil)
 *   ④ kalıcı dinleyici boşta-kapatmayla öldürülemez
 *
 * …ama dördünü de `commandListener.ts` KAYNAK METNİNE regex uygulayarak
 * "kanıtlıyordu". Bu iki yönden yanıltıcıdır:
 *   · YANLIŞ YEŞİL — metin duruyorken davranış bozulabilir (çağrı ölü dalda
 *     kalabilir, timer kurulmayabilir, sahiplik bayrağı okunmayabilir).
 *   · YANLIŞ KIRMIZI — zararsız bir yeniden düzenleme regex'i düşürür.
 *
 * Bu dosya aynı dört değişmezi GERÇEK `CommandListener` üzerinde çalıştırarak
 * kanıtlar: RPC çağrıldı mı, tabloya gidildi mi, ağ isteği çıktı mı, dinleyici
 * hayatta mı. Kaynak metni okunmaz.
 *
 * Kapsam notu: N-7 (TTL/saat) ve F-03 (hareket) zaten davranışsal olarak
 * `commandListenerValidityMotion.test.ts` içinde kilitli — burada TEKRAR
 * EDİLMEZ (aynı değişmez için ikinci kopya üretmek F-10'un çözdüğü sorunun
 * başka bir biçimidir).
 * ══════════════════════════════════════════════════════════════════════════
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';

const M = vi.hoisted(() => ({
  /** `callVehicleRpc(fn, args)` çağrılarının tamamı. */
  rpcCalls:    [] as Array<{ fn: string; args: unknown }>,
  /** RPC'nin döneceği değer (test başına ayarlanır). */
  rpcResult:   null as unknown,
  /** `updateRemoteCommandStatus` ile yazılan durumlar. */
  statuses:    [] as Array<{ id: string; status: string; reason?: string }>,
  /** MCU'ya giden fiziksel komutlar. */
  mcuCalls:    [] as string[],
  /** Supabase istemcisinden `.from(<tablo>)` istekleri. */
  fromTables:  [] as string[],
  /** Kurulan realtime kanalı sayısı (yeniden kurulum tespiti). */
  channelsCreated: 0,
}));

vi.mock('../platform/vehicleIdentityService', () => ({
  callVehicleRpc: vi.fn(async (fn: string, args: unknown) => {
    M.rpcCalls.push({ fn, args });
    return fn === 'fetch_pending_vehicle_commands' ? M.rpcResult : [];
  }),
  updateRemoteCommandStatus: vi.fn(async (id: string, status: string, reason?: string) => {
    M.statuses.push({ id, status, reason });
  }),
}));

vi.mock('../platform/commandCrypto', () => ({
  loadOrCreateDeviceKey: vi.fn(async () => ({ pubKeyB64: 'TEST' })),
  getCarPrivateKey:      vi.fn(() => ({} as CryptoKey)),
  /* Gerçek yüklem gibi: zarf şekli `ecdh_v1` ise E2E'dir. Böylece hem şifreli
     hem düz metin komut aynı testte gerçek dalları dolaşır. */
  isE2EPayload: vi.fn((p: unknown) =>
    !!p && typeof p === 'object' && (p as { type?: string }).type === 'ecdh_v1'),
  isEncryptedPayload: vi.fn(() => false),
  decryptE2EPayload:  vi.fn(async () => ({})),
  decryptPayload:     vi.fn(async () => ({})),
}));

vi.mock('../platform/nativeCommandBridge', () => ({
  executeMcuCommand: vi.fn(async (type: string) => { M.mcuCalls.push(type); return 'completed'; }),
  checkCrossChannelNonceReplay: vi.fn(async () => undefined),
}));

/** Hareket: doğrulanmış DURUYOR — kapı bu dosyanın konusu değil (F-03'te kilitli). */
vi.mock('../platform/assistant/maviVehicleSnapshotSource', () => ({
  captureMaviVehicleSnapshot: vi.fn(() => ({
    obdSpeedFreshKmh: 0, obdConnected: true, obdLastSeenMs: Date.now(), obdFreshWindowMs: 5_000,
    gpsSpeedMps: null, gpsAccuracyM: null, gpsFixAtMs: null,
    reverseSignal: false, ignition: 'on',
  })),
}));

vi.mock('../platform/serverClock', () => ({ getServerNowMs: vi.fn(() => Date.now()) }));

/**
 * Supabase istemcisi — `.from()` HER çağrısı kaydedilir. Kanonik yolda bu
 * dizinin `vehicle_commands` İÇERMEMESİ gerekir (anon rolün tabloda ayrıcalığı
 * yoktur; tabloya gidiş sessiz 0-satır demektir).
 */
vi.mock('../platform/supabaseClient', () => ({
  getSupabaseClient: () => ({
    from: (table: string) => {
      M.fromTables.push(table);
      const q: Record<string, unknown> = {};
      for (const k of ['select', 'eq', 'gte', 'order', 'limit', 'update', 'insert', 'upsert']) {
        q[k] = () => q;
      }
      q.then = (res: (v: { data: unknown[] }) => void) => res({ data: [] });
      return q;
    },
    channel: (topic: string) => {
      M.channelsCreated += 1;
      const ch: Record<string, unknown> = { topic: `realtime:${topic}` };
      ch.on = () => ch;
      ch.subscribe = () => ch;
      return ch;
    },
    getChannels:   () => [],
    removeChannel: async () => 'ok',
  }),
}));

function cmd(over: Record<string, unknown> = {}): Record<string, unknown> {
  const now = Date.now();
  return {
    id: 'cmd-1', vehicle_id: 'veh-1', type: 'lock', status: 'pending', nonce: 'n1',
    ttl: new Date(now + 5 * 60_000).toISOString(),
    created_at: new Date(now - 2_000).toISOString(),
    payload: { type: 'ecdh_v1', eph_pub: 'a', iv: 'b', data: 'c', ts: now - 2_000 },
    ...over,
  };
}

/** `commandListener.PENDING_POLL_MS` ile aynı — yoklama turu ölçümü için. */
const PENDING_POLL_MS = 15_000;

/** Ağ katmanı: kanonik yolda uzak komut için HİÇBİR doğrudan istek çıkmamalı. */
const fetchSpy = vi.fn(async () => new Response('[]', { status: 200 }));

function restCallsToCommands(): string[] {
  return fetchSpy.mock.calls
    .map(([url]) => String(url))
    .filter((u) => u.includes('vehicle_commands'));
}

describe('F-10/#647 · uzak komut otoritesi — DAVRANIŞ', () => {
  /* commandListener grafı ilk transform'da uzun sürer; bir kez ısıt. */
  beforeAll(async () => { await import('../platform/commandListener'); }, 180_000);

  beforeEach(() => {
    M.rpcCalls = []; M.statuses = []; M.mcuCalls = [];
    M.fromTables = []; M.channelsCreated = 0; M.rpcResult = [];
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
  });

  afterEach(async () => {
    const mod = await import('../platform/commandListener');
    mod.stopCommandListener(true);
    vi.unstubAllGlobals();
  });

  // ── ① Okuma yolu: RPC, tablo DEĞİL ──────────────────────────────────────

  it('① bekleyen komutlar `fetch_pending_vehicle_commands` RPC\'siyle OKUNUR', async () => {
    const mod = await import('../platform/commandListener');
    const l = new mod.CommandListener('veh-1') as unknown as
      { _alive: boolean; triggerPendingPoll: () => Promise<void> };
    l._alive = true;

    await l.triggerPendingPoll();

    const fetchRpc = M.rpcCalls.filter((c) => c.fn === 'fetch_pending_vehicle_commands');
    expect(fetchRpc.length, 'bekleyen komut RPC\'si HİÇ çağrılmadı — araç komutunu asla görmez')
      .toBeGreaterThan(0);
  });

  it('① okuma yolu `vehicle_commands` TABLOSUNA gitmez (anon ayrıcalığı yok → sessiz 0 satır)', async () => {
    const mod = await import('../platform/commandListener');
    const l = new mod.CommandListener('veh-1') as unknown as
      { _alive: boolean; triggerPendingPoll: () => Promise<void> };
    l._alive = true;

    await l.triggerPendingPoll();

    expect(M.fromTables, 'komut tablosu DOĞRUDAN sorgulandı — RLS sessizce boş döndürür')
      .not.toContain('vehicle_commands');
    expect(restCallsToCommands(), 'komut tablosuna doğrudan REST isteği çıktı').toEqual([]);
  });

  // ── ② Bilinmeyen ≠ sıfır ────────────────────────────────────────────────

  it('② cihaz anahtarı yoksa "0 bekleyen komut" GERÇEK olarak raporlanmaz', async () => {
    const mod = await import('../platform/commandListener');
    mod._resetCommandEvidenceForTest();
    M.rpcResult = null;  // callVehicleRpc: anahtar/yapılandırma yok

    const l = new mod.CommandListener('veh-1') as unknown as
      { _alive: boolean; triggerPendingPoll: () => Promise<void> };
    l._alive = true;
    await l.triggerPendingPoll();

    const ev = mod.getCommandEvidence();
    expect(ev.lastPollOutcome, 'anahtarsız yoklama "boş" sayıldı — bilinmeyen, sıfır gibi sunuluyor')
      .toBe('no_key');
    expect(ev.lastPollRows, 'satır sayısı 0 olarak UYDURULDU — UNKNOWN null kalmalı').toBeNull();
  });

  it('② gerçekten boş yanıt, bilinmeyenden AYRI raporlanır (ölçülmüş 0)', async () => {
    const mod = await import('../platform/commandListener');
    mod._resetCommandEvidenceForTest();
    M.rpcResult = [];

    const l = new mod.CommandListener('veh-1') as unknown as
      { _alive: boolean; triggerPendingPoll: () => Promise<void> };
    l._alive = true;
    await l.triggerPendingPoll();

    const ev = mod.getCommandEvidence();
    expect(ev.lastPollOutcome).toBe('empty');
    expect(ev.lastPollRows, 'ölçülmüş boşluk 0 satırdır — bu bilgi kaybolmamalı').toBe(0);
  });

  // ── ③ Durum yazma: tek kapı RPC ─────────────────────────────────────────

  it('③ komut durumu YALNIZ api_key RPC kapısından yazılır (REST PATCH yok)', async () => {
    const mod = await import('../platform/commandListener');
    M.rpcResult = [cmd()];

    const l = new mod.CommandListener('veh-1') as unknown as
      { _alive: boolean; triggerPendingPoll: () => Promise<void> };
    l._alive = true;
    await l.triggerPendingPoll();

    /* Komut gerçekten işlendi mi? (aksi hâlde "PATCH yok" iddiası boş küme
       üzerinde yeşil olurdu — sahte güven). */
    expect(M.statuses.length, 'komut hiç işlenmedi — testin negatif iddiası anlamsız olurdu')
      .toBeGreaterThan(0);
    expect(M.mcuCalls, 'fiziksel komut DB akışından gelmedi').toContain('lock');

    expect(restCallsToCommands(), 'durum REST PATCH ile yazıldı — anon ayrıcalığı yok, istek RLS\'e bile varmaz')
      .toEqual([]);
    expect(M.fromTables, 'durum tablo üzerinden güncellendi').not.toContain('vehicle_commands');
  });

  it('③ düz metin gelen KRİTİK komut fail-closed reddedilir (MCU\'ya gitmez)', async () => {
    /* Bu dal testi yazarken ÖLÇÜLDÜ: `lock` E2E zarfı olmadan geldiğinde
       dinleyici komutu reddediyor ve fiziksel yola HİÇ girmiyor. Kaynak
       regex'i bunu göstermezdi; davranış gösteriyor. */
    const mod = await import('../platform/commandListener');
    M.rpcResult = [cmd({ payload: { type: 'lock' } })];   // şifresiz

    const l = new mod.CommandListener('veh-1') as unknown as
      { _alive: boolean; triggerPendingPoll: () => Promise<void> };
    l._alive = true;
    await l.triggerPendingPoll();

    expect(M.mcuCalls, 'şifresiz kritik komut fiziksel olarak İCRA EDİLDİ').toEqual([]);
    expect(M.statuses.length, 'red sessizce yutuldu — telefona gerekçe yazılmadı')
      .toBeGreaterThan(0);
    expect(M.statuses.some((s) => s.status === 'completed'),
      'icra edilmeyen komut "completed" raporlandı').toBe(false);
  });

  // ── ③b Yoklama ASIL taşıyıcı ────────────────────────────────────────────

  it('③b periyodik yoklama GERÇEKTEN kurulur ve tur tur komut çeker', async () => {
    /* "Realtime tek taşıyıcı değildir" iddiası artık metinle değil, zamanı
       ileri sararak kanıtlanır: timer kurulmamış olsaydı ikinci tur HİÇ
       gelmezdi. Anon istemcide realtime RLS yüzünden olay üretmediği için
       yoklama "yedek" değil ASIL yoldur. */
    vi.useFakeTimers();
    try {
      const mod = await import('../platform/commandListener');
      M.rpcResult = [];

      mod.startCommandListener('veh-1', { permanent: true });
      await vi.advanceTimersByTimeAsync(0);
      const afterConnect = M.rpcCalls.filter((c) => c.fn === 'fetch_pending_vehicle_commands').length;

      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS + 100);
      const afterOneTick = M.rpcCalls.filter((c) => c.fn === 'fetch_pending_vehicle_commands').length;

      expect(afterOneTick,
        'yoklama turu gelmedi — timer kurulmamış, komut yalnız realtime\'a bağlı kalır (anon\'da hiç ulaşmaz)')
        .toBeGreaterThan(afterConnect);

      /* Sökülüş timer'ı GERÇEKTEN temizler (zero-leak): sonraki turda artış yok. */
      mod.stopCommandListener(true);
      const atStop = M.rpcCalls.filter((c) => c.fn === 'fetch_pending_vehicle_commands').length;
      await vi.advanceTimersByTimeAsync(PENDING_POLL_MS * 2);
      expect(M.rpcCalls.filter((c) => c.fn === 'fetch_pending_vehicle_commands').length,
        'kapatılan dinleyici hâlâ yokluyor — timer sızdı').toBe(atStop);
    } finally {
      vi.useRealTimers();
    }
  });

  // ── ④ Kalıcı sahiplik ───────────────────────────────────────────────────

  it('④ kalıcı dinleyici BOŞTA-KAPATMA ile ölmez, yalnız `force` ile kapanır', async () => {
    const mod = await import('../platform/commandListener');

    mod.startCommandListener('veh-1', { permanent: true });
    expect(mod.isCommandListenerActive(), 'kalıcı dinleyici açılmadı').toBe(true);

    mod.stopCommandListener();          // fcmService boşta sayacı
    expect(mod.isCommandListenerActive(),
      'boşta-kapatma kalıcı dinleyiciyi öldürdü — araç sessizce sağır kalır').toBe(true);

    mod.stopCommandListener(true);      // gerçek sökülüş
    expect(mod.isCommandListenerActive(), '`force` kapatma çalışmadı').toBe(false);
  });

  it('④ kalıcı dinleyici canlıyken geçici uyandırma onu YENİDEN KURMAZ', async () => {
    const mod = await import('../platform/commandListener');

    mod.startCommandListener('veh-1', { permanent: true });
    await Promise.resolve(); await Promise.resolve();
    const afterPermanent = M.channelsCreated;

    mod.startCommandListener('veh-1');  // push-to-wake geçici çağrısı
    await Promise.resolve(); await Promise.resolve();

    expect(M.channelsCreated,
      'geçici uyandırma bağlantıyı yeniden kurdu — dedup kümesi sıfırlanır, komut İKİ KEZ işlenebilir')
      .toBe(afterPermanent);
    expect(mod.isCommandListenerActive()).toBe(true);
  });
});
