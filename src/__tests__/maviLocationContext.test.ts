/**
 * maviLocationContext.test.ts — Mavi "neredeyiz?" bağlamı kilitleri.
 *
 * KİLİTLENEN KUSUR: "Mavi, neredeyiz?" → "Haritayı açıyorum, konumunu
 * görebilirsin." Zincir (`query.current_location` → `location.current.read` →
 * `readCurrentLocation` → reverse geocode) BAŞTAN SONA MEVCUTTU; kusur
 * Mavi'nin sistem promptunda KONUM SATIRININ HİÇ OLMAMASIYDI → model
 * bilmediği için savuşturuyordu (halüsinasyon değil, BAĞLAM AÇLIĞI).
 *
 * Bu dosya iki şeyi kilitler:
 *   1. Saf bağlam modelinin karar tablosu (GPS / DR / UNKNOWN).
 *   2. Yapısal sözleşme: ikinci konum sahibi YOK, ham koordinat SIZMIYOR,
 *      tool loop GLOBAL AÇILMADI, Trip PR bağlantısı BOZULMADI.
 */

import { describe, it, expect } from 'vitest';
import {
  buildLocationContext, formatLocationContextLine,
  UNAVAILABLE_LOCATION_CONTEXT, ACCURACY_GOOD_M,
  type LocationContextInput, type LocationPlaceParts,
} from '../platform/location/locationContextModel';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf-8');
const modelSrc    = read('src/platform/location/locationContextModel.ts');
const serviceSrc  = read('src/platform/location/locationContextService.ts');
const accessSrc   = read('src/platform/location/locationContextAccess.ts');
const providerSrc = read('src/platform/companion/companionChatProvider.ts');
const resolverSrc = read('src/platform/maviCore/intentResolver.ts');
const handlerSrc  = read('src/platform/maviCore/wiring/maviPilotHandlers.ts');

const KONYA: LocationPlaceParts = { road: 'D330', district: 'Meram', city: 'Konya' };

function input(over: Partial<LocationContextInput> = {}): LocationContextInput {
  return {
    fixClass: 'usable', ageMs: 1_000, accuracyM: 8,
    place: KONYA, dr: null,
    ...over,
  };
}

/* ══════════════ 1) KARAR TABLOSU ══════════════ */

describe('Konum bağlamı — GPS', () => {
  it('TAZE + iyi doğruluk → GPS · high · tahmin DEĞİL', () => {
    const c = buildLocationContext(input());
    expect(c.availability).toBe('available');
    expect(c.source).toBe('GPS');
    expect(c.confidence).toBe('high');
    expect(c.estimated).toBe(false);
    expect(c.city).toBe('Konya');
    expect(c.district).toBe('Meram');
    expect(c.road).toBe('D330');
  });

  it('Doğruluk KÖTÜ ise güven yükseltilmez', () => {
    const c = buildLocationContext(input({ accuracyM: ACCURACY_GOOD_M + 1 }));
    expect(c.confidence).toBe('medium');
    expect(c.source).toBe('GPS');
  });

  it('Doğruluk BİLİNMİYORSA "iyi" sayılmaz', () => {
    // Ölçülmeyen kalite iyi varsayılamaz — sahte güven üretmek yasak.
    expect(buildLocationContext(input({ accuracyM: null })).confidence).toBe('medium');
  });

  it('ESKİMİŞ fix (aging) + DR yok → GPS · medium · tahmin DEĞİL', () => {
    const c = buildLocationContext(input({ fixClass: 'aging', ageMs: 120_000 }));
    expect(c.availability).toBe('available');
    expect(c.source).toBe('GPS');
    expect(c.confidence).toBe('medium');
    expect(c.estimated).toBe(false);
  });
});

describe('Konum bağlamı — ÖLÜ HESAPLAMA (tahmini)', () => {
  it('ESKİMİŞ fix + DR sürüyor → DEAD_RECKONING · estimated=true', () => {
    const c = buildLocationContext(input({
      fixClass: 'aging', dr: { active: true, confidence: 0.8 },
    }));
    expect(c.source).toBe('DEAD_RECKONING');
    expect(c.estimated).toBe(true);
    expect(c.confidence).toBe('medium');
  });

  it('ÇOK ESKİ fix + DR sürüyor → tahmini konum SUNULABİLİR', () => {
    const c = buildLocationContext(input({
      fixClass: 'expired', dr: { active: true, confidence: 0.5 },
    }));
    expect(c.availability).toBe('available');
    expect(c.source).toBe('DEAD_RECKONING');
    expect(c.estimated).toBe(true);
  });

  it('🔒 ÇOK ESKİ fix + DR YOK → UNAVAILABLE (bayat koordinat "kesin konum" SUNULMAZ)', () => {
    const c = buildLocationContext(input({ fixClass: 'expired', dr: null }));
    expect(c).toEqual(UNAVAILABLE_LOCATION_CONTEXT);
  });

  it('DR güveni 0 ise TAHMİN DAYANAKSIZDIR → kullanılmaz', () => {
    // güven 0 = ilerleme durdu (PR-451a sözleşmesi).
    const c = buildLocationContext(input({
      fixClass: 'expired', dr: { active: true, confidence: 0 },
    }));
    expect(c.availability).toBe('unavailable');
  });

  it('DR bayrağı false ise tahmin üretilmez', () => {
    const c = buildLocationContext(input({
      fixClass: 'expired', dr: { active: false, confidence: 0.9 },
    }));
    expect(c.availability).toBe('unavailable');
  });
});

