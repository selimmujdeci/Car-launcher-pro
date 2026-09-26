/**
 * localModelEligibility.test.ts — HYBRID-F1: yerel LLM runtime uygunluk kararı.
 *
 * NEDEN VAR: `decideLocalModelEligibility` SAF bir karar fonksiyonudur — model
 * indirmiyor, JNI/routing kurmuyor, yalnız DI ile verilen kanıtı değerlendirip
 * `eligible`/`ineligible`/`unknown` döner. EN ÖNEMLİ KURAL: `unknown` HİÇBİR
 * KOŞULDA `eligible` anlamına gelmez (fail-closed). Testler hem 11 zorunlu
 * senaryoyu hem de modülün gerçekten SAF/bağımsız olduğunu (yapısal guard)
 * kilitler.
 */
import { describe, it, expect } from 'vitest';
import {
  decideLocalModelEligibility,
  type LocalModelEligibilityEvidence,
  type LocalModelEligibility,
} from '../platform/ai/local/localModelEligibility';

/** K2401 saha profili (HYBRID-F0 ledger kanıtı): Android 10, ~2GB, armeabi-v7a, 4 çekirdek, tier low. */
const K2401_EVIDENCE: LocalModelEligibilityEvidence = {
  deviceTier:      'low',
  isLowRamDevice:  true,
  supportedAbis:   ['armeabi-v7a'],
  totalRamMb:      2048,
  availMemMb:      640,
  usableStorageMb: 900,
  cpuCoreCount:    4,
  sdkInt:          29,
};

/** High-end arm64 fixture — tüm zorunlu eşikleri geçen tam kanıt. */
const HIGH_END_EVIDENCE: LocalModelEligibilityEvidence = {
  deviceTier:      'high',
  isLowRamDevice:  false,
  supportedAbis:   ['arm64-v8a', 'armeabi-v7a'],
  totalRamMb:      8192,
  availMemMb:      4096,
  usableStorageMb: 16384,
  cpuCoreCount:    8,
  sdkInt:          34,
};

describe('HYBRID-F1 — 11 zorunlu senaryo', () => {
  it('1) K2401 (2GB, armeabi-v7a, tier low) → ineligible(device_tier_low) — EN KANONİK sebep', () => {
    const r = decideLocalModelEligibility(K2401_EVIDENCE);
    expect(r.status).toBe('ineligible');
    expect(r.status === 'ineligible' && r.reason).toBe('device_tier_low');
  });

  it('2) 8GB, arm64-v8a, tier high, yeterli RAM/depolama → eligible', () => {
    const r = decideLocalModelEligibility(HIGH_END_EVIDENCE);
    expect(r.status).toBe('eligible');
    expect(r.status === 'eligible' && r.profile).toBe('small_local_llm');
  });

  it('3) RAM bilinmiyor (diğer her şey iyi) → unknown(total_ram_unknown)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, totalRamMb: undefined });
    expect(r.status).toBe('unknown');
    expect(r.status === 'unknown' && r.reason).toBe('total_ram_unknown');
  });

  it('4) ABI bilinmiyor (diğer her şey iyi) → unknown(abi_unknown)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, supportedAbis: undefined });
    expect(r.status).toBe('unknown');
    expect(r.status === 'unknown' && r.reason).toBe('abi_unknown');
  });

  it('5) arm64 + 8GB ama tier low → ineligible(device_tier_low) — tier her şeyi ezer', () => {
    const r = decideLocalModelEligibility({
      deviceTier: 'low', supportedAbis: ['arm64-v8a'], totalRamMb: 8192,
    });
    expect(r.status).toBe('ineligible');
    expect(r.status === 'ineligible' && r.reason).toBe('device_tier_low');
  });

  it('6) arm64 + high tier ama isLowRamDevice=true → ineligible(low_ram_device)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, isLowRamDevice: true });
    expect(r.status).toBe('ineligible');
    expect(r.status === 'ineligible' && r.reason).toBe('low_ram_device');
  });

  it('7) uygun cihaz ama depolama yetersiz → ineligible(storage_insufficient)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, usableStorageMb: 500 });
    expect(r.status).toBe('ineligible');
    expect(r.status === 'ineligible' && r.reason).toBe('storage_insufficient');
  });

  it('8) uygun cihaz ama termal blokta (level>=2) → ineligible(thermal_blocked)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, thermalLevel: 2 });
    expect(r.status).toBe('ineligible');
    expect(r.status === 'ineligible' && r.reason).toBe('thermal_blocked');
  });

  it('9) uygun cihaz ama CRITICAL bellek baskısı → ineligible(memory_pressure_blocked)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, memoryPressureLevel: 'CRITICAL' });
    expect(r.status).toBe('ineligible');
    expect(r.status === 'ineligible' && r.reason).toBe('memory_pressure_blocked');
  });

  it('10) unknown hiçbir koşulda eligible olmaz (her unknown senaryosunda status≠eligible)', () => {
    const unknownFixtures: LocalModelEligibilityEvidence[] = [
      { ...HIGH_END_EVIDENCE, totalRamMb: undefined },
      { ...HIGH_END_EVIDENCE, supportedAbis: undefined },
      { ...HIGH_END_EVIDENCE, usableStorageMb: undefined },
      { ...HIGH_END_EVIDENCE, isLowRamDevice: undefined },
      { deviceTier: 'high' },   // yalnız tier bilgisi var, gerisi tamamen eksik
    ];
    for (const ev of unknownFixtures) {
      const r = decideLocalModelEligibility(ev);
      expect(r.status, JSON.stringify(ev)).not.toBe('eligible');
    }
  });

  it('11) aynı girdi her zaman aynı sonucu verir (saflık — random/Date.now/global state YOK)', () => {
    const results: LocalModelEligibility[] = [];
    for (let i = 0; i < 25; i++) {
      results.push(decideLocalModelEligibility(HIGH_END_EVIDENCE));
      results.push(decideLocalModelEligibility(K2401_EVIDENCE));
    }
    for (const r of results) {
      if (r.evidence === HIGH_END_EVIDENCE) expect(r.status).toBe('eligible');
      else expect(r.status).toBe('ineligible');
    }
    // Çağrılar arası hiçbir sızıntı: aynı fixture'ı farklı sırada tekrar çağırmak sonucu değiştirmez.
    const a = decideLocalModelEligibility(K2401_EVIDENCE);
    const b = decideLocalModelEligibility(HIGH_END_EVIDENCE);
    const c = decideLocalModelEligibility(K2401_EVIDENCE);
    expect(a).toEqual(c);
    expect(a.status).not.toBe(b.status);
  });
});

