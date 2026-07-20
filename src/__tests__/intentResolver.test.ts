/**
 * intentResolver.test.ts — MAVİ 4.0 · DRIVE-3 · deterministik niyet çözücü sözleşmesi.
 *
 * KİLİTLENEN KURALLAR:
 *  - Intent + Entity + Confidence: doğal dil → katalog eylem kimliği (LLM YOK, offline, deterministik).
 *  - Alias sistemi: Türkçe-normalize + ek-toleranslı token eşleşmesi (regex çöplüğü/keyword tablosu yok).
 *  - Fail-closed: eşik altı → UNKNOWN (no_match); yakın çekişme → UNKNOWN (ambiguous). ASLA tahmin etme.
 *  - Entity çıkarımı deterministik + uydurma yok; zorunlu eksik → missingRequired.
 *  - Case-insensitive + Türkçe karakter + performans.
 */

import { describe, it, expect } from 'vitest';
import {
  createIntentResolver, MaviIntentResolver, normalizeUtterance,
  DRIVE_INTENT_CATALOG, UNKNOWN_INTENT,
  type IntentDefinition,
} from '../platform/maviCore/intentResolver';
import { PILOT_THEMES } from '../platform/maviCore/actionRegistry';

const resolver = createIntentResolver();

/* ── Task örnekleri (bire-bir) ─────────────────────────────────── */

describe('task örnekleri', () => {
  const CASES: ReadonlyArray<readonly [string, string, string]> = [
    ['Ana sayfayı aç', 'open.home', 'open.home'],
    ['Ayarları aç', 'open.settings', 'open.settings'],
    ['Geri dön', 'go.back', 'go.back'],
    ['Bildirimleri kapat', 'dismiss.toast', 'dismiss.toast'],
    ['Cihazı yenile', 'refresh.device', 'refresh.device'],
    ['Araç sağlığını göster', 'open.vehicle_health', 'vehicle.health.read'],
  ];

  for (const [utterance, intent, actionId] of CASES) {
    it(`"${utterance}" → ${intent} (${actionId})`, () => {
      const r = resolver.resolve(utterance);
      expect(r.intent).toBe(intent);
      expect(r.actionId).toBe(actionId);
      expect(r.reason).toBe('matched');
      expect(r.confidence).toBeGreaterThanOrEqual(0.8);
      expect(r.confidence).toBeLessThanOrEqual(1);
    });
  }
});

/* ── Katalog bütünlüğü ─────────────────────────────────────────── */

describe('intent katalogu', () => {
  it('her niyet actionId + requiredEntities + optionalEntities + description + alias taşır', () => {
    for (const def of DRIVE_INTENT_CATALOG) {
      expect(typeof def.intent).toBe('string');
      expect(def.intent.length).toBeGreaterThan(0);
      expect(typeof def.actionId).toBe('string');
      expect(def.actionId.length).toBeGreaterThan(0);
      expect(Array.isArray(def.requiredEntities)).toBe(true);
      expect(Array.isArray(def.optionalEntities)).toBe(true);
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.aliases.length).toBeGreaterThan(0);
    }
  });

  it('niyet kimlikleri benzersiz', () => {
    const ids = DRIVE_INTENT_CATALOG.map((d) => d.intent);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolver.intents() katalogla aynı sırada döner', () => {
    expect(resolver.intents()).toEqual(DRIVE_INTENT_CATALOG.map((d) => d.intent));
  });

  it('çift niyet tanımı kurulum-zamanı Error verir (fail-closed)', () => {
    const dup = [...DRIVE_INTENT_CATALOG, DRIVE_INTENT_CATALOG[0]];
    expect(() => new MaviIntentResolver(dup)).toThrow(/çift niyet/);
  });
});

/* ── Alias sistemi (ek-tolerans + eşanlam) ─────────────────────── */

describe('alias sistemi', () => {
  it('Türkçe ekleri tolere eder (gövde=önek): "ayarları"→ayarlar, "sayfayı"→sayfa', () => {
    expect(resolver.resolve('ayarları aç').intent).toBe('open.settings');
    expect(resolver.resolve('ana sayfayı göster').intent).toBe('open.home');
  });

  it('aynı niyete birden çok eşanlam çözülür', () => {
    for (const u of ['müzik aç', 'müzik çalar', 'çalar ekranı']) {
      expect(resolver.resolve(u).intent).toBe('open.music');
    }
  });

  it('fazladan gürültü sözcüğü niyeti bozmaz (skor düşer ama eşleşir)', () => {
    const r = resolver.resolve('lütfen ayarları aç bakalım');
    expect(r.intent).toBe('open.settings');
    expect(r.confidence).toBeGreaterThan(0.5);
  });
});

/* ── Entity çıkarımı (deterministik, uydurma yok) ─────────────── */

