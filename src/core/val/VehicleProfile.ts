/**
 * VehicleProfile.ts — Araç Profil Şeması & Otomatik Tespit Altyapısı
 *
 * IVehicleProfile    : Sinyal eşlemelerini ve araç tipini tanımlar.
 * VehicleProfileRegistry : Bilinen profilleri saklar; VIN + PID bitmask ile en iyi eşleşmeyi bulur.
 * StandardProfile    : OBD-II + CAN genel profil (ICE varsayılan).
 * EVProfile          : EV aracı profili — RPM/yakıt/motor sıcaklığı sinyalleri dışlanır.
 * DieselProfile      : Dizel profil — turbo boost ve egzoz sıcaklığı eklenir.
 * HybridProfile      : Hibrit profil — hem ICE hem EV sinyalleri.
 *
 * OBD-II PID referans (SAE J1979):
 *   0x0C → RPM         (A×256+B / 4)
 *   0x0D → Speed       (A km/h)
 *   0x2F → Fuel level  (A/255×100 %)
 *   0x05 → Coolant     (A − 40 °C)
 *   0x0F → Intake air  (A − 40 °C)
 *   0x42 → Control voltage (A×256+B / 1000 V)
 *   0x11 → Throttle    (A/255×100 %)
 */

import type { NormalizedVehicleData, SignalSource } from '../../platform/vehicleDataLayer/valTypes';

/* ── Araç tipi (obdService.VehicleType ile yapısal uyumlu) ──────────────── */

export type VehicleType = 'ice' | 'diesel' | 'ev' | 'hybrid' | 'phev';

/* ── Kaynak sinyal tanımlayıcısı ─────────────────────────────────────────── */

export interface SignalMapping {
  sourceId:   string;
  source:     SignalSource;
  field:      keyof NormalizedVehicleData;
  rawUnit:    'kmh' | 'mph' | 'mps' | 'percent' | 'celsius' | 'fahrenheit' | 'volts' | 'kpa' | 'psi' | 'rpm' | 'boolean' | 'km' | 'degrees';
  targetUnit: string;
  formula?:   string;
}

/* ── Araç profil arayüzü ─────────────────────────────────────────────────── */

export interface IVehicleProfile {
  /** Benzersiz profil kimliği (persistence anahtarı) */
  readonly id:          string;
  /** İnsanın okuyabileceği profil adı */
  readonly name:        string;
  /** Araç protokolü */
  readonly protocol:    'OBD2' | 'CAN' | 'MIXED';
  /** Bu profile ait araç tipi (obdService PID listesini belirler) */
  readonly vehicleType: VehicleType;
  /** VIN deseni — eşleşirse bu profil seçilir (null = desen yok) */
  readonly vinPattern:  RegExp | null;
  /** Tüm sinyal eşlemeleri */
  readonly mappings:    readonly SignalMapping[];
  /** Profildeki tüm kaynaklar */
  readonly sources:     ReadonlySet<SignalSource>;
  lookup(sourceId: string): SignalMapping | undefined;
  byField(field: keyof NormalizedVehicleData): SignalMapping[];
}

/* ── WMI (World Manufacturer Identifier) decoder ────────────────────────── */

/**
 * VIN'in ilk 3 karakterinden üretici ismini döner.
 * Kaynak: ISO 3779 + NHTSA WMI veritabanı (yaygın araçlar).
 *
 * @returns Üretici adı string, ya da bilinmiyorsa null.
 */