describe('HYBRID-F1 — ek eşik/sıralama doğrulamaları', () => {
  it('tier "mid" → ineligible(device_tier_mid) (mid, low ile KARIŞTIRILMAZ)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, deviceTier: 'mid' });
    expect(r.status).toBe('ineligible');
    expect(r.status === 'ineligible' && r.reason).toBe('device_tier_mid');
  });

  it('ABI dizisi arm64 İÇERMİYOR (yalnız armeabi-v7a, bilinmiyor DEĞİL) → ineligible(abi_unsupported)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, supportedAbis: ['armeabi-v7a'] });
    expect(r.status).toBe('ineligible');
    expect(r.status === 'ineligible' && r.reason).toBe('abi_unsupported');
  });

  it('boş ABI dizisi → unknown(abi_unknown) (bilinmiyor sayılır, unsupported DEĞİL)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, supportedAbis: [] });
    expect(r.status).toBe('unknown');
    expect(r.status === 'unknown' && r.reason).toBe('abi_unknown');
  });

  it('totalRamMb tam eşik değerinde (6144) → yeterli sayılır (sınırda ineligible OLMAZ)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, totalRamMb: 6144 });
    expect(r.status).toBe('eligible');
  });

  it('totalRamMb eşiğin 1 altında (6143) → ineligible(total_ram_insufficient)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, totalRamMb: 6143 });
    expect(r.status).toBe('ineligible');
    expect(r.status === 'ineligible' && r.reason).toBe('total_ram_insufficient');
  });

  it('geçersiz sayısal alanlar (0/negatif/NaN) bilinmiyor sayılır — sahte 0 kabul EDİLMEZ', () => {
    for (const bad of [0, -1, Number.NaN]) {
      const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, totalRamMb: bad });
      expect(r.status, String(bad)).toBe('unknown');
      expect(r.status === 'unknown' && r.reason).toBe('total_ram_unknown');
    }
  });

  it('termal seviye 1 (MODERATE altı) BLOKLAMAZ — yalnız ≥2 bloklar', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, thermalLevel: 1 });
    expect(r.status).toBe('eligible');
  });

  it('bellek baskısı MODERATE BLOKLAMAZ — yalnız CRITICAL bloklar (bu fazın politikası)', () => {
    const r = decideLocalModelEligibility({ ...HIGH_END_EVIDENCE, memoryPressureLevel: 'MODERATE' });
    expect(r.status).toBe('eligible');
  });

  it('thermal/memoryPressure hiç verilmezse eligible ENGELLENMEZ (opsiyonel alan)', () => {
    const { thermalLevel: _t, memoryPressureLevel: _m, ...rest } = HIGH_END_EVIDENCE as LocalModelEligibilityEvidence & {
      thermalLevel?: unknown; memoryPressureLevel?: unknown;
    };
    const r = decideLocalModelEligibility(rest);
    expect(r.status).toBe('eligible');
  });

  it('sonuç nesnesi donmuş (Object.freeze) — çağıran tarafından mutasyona kapalı', () => {
    const r = decideLocalModelEligibility(HIGH_END_EVIDENCE);
    expect(Object.isFrozen(r)).toBe(true);
  });

  it('throw etmez — bozuk/eksik girdi (boş obje) fail-closed unknown/ineligible döner', () => {
    expect(() => decideLocalModelEligibility({} as LocalModelEligibilityEvidence)).not.toThrow();
    const r = decideLocalModelEligibility({} as LocalModelEligibilityEvidence);
    expect(r.status).not.toBe('eligible');
  });
});

