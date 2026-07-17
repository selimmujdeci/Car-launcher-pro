/**
 * OEM Vehicle Status Bar — durum türetme modeli + gizlilik/perf guard testleri.
 *
 * Saf model senaryoları (Wi-Fi/BT/OBD/GPS/AI) + kaynak-tarama guard'ları:
 *   - anahtar/secret UI'a sızmıyor (19)
 *   - popover gizli veri taşımıyor (20)
 *   - yeni timer/rAF eklenmedi (23)
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  deriveWifiStatus, deriveBtStatus, deriveObdStatus, deriveGpsStatus, deriveAiStatus,
  statusTone, statusAnimates, OBD_FRESH_MS, OBD_STALE_MS, GPS_STALE_MS,
} from '../platform/vehicleStatusModel';

const T0 = 1_000_000; // sabit "now" (deterministik; Date.now kullanılmaz)

describe('Wi-Fi durumu', () => {
  it('1. online', () => expect(deriveWifiStatus(true, true)).toBe('online'));
  it('2. internet yok', () => expect(deriveWifiStatus(true, false)).toBe('no_internet'));
  it('offline', () => expect(deriveWifiStatus(false, false)).toBe('offline'));
});

describe('Bluetooth durumu', () => {
  it('3. kapalı', () => expect(deriveBtStatus({ enabled: false, connected: false })).toBe('disabled'));
  it('4. açık (idle)', () => expect(deriveBtStatus({ enabled: true, connected: false })).toBe('idle'));
  it('5. tarıyor', () => expect(deriveBtStatus({ enabled: true, connected: false, scanning: true })).toBe('scanning'));
  it('bağlı', () => expect(deriveBtStatus({ enabled: true, connected: true })).toBe('connected'));
  it('hata', () => expect(deriveBtStatus({ enabled: true, connected: false, error: true })).toBe('error'));
});

describe('OBD durumu (freshness çekirdeği)', () => {
  const base = { connectionState: 'connected', source: 'real', available: true };
  it('6. gerçek connected + fresh (<3s)', () =>
    expect(deriveObdStatus({ ...base, lastSeenMs: T0 - 1_000, now: T0 })).toBe('connected'));
  it('7. connected ama stale (3–10s)', () =>
    expect(deriveObdStatus({ ...base, lastSeenMs: T0 - 5_000, now: T0 })).toBe('stale'));
  // SÖZLEŞME DEĞİŞTİ (dalgalanma kök düzeltmesi): bu kilit eskiden ">10s sessizlik →
  // disconnected" diyordu. O davranış YANLIŞTI: link canlıyken ECU'nun susması bir KOPMA
  // DEĞİLDİR. POWER_SAVE'de poll periyodu 15s → yaş 10s'i RUTİN olarak aşar → sağlıklı
  // bağlantıda sahte "OBD bağlı değil" ve reconnect dalgalanması üretiyordu.
  // Kilit KALDIRILMADI, yeni doğru davranışa GÜNCELLENDİ: uzun sessizlik = 'stale'.
  it('>10s sessizlik → stale (KOPMA DEĞİL — link canlı, ECU susmuş)', () =>
    expect(deriveObdStatus({ ...base, lastSeenMs: T0 - 11_000, now: T0 })).toBe('stale'));
  it('çok uzun sessizlik (60s) bile disconnected DEĞİL — kopma yalnız transport kanıtıyla', () =>
    expect(deriveObdStatus({ ...base, lastSeenMs: T0 - 60_000, now: T0 })).toBe('stale'));
  it('DOĞRULANMIŞ transport kopması → disconnected (taze veri olsa bile)', () =>
    expect(deriveObdStatus({
      ...base, transportConnected: false, lastSeenMs: T0 - 100, now: T0,
    })).toBe('disconnected'));
  it('8. idle → disconnected', () =>
    expect(deriveObdStatus({ connectionState: 'idle', source: 'none', lastSeenMs: 0, now: T0, available: true })).toBe('disconnected'));
  it('9a. MOCK bağlı sayılmaz (source=mock)', () =>
    expect(deriveObdStatus({ connectionState: 'connected', source: 'mock', lastSeenMs: T0, now: T0, available: true })).toBe('disconnected'));
  it('9b. FALLBACK bağlı sayılmaz (source=none)', () =>
    expect(deriveObdStatus({ connectionState: 'connected', source: 'none', lastSeenMs: T0, now: T0, available: true })).toBe('disconnected'));
  it('connected state ama paket yok → connecting', () =>
    expect(deriveObdStatus({ ...base, lastSeenMs: 0, now: T0 })).toBe('connecting'));
  it('connecting/initializing/reconnecting → connecting', () => {
    for (const s of ['connecting', 'initializing', 'reconnecting', 'scanning']) {
      expect(deriveObdStatus({ connectionState: s, source: 'none', lastSeenMs: 0, now: T0, available: true })).toBe('connecting');
    }
  });
  it('error', () => expect(deriveObdStatus({ connectionState: 'error', source: 'none', lastSeenMs: 0, now: T0, available: true })).toBe('error'));
  it('platformda yok → unavailable', () =>
    expect(deriveObdStatus({ ...base, lastSeenMs: T0, now: T0, available: false })).toBe('unavailable'));
  it('saat atlaması (negatif yaş) → son bilineni koru (connected)', () =>
    expect(deriveObdStatus({ ...base, lastSeenMs: T0 + 5_000, now: T0 })).toBe('connected'));
});

describe('GPS durumu', () => {
  const b = { unavailable: false, isTracking: true, error: false, now: T0 };
  it('10. fixed (iyi doğruluk + taze)', () =>
    expect(deriveGpsStatus({ ...b, hasLocation: true, accuracy: 8, fixTimestamp: T0 - 1_000 })).toBe('fixed'));
  it('11. searching (tracking, konum yok)', () =>
    expect(deriveGpsStatus({ ...b, hasLocation: false, accuracy: Infinity, fixTimestamp: 0 })).toBe('searching'));
  it('12. stale (konum eski)', () =>
    expect(deriveGpsStatus({ ...b, hasLocation: true, accuracy: 8, fixTimestamp: T0 - (GPS_STALE_MS + 5_000) })).toBe('stale'));
  it('weak (kötü doğruluk)', () =>
    expect(deriveGpsStatus({ ...b, hasLocation: true, accuracy: 120, fixTimestamp: T0 - 1_000 })).toBe('weak'));
  it('disabled (unavailable)', () =>
    expect(deriveGpsStatus({ ...b, unavailable: true, hasLocation: false, accuracy: 0, fixTimestamp: 0 })).toBe('disabled'));
  it('error', () =>
    expect(deriveGpsStatus({ ...b, error: true, hasLocation: false, accuracy: 0, fixTimestamp: 0 })).toBe('error'));
});

describe('AI görünürlük + sağlık', () => {
  const ok = { configured: true, enabled: true, checked: true, providerCount: 2, readyProviderCount: 2, primaryReady: true };
  it('13. yapılandırma yok → hidden (render edilmez)', () =>
    expect(deriveAiStatus({ ...ok, configured: false, providerCount: 0, readyProviderCount: 0 })).toBe('hidden'));
  it('14. yapılandırılmış ama health bekleniyor → checking', () =>
    expect(deriveAiStatus({ ...ok, checked: false })).toBe('checking'));
  it('15. en az bir provider healthy → healthy', () =>
    expect(deriveAiStatus(ok)).toBe('healthy'));
  it('16. ana provider down, yedek healthy → fallback', () =>
    expect(deriveAiStatus({ ...ok, primaryReady: false, readyProviderCount: 1 })).toBe('fallback'));
  it('17. tüm providerlar down → error', () =>
    expect(deriveAiStatus({ ...ok, readyProviderCount: 0, primaryReady: false })).toBe('error'));
  it('18. AI kapalı → hidden', () =>
    expect(deriveAiStatus({ ...ok, enabled: false })).toBe('hidden'));
});

describe('OEM ton + animasyon (21 tema, 22 reduced-motion)', () => {
  it('healthy/connected/fixed/online → ok tonu', () => {
    for (const s of ['online', 'connected', 'fixed', 'healthy'] as const) expect(statusTone(s)).toBe('ok');
  });
  it('stale/weak/no_internet/fallback → warn', () => {
    for (const s of ['no_internet', 'stale', 'weak', 'fallback'] as const) expect(statusTone(s)).toBe('warn');
  });
  it('error → error tonu', () => expect(statusTone('error')).toBe('error'));
  it('22. animasyon YALNIZ connecting/checking/searching/scanning', () => {
    expect(statusAnimates('connecting')).toBe(true);
    expect(statusAnimates('checking')).toBe(true);
    expect(statusAnimates('searching')).toBe(true);
    expect(statusAnimates('connected')).toBe(false); // sabit durumda animasyon yok
    expect(statusAnimates('fixed')).toBe(false);
  });
});

describe('freshness bütçeleri anayasaya uygun', () => {
  it('OBD 3s / 10s', () => { expect(OBD_FRESH_MS).toBe(3_000); expect(OBD_STALE_MS).toBe(10_000); });
});

/* ── Kaynak-tarama guard'ları (19 sızıntı, 20 popover, 23 timer) ──────────── */

