/**
 * F4.2 · ARAÇ ODOMETRESİ KANIT KAPISI.
 *
 * ── ÖLÇÜLEN BAŞLANGIÇ DURUMU (F4, 2026-09-18) ────────────────────────────
 *   ODOMETER ACQUISITION / PERSISTENCE / FRESHNESS AUTHORITY = NOT AVAILABLE
 *   · ECU odometre PID'i okunmuyordu
 *   · `CarLauncher.persistOdometer` Java'da TANIMSIZ → sessiz no-op
 *   · production `vehicles`: 1083 aracın tamamında `odometer_km = 0`
 *
 * ── BU TURDA KANITLANAN ──────────────────────────────────────────────────
 * Edinim MİMARİSİ zaten vardı: `vehicleDidProfile` (kaynak zorunlu, eval yok,
 * `decode.fn` + katsayı ile ölçek), `manufacturerPidService` (DID okuma +
 * `updatedAt`), native `readObdDid`. Eksik olan tek şey ANLAM BAĞIydı:
 * "bu araçta odometre hangisi?" sorusunun makine-okunur cevabı yoktu.
 *
 * Yeni PID/DID/ölçek UYDURULMADI. Tek gerçek odometre kaydı zaten repoda
 * duruyordu: Renault Zoe PH2 · EVC · DID 2006 · 3 bayt · km · çarpan 1,
 * kaynağı OVMS (MIT) satırı. Ona yalnız `role: 'vehicle_odometer'` konuldu.
 *
 * ── KİLİTLENEN INVARIANTLAR ──────────────────────────────────────────────
 * VEHICLE ODOMETER ≠ TRIP DISTANCE ≠ GPS INTEGRALİ ≠ KULLANICI GİRDİSİ ·
 * unsupported ≠ 0 · timeout ≠ yeni ölçüm · ölçek kanıtsız sayı akmaz.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const svc = vi.hoisted(() => ({
  defs: [] as unknown[],
  values: new Map<string, unknown>(),
  throwOnDefs: false,
}));

vi.mock('../platform/obd/manufacturerPidService', () => ({
  getSupportedDids: () => {
    if (svc.throwOnDefs) throw new Error('profil okunamadı');
    return svc.defs;
  },
  getDidValue: (did: string) => svc.values.get(did.toUpperCase()),
}));

import {
  readVehicleOdometerEvidence,
  readVehicleOdometerKmOrNull,
  findOdometerDid,
  validateOdometerReading,
} from '../platform/obd/vehicleOdometerEvidence';
import type { CompiledDidDef } from '../platform/obd/vehicleDidProfile';
import {
  validateVehicleDidProfile,
  compileVehicleDidProfile,
} from '../platform/obd/vehicleDidProfile';
import { renaultZoePh2Profile } from '../platform/obd/profiles/renaultZoePh2Profile';

/** Gerçek derlenmiş tanım biçimi — elle uydurulmuş nesne değil. */
function def(over: Partial<CompiledDidDef> = {}): CompiledDidDef {
  return {
    did: '2006', service: '22', ecuId: 'evc', tx: '18DADAF1', rx: '18DAF1DA',
    name: 'Kilometre (Odometre)', unit: 'km', bytes: 3,
    min: 0, max: 999999, category: 'kilometre',
    role: 'vehicle_odometer',
    decode: (b: number[]) => b[0]! * 65536 + b[1]! * 256 + b[2]!,
    isText: false,
    ...over,
  };
}

beforeEach(() => { svc.defs = []; svc.values.clear(); svc.throwOnDefs = false; });

/* ═══ 1 · Kaynak yokluğu ════════════════════════════════════════════════ */

