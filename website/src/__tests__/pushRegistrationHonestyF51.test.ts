/**
 * F5.1 — Push kaydı DÜRÜSTLÜĞÜ.
 *
 * Bu dosya MUTASYON tarzı negatif testler içerir: her test, düzeltilen
 * kusurun geri gelmesi hâlinde DÜŞER.
 *
 * ── Kapatılan kusurlar ───────────────────────────────────────────────────
 * 1. `saveToDB` tüm hataları yutuyor, `subscribe()` yine "subscribed"
 *    diyordu → rozet "Bildirimler Aktif" derken hiçbir bildirim gelmiyordu.
 * 2. Tarayıcı izni TEK BAŞINA aktiflik sayılıyordu (backend kanıtı yok).
 * 3. Oturumsuz `user_id: null` yazılıyordu (RLS zaten reddeder — sessiz düşüş).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* ── Supabase istemci sahtesi ─────────────────────────────────────────── */

type QueryResult = { data: unknown; error: unknown };

const mockState = {
  userId:        null as string | null,
  upsertResult:  { data: { id: 'sub-1' }, error: null } as QueryResult,
  selectResult:  { data: { id: 'sub-1' }, error: null } as QueryResult,
  lastUpsertRow: null as Record<string, unknown> | null,
};

const supabaseBrowserMock = {
  auth: {
    getUser: async () => ({
      data: { user: mockState.userId ? { id: mockState.userId } : null },
    }),
  },
  from: () => ({
    upsert: (row: Record<string, unknown>) => {
      mockState.lastUpsertRow = row;
      return { select: () => ({ maybeSingle: async () => mockState.upsertResult }) };
    },
    select: () => ({
      eq: () => ({ maybeSingle: async () => mockState.selectResult }),
    }),
    delete: () => ({ eq: async () => ({ error: null }) }),
  }),
};

vi.mock('@/lib/supabase', () => ({ supabaseBrowser: supabaseBrowserMock }));

/* ── Tarayıcı yüzeyi sahtesi ──────────────────────────────────────────── */

const FAKE_ENDPOINT = 'https://push.example.test/ep/abc123';

function installBrowser(opts: {
  permission: NotificationPermission;
  existingSub: boolean;
  subscribeThrows?: boolean;
}) {
  const sub = {
    endpoint: FAKE_ENDPOINT,
    toJSON: () => ({ endpoint: FAKE_ENDPOINT, keys: { p256dh: 'k', auth: 'a' } }),
    unsubscribe: async () => true,
  };

  const registration = {
    pushManager: {
      getSubscription: async () => (opts.existingSub ? sub : null),
      subscribe: async () => {
        if (opts.subscribeThrows) throw new Error('subscribe failed');
        return sub;
      },
    },
  };

  vi.stubGlobal('Notification', {
    permission: opts.permission,
    requestPermission: async () => opts.permission,
  });
  vi.stubGlobal('PushManager', function PushManagerStub() { /* varlık göstergesi */ });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: async () => registration,
      register:        async () => registration,
    },
  });
}

async function loadEngine() {
  vi.resetModules();
  return import('@/lib/pushEngine');
}

beforeEach(() => {
  mockState.userId        = 'user-a';
  mockState.upsertResult  = { data: { id: 'sub-1' }, error: null };
  mockState.selectResult  = { data: { id: 'sub-1' }, error: null };
  mockState.lastUpsertRow = null;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = 'dGVzdC12YXBpZC1rZXk';
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
});

/* ── 1. İzin ≠ ACTIVE ─────────────────────────────────────────────────── */

describe('F5.1 · tarayıcı izni TEK BAŞINA ACTIVE değildir', () => {
  it('1. 🔒 izin granted + tarayıcı aboneliği var AMA backend kaydı YOK → FAILED', async () => {
    installBrowser({ permission: 'granted', existingSub: true });
    mockState.selectResult = { data: null, error: null };   // backend'de kayıt yok

    const { initPushEngine } = await loadEngine();
    const res = await initPushEngine();

    expect(res.state).toBe('FAILED');
    expect(res.reason).toBe('BACKEND_PERSIST_FAILED');
    expect(res.state).not.toBe('ACTIVE');
  });

  it('2. 🔒 izin granted + backend kaydı VAR → ACTIVE', async () => {
    installBrowser({ permission: 'granted', existingSub: true });

    const { initPushEngine } = await loadEngine();
    expect((await initPushEngine()).state).toBe('ACTIVE');
  });

  it('3. 🔒 izin default → PERMISSION_REQUIRED (ACTIVE değil)', async () => {
    installBrowser({ permission: 'default', existingSub: false });

    const { initPushEngine } = await loadEngine();
    expect((await initPushEngine()).state).toBe('PERMISSION_REQUIRED');
  });

  it('4. 🔒 izin denied → DENIED', async () => {
    installBrowser({ permission: 'denied', existingSub: false });

    const { initPushEngine } = await loadEngine();
    expect((await initPushEngine()).state).toBe('DENIED');
  });
});