describe('Konum bağlamı — KONUM YOK (uydurma YASAK)', () => {
  it('Fix yok → UNAVAILABLE', () => {
    expect(buildLocationContext(input({ fixClass: 'no_fix' })).availability).toBe('unavailable');
  });

  it('Geçersiz koordinat → UNAVAILABLE', () => {
    expect(buildLocationContext(input({ fixClass: 'invalid' })).availability).toBe('unavailable');
  });

  it('🔒 Adres HİÇ çözülemediyse konum SÖYLENMEZ (koordinat dile taşınmaz)', () => {
    const c = buildLocationContext(input({ place: null }));
    expect(c.availability).toBe('unavailable');
    expect(c.source).toBe('UNKNOWN');
  });

  it('Tüm alanları boş adres kanıt SAYILMAZ', () => {
    const c = buildLocationContext(input({ place: { road: '', district: '  ', city: null } }));
    expect(c.availability).toBe('unavailable');
  });

  it('Bozuk girdi UNAVAILABLE üretir (throw etmez)', () => {
    expect(buildLocationContext(null as unknown as LocationContextInput).availability)
      .toBe('unavailable');
  });
});

/* ══════════════ 2) CÜMLE ══════════════ */

describe('Konum cümlesi — dürüstlük ve gizlilik', () => {
  it('GPS güvenli → yer adıyla net cümle', () => {
    const line = formatLocationContextLine(buildLocationContext(input()));
    expect(line).toContain('Konya');
    expect(line).toContain('Meram');
    expect(line).toContain('D330');
    expect(line).not.toContain('yaklaşık');
  });

  it('Tahmini konum cümlede AÇIKÇA tahmin denir', () => {
    const line = formatLocationContextLine(buildLocationContext(input({
      fixClass: 'aging', dr: { active: true, confidence: 0.7 },
    })));
    expect(line).toMatch(/TAHMİNİ/);
    expect(line).toMatch(/ölü hesaplama|GPS zayıf/);
  });

  it('Düşük güvende cümle KESİN konuşmaz', () => {
    const line = formatLocationContextLine(buildLocationContext(input({ accuracyM: 500 })));
    expect(line).toContain('yaklaşık');
  });

  it('Konum yoksa satır ÜRETİLMEZ (null)', () => {
    expect(formatLocationContextLine(UNAVAILABLE_LOCATION_CONTEXT)).toBeNull();
    expect(formatLocationContextLine(null)).toBeNull();
  });

  it('🔒 HAM KOORDİNAT cümleye SIZMAZ', () => {
    for (const c of [
      buildLocationContext(input()),
      buildLocationContext(input({ fixClass: 'aging', dr: { active: true, confidence: 0.6 } })),
    ]) {
      const line = formatLocationContextLine(c) ?? '';
      // Ondalıklı koordinat deseni (37.00415 gibi) HİÇ görünmemeli.
      expect(line, `koordinat sızmış: ${line}`).not.toMatch(/-?\d{1,3}\.\d{3,}/);
      expect(line).not.toMatch(/enlem|boylam|lat|lon/i);
    }
  });

  it('🔒 Bağlam tipinde koordinat ALANI YOKTUR (yapısal gizlilik)', () => {
    const c = buildLocationContext(input()) as unknown as Record<string, unknown>;
    for (const k of ['lat', 'lon', 'latitude', 'longitude', 'coords']) {
      expect(Object.prototype.hasOwnProperty.call(c, k), `${k} alanı eklenmiş`).toBe(false);
    }
  });

  it('Şehir ve ilçe AYNIYSA tekrarlanmaz', () => {
    const line = formatLocationContextLine(buildLocationContext(input({
      place: { road: null, district: 'Konya', city: 'Konya' },
    })));
    expect(line).toBe('Konum: Konya.');
  });

  it('Yalnız yol biliniyorsa yine cevap üretilir', () => {
    const line = formatLocationContextLine(buildLocationContext(input({
      place: { road: 'D330', district: null, city: null },
    })));
    expect(line).toContain('D330');
  });
});

/* ══════════════ 3) YAPISAL KİLİTLER ══════════════ */

