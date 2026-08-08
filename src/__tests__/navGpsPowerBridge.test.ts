/**
 * navGpsPowerBridge — navigasyon ↔ native GPS güç politikası köprüsü kilitleri.
 *
 * SAHA KÖKÜ (2026-08-08, Siverek — ölçüldü):
 *   · `GPS_MIN_DIST_M = 2 m` duran araçta fix teslimini kesiyordu → `fixAgeMs`
 *     25.325 ms ölçüldü (sinyal ±2 m ile SAĞLAMKEN).
 *   · Native park kısması (5 dk hareketsizlik) navigasyondan HABERSİZDİ →
 *     uzun ışıkta 1 Hz GPS kapanıyor, kalkışta ilk ~60 m kör kalıyordu.
 *
 * Bu dosya köprünün SÖZLEŞMESİNİ kilitler: idempotent, fail-soft, web'de no-op,
 * ve navigasyon oturumunun İKİ ucuna da bağlı (başlarken true, biterken false).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const _setNavigationActive = vi.fn(() => Promise.resolve());
let _isNative = true;

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => _isNative },
  registerPlugin: () => ({}),
}));

vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: { setNavigationActive: (o: { active: boolean }) => _setNavigationActive(o) },
}));

const _logError = vi.fn();
vi.mock('../platform/crashLogger', () => ({ logError: (...a: unknown[]) => _logError(...a) }));

import {
  setNavigationGpsPower,
  getNavGpsPowerLastSent,
  _resetNavGpsPowerBridgeForTest,
} from '../platform/navigation/navGpsPowerBridge';

beforeEach(() => {
  _setNavigationActive.mockClear();
  _logError.mockClear();
  _isNative = true;
  _resetNavGpsPowerBridgeForTest();
});

describe('navGpsPowerBridge — sözleşme', () => {
  it('navigasyon başlayınca native servise active=true gider', () => {
    setNavigationGpsPower(true);
    expect(_setNavigationActive).toHaveBeenCalledTimes(1);
    expect(_setNavigationActive).toHaveBeenCalledWith({ active: true });
    expect(getNavGpsPowerLastSent()).toBe(true);
  });

  it('navigasyon bitince active=false gider', () => {
    setNavigationGpsPower(true);
    _setNavigationActive.mockClear();
    setNavigationGpsPower(false);
    expect(_setNavigationActive).toHaveBeenCalledWith({ active: false });
    expect(getNavGpsPowerLastSent()).toBe(false);
  });

  it('İDEMPOTENT: aynı değer tekrar gönderilmez (köprü trafiği yok)', () => {
    setNavigationGpsPower(true);
    setNavigationGpsPower(true);
    setNavigationGpsPower(true);
    expect(_setNavigationActive).toHaveBeenCalledTimes(1);
  });

  it('değer değişince yeniden gönderilir', () => {
    setNavigationGpsPower(true);
    setNavigationGpsPower(false);
    setNavigationGpsPower(true);
    expect(_setNavigationActive).toHaveBeenCalledTimes(3);
  });

  it('WEB MODU: native yokken hiçbir çağrı yapılmaz (sessiz no-op)', () => {
    _isNative = false;
    setNavigationGpsPower(true);
    expect(_setNavigationActive).not.toHaveBeenCalled();
    expect(_logError).not.toHaveBeenCalled();
  });

  it('FAIL-SOFT: köprü reddederse throw ETMEZ, yalnız loglanır', async () => {
    _setNavigationActive.mockImplementationOnce(() => Promise.reject(new Error('NO_PLUGIN')));
    expect(() => setNavigationGpsPower(true)).not.toThrow();
    await Promise.resolve();
    await Promise.resolve();
    expect(_logError).toHaveBeenCalled();
  });
});

describe('navGpsPowerBridge — ikinci otorite YASAĞI (kaynak kilidi)', () => {
  it('köprü konum OKUMAZ: izin isteme / abonelik / watchPosition İÇERMEZ', async () => {
    const src = await import('node:fs').then((fs) =>
      fs.readFileSync('src/platform/navigation/navGpsPowerBridge.ts', 'utf-8'),
    );
    /* Yorumlar hariç — kilit YORUM metnini değil KODU denetler. */
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !l.trim().startsWith('//'))
      .join('\n');

    expect(code).not.toMatch(/watchPosition|getCurrentPosition|requestPermissions/);
    expect(code).not.toMatch(/onGPSLocation|gpsService/);
    expect(code).not.toMatch(/setInterval|setTimeout/);
  });
});