describe('F4.2 · kanıt yoksa sayı yok', () => {
  it('1/6 — profilde odometre rolü yoksa UNSUPPORTED (0 ÜRETİLMEZ)', () => {
    svc.defs = [def({ role: undefined, category: 'kilometre' })];
    const e = readVehicleOdometerEvidence();
    expect(e.status).toBe('UNSUPPORTED');
    expect(e.valueKm).toBeNull();
    expect(readVehicleOdometerKmOrNull()).toBeNull();
  });

  it('serbest metin kategori TEK BAŞINA odometre saymaz', () => {
    /* `category` bilinçli olarak serbest metindir; anlam YALNIZ rolden gelir. */
    svc.defs = [def({ role: undefined, category: 'odometre' })];
    expect(readVehicleOdometerEvidence().status).toBe('UNSUPPORTED');
  });

  it('7 — tanım var ama okuma yoksa UNKNOWN (unsupported DEĞİL)', () => {
    svc.defs = [def()];
    const e = readVehicleOdometerEvidence();
    expect(e.status).toBe('UNKNOWN');
    expect(e.valueKm).toBeNull();
    /* Denetlenebilirlik: hangi ECU/DID beklendiği yine de taşınır. */
    expect(e.ecu).toBe('evc');
    expect(e.identifier).toBe('2006');
  });

  it('profil okunamazsa UNKNOWN — sessiz 0 yok', () => {
    svc.throwOnDefs = true;
    expect(readVehicleOdometerEvidence().status).toBe('UNKNOWN');
  });

  it('14 — profilde BİRDEN FAZLA odometre varsa çelişki gizlenmez', () => {
    svc.defs = [def({ did: '2006' }), def({ did: '2007' })];
    const e = readVehicleOdometerEvidence();
    expect(e.status).toBe('UNSUPPORTED');
    expect(e.reason).toContain('belirsiz');
    /* İlki SESSİZCE seçilmez. */
    expect(e.valueKm).toBeNull();
  });
});

/* ═══ 2 · Gerçek ölçüm ══════════════════════════════════════════════════ */

describe('F4.2 · kanıtlı okuma', () => {
  it('5/15/16 — geçerli okuma kanıt üretir ve provenance korunur', () => {
    svc.defs = [def()];
    svc.values.set('2006', { value: 92_451, def: def(), updatedAt: 1_700_000_000_000 });

    const e = readVehicleOdometerEvidence();
    expect(e).toMatchObject({
      status: 'MEASURED',
      valueKm: 92_451,
      source: 'ECU_REPORTED',
      protocol: 'UDS',
      ecu: 'evc',
      identifier: '2006',
    });
    /* `measuredAt` EDİNİM anını taşır — uydurulmaz. */
    expect(e.measuredAt).toBe(1_700_000_000_000);
    expect(readVehicleOdometerKmOrNull()).toBe(92_451);
  });

  it('KWP tanımı protokolü doğru bildirir', () => {
    svc.defs = [def({ service: '21', did: '80' })];
    svc.values.set('80', { value: 1000, def: def({ service: '21' }), updatedAt: 1 });
    expect(readVehicleOdometerEvidence().protocol).toBe('KWP');
  });

  it('16 — ölçüm anı bilinmiyorsa değer KANIT SAYILMAZ', () => {
    svc.defs = [def()];
    svc.values.set('2006', { value: 92_451, def: def(), updatedAt: Number.NaN });
    const e = readVehicleOdometerEvidence();
    expect(e.status).toBe('INVALID');
    expect(e.valueKm).toBeNull();
    expect(e.reason).toContain('Ölçüm anı');
  });
});

/* ═══ 3 · Ölçek ve makullük ═════════════════════════════════════════════ */

