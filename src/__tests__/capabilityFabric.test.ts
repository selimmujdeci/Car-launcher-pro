/**
 * capabilityFabric.test.ts — MAVİ F5 KİLİTLERİ.
 *
 * Bu testler F5'in SÖZLEŞMESİNİ kilitler:
 *  · katalog TEK KAYNAKTIR (prompt listesi elle yazılmaz),
 *  · tipli doğrulama olmadan hiçbir öneri capability yolundan geçemez,
 *  · availability ≠ permission ≠ authority (üç eksen AYRI),
 *  · gözlem seviyesi "yaptım" iddiasının TEK kaynağıdır,
 *  · fabric HİÇBİR ŞEY YÜRÜTMEZ ve ikinci gerçeklik kaynağı KURMAZ,
 *  · F0–F4 invariant'ları BOZULMAZ.
 *
 * Bu kilitleri ZAYIFLATMA/SİLME (CLAUDE.md Regresyon Kasası).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  CAROS_CAPABILITY_CATALOG, brainExposedIntents, findByLegacyIntent, catalogCapabilityIds,
  POI_CATEGORIES,
} from '../platform/capability/fabric/carosCapabilityCatalog';
import {
  resolveCapabilityAction, inspectCatalogIntegrity, findOperation,
} from '../platform/capability/fabric/capabilityResolver';
import {
  evaluateCapabilityRequest, evaluateLegacyIntent, requestFromLegacyIntent,
  readAvailability, classifyObservation, getCapabilityFabricDiagnostics,
  setCapabilityFabricEnforceRemoteFlag, _resetCapabilityFabricForTest,
} from '../platform/capability/fabric/capabilityFabric';
import { isSuccessObservation } from '../platform/capability/fabric/capabilityContract';
import type {
  CapabilityActionRequest, CapabilityOperationDef,
} from '../platform/capability/fabric/capabilityContract';
import {
  projectCapabilities, detectDomains, renderProjectionLines,
} from '../platform/capability/fabric/capabilityProjection';
import { capabilityRegistry } from '../platform/capability/capabilityRegistry';
import { buildCapabilityFabricView } from '../platform/devtools/capabilityFabricModel';

const src = (rel: string): string => readFileSync(join(process.cwd(), 'src', rel), 'utf8');
const codeOf = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

const req = (p: Partial<CapabilityActionRequest>): CapabilityActionRequest => ({
  capabilityId: 'navigation.route',
  operation: 'start',
  parameters: {},
  confidence: 0.9,
  provenance: 'llm_proposal',
  confirmationState: 'not_required',
  ...p,
});

beforeEach(() => {
  _resetCapabilityFabricForTest();
  capabilityRegistry.reset();
});
afterEach(() => {
  _resetCapabilityFabricForTest();
  capabilityRegistry.reset();
});

/* ══════════════════════════════════════════════════════════════════════════
 * A — Katalog ve keşif (discovery)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F5 · A · katalog ve keşif', () => {
  it('1. katalog BÜTÜNDÜR: duplicate işlem/intent YOK, boş enum YOK', () => {
    const r = inspectCatalogIntegrity();
    expect(r.duplicateOperations, 'aynı capability#operation iki kez tanımlı').toEqual([]);
    expect(r.duplicateLegacyIntents, 'aynı intent iki işleme köprülenmiş').toEqual([]);
    expect(r.emptyEnums, '`values` olmayan enum fail-closed → hiçbir değer geçemez').toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('2. **DUPLICATE capability kimliği REDDEDİLİR** (sessiz yetki kayması yasağı)', () => {
    const dup: readonly CapabilityOperationDef[] = [
      ...CAROS_CAPABILITY_CATALOG,
      { ...CAROS_CAPABILITY_CATALOG[0] },          // aynı capabilityId#operation
    ];
    const r = inspectCatalogIntegrity(dup);
    expect(r.ok).toBe(false);
    expect(r.duplicateOperations.length).toBeGreaterThan(0);
    expect(r.duplicateLegacyIntents.length).toBeGreaterThan(0);
  });

  it('3. her işlem kanonik yürütücüye KÖPRÜLÜDÜR (yeni yürütücü yok)', () => {
    for (const d of CAROS_CAPABILITY_CATALOG) {
      expect(d.legacyIntent, `${d.capabilityId}#${d.operation} köprüsüz`).not.toBeNull();
      expect(findByLegacyIntent(d.legacyIntent as string)).toBe(d);
    }
  });

  it('4. keşif: capability kimlikleri ve alan kapsaması gerçek CarOS alanlarını kapsar', () => {
    const ids = catalogCapabilityIds();
    expect(ids.length).toBeGreaterThanOrEqual(10);
    const domains = new Set(CAROS_CAPABILITY_CATALOG.map((d) => d.domain));
    for (const expected of ['navigation', 'media', 'settings', 'vehicle', 'diagnostics', 'phone', 'surface']) {
      expect(domains.has(expected as never), `alan eksik: ${expected}`).toBe(true);
    }
  });

  it('5. POI kategorileri `semanticAiService.PoiCategory` ile AYNI kümedir (kopya kaymasın)', () => {
    const s = src('platform/ai/semanticAiService.ts');
    const block = s.slice(s.indexOf('export type PoiCategory'), s.indexOf("| 'GENERAL';") + 14);
    const inService = new Set((block.match(/'([A-Z_]+)'/g) ?? []).map((x) => x.replace(/'/g, '')));
    expect(new Set(POI_CATEGORIES)).toEqual(inService);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * B — Tipli doğrulama
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F5 · B · tipli parametre doğrulaması', () => {
  it('6. geçerli istek ÇÖZÜLÜR ve parametreler daraltılır', () => {
    const r = resolveCapabilityAction(req({
      capabilityId: 'navigation.poi', operation: 'search',
      parameters: { query: '  benzinlik  ', category: 'gas_station' },
    }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.args.query).toBe('benzinlik');            // trim edildi
    expect(r.args.category).toBe('GAS_STATION');       // enum ALLOWLIST'ten normalize
    expect(r.route).toBe('CAPABILITY');
  });

  it('7. **ZORUNLU parametre EKSİKSE çözülmez** (fail-closed)', () => {
    const r = resolveCapabilityAction(req({
      capabilityId: 'surface.app', operation: 'open', parameters: {},
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failure).toBe('INVALID_ARGUMENT');
    expect(r.reason).toBe('appName:missing');
  });

  it('7b. **KATALOG YÜRÜTÜCÜ GERÇEĞİNİ AYNALAR** — tolere edilen alan ZORUNLU değildir', () => {
    /* Kanonik yürütücü bu üç durumda da sorunsuz çalışır (adres yoksa haritayı
       açar · terim yoksa "yakın yer" arar · sorgu yoksa müzik çaları açar).
       Katalog bunları zorunlu işaretleseydi ZORLAYICI kipte ÇALIŞAN komutlar
       ölürdü — katalog idealize sözleşme değil, GERÇEK sözleşmedir. */
    for (const [capabilityId, operation] of [
      ['navigation.route', 'startAddress'],
      ['navigation.poi', 'search'],
      ['media.playback', 'searchAndPlay'],
    ] as const) {
      const r = resolveCapabilityAction(req({ capabilityId, operation, parameters: {} }));
      expect(r.ok, `${capabilityId}#${operation} boş parametreyle düşmemeliydi`).toBe(true);
    }
  });

  it('7c. TAKMA AD: yürütücünün sessiz yedeği köprüde AYNALANIR', () => {
    /* `fromSemanticResult`: `appName ?? query` · `screen ?? query` ·
       `sensorQuery ?? query`. Köprü bunu bilmezse kapı, yürütücünün sorunsuz
       çalıştıracağı öneriyi INVALID_ARGUMENT sayardı. */
    expect(requestFromLegacyIntent('OPEN_APP', { query: 'radyo' }, 0.9)?.parameters)
      .toEqual({ appName: 'radyo' });
    expect(requestFromLegacyIntent('OPEN_SCREEN', { query: 'trafik' }, 0.9)?.parameters)
      .toEqual({ screen: 'trafik' });
    expect(requestFromLegacyIntent('QUERY_SENSOR', { query: 'yağ sıcaklığı' }, 0.9)?.parameters)
      .toEqual({ sensorQuery: 'yağ sıcaklığı' });
    // Asıl alan VARSA takma ad KULLANILMAZ.
    expect(requestFromLegacyIntent('OPEN_APP', { appName: 'kamera', query: 'radyo' }, 0.9)?.parameters)
      .toEqual({ appName: 'kamera' });
  });

  it('8. enum ALLOWLIST dışı değer REDDEDİLİR', () => {
    const r = resolveCapabilityAction(req({
      capabilityId: 'navigation.poi', operation: 'search',
      parameters: { query: 'x', category: 'NUCLEAR_PLANT' },
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failure).toBe('INVALID_ARGUMENT');
  });

  it('9. **ŞEMADA OLMAYAN alan SESSİZCE GEÇMEZ** (LLM uydurması sızamaz)', () => {
    const r = resolveCapabilityAction(req({
      capabilityId: 'media.playback', operation: 'pause',
      parameters: { deleteAllData: true },
    }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toBe('deleteAllData:unknown_param');
  });

  it('10. tip uyuşmazlığı ve uzunluk tavanı REDDEDİLİR', () => {
    const wrongType = resolveCapabilityAction(req({
      capabilityId: 'navigation.poi', operation: 'search', parameters: { query: 42 },
    }));
    expect(wrongType.ok).toBe(false);
    const tooLong = resolveCapabilityAction(req({
      capabilityId: 'navigation.poi', operation: 'search', parameters: { query: 'a'.repeat(500) },
    }));
    expect(tooLong.ok).toBe(false);
  });

  it('11. güven (confidence) sınırları dışında istek REDDEDİLİR', () => {
    for (const c of [-0.1, 1.4, Number.NaN]) {
      const r = resolveCapabilityAction(req({ confidence: c }));
      expect(r.ok, `confidence=${c} geçmemeliydi`).toBe(false);
    }
  });

  it('12. katalog dışı capability → CAPABILITY_NOT_FOUND ve LEGACY yönlendirmesi', () => {
    const r = resolveCapabilityAction(req({ capabilityId: 'vehicle.launchRocket', operation: 'go' }));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failure).toBe('CAPABILITY_NOT_FOUND');
    expect(r.route).toBe('LEGACY_FALLBACK');           // eski yol KAPANMAZ
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * C — Kapı: availability ≠ permission ≠ authority
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F5 · C · kapı kararı', () => {
  it('13. GEÇERLİ istek kapıdan geçer ve rota CAPABILITY olur', () => {
    setCapabilityFabricEnforceRemoteFlag(true);
    const d = evaluateCapabilityRequest(req({
      capabilityId: 'media.playback', operation: 'pause',
    }));
    expect(d.allow).toBe(true);
    expect(d.route).toBe('CAPABILITY');
    expect(d.failure).toBeNull();
    expect(getCapabilityFabricDiagnostics().capabilityRoutes).toBe(1);
  });

  it('14. **GEÇERSİZ ARGÜMAN zorlayıcı kipte YÜRÜTÜLMEZ**', () => {
    setCapabilityFabricEnforceRemoteFlag(true);
    const d = evaluateCapabilityRequest(req({
      capabilityId: 'surface.app', operation: 'open', parameters: {},
    }));
    expect(d.allow).toBe(false);
    expect(d.failure).toBe('INVALID_ARGUMENT');
  });

  it('15. **UNAVAILABLE capability zorlayıcı kipte YÜRÜTÜLMEZ** (registry KANITLI olumsuz)', () => {
    capabilityRegistry.resolveCapability('vehicle.obd', {
      source: 'obd', available: false, confidence: 0.95, quality: 'high',
    }, 'vehicle');
    capabilityRegistry.resolveCapability('vehicle.live_pid', {
      source: 'obd', available: false, confidence: 0.95, quality: 'high',
    }, 'vehicle');
    setCapabilityFabricEnforceRemoteFlag(true);
    const d = evaluateCapabilityRequest(req({
      capabilityId: 'vehicle.sensor', operation: 'query',
      parameters: { sensorQuery: 'motor suyu' },
    }));
    expect(d.availability).toBe('UNAVAILABLE');
    expect(d.failure).toBe('UNAVAILABLE');
    expect(d.allow).toBe(false);
  });

  it('16. **PERMISSION_DENIED: cihazda MEVCUT olsa bile Mavi öneremez** (üç eksen ayrı)', () => {
    capabilityRegistry.resolveCapability('vehicle.obd', {
      source: 'obd', available: true, confidence: 0.95, quality: 'high',
    }, 'vehicle');
    setCapabilityFabricEnforceRemoteFlag(true);
    const def = findByLegacyIntent('CLEAR_DTC_CODES');
    expect(def?.exposedToBrain, 'DTC silme beyne AÇIK olmamalı').toBe(false);
    const d = evaluateCapabilityRequest(req({
      capabilityId: 'diagnostics.dtc', operation: 'clear', provenance: 'llm_proposal',
    }));
    // availability POZİTİF olmasına rağmen izin REDDEDİLİR.
    expect(d.availability).toBe('AVAILABLE');
    expect(d.failure).toBe('PERMISSION_DENIED');
    expect(d.allow).toBe(false);
  });

  it('17. **BAYAT (stale) kanıt AVAILABLE saymaz** — UNKNOWN\'a düşer, yol KAPANMAZ', () => {
    capabilityRegistry.resolveCapability('vehicle.obd', {
      source: 'obd', available: true, confidence: 0.95, quality: 'high',
      observedAt: 1,                                   // çok eski → stale
    }, 'vehicle');
    setCapabilityFabricEnforceRemoteFlag(true);
    const def = findByLegacyIntent('CHECK_VEHICLE_HEALTH') as CapabilityOperationDef;
    expect(readAvailability(def)).not.toBe('AVAILABLE');
    const d = evaluateCapabilityRequest(req({ capabilityId: 'vehicle.health', operation: 'check' }));
    expect(d.availability).toBe('UNKNOWN');
    expect(d.allow, 'kanıt yokluğu yolu KAPATMAMALI (fail-closed regresyonu)').toBe(true);
  });

  it('18. kanıt İSTEMEYEN işlem UNKNOWN bildirir — sahte "AVAILABLE" ÜRETİLMEZ', () => {
    const def = findByLegacyIntent('OPEN_APP') as CapabilityOperationDef;
    expect(def.requiredCapabilities).toEqual([]);
    expect(readAvailability(def)).toBe('UNKNOWN');
  });

  it('19. **GÖLGE KİP (varsayılan) HİÇBİR EYLEMİ ENGELLEMEZ** ama kararı ÖLÇER', () => {
    const d = evaluateCapabilityRequest(req({
      capabilityId: 'surface.app', operation: 'open', parameters: {},
    }));
    expect(d.enforced).toBe(false);
    expect(d.wouldBlock, 'zorlayıcı olsaydı engellenirdi — ölçüm kaybolmamalı').toBe(true);
    expect(d.allow, 'gölge kipte davranış BUGÜNKÜYLE aynı olmalı').toBe(true);
  });

  it('20. LEGACY_FALLBACK: katalog dışı intent DAİMA geçer ve ayrı sayılır', () => {
    setCapabilityFabricEnforceRemoteFlag(true);
    const d = evaluateLegacyIntent('SHOW_WEATHER', {}, 0.9);
    expect(d.route).toBe('LEGACY_FALLBACK');
    expect(d.allow).toBe(true);
    const diag = getCapabilityFabricDiagnostics();
    expect(diag.legacyRoutes).toBe(1);
    expect(diag.capabilityRoutes).toBe(0);
  });

  it('21. kapsama oranı GERÇEK trafikten çıkar (capability tercih edilir)', () => {
    evaluateLegacyIntent('PAUSE_MEDIA', {}, 0.9);       // capability
    evaluateLegacyIntent('MEDIA_NEXT', {}, 0.9);        // capability
    evaluateLegacyIntent('SHOW_WEATHER', {}, 0.9);      // legacy
    const diag = getCapabilityFabricDiagnostics();
    expect(diag.capabilityRoutes).toBe(2);
    expect(diag.legacyRoutes).toBe(1);
    expect(diag.coveragePercent).toBe(67);
  });

  it('22. onay gerektiren işlem isteği `pending` ile doğar (kapı DEĞİL, BİLGİ)', () => {
    const phone = requestFromLegacyIntent('OPEN_PHONE', { contactName: 'X' }, 0.9);
    expect(phone?.confirmationState).toBe('pending');
    const pause = requestFromLegacyIntent('PAUSE_MEDIA', {}, 0.9);
    expect(pause?.confirmationState).toBe('not_required');
  });

  it('23. köprü yalnız ŞEMADAKİ alanları taşır — yabancı alan yürütücüye SIZMAZ', () => {
    const r = requestFromLegacyIntent('OPEN_PHONE', {
      contactName: 'Selim', sensorQuery: 'motor suyu', secret: 'x',
    }, 0.9);
    expect(Object.keys(r?.parameters ?? {})).toEqual(['contactName']);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * D — Gözlem (observation)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F5 · D · gözlem seviyesi', () => {
  it('24. **DÜRÜSTLÜK TAVANI**: kanıtsız yolda "succeeded" bile OBSERVED/EXECUTED olmaz', () => {
    // Tavanı ACCEPTED olan işlem (ör. ayar): yürütücü başarı dese bile ACCEPTED.
    expect(classifyObservation('succeeded', 'ACCEPTED')).toBe('ACCEPTED');
    // Tavanı OBSERVED olan işlem (sensör okuma): başarı EXECUTED olarak geçer.
    expect(classifyObservation('succeeded', 'OBSERVED')).toBe('EXECUTED');
  });

  it('25. **UNKNOWN gözlemde "yaptım" DENEMEZ**', () => {
    expect(isSuccessObservation('UNKNOWN')).toBe(false);
    expect(isSuccessObservation('ACCEPTED')).toBe(false);
    expect(isSuccessObservation('REQUESTED')).toBe(false);
    expect(isSuccessObservation('FAILED')).toBe(false);
    expect(isSuccessObservation('CANCELLED')).toBe(false);
    expect(isSuccessObservation('EXECUTED')).toBe(true);
    expect(isSuccessObservation('OBSERVED')).toBe(true);
  });

  it('26. kanonik durumlar bounded gözlem sınıflarına eksiksiz eşlenir', () => {
    expect(classifyObservation('needs_confirmation', 'OBSERVED')).toBe('REQUESTED');
    expect(classifyObservation('denied', 'OBSERVED')).toBe('FAILED');
    expect(classifyObservation('unsupported', 'OBSERVED')).toBe('FAILED');
    expect(classifyObservation('failed', 'OBSERVED')).toBe('FAILED');
    expect(classifyObservation('started', 'OBSERVED')).toBe('ACCEPTED');
    expect(classifyObservation('not_handled', 'OBSERVED')).toBe('UNKNOWN');
    expect(classifyObservation('bilinmeyen_durum', 'OBSERVED')).toBe('UNKNOWN');
  });

  it('27. tavan uygulaması yalnız BAŞARI iddiasını sınırlar — hatayı gizlemez', () => {
    expect(classifyObservation('failed', 'ACCEPTED')).toBe('FAILED');
    expect(classifyObservation('denied', 'ACCEPTED')).toBe('FAILED');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * E — Projeksiyon (prompt yüzeyi)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F5 · E · bağlama göre yüzey', () => {
  it('28. alan ipucu bulunursa yüzey DARALIR', () => {
    const p = projectCapabilities('ibrahim tatlısesden müzik çal');
    expect(p.narrowed).toBe(true);
    expect(p.domains).toContain('media');
    expect(p.operations.every((d) => d.domain === 'media' || d.domain === 'surface')).toBe(true);
  });

  it('29. ipucu yoksa TAM yüzey döner ve bu DÜRÜSTÇE bildirilir', () => {
    const p = projectCapabilities('zzz qqq');
    expect(p.narrowed).toBe(false);
    expect(p.operations.length).toBe(
      CAROS_CAPABILITY_CATALOG.filter((d) => d.exposedToBrain && d.legacyIntent !== null).length,
    );
  });

  it('30. yalnız `surface` eşleşmesi DARALTMA sayılmaz ("müziği aç" medyayı düşürmemeli)', () => {
    const p = projectCapabilities('aç');
    expect(p.narrowed).toBe(false);
    const m = projectCapabilities('müziği aç');
    expect(m.narrowed).toBe(true);
    expect(m.operations.some((d) => d.domain === 'media')).toBe(true);
  });

  it('31. **BEYNE KAPALI işlem projeksiyonda GÖRÜNMEZ**', () => {
    for (const text of ['arıza kodlarını sil', 'dtc temizle', '']) {
      const p = projectCapabilities(text);
      expect(p.operations.some((d) => d.capabilityId === 'diagnostics.dtc')).toBe(false);
    }
  });

  it('32. prompt satırları katalogdan ÜRETİLİR ve zorunlu alanları taşır', () => {
    const lines = renderProjectionLines(projectCapabilities('kadıköye git'));
    expect(lines.some((l) => l.startsWith('NAVIGATE_ADDRESS —'))).toBe(true);
    const app = renderProjectionLines(projectCapabilities('kamerayı aç uygulama'))
      .find((l) => l.startsWith('OPEN_APP —'));
    expect(app, 'OPEN_APP yüzeyde olmalı').toBeDefined();
    expect(app).toContain('zorunlu: appName');
  });

  it('33. alan tespiti metni SAKLAMAZ, yalnız alan adları döner', () => {
    const d = detectDomains('Selim\'i ara ve motor suyunu söyle');
    expect(d).toContain('phone');
    expect(d).toContain('vehicle');
    expect(d.every((x) => typeof x === 'string' && x.length < 20)).toBe(true);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * F — TEK KAYNAK (üç kopya listenin imhası)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F5 · F · prompt listesi tek kaynaktan türetilir', () => {
  it('34. `BRAIN_INTENTS` ELLE YAZILMAZ — katalogdan türetilir', () => {
    const code = codeOf(src('platform/companion/companionChatProvider.ts'));
    expect(code).toContain('brainIntentAllowlist()');
    const decl = code.slice(code.indexOf('const BRAIN_INTENTS'), code.indexOf('const BRAIN_INTENTS') + 260);
    /* Türetme kaldırılıp yerine sabit liste dönerse bu kilit düşer. */
    expect(decl).toContain('brainIntentAllowlist()');
  });

  it('35. **KAPSAMA REGRESYONU YOK**: türetilen küme eski 29 intent\'i AYNEN kapsar', () => {
    const ORIGINAL_29 = [
      'SEARCH_POI', 'OPEN_NAVIGATION', 'NAVIGATE_ADDRESS',
      'FIND_NEARBY_GAS', 'FIND_NEARBY_PARKING', 'FIND_NEARBY_REST_AREA',
      'OPEN_MUSIC', 'PLAY_MUSIC_SEARCH', 'PAUSE_MEDIA',
      'MEDIA_NEXT', 'MEDIA_PREV', 'VOLUME_UP', 'VOLUME_DOWN',
      'OPEN_PHONE', 'OPEN_SETTINGS', 'SHOW_WEATHER', 'OPEN_APP', 'OPEN_SCREEN',
      'CHECK_VEHICLE_HEALTH', 'CHECK_MAINTENANCE', 'CYCLE_THEME', 'ENABLE_NIGHT_MODE',
      'SET_SETTING', 'OPEN_FAVORITES', 'ENABLE_DRIVING_MODE', 'TOGGLE_SLEEP_MODE',
      'REMEMBER', 'FORGET', 'QUERY_SENSOR',
    ];
    /* MAVI-F7 · KİLİT GÜNCELLENDİ (kaldırılmadı). Kilidin koruduğu şey KAPSAM
     * KAYBIdır; F7'de `PLAY_MEDIA` katalog'a EKLENDİ (kayıp değil, kazanç) —
     * eskiden "müziği devam ettir" katalogda YOKTU ve `PAUSE_MEDIA`nın tersi
     * olan işlem beyne kapalıydı. Bilinçli eklemeler AÇIKÇA listelenir ki
     * gözden kaçan bir genişleme sessizce geçemesin. */
    const ADDED_SINCE_F5 = ['PLAY_MEDIA'];               // MAVI-F7 · media.playback#resume
    const LEGACY_ONLY = ['SHOW_WEATHER', 'ENABLE_DRIVING_MODE', 'TOGGLE_SLEEP_MODE', 'REMEMBER', 'FORGET'];
    const derivedSet = new Set([...brainExposedIntents(), ...LEGACY_ONLY]);
    for (const i of ORIGINAL_29) {
      expect(derivedSet.has(i), `KAPSAM KAYBI: ${i} artık beyne açık değil`).toBe(true);
    }
    /* Fazlası da YOK — yalnız AÇIKÇA listelenen eklemeler kadar. */
    expect(derivedSet.size).toBe(ORIGINAL_29.length + ADDED_SINCE_F5.length);
    for (const i of ADDED_SINCE_F5) expect(derivedSet.has(i)).toBe(true);
  });

  it('36. beyne kapalı işlem türetilmiş listeye SIZMAZ', () => {
    expect(brainExposedIntents()).not.toContain('CLEAR_DTC_CODES');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * G — Kaynak kilitleri (mimari sınırlar)
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F5 · G · kaynak kilitleri', () => {
  const contract = src('platform/capability/fabric/capabilityContract.ts');
  const catalog = src('platform/capability/fabric/carosCapabilityCatalog.ts');
  const resolver = src('platform/capability/fabric/capabilityResolver.ts');
  const projection = src('platform/capability/fabric/capabilityProjection.ts');
  const fabric = src('platform/capability/fabric/capabilityFabric.ts');

  it('37. **FABRIC HİÇBİR ŞEY YÜRÜTMEZ** (ikinci yürütücü yasağı)', () => {
    const code = codeOf(fabric);
    for (const forbidden of [
      'dispatchIntent', 'executeIntent', 'executeAIResult', 'routeIntent',
      'navigationService', 'mediaService', 'appLauncher', 'obdService',
      'speakMaviAnswer', 'ttsSpeak', 'useStore',
    ]) {
      expect(code, `fabric yürütme yoluna dokunuyor: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('38. **FABRIC GÜVENLİK KARARI VERMEZ** (kanonik otorite taklit edilmez)', () => {
    const code = codeOf(fabric);
    for (const forbidden of [
      'evaluateVehicleAction', 'evaluateActionIdSafety', 'createAiSafetyGate',
      'assistantSafetyKernel', 'motionState', 'MOTION_STOPPED_MAX_KMH',
    ]) {
      expect(code, `fabric kanonik güvenlik kararını KOPYALIYOR: ${forbidden}`).not.toContain(forbidden);
    }
  });

  it('39. SAF katmanlar SAF kalır (I/O · timer · Date.now · modül durumu YOK)', () => {
    for (const [name, s] of [
      ['contract', contract], ['catalog', catalog],
      ['resolver', resolver], ['projection', projection],
    ] as const) {
      const code = codeOf(s);
      expect(code, name).not.toMatch(/Date\.now|setTimeout|setInterval|localStorage|fetch\(/);
      expect(code, `${name} modül düzeyinde DEĞİŞKEN durum tutuyor`).not.toMatch(/^let\s/m);
    }
  });

  it('40. sözleşme katmanı HİÇBİR modül import ETMEZ', () => {
    expect(codeOf(contract)).not.toMatch(/\bimport\b/);
  });

  it('41. availability politikası KİLİTLİ: yalnız KANITLI OLUMSUZ kapatır', () => {
    const code = codeOf(fabric);
    expect(code).toContain("'unavailable', 'unsupported', 'restricted'");
    /* `UNKNOWN` kapatır hâle gelirse çalışan komutlar sessizce ölürdü. */
    expect(code).toMatch(/return allAvailable \? 'AVAILABLE' : 'UNKNOWN'/);
  });

  it('42. gölge kip KİLİTLİ: enforce kapalıyken `allow` DAİMA true', () => {
    const code = codeOf(fabric);
    expect(code).toMatch(/allow: enforced \? !wouldBlock : true/);
  });

  it('43. LAB kaynak katmanı KOMUT GÖNDERMEZ', () => {
    const code = codeOf(src('platform/devtools/capabilityFabricSources.ts'));
    for (const forbidden of [
      'evaluateCapabilityRequest', 'evaluateLegacyIntent', 'dispatchIntent',
      'setCapabilityFabricEnforceRemoteFlag', '_resetCapabilityFabricForTest',
    ]) {
      expect(code, `LAB kaynağı aktif komut içeriyor: ${forbidden}`).not.toContain(forbidden);
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * H — Önceki fazların invariant'ları
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F5 · H · F0–F4 invariant\'ları korunur', () => {
  it('44. F0: gecikme telemetrisi damgaları KALDIRILMADI', () => {
    const code = src('platform/assistant/maviLatencyTrace.ts');
    for (const mark of [
      'brain_request_start', 'brain_complete', 'first_audio_requested',
      'first_audio_confirmed', 'filler_trigger',
    ]) {
      expect(code, `F0 damgası kayboldu: ${mark}`).toContain(mark);
    }
  });

  it('45. F2: capability katmanı METİN ÜRETMEZ (yapay ara söz doğamaz)', () => {
    for (const s of [
      src('platform/capability/fabric/capabilityFabric.ts'),
      src('platform/capability/fabric/capabilityResolver.ts'),
    ]) {
      const code = codeOf(s);
      expect(code).not.toContain('speak');
      expect(code).not.toContain('feedback');
    }
  });

  it('46. F3: kısmi transkript yolu capability katmanına BAĞLANMADI', () => {
    const code = codeOf(src('platform/capability/fabric/capabilityFabric.ts'));
    expect(code).not.toContain('sttPartialStream');
    expect(code).not.toContain('notePartial');
  });

  it('47. F4: akış katmanı capability kapısını ATLAMAZ (yapısal çıktı hâlâ susar)', () => {
    const code = codeOf(src('platform/voice/streamSayExtractor.ts'));
    expect(code).toMatch(/if \(t !== 'chat'\)/);
    expect(code).toContain("state = 'STRUCTURED'");
  });

  it('48. kanonik eylem otoritesi DEĞİŞMEDİ: kapı sırası ve defter yerinde', () => {
    const code = src('platform/action/maviActionAuthority.ts');
    expect(code).toContain('evaluateActionIdSafety');
    expect(code).toContain('createAiSafetyGate');
    expect(code).toContain('requiresConfirmation');
    const exec = src('platform/commandExecutor.ts');
    /* Kapı hâlâ yürütücüden ÖNCE ve `isVehicleEffectiveIntent` üzerinden çalışmalı. */
    expect(exec.indexOf('evaluateVehicleAction')).toBeLessThan(exec.indexOf('switch (intent.type)'));
  });

  it('49. gözlem kaydı yürütmeyi ETKİLEMEZ (fail-soft)', () => {
    const code = src('platform/commandExecutor.ts');
    const i = code.indexOf('function _recordCapabilityOutcome');
    expect(i).toBeGreaterThan(-1);
    /* KİLİT GÜÇLENDİRİLDİ (MAVI-F7): sabit karakter penceresi KÖR bir kilitti
     * — gövde büyüyünce `catch` pencereden çıkıyordu ve kilit hiçbir şeyi
     * korumuyordu. Artık fonksiyonun TAMAMI alınır. */
    const end = code.indexOf('\n}', i);
    expect(end).toBeGreaterThan(i);
    const body = code.slice(i, end + 2);
    expect(body).toContain('try {');
    expect(body).toContain('} catch {');
    /* Gözlem kaydı yürütmeyi TETİKLEYEMEZ: içinden yürütücüye/köprüye çağrı
     * yapılmaz ve beklenmez (senkron, yan etkisiz kayıt). */
    expect(body).not.toContain('dispatchIntent');
    expect(body).not.toContain('await ');
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * I — LAB modeli
 * ════════════════════════════════════════════════════════════════════════ */

describe('MAVI-F5 · I · LAB modeli dürüsttür', () => {
  const base = {
    diagnostics: {
      enforcing: false, capabilityRoutes: 0, legacyRoutes: 0, allowed: 0,
      coveragePercent: 0, failures: {}, observations: {},
      plansBuilt: 0, planItems: 0, planDependencies: 0, planResults: {},
    },
    enforcing: false,
    rows: CAROS_CAPABILITY_CATALOG.map((d) => ({
      capabilityId: d.capabilityId, operation: d.operation, domain: d.domain as string,
      safetyClass: d.safetyClass as string, requiresConfirmation: d.requiresConfirmation,
      observationCeiling: d.observationCeiling as string, exposedToBrain: d.exposedToBrain,
      legacyIntent: d.legacyIntent, availability: 'UNKNOWN',
      requiredCapabilities: d.requiredCapabilities,
    })),
    integrity: { ok: true, duplicateOperations: [], duplicateLegacyIntents: [], emptyEnums: [] },
    brainIntentCount: brainExposedIntents().length,
  };

  it('50. hiç tur geçmediyse kapsama "%0" DEĞİL "ölçüm yok" gösterilir', () => {
    const v = buildCapabilityFabricView(base);
    const f = v.fields.find((x) => x.id === 'coverage');
    expect(f?.klass).toBe('UNAVAILABLE');
    expect(f?.value).not.toContain('%0');
  });

  it('51. gerçek trafik varsa kapsama TÜRETİLMİŞ olarak sunulur', () => {
    const v = buildCapabilityFabricView({
      ...base,
      diagnostics: { ...base.diagnostics, capabilityRoutes: 3, legacyRoutes: 1, coveragePercent: 75 },
    });
    const f = v.fields.find((x) => x.id === 'coverage');
    expect(f?.klass).toBe('DERIVED');
    expect(f?.value).toContain('%75');
  });

  it('52. kaynak okunamazsa UNAVAILABLE gösterilir — sahte sıfır ÜRETİLMEZ', () => {
    const v = buildCapabilityFabricView({
      diagnostics: null, enforcing: null, rows: null, integrity: null, brainIntentCount: null,
    });
    for (const id of ['mode', 'coverage', 'catalog_size', 'brain_intents', 'integrity']) {
      expect(v.fields.find((x) => x.id === id)?.klass, id).toBe('UNAVAILABLE');
    }
  });

  it('53. katalog bütünlüğü KUSURU ekranda gizlenmez', () => {
    const v = buildCapabilityFabricView({
      ...base,
      integrity: { ok: false, duplicateOperations: ['a#b'], duplicateLegacyIntents: [], emptyEnums: [] },
    });
    expect(v.fields.find((x) => x.id === 'integrity')?.value).toContain('KUSUR');
  });

  it('54. LAB satırları parametre DEĞERİ taşımaz (yalnız katalog sabitleri)', () => {
    const v = buildCapabilityFabricView(base);
    for (const r of v.rows) {
      expect(Object.keys(r).sort()).toEqual([
        'availability', 'capabilityId', 'domain', 'exposedToBrain', 'legacyIntent',
        'observationCeiling', 'operation', 'requiredCapabilities', 'requiresConfirmation',
        'safetyClass',
      ]);
    }
  });
});

/* ── Yardımcı: `findOperation` sözleşmesi ─────────────────────────────── */
describe('MAVI-F5 · J · çözümleyici yardımcıları', () => {
  it('55. `findOperation` yalnız TAM eşleşmede döner', () => {
    expect(findOperation('media.playback', 'pause')).not.toBeNull();
    expect(findOperation('media.playback', 'Pause')).toBeNull();   // büyük/küçük harf ÖNEMLİ
    expect(findOperation('media.playback', 'destroy')).toBeNull();
  });
});