export function decodeWMI(vin: string): string | null {
  if (!vin || vin.length < 3) return null;
  const wmi = vin.slice(0, 3).toUpperCase();

  const table: Record<string, string> = {
    // ── Almanya ───────────────────────────────────────────────────────────
    WAU: 'Audi', WUA: 'Audi',
    WBA: 'BMW', WBS: 'BMW', WBX: 'BMW',
    WBY: 'BMW (EV)', // i serisi
    WDD: 'Mercedes-Benz', WDC: 'Mercedes-Benz', WDB: 'Mercedes-Benz',
    WVW: 'Volkswagen', WV1: 'Volkswagen', WV2: 'Volkswagen',
    WP0: 'Porsche', WP1: 'Porsche',
    WMW: 'MINI',
    W0L: 'Opel',
    TRU: 'Audi (Unkaria)',
    TMB: 'Škoda',
    // ── Fransa ────────────────────────────────────────────────────────────
    VF1: 'Renault', VF3: 'Peugeot', VF7: 'Citroën',
    VF6: 'Renault',
    // ── İtalya ───────────────────────────────────────────────────────────
    ZAR: 'Alfa Romeo',
    ZFF: 'Ferrari',
    ZFA: 'Fiat', ZFC: 'Fiat',
    ZLA: 'Lancia',
    // ── İsveç ────────────────────────────────────────────────────────────
    YV1: 'Volvo', YV4: 'Volvo',
    // ── İngiltere ────────────────────────────────────────────────────────
    SAL: 'Land Rover', SAJ: 'Jaguar', SAR: 'Rover',
    // ── Japonya ──────────────────────────────────────────────────────────
    JHM: 'Honda', JH4: 'Honda',
    JTN: 'Toyota', JTD: 'Toyota', JTM: 'Toyota', JTJ: 'Lexus',
    JF1: 'Subaru', JF2: 'Subaru',
    JN1: 'Nissan', JN8: 'Nissan',
    JMZ: 'Mazda', JM1: 'Mazda',
    // ── Kore ────────────────────────────────────────────────────────────
    KMH: 'Hyundai', KNA: 'Kia', KNM: 'Renault Samsung',
    // ── ABD ──────────────────────────────────────────────────────────────
    '1G1': 'Chevrolet', '1G6': 'Cadillac', '1FA': 'Ford', '2FA': 'Ford',
    '1HG': 'Honda (ABD)',
    '4T1': 'Toyota (ABD)',
    // ── Tesla (özel)─────────────────────────────────────────────────────
    '5YJ': 'Tesla', '7SA': 'Tesla', '7G2': 'Tesla',
  };

  return table[wmi] ?? null;
}

/* ── Profil oluşturucu (DRY) ─────────────────────────────────────────────── */

function _buildProfile(opts: {
  id:          string;
  name:        string;
  vehicleType: VehicleType;
  vinPattern:  RegExp | null;
  protocol:    'OBD2' | 'CAN' | 'MIXED';
  mappings:    readonly SignalMapping[];
}): IVehicleProfile {
  const byId  = new Map<string, SignalMapping>();
  const byFld = new Map<keyof NormalizedVehicleData, SignalMapping[]>();

  for (const m of opts.mappings) {
    byId.set(m.sourceId, m);
    const list = byFld.get(m.field) ?? [];
    list.push(m);
    byFld.set(m.field, list);
  }

  const srcs = new Set(opts.mappings.map((m) => m.source)) as Set<SignalSource>;

  return {
    id:          opts.id,
    name:        opts.name,
    protocol:    opts.protocol,
    vehicleType: opts.vehicleType,
    vinPattern:  opts.vinPattern,
    mappings:    opts.mappings,
    sources:     srcs as ReadonlySet<SignalSource>,
    lookup:      (sid) => byId.get(sid),
    byField:     (f)   => byFld.get(f) ?? [],
  };
}

/* ══════════════════════════════════════════════════════════════════════════
   Paylaşılan sinyal eşleme setleri
══════════════════════════════════════════════════════════════════════════ */

const OBD_SPEED_MAPPING: SignalMapping = {
  sourceId: '0x0D', source: 'OBD', field: 'speed',
  rawUnit: 'kmh', targetUnit: 'kmh', formula: 'A (direct km/h)',
};
const OBD_RPM_MAPPING: SignalMapping = {
  sourceId: '0x0C', source: 'OBD', field: 'rpm',
  rawUnit: 'rpm', targetUnit: 'rpm', formula: '(A×256 + B) / 4',
};
const OBD_FUEL_MAPPING: SignalMapping = {
  sourceId: '0x2F', source: 'OBD', field: 'fuel',
  rawUnit: 'percent', targetUnit: 'percent', formula: 'A / 2.55',
};
const OBD_COOLANT_MAPPING: SignalMapping = {
  sourceId: '0x05', source: 'OBD', field: 'coolantTemp',
  rawUnit: 'celsius', targetUnit: 'celsius', formula: 'A − 40',
};
const OBD_VOLT_MAPPING: SignalMapping = {
  sourceId: '0x42', source: 'OBD', field: 'batteryVolt',
  rawUnit: 'volts', targetUnit: 'volts', formula: '(A×256 + B) / 1000',
};
const OBD_THROTTLE_MAPPING: SignalMapping = {
  sourceId: '0x11', source: 'OBD', field: 'throttle',
  rawUnit: 'percent', targetUnit: 'percent', formula: 'A / 2.55',
};

