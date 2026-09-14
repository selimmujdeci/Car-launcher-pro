/**
 * hybridF2LocalModelCapability.test.ts — HYBRID-F2: `ai.local_model` capability'sinin
 * F1 eligibility kararına FAIL-CLOSED bağlanması.
 *
 * EN ÖNEMLİ AYRIM: DEVICE ELIGIBILITY (F1 — "bu cihaz yapısal olarak uygun mu") ile
 * RUNTIME AVAILABILITY ("gerçek runtime kurulu mu + model yüklü mü") AYRI SORULARDIR.
 * `eligible ≠ available`. Bu faz gerçek runtime/model EKLEMEZ — yalnız kanıt projeksiyonu
 * genişletilir; capability bu yüzden HER SENARYODA `unavailable` kalır (fixture'da hepsi
 * `true` verilmedikçe).
 */
import { describe, it, expect } from 'vitest';
import {
  createRuntimeCapabilityProviders,
  type LocalModelEvidence,
} from '../platform/capability/providers/runtimeCapabilityProviders';
import { decideLocalModelEligibility, type LocalModelEligibilityEvidence } from '../platform/ai/local/localModelEligibility';
import type { CapabilityProvider, CapabilityProviderResult } from '../platform/capability';

/* ── Yardımcılar ─────────────────────────────────────────────────────── */

function buildLocalModelProvider(evidence: LocalModelEvidence | null): CapabilityProvider {
  const list = createRuntimeCapabilityProviders({ probes: { localModel: () => evidence } });
  const p = list.find((x) => x.id === 'ai.local_model');
  if (!p) throw new Error('ai.local_model provider oluşturulmadı');
  return p;
}

async function readStatus(p: CapabilityProvider): Promise<string | undefined> {
  const r = await Promise.resolve(p.read()) as CapabilityProviderResult | null;
  return r?.status;
}

/**
 * Blok/satır yorumlarını çıkarır — kaynak-metin guard testleri modülün AÇIKLAYICI
 * docblock'unun (ör. "capabilityRegistry.ts ile AYNI desen" cümlesi) kendisini
 * yanlış-pozitif olarak yakalamasın diye yalnız GERÇEK KOD gövdesi taranır.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/** K2401 saha fixture (HYBRID-F0/F1 ile AYNI): 2GB/armeabi-v7a/tier low. */
const K2401_ELIGIBILITY_INPUT: LocalModelEligibilityEvidence = {
  deviceTier: 'low', isLowRamDevice: true, supportedAbis: ['armeabi-v7a'], totalRamMb: 2048,
};

/** High-end arm64 fixture: tüm eligibility eşiklerini geçer. */
const HIGH_END_ELIGIBILITY_INPUT: LocalModelEligibilityEvidence = {
  deviceTier: 'high', isLowRamDevice: false, supportedAbis: ['arm64-v8a'],
  totalRamMb: 8192, usableStorageMb: 16384,
};

