/**
 * obdCoreV2.patch8.service.test.ts — Patch 8C (extendedPidService)
 *
 * Kilitler:
 *  - parseSupportedBitmask: SAE 0100 örnek vektörü + aralık tabanı kaydırması.
 *  - Talep-güdümlü sözleşme: izleyici yokken native liste BOŞ (sıfır maliyet);
 *    ilk izleyici keşfi başlatır; son izleyici ayrılınca liste boşalır.
 *  - Keşif zinciri: 00 yanıtında 20 destekliyse kuyruk 20'ye ilerler.
 *  - Destek filtresi: keşif tamamlandıysa desteklenmeyen izlenen PID native'e gitmez.
 *  - Core PID'ler EXTENDED listeye asla girmez.
 *  - Değer akışı: ham hex → decode → watcher; bozuk veri watcher'a ulaşmaz.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const M = vi.hoisted(() => ({
  pushedLists: [] as string[][],
  isNative: true,
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => M.isNative) },
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    setObdExtendedPids: vi.fn(async (opts: { pids: string[] }) => { M.pushedLists.push(opts.pids); }),
    addListener: vi.fn(async () => ({ remove: vi.fn() })),
  },
}));

vi.mock('../platform/crashLogger', () => ({ logError: vi.fn() }));

import {
  watchPid,
  getPidValue,
  isPidSupported,
  notifyObdConnected,
  parseSupportedBitmask,
  _internals,
} from '../platform/obd/extendedPidService';

beforeEach(() => {
  _internals.reset();
  M.pushedLists.length = 0;
  M.isNative = true;
});

describe('Patch 8C — parseSupportedBitmask', () => {
  it('klasik SAE örneği: BE 1F B8 13 (base 00)', () => {
    // 0xBE = 1011 1110 → PID 01,03,04,05,06,07 (bit7→01 … bit1→07, bit0 yok)
    const s = parseSupportedBitmask('00', 'BE1FB813');
    expect(s.has('01')).toBe(true);
    expect(s.has('02')).toBe(false);
    expect(s.has('03')).toBe(true);
    expect(s.has('0C')).toBe(true); // 0x1F baytı: PID 0C-10
    expect(s.has('0D')).toBe(true);
    expect(s.has('20')).toBe(true); // 0x13 bit0 → PID 32 (0x20) → sonraki aralık var
  });

  it('aralık tabanı kayar: base 20 + bit7/bayt0 → PID 21', () => {
    const s = parseSupportedBitmask('20', '80000001');
    expect(s.has('21')).toBe(true);
    expect(s.has('40')).toBe(true); // bit0/bayt3 → base+32 = 0x40
    expect(s.size).toBe(2);
  });

  it('eksik/bozuk veri → boş set', () => {
    expect(parseSupportedBitmask('00', 'BE1F').size).toBe(0);
    expect(parseSupportedBitmask('ZZ', 'BE1FB813').size).toBe(0);
  });
});

describe('Patch 8C — talep-güdümlü sözleşme (Mali-400 kuralı)', () => {
  it('ilk izleyici keşif kuyruğunu (00) + izlenen PID\'i native\'e iter', () => {
    watchPid('5C', () => {});
    expect(M.pushedLists.length).toBe(1);
    expect(M.pushedLists[0]).toEqual(['00', '5C']);
  });

  it('son izleyici ayrılınca native liste boşalır (keşif kuyruğu hariç)', () => {
    const un = watchPid('5C', () => {});
    un();
    const last = M.pushedLists[M.pushedLists.length - 1]!;
    expect(last).toEqual(['00']); // izlenen kalmadı; bekleyen keşif tamamlanınca o da düşer
  });

  it('core PID izlense bile native EXTENDED listesine GİRMEZ', () => {
    watchPid('0C', () => {}); // RPM — ana yoldan zaten akıyor
    expect(M.pushedLists[M.pushedLists.length - 1]).toEqual(['00']);
  });

  it('tanımsız PID native listeye girmez', () => {
    watchPid('99', () => {}); // registry'de yok (0x99 tanımsız)
    expect(M.pushedLists[M.pushedLists.length - 1]).toEqual(['00']);
  });

  it('web (non-native) ortamda native çağrı yapılmaz', () => {
    M.isNative = false;
    watchPid('5C', () => {});
    expect(M.pushedLists.length).toBe(0);
  });
});

describe('Patch 8C — keşif zinciri + destek filtresi', () => {
  it('00 yanıtı 20\'yi destekliyorsa kuyruk 20\'ye ilerler', () => {
    watchPid('5C', () => {});
    _internals.onExtendedData({ pid: '00', data: 'BE1FB813' }); // bit0 set → 0x20 var
    expect(_internals.getDiscoveryQueue()).toEqual(['20']);
    // 20 yanıtı 40'ı desteklemiyorsa zincir biter
    _internals.onExtendedData({ pid: '20', data: '80000000' });
    expect(_internals.getDiscoveryQueue()).toEqual([]);
  });

  it('keşif sonrası desteklenmeyen izlenen PID native listeden düşer', () => {
    watchPid('5C', () => {}); // yağ sıcaklığı (0x5C) — bu araç desteklemiyor olacak
    _internals.onExtendedData({ pid: '00', data: 'BE1FB800' }); // 0x20 yok → keşif bitti
    expect(isPidSupported('5C')).toBe(false);
    const last = M.pushedLists[M.pushedLists.length - 1]!;
    expect(last).toEqual([]); // keşif bitti + 5C desteklenmiyor → tam boş = sıfır maliyet
  });

  it('desteklenen izlenen PID keşif sonrası listede kalır', () => {
    watchPid('04', () => {}); // motor yükü — 0xBE bit... 04 destekli (BE1FB813)
    _internals.onExtendedData({ pid: '00', data: 'BE1FB800' });
    expect(isPidSupported('04')).toBe(true);
    expect(M.pushedLists[M.pushedLists.length - 1]).toEqual(['04']);
  });
});

describe('Patch 8C — değer akışı', () => {
  it('ham hex çözülüp watcher\'a ulaşır, önbelleğe yazılır', () => {
    const seen: number[] = [];
    watchPid('5C', (v) => seen.push(v.value));
    _internals.onExtendedData({ pid: '5C', data: '8C' }); // 0x8C-40 = 100°C
    expect(seen).toEqual([100]);
    expect(getPidValue('5c')?.value).toBe(100);
    expect(getPidValue('5C')?.def.unit).toBe('°C');
  });

  it('bozuk/sınır dışı veri watcher\'a ULAŞMAZ (fail-soft)', () => {
    const seen: number[] = [];
    watchPid('0E', (v) => seen.push(v.value)); // avans, 1 bayt
    _internals.onExtendedData({ pid: '0E', data: '' });   // eksik
    _internals.onExtendedData({ pid: '0E', data: 'ZZ' }); // bozuk hex
    expect(seen).toEqual([]);
  });

  it('geç abone önbellekteki son değeri anında alır', () => {
    watchPid('46', () => {});
    _internals.onExtendedData({ pid: '46', data: '54' }); // 0x54-40 = 44°C
    const seen: number[] = [];
    watchPid('46', (v) => seen.push(v.value));
    expect(seen).toEqual([44]);
  });
});

describe('Patch 8C — bağlantı kancası', () => {
  it('izleyici yokken notifyObdConnected NO-OP', () => {
    notifyObdConnected();
    expect(M.pushedLists.length).toBe(0);
  });

  it('izleyici varken keşif yeniden başlar (farklı araç senaryosu)', () => {
    watchPid('04', () => {});
    _internals.onExtendedData({ pid: '00', data: 'BE1FB800' }); // keşif bitti
    expect(isPidSupported('04')).toBe(true);
    notifyObdConnected();
    expect(isPidSupported('04')).toBe(null); // yeniden doğrulanacak
    expect(_internals.getDiscoveryQueue()).toEqual(['00']);
  });
});
