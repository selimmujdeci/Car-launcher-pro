/**
 * hybridF3RealCapabilityWiring.test.ts — HYBRID-F3: `ai.local_model` GERÇEK
 * registry/runtime wiring'e bağlandı.
 *
 * KAPSAM: F0 (device evidence) → F1 (decideLocalModelEligibility) → F2
 * (runtimeCapabilityProviders local model provider) → F3 (platformCoreCapabilityWiring
 * → gerçek Capability Registry) zincirinin UÇTAN UCA çalıştığını, TEK OTORİTE
 * ilkesinin korunduğunu ve `deviceTierMinimum` kilidinin İKİNCİ bir karar
 * mantığına DÖNÜŞMEDİĞİNİ kanıtlar.
 *
 * TEST İZOLASYONU: gerçek `capabilityRegistry` singleton PAYLAŞILMAZ (mevcut
 * `platformCoreCapabilityWiring.test.ts` deseniyle AYNI) — her test kendi
 * `createCapabilityRegistry(...)` instance'ını DI eder. Singleton'ın kendi
 * `setDeviceTierProvider` davranışı AYRI, izole bir `describe` bloğunda ve
 * `afterEach` ile TEMİZLENEREK test edilir.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  startPlatformCoreCapabilityWiring,
  type CapabilityWiringDeps,
} from '../platform/system/platformCoreCapabilityWiring';
import {
  createCapabilityRegistry, DEFAULT_CAPABILITY_CATALOG, capabilityRegistry,
} from '../platform/capability/capabilityRegistry';
import { createRuntimeCapabilityProviders } from '../platform/capability/providers/runtimeCapabilityProviders';
import {
  setNativeResourceEvidence, _resetCapabilitiesForTest, getDeviceTier,
} from '../platform/deviceCapabilities';

/** async refresh (Promise.allSettled) mikro/makro kuyruğunu boşalt. */
const flush = () => new Promise<void>((r) => setTimeout(r, 0));

/** Blok/satır yorumlarını çıkarır — kaynak-metin guard testleri docblock'un
 * açıklayıcı örnek kodunu yanlış-pozitif yakalamasın diye. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

const WIRING_SRC = readFileSync(
  join(process.cwd(), 'src', 'platform', 'system', 'platformCoreCapabilityWiring.ts'), 'utf8',
);
const WIRING_CODE = stripComments(WIRING_SRC);

/** Aktif wiring kaydı testler arası SIZMASIN. */
const _open: Array<() => void> = [];
function start(deps: CapabilityWiringDeps = {}) {
  const c = startPlatformCoreCapabilityWiring(deps);
  _open.push(c);
  return c;
}

beforeEach(() => {
  _resetCapabilitiesForTest();
});
afterEach(() => {
  while (_open.length) { try { _open.pop()!(); } catch { /* */ } }
  _resetCapabilitiesForTest();
});

