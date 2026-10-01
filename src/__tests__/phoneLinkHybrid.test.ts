/**
 * phoneLinkHybrid.test.ts — Phone Link hibrit (Wi-Fi + Bluetooth) · tek uygulama iki rol.
 *
 * Kilitlenenler:
 *  · Bluetooth'u Android'e kapalı ünitede (K24/NWD) Wi-Fi yolu BEKLETİLMEDEN başlar
 *  · açılış yolu izin diyaloğu AÇMAZ (askPermission:false)
 *  · eski (yalnız RFCOMM) native için kurallar AYNEN
 *  · "Bluetooth kapalı, açın" yanlış yönlendirmesi yapılmaz; "bağlı" yalnız gerçek oturumda
 *  · rol: kullanıcı seçimi > head unit tespiti > ekran kısa kenarı
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PhoneHubLinkSnapshotRaw } from '../platform/phoneHub/phoneHubLink';

const h = vi.hoisted(() => ({
  raw: { present: false } as PhoneHubLinkSnapshotRaw,
  startCalls: [] as Array<{ askPermission?: boolean }>,
}));

vi.mock('../platform/phoneHub/phoneHubLink', async () => {
  const actual = await vi.importActual<typeof import('../platform/phoneHub/phoneHubLink')>('../platform/phoneHub/phoneHubLink');
  return {
    ...actual,
    refreshPhoneHubLink: vi.fn(async () => h.raw),
    getPhoneHubLink: vi.fn(() => h.raw),
    startPhoneHubServer: vi.fn(async (o: { askPermission?: boolean } = {}) => {
      h.startCalls.push(o);
      return { ok: true, errorCode: null, userMessage: null };
    }),
  };
});

import {
  evaluateTransportReadiness, evaluatePhoneLinkTransportReadiness, _resetPhoneLinkProductBootForTest,
} from '../platform/phoneLink/phoneLinkProductBoot';
import { resolvePhoneLinkRole, suggestPhoneLinkRole } from '../platform/phoneLink/phoneLinkDeviceRole';
import { describeCarView, describePhoneView } from '../platform/phoneLink/phoneLinkPanelModel';
import { CLIENT_ABSENT, parseClientSnapshot } from '../platform/phoneHub/phoneHubClient';
import { describePhoneConnection } from '../components/phone/PhoneConnectionTab';

/** K24/NWD: sistem ayarı "açık" ama Android BT yığını hiç açılmıyor. */
const K24_BT = {
  running: false, state: 'ERROR', blockerCode: 'BLUETOOTH_DISABLED',
  systemSettingOn: true, stackUnavailableSuspected: true,
};

function snap(over: Partial<PhoneHubLinkSnapshotRaw> = {}): PhoneHubLinkSnapshotRaw {
  return {
    present: true,
    server: { running: false, state: 'ERROR' },
    preconditions: { ready: false, blockerCode: 'BLUETOOTH_DISABLED', connectPermission: true },
    ...over,
  };
}

beforeEach(() => {
  h.startCalls = [];
  _resetPhoneLinkProductBootForTest();
});

describe('hibrit hazırlık kararı', () => {
  it('H1. 🔒 Bluetooth açılamıyor → Wi-Fi yolu BEKLETİLMEDEN başlatılır', () => {
    const d = evaluateTransportReadiness(snap({ transports: { bluetooth: K24_BT, wifi: { running: false } } }));
    expect(d).toEqual({ shouldStartServer: true, state: 'READY', reason: 'wifi_only' });
  });

  it('H2. Wi-Fi dinliyor + Bluetooth engelli → yeniden başlatma YOK (idempotent)', () => {
    const d = evaluateTransportReadiness(snap({ transports: { bluetooth: K24_BT, wifi: { running: true } } }));
    expect(d).toEqual({ shouldStartServer: false, state: 'READY', reason: 'wifi_only' });
    const both = evaluateTransportReadiness(snap({
      transports: { bluetooth: { running: true, blockerCode: null }, wifi: { running: true } },
    }));
    expect(both).toEqual({ shouldStartServer: false, state: 'READY', reason: 'server_already_listening' });
  });

  it('H3. 🔒 eski native (transports yok) + Bluetooth kapalı → kurallar AYNEN: bekle', () => {
    const d = evaluateTransportReadiness(snap());
    expect(d.shouldStartServer).toBe(false);
    expect(d.state).toBe('WAITING_FOR_USER_CONNECTIVITY');
  });

  it('H4. 🔒 açılış yolu izin diyaloğu AÇMAZ (askPermission:false)', async () => {
    h.raw = snap({ transports: { bluetooth: K24_BT, wifi: { running: false } } });
    const d = await evaluatePhoneLinkTransportReadiness();
    expect(h.startCalls).toEqual([{ askPermission: false }]);
    expect(d.reason).toBe('wifi_only');
  });
});

describe('rol: tek uygulama, iki rol', () => {
  it('R1. kullanıcı seçimi kazanır; head unit tespiti → araç; kısa kenar < 600dp → telefon', () => {
    expect(resolvePhoneLinkRole('phone', 1200, true)).toBe('phone');
    expect(resolvePhoneLinkRole('car', 390, false)).toBe('car');
    expect(suggestPhoneLinkRole(390, true)).toBe('car');      // üretici paketleri → araç
    expect(suggestPhoneLinkRole(390, false)).toBe('phone');
    expect(suggestPhoneLinkRole(768, false)).toBe('car');     // dikey 768×1024 head unit
    expect(suggestPhoneLinkRole(null, false)).toBe('car');    // bilinmiyor → asıl yer araç
    expect(resolvePhoneLinkRole('auto', 412, false)).toBe('phone');
  });
});