/* ── 2. Kayıt başarısızlığı ≠ ACTIVE ──────────────────────────────────── */

describe('F5.1 · backend kaydı düşerse ACTIVE İDDİA EDİLMEZ', () => {
  it('5. 🔒 upsert HATA döndürür → FAILED (eskiden "subscribed" diyordu)', async () => {
    installBrowser({ permission: 'granted', existingSub: false });
    mockState.upsertResult = { data: null, error: { message: 'relation does not exist' } };

    const { subscribe } = await loadEngine();
    const res = await subscribe();

    expect(res.state).toBe('FAILED');
    expect(res.reason).toBe('BACKEND_PERSIST_FAILED');
  });

  it('6. 🔒 upsert hatasız ama SATIR OLUŞMADI (RLS sessiz filtresi) → FAILED', async () => {
    installBrowser({ permission: 'granted', existingSub: false });
    mockState.upsertResult = { data: null, error: null };

    const { subscribe } = await loadEngine();
    expect((await subscribe()).state).toBe('FAILED');
  });

  it('7. 🔒 dönen sebep endpoint/anahtar SIZDIRMAZ', async () => {
    installBrowser({ permission: 'granted', existingSub: false });
    mockState.upsertResult = { data: null, error: { message: 'x' } };

    const { subscribe } = await loadEngine();
    const res = await subscribe();

    expect(JSON.stringify(res.reason ?? '')).not.toContain(FAKE_ENDPOINT);
    expect(JSON.stringify(res.reason ?? '')).not.toContain('p256dh');
  });

  it('8. 🔒 PushManager.subscribe fırlarsa → FAILED/SUBSCRIBE_FAILED', async () => {
    installBrowser({ permission: 'granted', existingSub: false, subscribeThrows: true });

    const { subscribe } = await loadEngine();
    const res = await subscribe();

    expect(res.state).toBe('FAILED');
    expect(res.reason).toBe('SUBSCRIBE_FAILED');
  });
});

/* ── 3. Sahiplik fail-closed ──────────────────────────────────────────── */

describe('F5.1 · sahiplik bağlanamıyorsa yazılmaz', () => {
  it('9. 🔒 oturum YOK → NOT_AUTHENTICATED ve HİÇBİR satır yazılmaz', async () => {
    installBrowser({ permission: 'granted', existingSub: false });
    mockState.userId = null;

    const { subscribe } = await loadEngine();
    const res = await subscribe();

    expect(res.state).toBe('FAILED');
    expect(res.reason).toBe('NOT_AUTHENTICATED');
    /* MUTASYON KAPISI: eskiden `user_id: null` ile yazma DENENİYORDU. */
    expect(mockState.lastUpsertRow).toBeNull();
  });

  it('10. 🔒 oturum VAR → satır DAİMA o kullanıcıya bağlanır (null user_id yok)', async () => {
    installBrowser({ permission: 'granted', existingSub: false });
    mockState.userId = 'user-b';

    const { subscribe } = await loadEngine();
    await subscribe();

    expect(mockState.lastUpsertRow?.user_id).toBe('user-b');
    expect(mockState.lastUpsertRow?.user_id).not.toBeNull();
  });
});

/* ── 4. Yapılandırma eksikse sahte başarı yok ─────────────────────────── */

describe('F5.1 · VAPID anahtarı yoksa açıkça söylenir', () => {
  it('11. 🔒 VAPID anahtarı YOK → FAILED/NO_VAPID_KEY (sessiz "mod düşüşü" YOK)', async () => {
    installBrowser({ permission: 'granted', existingSub: false });
    delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;

    const { subscribe } = await loadEngine();
    const res = await subscribe();

    expect(res.state).toBe('FAILED');
    expect(res.reason).toBe('NO_VAPID_KEY');
  });

  it('12. 🔒 tarayıcı Push desteklemiyor → UNSUPPORTED', async () => {
    /* Desteklemeyen tarayıcıda bu özellikler `undefined` DEĞİL, HİÇ YOKTUR.
       `stubGlobal(..., undefined)` anahtarı bırakır ve `'Notification' in
       window` yine true döner — gerçeği modellemek için SİLİYORUZ. */
    const savedNotification = Reflect.get(globalThis, 'Notification');
    const savedPushManager  = Reflect.get(globalThis, 'PushManager');
    Reflect.deleteProperty(globalThis, 'Notification');
    Reflect.deleteProperty(globalThis, 'PushManager');

    try {
      const { subscribe } = await loadEngine();
      expect((await subscribe()).state).toBe('UNSUPPORTED');
    } finally {
      if (savedNotification !== undefined) Reflect.set(globalThis, 'Notification', savedNotification);
      if (savedPushManager  !== undefined) Reflect.set(globalThis, 'PushManager',  savedPushManager);
    }
  });
});