const HERE = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(HERE, rel), 'utf8');
const MODEL = readSrc('../platform/vehicleStatusModel.ts');
const COMPONENT = readSrc('../components/common/VehicleStatusIndicators.tsx');

describe('gizlilik + performans guard (kaynak taraması)', () => {
  it('19. model anahtar DEĞERİNİ okumaz (yalnız has/boolean)', () => {
    // Model saf metadata alır; sensitiveKeyStore.get/useSensitiveKey KULLANMAZ.
    expect(MODEL).not.toMatch(/sensitiveKeyStore|\.get\(|apiKey|secret/i);
  });
  it('19b. bileşen anahtar değerini state/DOM/log\'a taşımaz (get/log yok, yalnız has)', () => {
    expect(COMPONENT).not.toMatch(/sensitiveKeyStore\.get|useSensitiveKey|console\.(log|info|warn|error)/);
    expect(COMPONENT).toMatch(/sensitiveKeyStore\.has/); // yalnız boolean sorgusu
  });
  it('20. popover etiketleri gizli veri içermez (sağlayıcı adı/anahtar yok)', () => {
    // Sağlayıcı adları YALNIZ AI_PROVIDER_KEYS sabitinde (has() boolean sorgusu için anahtar
    // İSİMLERİ; değer değil) geçebilir. Bu satır çıkarıldıktan sonra kullanıcıya görünen hiçbir
    // metinde (AI_LABEL/JSX/log) sağlayıcı adı kalmamalı.
    const withoutKeyConst = COMPONENT.replace(/const AI_PROVIDER_KEYS[^;]*;/, '');
    expect(withoutKeyConst).not.toMatch(/gemini|groq|claude|openai/i);
  });
  it('23. yeni timer / rAF / interval EKLENMEDİ (CSS-only animasyon)', () => {
    for (const src of [MODEL, COMPONENT]) {
      expect(src).not.toMatch(/setInterval|setTimeout|requestAnimationFrame/);
    }
  });
  it('23b. animasyon prefers-reduced-motion korumalı (motion-safe)', () => {
    expect(COMPONENT).toMatch(/motion-safe:animate/);
  });
});