describe('araç ekranı metinleri', () => {
  it('C1. 🔒 K24: "Bluetooth\'u açın" DENMEZ; Wi-Fi yolunun kullanılacağı söylenir', () => {
    const v = describeCarView(snap({
      transports: { bluetooth: K24_BT, wifi: { running: true, localAddresses: ['192.168.43.5'] } },
    }))!;
    expect(v.bluetooth.text).toContain('Wi-Fi kullanılır');
    expect(v.bluetooth.text.toLowerCase()).not.toContain('açın');
    expect(v.wifi).toMatchObject({ text: 'Hazır · 192.168.43.5', tone: 'ok' });
    expect(v.listening).toBe(true);
  });

  it('C2. Wi-Fi dinliyor ama ağ yok → hotspot yönlendirmesi', () => {
    const v = describeCarView(snap({ transports: { bluetooth: K24_BT, wifi: { running: true, localAddresses: [] } } }))!;
    expect(v.wifi.tone).toBe('warn');
    expect(v.wifi.text).toContain('hotspot');
  });

  it('C3. 🔒 "bağlı" yalnız gerçekten kurulmuş oturumda; taşıma söylenir', () => {
    const base = { transports: { bluetooth: K24_BT, wifi: { running: true }, active: 'WIFI' as const } };
    expect(describeCarView(snap({ ...base, session: { trulyEstablished: false } }))!.connection.text).toBe('Bağlanıyor…');
    expect(describeCarView(snap({ ...base, session: { trulyEstablished: true } }))!.connection.text).toBe('Bağlı (Wi-Fi)');
    expect(describeCarView(snap({ ...base, session: null, pairing: { awaitingConfirmation: true } }))!.awaitingConfirmation).toBe(true);
    expect(describeCarView({ present: false })).toBeNull();
  });
});

describe('Telefon Merkezi — üretici Bluetooth\'u', () => {
  it('T1. 🔒 ayar açık + Android yığını kapalı → "Bluetooth\'u açın" DENMEZ', () => {
    const oem = describePhoneConnection({ state: 'OFF', systemSettingOn: true });
    expect(oem.title).toContain('ünitenin kendi Bluetooth');
    expect(oem.detail).toContain('Wi-Fi');
    expect(`${oem.title} ${oem.detail}`).not.toMatch(/Bluetooth'u açın/);
    /* Gerçekten kapalıysa (ya da bilinmiyorsa) eski doğru öneri aynen. */
    expect(describePhoneConnection({ state: 'OFF', systemSettingOn: false }).title).toBe('Bluetooth kapalı');
    expect(describePhoneConnection({ state: 'OFF' }).title).toBe('Bluetooth kapalı');
  });
});

describe('telefon ekranı', () => {
  const client = (over: Record<string, unknown>) => parseClientSnapshot({
    role: 'PHONE', phase: 'IDLE', paths: { wifi: 'IDLE', bluetooth: 'IDLE' }, session: null,
    trust: { hasTrustedPeer: false }, pairing: { awaitingConfirmation: false }, ...over,
  });

  it('P1. 🔒 okunamayan/yabancı anlık görüntü → yok sayılır (bağlı DENMEZ)', () => {
    expect(parseClientSnapshot(null)).toBe(CLIENT_ABSENT);
    expect(parseClientSnapshot({ error: 'SNAPSHOT_BUILD_FAILED' })).toBe(CLIENT_ABSENT);
    expect(parseClientSnapshot({ role: 'HEAD_UNIT', phase: 'CONNECTED' })).toBe(CLIENT_ABSENT);
    expect(client({ phase: 'CONNECTED', session: { trulyEstablished: false } }).connected).toBe(false);
    expect(client({ phase: 'UYDURMA' }).phase).toBeNull();
  });

  it('P2. Wi-Fi ile bağlı → başlık taşımayı söyler; eylem "kes"', () => {
    const v = describePhoneView(client({
      phase: 'CONNECTED', activeTransport: 'WIFI', session: { trulyEstablished: true },
      paths: { wifi: 'CONNECTED', bluetooth: 'CANCELLED' },
    }))!;
    expect(v.headline).toBe('Araca bağlı (Wi-Fi)');
    expect(v.action).toBe('disconnect');
    expect(v.bluetooth.text).toBe('Diğer yol kullanıldı');
  });

  it('P3. bulunamadı → ne yapılacağı söylenir; eylem "bağlan"', () => {
    const v = describePhoneView(client({ phase: 'NOT_FOUND', paths: { wifi: 'NOT_FOUND', bluetooth: 'DISABLED' } }))!;
    expect(v.headline).toBe('Araç bulunamadı');
    expect(v.hint).toContain('hotspot');
    expect(v.action).toBe('connect');
  });

  it('P4. kod onayı bekleniyor → iki ekranı karşılaştır', () => {
    const v = describePhoneView(client({ phase: 'AWAITING_CONFIRM', pairing: { awaitingConfirmation: true } }))!;
    expect(v.awaitingConfirmation).toBe(true);
    expect(v.headline).toContain('kodu karşılaştırın');
  });
});