describe('🔒 YAPISAL — mevcut zincir yeniden kullanıldı, ikinci sahip doğmadı', () => {
  it('Saf model HİÇBİR ŞEY import etmez (I/O · timer · saat · fetch yok)', () => {
    const code = modelSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(code, 'saf model dışarıya bağımlı hâle gelmiş').not.toMatch(/^\s*import\s/m);
    expect(code).not.toMatch(/fetch\(|setInterval|setTimeout|Date\.now\(|performance\.now\(/);
  });

  it('İKİNCİ GPS OKUYUCU yok — tek sahip `gpsService.getGPSState`', () => {
    expect(serviceSrc).toContain('getGPSState()');
    expect(serviceSrc, 'yeni GPS aboneliği/watch açılmış')
      .not.toMatch(/watchPosition|getCurrentPosition|onGPSLocation|navigator\.geolocation/);
  });

  it('YENİ REVERSE-GEOCODE SERVİSİ yok — mevcut modül yeniden kullanılıyor', () => {
    expect(serviceSrc).toContain("import('../geocodingService')");
    expect(serviceSrc, 'servis kendi ağ çağrısını yapıyor').not.toMatch(/fetch\(|nominatim/i);
  });

  it('Mevcut SAF ÇEKİRDEK yeniden kullanıldı (sınıflandırma kopyalanmadı)', () => {
    expect(serviceSrc).toContain('classifyLocationFix');
    expect(modelSrc, 'sınıflandırma saf modelde yeniden yazılmış')
      .not.toMatch(/LOCATION_EXPIRY_MS|LOCATION_FRESH_MS/);
  });

  it('DR SALT-OKUNUR — PR-451a mimarisine yazım YOK', () => {
    expect(serviceSrc).toContain('getNavigationSessionRuntimeSnapshot');
    expect(serviceSrc, 'DR mimarisine yazım eklenmiş')
      .not.toMatch(/startNavigationSessionRuntime|_resetNavigationSessionRuntime|projectDeadReckon|advanceAlongRoute/);
  });

  it('Konum katmanı YENİ ZAMANLAYICI kurmaz', () => {
    expect(serviceSrc).not.toMatch(/setInterval\(|requestAnimationFrame\(/);
  });

  it('Konum katmanı HİÇBİR ŞEY YAZMAZ (salt okuma)', () => {
    expect(serviceSrc).not.toMatch(/safeSetRaw|localStorage\.setItem|updateSettings|\.setState\(/);
  });

  it('İnce kapının ÇALIŞMA ZAMANI bağımlılığı YOK', () => {
    const runtimeImports = accessSrc.match(/^\s*import\s+(?!type\s)/gm) ?? [];
    expect(runtimeImports.length, 'erişim kapısına çalışma zamanı importu girmiş').toBe(0);
  });

  it('🔒 TOOL LOOP / ORCHESTRATOR GLOBAL AÇILMADI', () => {
    // Bayrak varsayılanı KAPALI kalmalı; bu PR onu çevirmemeli.
    const flagSrc = read('src/platform/ai/gateway/aiGatewayFlag.ts');
    expect(flagSrc).toContain("localStorage.getItem(AI_ORCHESTRATOR_LOCAL_FLAG) === 'true'");
    expect(providerSrc, 'sağlayıcı orchestrator bayrağını zorluyor')
      .not.toMatch(/setMaviOrchestratorEnabled\(true\)/);
    expect(serviceSrc).not.toMatch(/OrchestratorEnabled|runToolLoop|MAVI_TOOLS/);
  });

  it('🔒 Mevcut `query.current_location` alias\'ları KORUNDU', () => {
    for (const alias of ['neredeyim', 'neredeyiz', 'konumum ne', 'bulunduğumuz yer neresi']) {
      expect(resolverSrc, `alias kaybolmuş: ${alias}`).toContain(`'${alias}'`);
    }
    expect(resolverSrc).toContain("intent: 'query.current_location', actionId: 'location.current.read'");
  });

  it('🔒 Mevcut `location.current.read` handler davranışı KORUNDU', () => {
    expect(handlerSrc).toContain("'location.current.read':");
    expect(handlerSrc).toContain('deps.readCurrentLocation()');
    // Gölge handler GERÇEK konum okumamaya devam etmeli (PII sözleşmesi).
    expect(handlerSrc).toContain("'location.current.read': () => ({ ok: true, value: { ok: false, text: 'gölge' } })");
  });

  it('🔒 TRIP PR bağlantısı BOZULMADI', () => {
    expect(providerSrc).toContain('readTripSessionOrNull()');
    expect(providerSrc).toContain('interpretTripSession(');
    // Konum satırı trip satırının YERİNE geçmemeli — ikisi de bağlamda.
    expect(providerSrc).toContain('formatLocationContextLine(readLocationContextOrNull())');
  });

  it('🔒 Sağlayıcıya SAHTE konum yedeği eklenmedi', () => {
    const block = providerSrc.slice(
      providerSrc.indexOf('(1b) KONUM'),
      providerSrc.indexOf('(2) Yolculuk süresi'),
    );
    expect(block).not.toMatch(/'Konya'|varsayılan|default.*konum|lastKnown/i);
    expect(block).toContain('readLocationContextOrNull()');
  });
});