describe('HYBRID-F2 — 10 zorunlu senaryo', () => {
  it('1) K2401 (tier low) → F1 ineligible(device_tier_low) → ai.local_model unavailable', async () => {
    const eligibility = decideLocalModelEligibility(K2401_ELIGIBILITY_INPUT);
    expect(eligibility.status).toBe('ineligible');

    const evidence: LocalModelEvidence = {
      eligibilityStatus: eligibility.status,
      eligibilityReason: eligibility.status !== 'eligible' ? eligibility.reason : undefined,
      runtimeAvailable: false,
      modelLoaded: false,
    };
    const p = buildLocalModelProvider(evidence);
    const status = await readStatus(p);
    expect(status).toBe('unavailable');
  });

  it('2) High-end arm64+8GB → F1 eligible → runtime yok → capability YİNE unavailable (eligible ≠ available)', async () => {
    const eligibility = decideLocalModelEligibility(HIGH_END_ELIGIBILITY_INPUT);
    expect(eligibility.status).toBe('eligible');

    const evidence: LocalModelEvidence = {
      eligibilityStatus: eligibility.status,
      runtimeAvailable: false,   // gerçek runtime YOK (bu faz)
      modelLoaded: false,        // gerçek model YOK (bu faz)
    };
    const p = buildLocalModelProvider(evidence);
    const status = await readStatus(p);
    expect(status).toBe('unavailable');
  });

  it('3) eligibility "unknown" → unavailable', async () => {
    const evidence: LocalModelEvidence = {
      eligibilityStatus: 'unknown', eligibilityReason: 'total_ram_unknown',
      runtimeAvailable: false, modelLoaded: false,
    };
    const status = await readStatus(buildLocalModelProvider(evidence));
    expect(status).toBe('unavailable');
  });

  it('4) eligible + runtimeAvailable=true ama modelLoaded=false → unavailable', async () => {
    const evidence: LocalModelEvidence = {
      eligibilityStatus: 'eligible', runtimeAvailable: true, modelLoaded: false,
    };
    const status = await readStatus(buildLocalModelProvider(evidence));
    expect(status).toBe('unavailable');
  });

  it('5) eligible + modelLoaded=true ama runtimeAvailable=false → unavailable', async () => {
    const evidence: LocalModelEvidence = {
      eligibilityStatus: 'eligible', runtimeAvailable: false, modelLoaded: true,
    };
    const status = await readStatus(buildLocalModelProvider(evidence));
    expect(status).toBe('unavailable');
  });

  it('6) YALNIZ test fixture: eligible + runtimeAvailable=true + modelLoaded=true → available (gerçek runtime EKLENMEDİ)', async () => {
    const evidence: LocalModelEvidence = {
      eligibilityStatus: 'eligible', runtimeAvailable: true, modelLoaded: true,
    };
    const status = await readStatus(buildLocalModelProvider(evidence));
    expect(status).toBe('available');
  });

  it('7) capabilityRegistry.ts içindeki deviceTierMinimum:\'high\' kilidi KORUNMUŞ (kaynak-metin kanıtı)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'capability', 'capabilityRegistry.ts'), 'utf8',
    ) as string;
    expect(src).toMatch(/\{\s*id:\s*'ai\.local_model',\s*domain:\s*'ai',\s*deviceTierMinimum:\s*'high'\s*\}/);
    // Kilidin UYGULANDIĞI kod (TIER_RANK karşılaştırması) da hâlâ mevcut ve SİLİNMEMİŞ.
    expect(src).toMatch(/TIER_RANK\[deviceTier\]\s*<\s*TIER_RANK\[def\.deviceTierMinimum\]/);
  });

  it('8) unknown HİÇBİR durumda available\'a dönüşmez (F1 → provider zincirinde)', async () => {
    const unknownFixtures: LocalModelEligibilityEvidence[] = [
      { deviceTier: 'high' },                                              // her şey eksik
      { deviceTier: 'high', supportedAbis: undefined, totalRamMb: 8192 },  // ABI bilinmiyor
      { deviceTier: 'high', supportedAbis: ['arm64-v8a'], totalRamMb: undefined }, // RAM bilinmiyor
    ];
    for (const input of unknownFixtures) {
      const eligibility = decideLocalModelEligibility(input);
      expect(eligibility.status, JSON.stringify(input)).toBe('unknown');
      const evidence: LocalModelEvidence = {
        eligibilityStatus: eligibility.status,
        eligibilityReason: eligibility.status !== 'eligible' ? eligibility.reason : undefined,
        // Fixture'da runtime/model bilerek "true" verilse BİLE eligibility unknown'sa unavailable olmalı.
        runtimeAvailable: true, modelLoaded: true,
      };
      const status = await readStatus(buildLocalModelProvider(evidence));
      expect(status, JSON.stringify(input)).toBe('unavailable');
    }
  });

  it('9) capability provider model yüklemiyor, native API çağırmıyor, fetch yapmıyor (kod-gövdesi kilidi)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'capability', 'providers', 'runtimeCapabilityProviders.ts'), 'utf8',
    ) as string;
    const code = stripComments(src);
    for (const token of ['fetch(', 'XMLHttpRequest', 'CarLauncher', '@capacitor', 'llama', 'ONNX', 'TFLite']) {
      expect(code, `yasaklı iz KOD içinde bulundu: ${token}`).not.toContain(token);
    }
  });

  it('10) F1 (localModelEligibility) SAF modül olmaya devam ediyor — regresyon', async () => {
    // Guard'ın kendisi F1'in kendi test dosyasında yaşıyor; burada YALNIZ modülün hâlâ
    // aynı saf sözleşmeyi taşıdığını (throw etmez, deterministik) hızlı bir smoke ile doğrularız.
    const a = decideLocalModelEligibility(K2401_ELIGIBILITY_INPUT);
    const b = decideLocalModelEligibility(K2401_ELIGIBILITY_INPUT);
    expect(a).toEqual(b);
    expect(() => decideLocalModelEligibility({} as LocalModelEligibilityEvidence)).not.toThrow();
  });
});

