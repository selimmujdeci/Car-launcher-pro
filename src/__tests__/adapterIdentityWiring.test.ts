/**
 * adapterIdentityWiring.test.ts — V-04: `adapterCapability` ÜRÜN YOLUNA BAĞLANDI.
 *
 * NEDEN VAR: `adapterCapability.ts` yazılmış, test edilmiş ve doğru çalışıyordu — ama
 * ürün yolunda **sıfır tüketicisi** vardı (V-04 ölü kod tablosu). Yani "klon adaptör
 * tespitimiz var" sanılıyor, gerçekte hiç çalışmıyordu: klasik "motor var, besleyen yok".
 * Bu dosya köprünün GERÇEKTEN kurulu olduğunu kilitler.
 *
 * Kilitlenen davranışlar:
 *  1. Prob HİÇ koşmadıysa `null` döner — 'unknown' UYDURULMAZ.
 *     ("sormadık" ile "sorduk, bilemedik" ayrı arızalardır; ikisini birleştirmek
 *      gözlem ekranını yalancı yapar.)
 *  2. Native metot yoksa (eski plugin) fail-soft: çağrı patlamaz, akış sürmeli.
 *  3. Prob patlarsa `attempted` TRUE kalır — "denendi ama olmadı" bilgisi korunur.
 *  4. Başarılı probda ham yanıt SAKLANIR (kanıt) ve sınıflandırma ondan TÜRETİLİR.
 *  5. `reset` kimliği temizler — kimlik bir sonraki bağlantıya TAŞINMAZ.
 *  6. Tek-sefer kuralı: ikinci çağrı native'e YENİ komut göndermez (Mali-400).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

/* Capacitor: native platform gibi davran — aksi hâlde servis erkenden null döner. */
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true },
}));

const probeMock = vi.fn();
vi.mock('../platform/nativePlugin', () => ({
  CarLauncher: {
    get probeAdapterIdentity() { return probeMock.getMockImplementation() ? probeMock : undefined; },
  },
}));

import {
  probeAdapterIdentity, getAdapterCapabilities, getAdapterIdentityRaw,
  wasAdapterProbeAttempted, resetAdapterIdentity,
} from '../platform/obd/adapterIdentityService';

beforeEach(() => {
  resetAdapterIdentity();
  probeMock.mockReset();
});