/**
 * Blok/satır yorumlarını çıkarır — guard testleri modülün AÇIKLAYICI docblock'unun
 * (ör. "voiceService import ETMEZ" cümlesi) kendisini yanlış-pozitif olarak
 * yakalamasın diye yalnız GERÇEK KOD gövdesi taranır.
 */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

async function readEligibilitySource(): Promise<string> {
  const { readFileSync } = await import('node:fs');
  const { join } = await import('node:path');
  return readFileSync(
    join(process.cwd(), 'src', 'platform', 'ai', 'local', 'localModelEligibility.ts'), 'utf8',
  ) as string;
}

describe('HYBRID-F1 — yapısal guard (SAFLIK ve tek-otorite kilidi)', () => {
  it('modül hiçbir native/routing/authority modülünü import ETMEZ (kod gövdesi kilidi)', async () => {
    const full = await readEligibilitySource();
    const code = stripComments(full);

    // Yasaklı bağımlılıklar — herhangi biri KOD içinde görülürse modül artık "yaprak" değildir.
    const forbidden = [
      'voiceService', 'maviActionAuthority', 'CarLauncher', 'nativePlugin',
      'thermalWatchdog', 'memoryWatchdog', 'safetyGate', 'executionEngine',
      'maviTurn', 'maviSpeech', 'companionChatProvider', 'aiGateway',
      'maviModelOrchestrator', '@capacitor', 'fetch(', 'XMLHttpRequest',
    ];
    for (const token of forbidden) {
      expect(code, `yasaklı bağımlılık KOD içinde bulundu: ${token}`).not.toContain(token);
    }

    // `getDeviceTier` yalnız YORUM/DOKÜMANTASYONDA geçebilir — KOD içinde FONKSİYON ÇAĞRISI YASAK.
    expect(code, 'getDeviceTier() ÇAĞRILMAMALI — tier dışarıdan gelir').not.toMatch(/getDeviceTier\s*\(/);

    // Tek izin verilen değer-import'u YOK denecek kadar az: yalnız type-only DeviceTier
    // (import satırları yoruma bağlı olmadığı için TAM dosyadan taranır).
    const importLines = full.split('\n').filter((l) => l.trim().startsWith('import '));
    expect(importLines.length).toBe(1);
    expect(importLines[0]).toMatch(/^import type \{ DeviceTier \} from '\.\.\/\.\.\/deviceCapabilities';$/);
  });

  it('saf fonksiyon: Date.now/Math.random/setTimeout/localStorage KOD içinde KULLANMAZ', async () => {
    const code = stripComments(await readEligibilitySource());
    for (const token of ['Date.now', 'Math.random', 'setTimeout', 'setInterval', 'localStorage', 'sessionStorage', 'await ', 'async ']) {
      expect(code, `saflık ihlali: ${token}`).not.toContain(token);
    }
  });

  it('modül seviyesinde mutable state YOK (yalnız `const`/`function`/`interface`/`type` — `let` YOK)', async () => {
    const code = stripComments(await readEligibilitySource());
    expect(code, 'modül seviyesinde `let` bulunmamalı (mutable global state)').not.toMatch(/^let\s/m);
  });
});