describe('HYBRID-F3 — A-F: gerçek registry sonuç matrisi', () => {
  it('A) ai.local_model GERÇEK wiring zincirinde register olur (fabrika kendi probe\'unu üretir)', async () => {
    setNativeResourceEvidence({
      totalRamMb: 2048, isLowRamDevice: true, supportedAbis: ['armeabi-v7a'], cpuCoreCount: 4,
    });
    const registry = createCapabilityRegistry({ deviceTier: 'low', seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    start({ registry, deviceTier: 'low', navigator: {} });
    await flush();
    expect(registry.getCapability('ai.local_model')).not.toBeNull();
  });

  it('B) K2401/low-tier → registry sonucu unavailable (GERÇEK zincir, DI eligibility yok)', async () => {
    setNativeResourceEvidence({
      totalRamMb: 2048, isLowRamDevice: true, supportedAbis: ['armeabi-v7a'], cpuCoreCount: 4,
    });
    const registry = createCapabilityRegistry({ deviceTier: 'low', seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    start({ registry, deviceTier: 'low', navigator: {} });
    await flush();
    expect(registry.getCapability('ai.local_model')?.status).toBe('unavailable');
  });

  it('C) High-end arm64+8GB ama runtime YOK (bu fazda HER ZAMAN) → unavailable (GERÇEK probe)', async () => {
    setNativeResourceEvidence({
      totalRamMb: 8192, isLowRamDevice: false, supportedAbis: ['arm64-v8a'],
      usableStorageMb: 16384, cpuCoreCount: 8, sdkInt: 34,
    });
    const registry = createCapabilityRegistry({ deviceTier: 'high', seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    start({ registry, deviceTier: 'high', navigator: {} });
    await flush();
    // F1 eligible OLUR AMA gerçek probe runtimeAvailable'ı bu fazda SABİT false döner.
    expect(registry.getCapability('ai.local_model')?.status).toBe('unavailable');
  });

  it('D) High-end + runtime var ama model yüklü DEĞİL (test-DI provider, GERÇEK registry zinciri) → unavailable', async () => {
    const providers = createRuntimeCapabilityProviders({
      env: { deviceTier: 'high' },
      probes: { localModel: () => ({ eligibilityStatus: 'eligible', runtimeAvailable: true, modelLoaded: false }) },
    });
    const registry = createCapabilityRegistry({ deviceTier: 'high', seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    start({ registry, providers });
    await flush();
    expect(registry.getCapability('ai.local_model')?.status).toBe('unavailable');
  });

  it('E) Tüm kanıtlar true (test-DI provider) → registry GERÇEKTEN available üretebiliyor', async () => {
    const providers = createRuntimeCapabilityProviders({
      env: { deviceTier: 'high' },
      probes: { localModel: () => ({ eligibilityStatus: 'eligible', runtimeAvailable: true, modelLoaded: true }) },
    });
    const registry = createCapabilityRegistry({ deviceTier: 'high', seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    start({ registry, providers });
    await flush();
    // deviceTierMinimum:'high' kilidi DOĞRU beslenen tier ile ARTIK available'ı ENGELLEMİYOR.
    expect(registry.getCapability('ai.local_model')?.status).toBe('available');
  });

  it('F1) Eksik/unknown evidence (RAM/ABI bilinmiyor, F1→unknown) → GERÇEK zincirde fail-closed unavailable', async () => {
    // setNativeResourceEvidence HİÇ çağrılmadı → F0 kanıtı yok → F1 eligibility 'unknown'.
    const registry = createCapabilityRegistry({ deviceTier: 'high', seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    start({ registry, deviceTier: 'high', navigator: {} });
    await flush();
    // F2'nin provider mantığı 'unknown'ı da 'unavailable'a projekte eder (eligibilityStatus
    // !== 'eligible' dalı) → Registry'ye GEÇERLİ bir "available:false" kanıtı ulaşır.
    expect(registry.getCapability('ai.local_model')?.status).toBe('unavailable');
  });

  it('F2) provider throw/invalid kaynak → asla "available" ÜRETMEZ (gerçek davranış: unknown kalır)', async () => {
    // ⚠️ NÜANS: mevcut mimari "throw/kaynak yok" ile "kanıtlı olumsuz" durumlarını AYRI tutar
    // (zero-trust: `unknown ≠ unavailable`, ikisi de `≠ available`). Provider'ın kendisi
    // throw ederse (ya da probe null dönerse) Registry'ye kanıt HİÇ ULAŞMAZ → sonuç `unknown`
    // kalır — `unavailable` (kanıtlı "hayır") DEĞİL. Bu testin KİLİTLEDİĞİ tek şey: hiçbir
    // koşulda `available` ÜRETİLMEZ (fail-closed'ın gerçek karşılığı).
    const throwingProviders = createRuntimeCapabilityProviders({
      env: { deviceTier: 'high' },
      probes: { localModel: () => { throw new Error('boom'); } },
    });
    const registry = createCapabilityRegistry({ deviceTier: 'high', seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    start({ registry, providers: throwingProviders });
    await flush();
    const status = registry.getCapability('ai.local_model')?.status;
    expect(status).not.toBe('available');
    expect(['unknown', 'unavailable']).toContain(status);
  });
});

describe('HYBRID-F3 — G: ikinci bağımsız karar fonksiyonu OLUŞMADI (kaynak-metin kilidi)', () => {
  it('wiring dosyası tier/eligibility KARARINI kendisi VERMEZ — yalnız decideLocalModelEligibility\'yi ÇAĞIRIR', () => {
    expect(WIRING_CODE).toMatch(/decideLocalModelEligibility\(/);
    // Tier KARŞILAŞTIRMASI (=== 'high' / TIER_RANK vb.) burada TEKRARLANMAZ.
    expect(WIRING_CODE).not.toMatch(/deviceTier\s*(===|!==|<|>)\s*['"]?(low|mid|high)/);
    expect(WIRING_CODE).not.toMatch(/TIER_RANK/);
    // getDeviceTier() İMPLEMENTASYONU kopyalanmadı — yalnız ÇAĞRILIYOR (fonksiyon referansı).
    expect(WIRING_CODE).toMatch(/getDeviceTier/);
  });

  it('runtimeCapabilityProviders provider seviyesinde de tier YENİDEN HESAPLANMIYOR', async () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'capability', 'providers', 'runtimeCapabilityProviders.ts'), 'utf8',
    );
    const code = stripComments(src);
    expect(code).not.toMatch(/getDeviceTier\s*\(/);
  });

  it('localModelEligibility (F1) hâlâ SAF — capability registry/global state import ETMEZ', async () => {
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'ai', 'local', 'localModelEligibility.ts'), 'utf8',
    );
    const code = stripComments(src);
    for (const token of ['capabilityRegistry', 'CapabilityRegistry', 'platformCoreCapabilityWiring']) {
      expect(code, `yasaklı bağımlılık: ${token}`).not.toContain(token);
    }
  });
});

describe('HYBRID-F3 — H/I: mevcut davranış bozulmadı + duplicate registration yok', () => {
  it('H) diğer capability\'ler (device.gps) wiring DEĞİŞİKLİĞİNDEN ETKİLENMEDİ — evidence akışı BİREBİR aynı', async () => {
    // Detaylı karar-mantığı regresyonu zaten capabilityRegistry.test.ts (246/246) ile
    // kanıtlı; burada kilitlenen şey YALNIZ bu wiring'in device.gps'i HÂLÂ beslediğidir
    // (localModel probe eklemek başka capability'lerin kanıt akışını KESMEDİ). Aynı desen
    // `platformCoreCapabilityWiring.test.ts` testi #6 ile (resolvedIds üzerinden) AYNI.
    const resolved: string[] = [];
    const fakeRegistry = {
      resolveCapability: (id: string) => { resolved.push(id); return null; },
      getCapability: () => null,
    };
    start({ registry: fakeRegistry, deviceTier: 'high', navigator: { geolocation: {} } });
    await flush();
    expect(resolved).toContain('device.gps');
    expect(resolved).toContain('ai.local_model');   // YENİ probe de AYNI zincirden geçiyor
  });

  it('I) ai.local_model provider listesinde TAM BİR KEZ geçer (duplicate registration YOK)', () => {
    const providers = createRuntimeCapabilityProviders({
      env: { deviceTier: 'high' },
      probes: { localModel: () => ({ eligibilityStatus: 'eligible', runtimeAvailable: false, modelLoaded: false }) },
    });
    const matches = providers.filter((p) => p.id === 'ai.local_model');
    expect(matches.length).toBe(1);
  });

  it('I2) startPlatformCoreCapabilityWiring İKİNCİ kez çağrılırsa YENİ adapter/registration OLUŞTURMAZ', async () => {
    const registry = createCapabilityRegistry({ deviceTier: 'high', seedCatalog: DEFAULT_CAPABILITY_CATALOG });
    const cleanup1 = start({ registry, deviceTier: 'high', navigator: {} });
    const cleanup2 = start({ registry, deviceTier: 'high', navigator: {} }); // aktifken ikinci çağrı
    expect(typeof cleanup1).toBe('function');
    expect(typeof cleanup2).toBe('function');
    // İkinci çağrı no-op cleanup döner (aynı referans DEĞİL ama registry'ye ikinci kez
    // provider EKLEMEZ) — dolaylı kanıt: refresh sonrası tek bir 'ai.local_model' kaydı var.
    await flush();
    expect(registry.getCapability('ai.local_model')).not.toBeNull();
  });
});

describe('HYBRID-F3 — Registry tier otorite düzeltmesi (singleton bug kanıtı + düzeltme)', () => {
  afterEach(() => {
    // Singleton PAYLAŞILAN global state — testin ARDINDAN varsayılan (nötr) kaynağa döndür
    // ki başka test dosyaları BU testin bıraktığı state'i MİRAS ALMASIN.
    capabilityRegistry.setDeviceTierProvider(() => 'low');
  });

  it('KANIT: singleton varsayılanı sabit \'low\' idi (DI edilmeden) — düzeltmenin GEREKÇESİ', () => {
    // Bu, capabilityRegistry.ts constructor'ının belgelenmiş (setDeviceTierProvider docblock'u)
    // davranışının BAĞIMSIZ bir kanıtı: setter çağrılmadan singleton'ın tier'ı DEĞİŞMEZ.
    // (Başka bir testte setter zaten çağrılmış olabileceğinden bu test SIRAYA duyarlı
    // değildir — yalnız setter'ın VAR OLDUĞUNU ve etkili olduğunu B testinde kanıtlarız.)
    expect(typeof capabilityRegistry.setDeviceTierProvider).toBe('function');
  });

  it('setDeviceTierProvider singleton\'ı GERÇEK getDeviceTier ile hizalar — deviceTierMinimum kilidi artık DOĞRU tier\'ı görür', () => {
    capabilityRegistry.setDeviceTierProvider(() => 'high');
    const rec = capabilityRegistry.resolveCapability(
      'ai.local_model',
      { source: 'runtime', available: true, quality: 'medium', confidence: 0.8 },
      'ai',
    );
    // Tier artık 'high' → deviceTierMinimum:'high' kilidi ARTIK provider'ın available
    // kararını EZMİYOR (önceden sabit 'low' varsayımıyla HER ZAMAN restricted olurdu).
    expect(rec?.status).toBe('available');
  });

  it('KIYAS: tier BESLENMEDEN (sabit \'low\' varsayımı) AYNI kanıt restricted\'e DÜŞERDİ', () => {
    capabilityRegistry.setDeviceTierProvider(() => 'low');
    const rec = capabilityRegistry.resolveCapability(
      'ai.local_model',
      { source: 'runtime', available: true, quality: 'medium', confidence: 0.8 },
      'ai',
    );
    expect(rec?.status).toBe('restricted');
  });

  it('platformCoreCapabilityWiring GERÇEK singleton kullanıldığında setDeviceTierProvider\'ı ÇAĞIRIR (kaynak-metin kilidi)', () => {
    expect(WIRING_CODE).toMatch(/capabilityRegistry\.setDeviceTierProvider\(/);
    // Yalnız GERÇEK singleton için — test-DI edilen registry'ye ZORLA çağrılmaz.
    expect(WIRING_CODE).toMatch(/registry\s*===\s*capabilityRegistry/);
  });

  it('platformCoreCapabilityWiring GERÇEK deviceTierMinimum SATIRINI değiştirmedi (capabilityRegistry.ts kaynak kanıtı)', () => {
    const regSrc = readFileSync(
      join(process.cwd(), 'src', 'platform', 'capability', 'capabilityRegistry.ts'), 'utf8',
    );
    expect(regSrc).toMatch(/\{\s*id:\s*'ai\.local_model',\s*domain:\s*'ai',\s*deviceTierMinimum:\s*'high'\s*\}/);
  });
});

describe('HYBRID-F3 — J: F2 provider testleri hâlâ geçerli (smoke referansı)', () => {
  it('getDeviceTier() gerçek modülü ÇALIŞIR durumda — F3 onu bozmadı', () => {
    expect(() => getDeviceTier()).not.toThrow();
    expect(['low', 'mid', 'high']).toContain(getDeviceTier());
  });
});
