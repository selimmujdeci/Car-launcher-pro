/**
 * sensorQueryService — Patch 9B (OBD Core v2): sesli asistan araç-verisi sorgu API'si.
 *
 * "Yağ sıcaklığı kaç?", "hararet ne durumda?", "yakıt ne kadar?" tipi soruları
 * Türkçe sensör adından değere çözer. İki kaynak:
 *  - CORE alanlar: obdService anlık verisi (hız/devir/hararet/yakıt/gaz/emme/turbo/akü) —
 *    senkron, her zaman taze (poll ana yolu).
 *  - EXTENDED PID'ler: extendedPidService — önbellekte taze değer varsa anında; yoksa
 *    GEÇİCİ watchPid aboneliğiyle ilk değer beklenir (timeout'lu, abonelik temizlenir →
 *    sorgu bitince native polling durur, Mali-400 kuralı bozulmaz).
 *
 * Beyin bağlantısı: intent katmanı (yerel parser / LLM araç bağlamı) bu modülün
 * querySensor()'unu çağırıp `text` alanını TTS'e verir. Modül React'siz ve yan
 * etkisiz (geçici abonelik hariç) — her beyin sürümü kullanabilir.
 */

import { getOBDDataSnapshot } from '../obdService';
import type { OBDData } from '../obdTypes';
import { watchPid, getPidValue, isPidSupported } from './extendedPidService';
import { STANDARD_PID_MAP } from './StandardPidRegistry';
import { watchDid, getDidValue, isDidSupported, getSupportedDids } from './manufacturerPidService';

export interface SensorAnswer {
  /** İnsan-okur sensör adı ("Motor yağı sıcaklığı"). */
  name: string;
  /** Çözülen değer; null = şu anda okunamıyor (bağlantı yok / desteklenmiyor / zaman aşımı). */
  value: number | null;
  unit: string;
  /** TTS'e hazır Türkçe cevap cümlesi. */
  text: string;
  /** Patch 12B: 'manufacturer' = yüklü VehicleDidProfile üzerinden (UDS Mode 22). */
  source: 'core' | 'extended' | 'manufacturer';
  pid?: string;
}