describe('F4.2 · ölçek/birim güvenliği', () => {
  it('9/10 — birim km DEĞİLSE sayı akmaz (mil sessizce çevrilmez)', () => {
    for (const unit of ['mi', '', '0.1km', 'm']) {
      const r = validateOdometerReading(50_000, def({ unit }));
      expect(r.ok, unit).toBe(false);
      if (!r.ok) expect(r.reason).toContain('Ölçek doğrulanmadı');
    }
  });

  it('8/11 — bozuk/sentinel okuma reddedilir', () => {
    for (const raw of [Number.NaN, Infinity, -1, '92451', null, undefined, {}]) {
      expect(validateOdometerReading(raw, def()).ok, String(raw)).toBe(false);
    }
  });

  it('negatif kilometre PROFİL İZİN VERSE BİLE reddedilir', () => {
    /* Bu kilit bilinçli olarak profil aralığından BAĞIMSIZDIR: bozuk bir
       profil `min: -1000` beyan etse bile negatif odometre fiziksel olarak
       imkânsızdır. (Mutasyon sınaması bu kapının aralık kontrolüyle
       örtüldüğünü gösterdi — artık kendi başına sınanıyor.) */
    const r = validateOdometerReading(-5, def({ min: -1000 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('Negatif');
  });

  it('14 — makullük sınırı PROFİLİN beyanıdır, keyfi tavan yok', () => {
    /* Profil 999.999'a kadar beyan ediyor → 700.000 km REDDEDİLMEZ. */
    expect(validateOdometerReading(700_000, def()).ok).toBe(true);
    /* Beyan dışı değer reddedilir. */
    const over = validateOdometerReading(1_000_001, def());
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.reason).toContain('aralığının dışında');
  });

  it('geçersiz okuma INVALID olur, UNKNOWN ile karışmaz', () => {
    svc.defs = [def()];
    svc.values.set('2006', { value: -5, def: def(), updatedAt: 1 });
    expect(readVehicleOdometerEvidence().status).toBe('INVALID');
  });
});

/* ═══ 4 · Kaynak ayrımı (en kritik) ═════════════════════════════════════ */

describe('F4.2 · odometre ≠ mesafe ≠ kullanıcı girdisi', () => {
  it('3/4/19/20 — kanıt kaynağı YALNIZ ECU_REPORTED olabilir', () => {
    svc.defs = [def()];
    svc.values.set('2006', { value: 92_451, def: def(), updatedAt: 1 });
    const e = readVehicleOdometerEvidence();
    /* Sözleşmede başka kaynak YOKTUR: trip mesafesi, GPS integrali veya
       kullanıcı girdisi bu kapıdan GEÇEMEZ — tip düzeyinde imkânsız. */
    expect(e.source).toBe('ECU_REPORTED');
  });

  it('kapı hiçbir mesafe/kullanıcı deposunu OKUMAZ', async () => {
    /* Yapısal kilit: modül yalnız DID servisini import eder. */
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(
      join(process.cwd(), 'src/platform/obd/vehicleOdometerEvidence.ts'), 'utf8',
    );
    /* Yalnız KOD sınanır; açıklama metinleri production kanıtını anlatmak
       için bu adları anmak zorunda. */
    const kod = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
    expect(kod).not.toContain('UnifiedVehicleStore');
    expect(kod).not.toContain('tripLogService');
    expect(kod).not.toContain('sensitiveKeyStore');
    expect(kod).not.toMatch(/odometer_km/);
    /* İzin verilen TEK veri kaynağı üretici DID servisidir. */
    const imports = [...kod.matchAll(/from '([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./manufacturerPidService', './vehicleDidProfile']);
  });
});

/* ═══ 5 · Gerçek profil ═════════════════════════════════════════════════ */

describe('F4.2 · Renault Zoe PH2 profili gerçek kanıtla çalışır', () => {
  it('profil doğrulayıcıdan geçer ve odometre rolü derlenir', () => {
    const v = validateVehicleDidProfile(renaultZoePh2Profile);
    expect(v.valid).toBe(true);
    if (!v.valid) throw new Error(v.errors.join(' · '));

    const compiled = compileVehicleDidProfile(v.profile);
    const found = findOdometerDid([...compiled.values()]);
    expect(found.ok).toBe(true);
    if (!found.ok) throw new Error(found.reason);

    /* Repoda ZATEN var olan kayıt — bu turda UYDURULMADI. */
    expect(found.def.did).toBe('2006');
    expect(found.def.ecuId).toBe('evc');
    expect(found.def.unit).toBe('km');
  });

  it('bilinmeyen rol profili YÜKLETMEZ (sessizce yok sayılmaz)', () => {
    const bad = {
      ...renaultZoePh2Profile,
      dids: renaultZoePh2Profile.dids.map((d) =>
        d.did === '2006' ? { ...d, role: 'uydurma_rol' } : d),
    };
    const v = validateVehicleDidProfile(bad);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.errors.join(' ')).toContain('bilinmeyen anlam rolü');
  });

  it('diğer profillerde odometre rolü YOK — sahte destek iddiası yok', async () => {
    const { universalUdsProfile } = await import('../platform/obd/profiles/universalUdsProfile');
    const { renaultDaciaProfile } = await import('../platform/obd/profiles/renaultDaciaProfile');
    for (const p of [universalUdsProfile, renaultDaciaProfile]) {
      const compiled = compileVehicleDidProfile(p);
      expect(findOdometerDid([...compiled.values()]).ok, p.brand).toBe(false);
    }
  });
});