describe('entity çıkarımı', () => {
  it('tema entity: "gece moduna geç" → set.theme, theme=night', () => {
    const r = resolver.resolve('gece moduna geç');
    expect(r.intent).toBe('set.theme');
    expect(r.entities.theme).toBe('night');
    expect(PILOT_THEMES).toContain(r.entities.theme);
    expect(r.missingRequired).toEqual([]);
  });

  it('sayısal entity 0..100: "parlaklığı 40 yap" → set.brightness, value=40', () => {
    const r = resolver.resolve('parlaklığı 40 yap');
    expect(r.intent).toBe('set.brightness');
    expect(r.entities.value).toBe(40);
  });

  it('ses seviyesi: "sesi 75 yap" → set.volume, value=75', () => {
    const r = resolver.resolve('sesi 75 yap');
    expect(r.intent).toBe('set.volume');
    expect(r.entities.value).toBe(75);
  });

  it('zorunlu entity yoksa missingRequired dolar, uydurma değer üretilmez', () => {
    const r = resolver.resolve('temayı değiştir');
    expect(r.intent).toBe('set.theme');
    expect(r.entities.theme).toBeUndefined();
    expect(r.missingRequired).toContain('theme');
  });

  it('aralık dışı sayı entity kabul edilmez (0..100)', () => {
    const r = resolver.resolve('parlaklığı 250 yap');
    expect(r.intent).toBe('set.brightness');
    expect(r.entities.value).toBeUndefined();
    expect(r.missingRequired).toContain('value');
  });

  it('opsiyonel destination: "eve git" → navigation.open, destination=eve', () => {
    const r = resolver.resolve('eve git');
    expect(r.intent).toBe('navigation.open');
    expect(r.entities.destination).toBe('eve');
    expect(r.missingRequired).toEqual([]); // destination opsiyonel
  });
});

/* ── Unknown (no_match) ────────────────────────────────────────── */

describe('unknown intent', () => {
  it('katalog dışı cümle → UNKNOWN_INTENT + actionId null (fail-closed)', () => {
    const r = resolver.resolve('bugün hava nasıl olacak');
    expect(r.intent).toBe(UNKNOWN_INTENT);
    expect(r.actionId).toBeNull();
    expect(r.reason).toBe('no_match');
  });

  it('boş/whitespace girdi → UNKNOWN (empty)', () => {
    expect(resolver.resolve('').reason).toBe('empty');
    expect(resolver.resolve('   ').reason).toBe('empty');
    expect(resolver.resolve('').intent).toBe(UNKNOWN_INTENT);
  });

  it('anlamsız gürültü → UNKNOWN, hiçbir eylem sızmaz', () => {
    const r = resolver.resolve('qwerty zxcvb');
    expect(r.actionId).toBeNull();
  });
});

/* ── Ambiguous (yakın çekişme → tahmin etme) ──────────────────── */

describe('ambiguous', () => {
  it('yalın "aç" birçok "... aç" niyetiyle çekişir → UNKNOWN (ambiguous), tahmin YOK', () => {
    const r = resolver.resolve('aç');
    expect(r.intent).toBe(UNKNOWN_INTENT);
    expect(r.reason).toBe('ambiguous');
    expect(r.actionId).toBeNull();
    expect(r.alternatives.length).toBeGreaterThanOrEqual(2); // çekişen adaylar tanıda görünür
  });

  it('ambiguityMargin=0 çekişmeyi kapatır (deterministik en iyi seçilir)', () => {
    const strict = createIntentResolver(DRIVE_INTENT_CATALOG, { ambiguityMargin: 0 });
    const r = strict.resolve('aç');
    // Marj 0 → beraberlik ambiguous saymaz; katalog sırasında ilk gelen deterministik seçilir.
    expect(r.reason).toBe('matched');
  });
});

/* ── Case-insensitive + Türkçe karakter ───────────────────────── */

describe('case-insensitive + türkçe karakter', () => {
  it('büyük/küçük harf farkı sonucu değiştirmez', () => {
    expect(resolver.resolve('AYARLARI AÇ').intent).toBe('open.settings');
    expect(resolver.resolve('AyArLaRı Aç').intent).toBe('open.settings');
  });

  it('İ/I ve aksanlı harfler normalize edilir', () => {
    expect(normalizeUtterance('İSTASYON Ağ ÇÖZ')).toBe('istasyon ag coz');
    expect(resolver.resolve('CİHAZI YENİLE').intent).toBe('refresh.device');
  });

  it('normalizeUtterance non-string → boş string (savunmacı)', () => {
    // @ts-expect-error kasıtlı yanlış tip
    expect(normalizeUtterance(undefined)).toBe('');
  });
});

/* ── Performans (deterministik, hızlı) ────────────────────────── */

describe('performans', () => {
  it('5000 çözüm makul sürede biter (offline · saf)', () => {
    const samples = ['ayarları aç', 'geri dön', 'gece moduna geç', 'sesi 30 yap', 'bugün hava nasıl'];
    const t0 = Date.now();
    for (let i = 0; i < 5000; i++) resolver.resolve(samples[i % samples.length]);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('aynı girdi → aynı çıktı (deterministik)', () => {
    const a = resolver.resolve('araç sağlığını göster');
    const b = resolver.resolve('araç sağlığını göster');
    expect(a).toEqual(b);
  });
});

/* ── Özel katalog + eşik ayarı ────────────────────────────────── */

describe('yapılandırma', () => {
  it('özel katalogla çalışır (varsayılana bağlı değil)', () => {
    const custom: IntentDefinition[] = [{
      intent: 'test.ping', actionId: 'diag.ping',
      requiredEntities: [], optionalEntities: [], description: 'ping',
      aliases: ['ping at', 'test et'],
    }];
    const r = createIntentResolver(custom).resolve('ping at');
    expect(r.intent).toBe('test.ping');
    expect(r.actionId).toBe('diag.ping');
  });

  it('yüksek acceptThreshold zayıf eşleşmeyi reddeder', () => {
    const strict = createIntentResolver(DRIVE_INTENT_CATALOG, { acceptThreshold: 0.99 });
    const r = strict.resolve('lütfen ayarları aç bakalım'); // gürültülü → skor < 0.99
    expect(r.reason).toBe('no_match');
  });
});