const CAN_MAPPINGS: readonly SignalMapping[] = [
  { sourceId: 'can:speed',       source: 'CAN', field: 'speed',       rawUnit: 'kmh',     targetUnit: 'kmh',                   formula: 'direct' },
  { sourceId: 'can:rpm',         source: 'CAN', field: 'rpm',         rawUnit: 'rpm',     targetUnit: 'rpm',                   formula: 'direct' },
  { sourceId: 'can:fuel',        source: 'CAN', field: 'fuel',        rawUnit: 'percent', targetUnit: 'percent',               formula: 'direct' },
  { sourceId: 'can:coolantTemp', source: 'CAN', field: 'coolantTemp', rawUnit: 'celsius', targetUnit: 'celsius',               formula: 'direct' },
  { sourceId: 'can:ambientTemp', source: 'CAN', field: 'ambientTemp', rawUnit: 'celsius', targetUnit: 'celsius',               formula: 'direct' },
  { sourceId: 'can:batteryVolt', source: 'CAN', field: 'batteryVolt', rawUnit: 'volts',   targetUnit: 'volts',                 formula: 'direct' },
  { sourceId: 'can:gearPos',     source: 'CAN', field: 'gearPos',     rawUnit: 'degrees', targetUnit: 'enum(-1=R,0=N,1-8=fwd)', formula: 'direct' },
  { sourceId: 'can:tpms',        source: 'CAN', field: 'tpms',        rawUnit: 'kpa',     targetUnit: 'kpa',                   formula: 'direct array [FL,FR,RL,RR]' },
];

const GPS_MAPPINGS: readonly SignalMapping[] = [
  { sourceId: 'gps:speed',    source: 'GPS', field: 'speed',    rawUnit: 'mps',     targetUnit: 'kmh',    formula: 'speedMs × 3.6; deadzone < 0.8 km/h → 0' },
  { sourceId: 'gps:heading',  source: 'GPS', field: 'heading',  rawUnit: 'degrees', targetUnit: 'degrees', formula: 'direct' },
  { sourceId: 'gps:location', source: 'GPS', field: 'location', rawUnit: 'degrees', targetUnit: 'degrees', formula: '{lat, lng, accuracy}' },
];

/* ══════════════════════════════════════════════════════════════════════════
   Profil tanımları
══════════════════════════════════════════════════════════════════════════ */

/** ICE / Dizel / varsayılan: tüm OBD-II sinyalleri + CAN + GPS */
export const StandardProfile: IVehicleProfile = _buildProfile({
  id:          'standard',
  name:        'Standard OBD-II + CAN (ICE)',
  vehicleType: 'ice',
  vinPattern:  null,
  protocol:    'MIXED',
  mappings: [
    OBD_SPEED_MAPPING, OBD_RPM_MAPPING, OBD_FUEL_MAPPING,
    OBD_COOLANT_MAPPING, OBD_VOLT_MAPPING, OBD_THROTTLE_MAPPING,
    ...CAN_MAPPINGS, ...GPS_MAPPINGS,
  ],
});

/**
 * EV profil: RPM, yakıt ve motor sıcaklığı OBD PID'leri dışlanır.
 * Bu PID'ler EV'de NO-DATA döner → her biri 200ms ELM327 timeout → 600ms/döngü kayıp.
 * Yalnızca hız + voltaj + CAN + GPS aktif.
 *
 * VIN deseni: Tesla WMI başlangıçları (5YJ, 7SA, 7G2).
 */
export const EVProfile: IVehicleProfile = _buildProfile({
  id:          'ev',
  name:        'Electric Vehicle (EV)',
  vehicleType: 'ev',
  vinPattern:  /^[57][YSG]/,
  protocol:    'MIXED',
  mappings: [
    OBD_SPEED_MAPPING, OBD_VOLT_MAPPING, OBD_THROTTLE_MAPPING,
    ...CAN_MAPPINGS, ...GPS_MAPPINGS,
  ],
});

/**
 * Dizel profil: standart ICE + turbo boost basıncı eklenir.
 * VIN deseni: yok (PID bitmask heuristic ile belirlenir).
 */