describe('HYBRID-F2 — yapısal guard', () => {
  it('runtimeCapabilityProviders local eligibility kararını (F1 sonucunu) TÜKETEBİLİR', async () => {
    // eligibilityReason F1'in ineligibility/unknown reason birliğinden GELİYOR — tip uyumu.
    const eligibility = decideLocalModelEligibility(K2401_ELIGIBILITY_INPUT);
    expect(eligibility.status).toBe('ineligible');
    const evidence: LocalModelEvidence = {
      eligibilityStatus: eligibility.status,
      eligibilityReason: eligibility.status !== 'eligible' ? eligibility.reason : undefined,
      runtimeAvailable: false, modelLoaded: false,
    };
    const status = await readStatus(buildLocalModelProvider(evidence));
    expect(status).toBe('unavailable');
  });

  it('localModelEligibility hiçbir capability registry/global state import ETMEZ (F1 dosyasının kendi guard testiyle AYNI kilit — çapraz doğrulama)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src', 'platform', 'ai', 'local', 'localModelEligibility.ts'), 'utf8',
    ) as string;
    const code = stripComments(src);
    for (const token of ['capabilityRegistry', 'CapabilityRegistry', 'runtimeCapabilityProviders']) {
      expect(code, `yasaklı bağımlılık KOD içinde bulundu: ${token}`).not.toContain(token);
    }
  });

  it('ai.local_model provider side-effect ÜRETMEZ — fabrika probe/navigator OKUMAZ, yalnız read() okur', () => {
    let calls = 0;
    const list = createRuntimeCapabilityProviders({
      probes: { localModel: () => { calls++; return { eligibilityStatus: 'eligible', runtimeAvailable: false, modelLoaded: false }; } },
    });
    expect(calls).toBe(0);   // fabrika ÇAĞIRMADI
    expect(list.some((p) => p.id === 'ai.local_model')).toBe(true);
    expect(calls).toBe(0);   // provider oluşturmak da ÇAĞIRMADI
  });

  it('ai.local_model capability sonucu YALNIZ evidence\'tan türetilir — aynı evidence → aynı sonuç (deterministik)', async () => {
    const evidence: LocalModelEvidence = {
      eligibilityStatus: 'ineligible', eligibilityReason: 'total_ram_insufficient',
      runtimeAvailable: false, modelLoaded: false,
    };
    const r1 = await readStatus(buildLocalModelProvider(evidence));
    const r2 = await readStatus(buildLocalModelProvider(evidence));
    expect(r1).toBe(r2);
    expect(r1).toBe('unavailable');
  });

  it('provider kaynak yokken (probe null döner) unknown\'a düşer — sahte unavailable ÜRETİLMEZ', async () => {
    const status = await readStatus(buildLocalModelProvider(null));
    expect(status).toBeUndefined();   // read() null döner → CapabilityProviderResult yok (unknown)
  });
});