describe('V-04 — adaptör kimlik köprüsü', () => {
  it('prob HİÇ koşmadıysa null döner — "unknown" uydurulmaz', () => {
    expect(getAdapterCapabilities()).toBeNull();
    expect(getAdapterIdentityRaw()).toBeNull();
    expect(wasAdapterProbeAttempted()).toBe(false);
  });

  it('native metot yoksa fail-soft: null döner, PATLAMAZ', async () => {
    /* probeMock'a implementasyon verilmedi → mock getter undefined döndürür,
       yani eski plugin sürümü senaryosu. */
    await expect(probeAdapterIdentity()).resolves.toBeNull();
    expect(getAdapterCapabilities()).toBeNull();
  });

  it('prob PATLARSA fail-soft null döner ama "denendi" bilgisi KORUNUR', async () => {
    probeMock.mockImplementation(() => Promise.reject(new Error('ELM sustu')));
    await expect(probeAdapterIdentity()).resolves.toBeNull();
    /* Kritik: attempted TRUE kalmalı. False olsaydı gözlem ekranı "prob hiç
       koşmadı" derdi ve okuyan, adaptörün yanıt vermediğini ANLAYAMAZDI. */
    expect(wasAdapterProbeAttempted()).toBe(true);
    expect(getAdapterCapabilities()).toBeNull();
  });

  it('boş yanıt sınıflandırılmaz — "sorduk, cihaz sustu" ayrı tutulur', async () => {
    probeMock.mockImplementation(() => Promise.resolve({ raw: '   ' }));
    await expect(probeAdapterIdentity()).resolves.toBeNull();
    expect(wasAdapterProbeAttempted()).toBe(true);
    expect(getAdapterCapabilities()).toBeNull();
  });

  it('KLON tespit edilir ve yetenekler FAIL-CLOSED false olur', async () => {
    /* Etikette ELM327 yazıyor ama kimlik komutları '?' → klon. */
    probeMock.mockImplementation(() => Promise.resolve({ raw: 'ELM327 v1.5|?|?' }));
    const caps = await probeAdapterIdentity();
    expect(caps?.kind).toBe('clone');
    expect(caps?.extendedAddressing).toBe(false);
    expect(caps?.flowControl).toBe(false);
    /* Ham yanıt KANIT olarak saklanır. */
    expect(getAdapterIdentityRaw()).toBe('ELM327 v1.5|?|?');
  });

  it('STN adaptör en yetenekli sınıfa çıkar', async () => {
    probeMock.mockImplementation(() => Promise.resolve({ raw: 'ELM327 v1.4|OBDLink|STN1170 v4.3' }));
    const caps = await probeAdapterIdentity();
    expect(caps?.kind).toBe('stn');
    expect(caps?.extendedAddressing).toBe(true);
    expect(caps?.flowControl).toBe(true);
  });

  it('TEK SEFER: ikinci çağrı native\'e yeni komut GÖNDERMEZ', async () => {
    probeMock.mockImplementation(() => Promise.resolve({ raw: 'ELM327 v1.5|?|?' }));
    await probeAdapterIdentity();
    await probeAdapterIdentity();
    await probeAdapterIdentity();
    /* Kimlik oturum boyunca değişmez; ELM kuyruğuna tekrar yük binmemeli. */
    expect(probeMock).toHaveBeenCalledTimes(1);
  });

  it('reset kimliği temizler — sonraki bağlantıya TAŞINMAZ', async () => {
    probeMock.mockImplementation(() => Promise.resolve({ raw: 'ELM327 v1.5|?|?' }));
    await probeAdapterIdentity();
    expect(getAdapterCapabilities()).not.toBeNull();

    resetAdapterIdentity();

    /* Aynı dongle başka araca ya da başka dongle aynı araca takılabilir —
       eski kimliği devretmek ölçümü VARSAYIMA çevirir. */
    expect(getAdapterCapabilities()).toBeNull();
    expect(getAdapterIdentityRaw()).toBeNull();
    expect(wasAdapterProbeAttempted()).toBe(false);
  });
});

describe('V-04 — ürün yolu gerçekten bağlı mı', () => {
  it('obdService probu ÇAĞIRIYOR ve kopmada SIFIRLIYOR (kaynak kanıtı)', async () => {
    /* Bu kilit olmadan servis "yazılmış ama yine bağlanmamış" olabilirdi —
       V-04'ün kapatmaya çalıştığı kusurun ta kendisi. */
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'obdService.ts'), 'utf8',
    ) as string;
    expect(src).toMatch(/from '\.\/obd\/adapterIdentityService'/);
    expect(src).toMatch(/void probeAdapterIdentity\(\)/);
    expect(src).toMatch(/resetAdapterIdentity\(\)/);
  });

  it('LAB gözlem yüzeyi bağlı — gözlemlenemeyen özellik tamamlanmış sayılmaz', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const model = readFileSync(
      join(process.cwd(), 'src', 'platform', 'devtools', 'adapterDiagnosticsModel.ts'), 'utf8',
    ) as string;
    const sources = readFileSync(
      join(process.cwd(), 'src', 'platform', 'devtools', 'adapterDiagnosticsSources.ts'), 'utf8',
    ) as string;
    expect(model).toMatch(/_identitySection/);
    expect(model).toMatch(/_identitySection\(s\)/);          // buildAdSections'a bağlı
    expect(sources).toMatch(/adapterIdentityService/);
    expect(sources).toMatch(/identity: _readIdentity\(\)/);  // snapshot'a bağlı
  });
});