export const DieselProfile: IVehicleProfile = _buildProfile({
  id:          'diesel',
  name:        'Diesel Engine',
  vehicleType: 'diesel',
  vinPattern:  null,
  protocol:    'MIXED',
  mappings: [
    OBD_SPEED_MAPPING, OBD_RPM_MAPPING, OBD_FUEL_MAPPING,
    OBD_COOLANT_MAPPING, OBD_VOLT_MAPPING, OBD_THROTTLE_MAPPING,
    ...CAN_MAPPINGS, ...GPS_MAPPINGS,
  ],
});

/**
 * Hibrit profil: ICE + EV PID setlerinin birleşimi.
 * VIN deseni: yok.
 */
export const HybridProfile: IVehicleProfile = _buildProfile({
  id:          'hybrid',
  name:        'Hybrid / PHEV',
  vehicleType: 'hybrid',
  vinPattern:  null,
  protocol:    'MIXED',
  mappings: [
    OBD_SPEED_MAPPING, OBD_RPM_MAPPING, OBD_FUEL_MAPPING,
    OBD_COOLANT_MAPPING, OBD_VOLT_MAPPING, OBD_THROTTLE_MAPPING,
    ...CAN_MAPPINGS, ...GPS_MAPPINGS,
  ],
});

/* ══════════════════════════════════════════════════════════════════════════
   VehicleProfileRegistry — Profil deposu & otomatik seçim
══════════════════════════════════════════════════════════════════════════ */

/**
 * PID numaraları (decimal) — SAE J1979 Mode 01 PID 00 bitmask'ından okunur.
 * Mode 01 PID 00: PIDs 01–32 arası bitmask.
 */
const PID_RPM   = 0x0C; // 12
const PID_TEMP  = 0x05; // 5
const PID_SPEED = 0x0D; // 13

export class VehicleProfileRegistry {
  private readonly _profiles: IVehicleProfile[];
  private readonly _byId:     Map<string, IVehicleProfile>;

  constructor(profiles: IVehicleProfile[]) {
    this._profiles = profiles;
    this._byId     = new Map(profiles.map((p) => [p.id, p]));
  }

  getById(id: string): IVehicleProfile | undefined {
    return this._byId.get(id);
  }

  /**
   * En iyi eşleşen profili seçer.
   *
   * Öncelik sırası:
   *   1. VIN deseni — VIN varsa ve bir profilin `vinPattern`'i eşleşiyorsa seç.
   *   2. PID bitmask heuristic — VIN yoksa veya desen eşleşmezse:
   *        • PID 0x0C (RPM) yoksa → EV profil
   *        • PID 0x05 (Sıcaklık) ve PID 0x2F (Yakıt) her ikisi de yoksa → EV profil
   *        • Aksi hâlde → StandardProfile (ICE fallback)
   *   3. Hiçbiri eşleşmezse StandardProfile döner.
   *
   * @param vin           17-char VIN ya da null
   * @param supportedPids Mode 01 PID 00'dan ayrıştırılmış desteklenen PID Set'i
   */
  findBestMatch(vin: string | null, supportedPids: Set<number>): IVehicleProfile {
    // 1. VIN desen eşleştirme
    if (vin) {
      for (const p of this._profiles) {
        if (p.vinPattern?.test(vin)) return p;
      }
    }

    // 2. PID bitmask heuristik — yalnızca PID bilgisi anlamlıysa uygula
    if (supportedPids.size > 0) {
      const hasRpm   = supportedPids.has(PID_RPM);
      const hasTemp  = supportedPids.has(PID_TEMP);
      const hasSpeed = supportedPids.has(PID_SPEED);

      // Kesin EV tespiti: hız var (OBD-II zorunlu) ama RPM yok
      if (hasSpeed && !hasRpm) {
        return this._byId.get('ev') ?? StandardProfile;
      }

      // Güçlü EV ipucu: hız var, motor sıcaklığı yok
      if (hasSpeed && !hasTemp) {
        return this._byId.get('ev') ?? StandardProfile;
      }
    }

    // 3. Varsayılan
    return StandardProfile;
  }
}

/** Singleton kayıt defteri — tüm bilinen profilleri içerir */
export const vehicleProfileRegistry = new VehicleProfileRegistry([
  StandardProfile,
  EVProfile,
  DieselProfile,
  HybridProfile,
]);