/* ── Türkçe normalize (screenRegistry ile aynı kural — bağımsız kopya) ───── */
function norm(s: string): string {
  return s.toLowerCase()
    .replace(/ı/g, 'i').replace(/İ/g, 'i')
    .replace(/ö/g, 'o').replace(/ü/g, 'u')
    .replace(/ç/g, 'c').replace(/ş/g, 's').replace(/ğ/g, 'g')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/* ── Eşleştirme tablosu ──────────────────────────────────────────────────── */

interface CoreTarget  { kind: 'core'; field: keyof OBDData; name: string; unit: string }
interface ExtTarget   { kind: 'ext';  pid: string }
/** Patch 12B: yüklü VehicleDidProfile'daki bir DID (manufacturerPidService). */
interface DidTarget   { kind: 'did';  did: string }
type Target = CoreTarget | ExtTarget | DidTarget;

/** Normalize edilmiş tetikleyici → hedef. UZUN alias'lar önce denenir (spesifik kazanır). */
const ALIASES: ReadonlyArray<[string, Target]> = [
  // ── EXTENDED (spesifik adlar önce — "yag sicakligi" "sicaklik"tan önce eşleşmeli) ──
  ['motor yagi sicakligi', { kind: 'ext', pid: '5C' }],
  ['yag sicakligi',        { kind: 'ext', pid: '5C' }],
  ['yag',                  { kind: 'ext', pid: '5C' }],
  ['motor yuku',           { kind: 'ext', pid: '04' }],
  ['ortam sicakligi',      { kind: 'ext', pid: '46' }],
  ['disari sicaklik',      { kind: 'ext', pid: '46' }],
  ['hava sicakligi',       { kind: 'ext', pid: '46' }],
  ['yakit tuketimi',       { kind: 'ext', pid: '5E' }],
  ['anlik tuketim',        { kind: 'ext', pid: '5E' }],
  ['tuketim',              { kind: 'ext', pid: '5E' }],
  ['katalizor sicakligi',  { kind: 'ext', pid: '3C' }],
  ['katalizor',            { kind: 'ext', pid: '3C' }],
  ['modul voltaji',        { kind: 'ext', pid: '42' }],
  ['maf',                  { kind: 'ext', pid: '10' }],
  ['hava akisi',           { kind: 'ext', pid: '10' }],
  ['atesleme avansi',      { kind: 'ext', pid: '0E' }],
  ['avans',                { kind: 'ext', pid: '0E' }],
  ['barometrik basinc',    { kind: 'ext', pid: '33' }],
  ['yakit trim',           { kind: 'ext', pid: '06' }],

  // ── CORE (obdService ana yolu) ──
  ['motor sicakligi', { kind: 'core', field: 'engineTemp',     name: 'Motor sıcaklığı',   unit: '°C'   }],
  ['hararet',         { kind: 'core', field: 'engineTemp',     name: 'Motor sıcaklığı',   unit: '°C'   }],
  ['su sicakligi',    { kind: 'core', field: 'engineTemp',     name: 'Motor sıcaklığı',   unit: '°C'   }],
  ['motor devri',     { kind: 'core', field: 'rpm',            name: 'Motor devri',        unit: 'rpm'  }],
  ['devir',           { kind: 'core', field: 'rpm',            name: 'Motor devri',        unit: 'rpm'  }],
  ['rpm',             { kind: 'core', field: 'rpm',            name: 'Motor devri',        unit: 'rpm'  }],
  ['hiz',             { kind: 'core', field: 'speed',          name: 'Hız',                unit: 'km/h' }],
  ['surat',           { kind: 'core', field: 'speed',          name: 'Hız',                unit: 'km/h' }],
  ['yakit seviyesi',  { kind: 'core', field: 'fuelLevel',      name: 'Yakıt seviyesi',     unit: '%'    }],
  ['yakit',           { kind: 'core', field: 'fuelLevel',      name: 'Yakıt seviyesi',     unit: '%'    }],
  ['benzin',          { kind: 'core', field: 'fuelLevel',      name: 'Yakıt seviyesi',     unit: '%'    }],
  ['depo',            { kind: 'core', field: 'fuelLevel',      name: 'Yakıt seviyesi',     unit: '%'    }],
  ['menzil',          { kind: 'core', field: 'estimatedRangeKm', name: 'Tahmini menzil',   unit: 'km'   }],
  ['gaz kelebegi',    { kind: 'core', field: 'throttle',       name: 'Gaz kelebeği',       unit: '%'    }],
  ['gaz pedali',      { kind: 'core', field: 'throttle',       name: 'Gaz kelebeği',       unit: '%'    }],
  ['emme sicakligi',  { kind: 'core', field: 'intakeTemp',     name: 'Emme havası sıcaklığı', unit: '°C' }],
  ['turbo basinci',   { kind: 'core', field: 'boostPressure',  name: 'Turbo basıncı',      unit: 'kPa'  }],
  ['turbo',           { kind: 'core', field: 'boostPressure',  name: 'Turbo basıncı',      unit: 'kPa'  }],
  ['aku voltaji',     { kind: 'core', field: 'batteryVoltage', name: 'Akü voltajı',        unit: 'V'    }],
  ['aku',             { kind: 'core', field: 'batteryVoltage', name: 'Akü voltajı',        unit: 'V'    }],
  ['voltaj',          { kind: 'core', field: 'batteryVoltage', name: 'Akü voltajı',        unit: 'V'    }],
];

/**
 * Patch 12B: yüklü profildeki DID'lerin Türkçe adlarını alias'a çevirir. Profil YOKSA
 * (getSupportedDids() boş liste döner) [] — resolveSensor'un davranışı mevcut ALIASES'e
 * göre DEĞİŞMEZ (profilsiz 15 kilit yeşil kalır). Her çağrıda TAZE üretilir (profil
 * runtime'da yüklenip kaldırılabilir — modül-yükleme anında SABİTLENEMEZ).
 */
function _profileAliases(): Array<[string, Target]> {
  return getSupportedDids().map((def) => [norm(def.name), { kind: 'did', did: def.did }] as [string, Target]);
}

/** Soruyu hedefe çözer — uzun (spesifik) alias önce; bulunamazsa null. */
export function resolveSensor(spoken: string): Target | null {
  const q = norm(spoken);
  if (q.length < 2) return null;
  // Uzunluk sırasına göre: "motor yagi sicakligi" "yag"dan önce denenmeli.
  const combined: ReadonlyArray<[string, Target]> = [...ALIASES, ..._profileAliases()];
  const sorted = [...combined].sort((a, b) => b[0].length - a[0].length);
  for (const [alias, target] of sorted) {
    if (q === alias || q.includes(alias)) return target;
  }
  return null;
}

/* ── Cevap üretimi ───────────────────────────────────────────────────────── */

/** Birimi konuşma diline çevirip cümle kurar. */
function speak(name: string, value: number, unit: string): string {
  const v = Math.abs(value % 1) < 0.05 ? String(Math.round(value)) : value.toFixed(1).replace('.', ',');
  switch (unit) {
    case '°C':   return `${name} ${v} derece.`;
    case '%':    return `${name} yüzde ${v}.`;
    case 'V':    return `${name} ${v} volt.`;
    case 'km/h': return `${name} saatte ${v} kilometre.`;
    case 'rpm':  return `${name} ${v} devir.`;
    case 'km':   return `${name} ${v} kilometre.`;
    case 'L/h':  return `${name} saatte ${v} litre.`;
    case 'kPa':  return `${name} ${v} kilopaskal.`;
    default:     return `${name} ${v}${unit ? ' ' + unit : ''}.`;
  }
}

function unavailable(name: string, source: 'core' | 'extended' | 'manufacturer', pid?: string): SensorAnswer {
  return {
    name, value: null, unit: '', source, pid,
    text: `${name} şu anda okunamıyor.`,
  };
}

/** EXTENDED önbellek tazelik eşiği — rotasyonda değerler saniyeler mertebesinde yaşlanır. */
const EXT_CACHE_FRESH_MS = 30_000;
/** İlk değer bekleme tavanı — keşif (≤4 tur) + rotasyon payı. */
const EXT_WAIT_TIMEOUT_MS = 12_000;

/**
 * Sesli soruyu cevaba çözer. Eşleşme yoksa null (çağıran dürüstçe "anlamadım" der).
 * EXTENDED hedefte taze önbellek yoksa geçici abonelikle ilk değer beklenir —
 * timeout'ta value:null ile dürüst cevap döner (sahte değer YOK).
 */
export async function querySensor(spoken: string): Promise<SensorAnswer | null> {
  const target = resolveSensor(spoken);
  if (!target) return null;

  if (target.kind === 'core') {
    const data = getOBDDataSnapshot();
    const raw = data[target.field];
    const value = typeof raw === 'number' && raw >= 0 && Number.isFinite(raw) ? raw : null;
    if (value === null) return unavailable(target.name, 'core');
    return {
      name: target.name, value, unit: target.unit, source: 'core',
      text: speak(target.name, value, target.unit),
    };
  }

  if (target.kind === 'did') {
    const didDef = getSupportedDids().find((d) => d.did === target.did);
    if (!didDef) return null; // profil kaldırılmış olabilir — tabloyla senkron değilse dürüstçe null

    // 1) Taze önbellek → anında cevap.
    const cachedDid = getDidValue(target.did);
    if (cachedDid && Date.now() - cachedDid.updatedAt < EXT_CACHE_FRESH_MS) {
      return {
        name: didDef.name, value: cachedDid.value, unit: didDef.unit, source: 'manufacturer', pid: didDef.did,
        text: speak(didDef.name, cachedDid.value, didDef.unit),
      };
    }

    // 2) KALICI desteklenmiyor (7F-31/33) → bekleme, dürüst cevap.
    if (isDidSupported(target.did) === false) {
      return {
        name: didDef.name, value: null, unit: didDef.unit, source: 'manufacturer', pid: didDef.did,
        text: `${didDef.name} bu araçta desteklenmiyor.`,
      };
    }

    // 3) Geçici abonelik: TAZE ilk değeri bekle, sonra aboneliği bırak (round-robin zamanlayıcı durur).
    const didStartedAt = Date.now();
    return new Promise<SensorAnswer>((resolve) => {
      let done = false;
      const finish = (answer: SensorAnswer) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        unsub();
        resolve(answer);
      };
      const unsub = watchDid(target.did, (v) => {
        if (v.updatedAt < didStartedAt) return; // bayat önbellek yankısı — taze okumayı bekle
        finish({
          name: didDef.name, value: v.value, unit: didDef.unit, source: 'manufacturer', pid: didDef.did,
          text: speak(didDef.name, v.value, didDef.unit),
        });
      });
      const timer = setTimeout(() => finish(unavailable(didDef.name, 'manufacturer', didDef.did)), EXT_WAIT_TIMEOUT_MS);
    });
  }

  const def = STANDARD_PID_MAP.get(target.pid);
  if (!def) return null; // tablo dışı hedef tanımlanmaz (ALIASES tabloyla senkron olmalı)

  // 1) Taze önbellek → anında cevap (panel açıksa zaten akıyor).
  const cached = getPidValue(target.pid);
  if (cached && Date.now() - cached.updatedAt < EXT_CACHE_FRESH_MS) {
    return {
      name: def.name, value: cached.value, unit: def.unit, source: 'extended', pid: def.pid,
      text: speak(def.name, cached.value, def.unit),
    };
  }

  // 2) Araç desteklemiyorsa bekleme — dürüst cevap.
  if (isPidSupported(target.pid) === false) {
    return {
      name: def.name, value: null, unit: def.unit, source: 'extended', pid: def.pid,
      text: `${def.name} bu araçta desteklenmiyor.`,
    };
  }

  // 3) Geçici abonelik: TAZE ilk değeri bekle, sonra aboneliği bırak (polling durur).
  // watchPid abone olur olmaz önbellekteki (bayat) değeri de verir — sorgu başlangıcından
  // ÖNCEKİ değerler yoksayılır; yalnız yeni okuma kabul edilir.
  const startedAt = Date.now();
  return new Promise<SensorAnswer>((resolve) => {
    let done = false;
    const finish = (answer: SensorAnswer) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsub();
      resolve(answer);
    };
    const unsub = watchPid(target.pid, (v) => {
      if (v.updatedAt < startedAt) return; // bayat önbellek yankısı — taze okumayı bekle
      finish({
        name: def.name, value: v.value, unit: def.unit, source: 'extended', pid: def.pid,
        text: speak(def.name, v.value, def.unit),
      });
    });
    const timer = setTimeout(() => finish(unavailable(def.name, 'extended', def.pid)), EXT_WAIT_TIMEOUT_MS);
  });
}
