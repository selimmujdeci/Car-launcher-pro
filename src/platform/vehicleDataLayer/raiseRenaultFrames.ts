/**
 * raiseRenaultFrames — NWD/Raise CAN kutusu ham çerçeve çözücüsü (Renault Megane 4). SAF.
 *
 * KAYNAK (kanıt, 2026-10-02):
 *  · NWD `CanProtocalUtil` çözücüsü (dexdump): responseTPMSInfo · responseTripInfo ·
 *    responseCentralState bayt/bit eşlemeleri birebir.
 *  · Saha: kullanıcının NWD ekranında okuduğu değerler (lastik 2,4 / 2,4 / 2,0 / 1,9 bar ·
 *    ort. tüketim 6,1) ham çerçevelerle karşılaştırıldı.
 *
 * Girdi: `canRaiseFrame` olayının veri bölümü (tip/uzunluk/sağlama HARİÇ, native
 * `NwdRawFrameTap` sağlamayı doğruladıktan sonra iletir).
 * Bilinmeyen değer `null`dır — sahte 0 ÜRETİLMEZ (CLAUDE.md §8).
 */

export interface CanClimateState {
  readonly power:          boolean | null;  // klima sistemi açık
  readonly ac:             boolean | null;  // A/C kompresörü
  readonly auto:           boolean | null;
  readonly dual:           boolean | null;
  readonly recirc:         boolean | null;  // iç hava
  readonly defrostFront:   boolean | null;
  readonly defrostRear:    boolean | null;
  readonly fanLevel:       number | null;
  readonly fanMax:         number | null;
  readonly tempDriverC:    number | null;
  readonly tempPassengerC: number | null;
}

export interface CanDoorsState {
  readonly frontLeft:  boolean;
  readonly frontRight: boolean;
  readonly rearLeft:   boolean;
  readonly rearRight:  boolean;
  readonly trunk:      boolean;
}

export type TirePressures = readonly [number | null, number | null, number | null, number | null];

export interface CanTpmsState {
  /** Ham durum kodu (0 = uyarı yok). Diğer kodların anlamı belgelenmedi → yorumlanmaz. */
  readonly statusCode: number;
  /** [ön sol, ön sağ, arka sol, arka sağ] bar; null = bu teker henüz ölçülmedi. */
  readonly bar: TirePressures;
  readonly atMs: number;
}

export interface CanTripState {
  readonly avgFuelL100km: number | null;
  readonly avgSpeedKmh:   number | null;
  readonly totalKm:       number | null;
  readonly atMs:          number;
}

export interface CanMassageState {
  readonly driverOn:    boolean | null;
  readonly mode:        number | null;
  readonly strength:    number | null;
  readonly speed:       number | null;
  readonly passengerOn: boolean | null;
  readonly atMs:        number;
}

export interface CanAmbientState {
  readonly on:         boolean;
  readonly front:      boolean;
  readonly rear:       boolean;
  /** Kutunun renk numarası (0–7). Ada eşlemesi sahada doğrulanmalı. */
  readonly colorIndex: number;
  readonly brightness: number;
  readonly atMs:       number;
}

/** Raise yanıt tipleri (NWD `ProtocalConst$ResponseType`). */
export const RAISE_TYPE = Object.freeze({
  TPMS:     0x61,
  TRIP:     0x81,
  CENTRAL1: 0x71,
  CENTRAL2: 0x72,
  CENTRAL3: 0x73,
});

/** Merkezi ayar numaraları — yazma (2E 83 02 <no> <değer>) ve okuma (0x72) AYNI. */
export const CENTRAL_ID = Object.freeze({
  MASSAGE_DRIVER_ON:    0x90,
  MASSAGE_MODE:         0x91,
  MASSAGE_STRENGTH:     0x92,
  MASSAGE_SPEED:        0x93,
  MASSAGE_PASSENGER_ON: 0x94,
  AMBIENT_ON:           0x15,
  AMBIENT_FRONT:        0x16,
  AMBIENT_REAR:         0x17,
  AMBIENT_COLOR:        0x18,
  AMBIENT_BRIGHTNESS:   0x19,
});

/**
 * Ambiyans renk numarası → ad. KAYNAK: NWD `CanAllInOne.apk` kaynakları
 * (`array_mLamp_AmbientColor_ls` → `array_color_*`, 2026-10-02) — kutunun
 * numarasını NWD ekranı bu adlarla gösterir. Aracın gerçek rengi sahada TEK TEK
 * doğrulanmadı. (NWD Türkçe çevirisi 7'ye de "mavi" der; ayırt etmek için turkuaz.)
 */
export const AMBIENT_COLOR_NAMES: readonly string[] = Object.freeze([
  'beyaz', 'kırmızı', 'mavi', 'turuncu', 'mor', 'gri', 'yeşil', 'turkuaz',
]);

/** Masaj modu numarası → ad (NWD `array_mSeat_SeatMassageMode_ls`: relaxing · lumbar · tonic). */
export const MASSAGE_MODE_NAMES: readonly string[] = Object.freeze(['dinlendirici', 'bel', 'tonik']);

/** NWD arayüz aralıkları (native beyaz liste ile aynı): şiddet 0–4 (ekranda 1–5). */
export const MASSAGE_STRENGTH_MAX = 4;
/** Saha: kutu parlaklığı 0–100 ölçeğinde bildiriyor (gözlenen 50); adım 10. */
export const AMBIENT_BRIGHTNESS_MAX = 100;
export const AMBIENT_BRIGHTNESS_STEP = 10;

export function hexToBytes(hex: string): number[] | null {
  if (typeof hex !== 'string' || hex.length % 2 !== 0 || !/^[0-9A-Fa-f]*$/.test(hex)) return null;
  const out: number[] = [];
  for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
  return out;
}

/** NWD `getTpmsValue`: 0 ve 0xFF = ölçüm yok; aksi hâlde ham × 0,03 bar. */
function tireBar(raw: number): number | null {
  if (raw === 0 || raw === 0xff) return null;
  return Math.round(raw * 3) / 100;
}

/** 0x61: [durum, ön sol, ön sağ, arka sol, arka sağ]. */
export function decodeTpms(d: readonly number[], atMs: number): CanTpmsState | null {
  if (d.length < 5) return null;
  return Object.freeze({
    statusCode: d[0]!,
    bar: Object.freeze([tireBar(d[1]!), tireBar(d[2]!), tireBar(d[3]!), tireBar(d[4]!)]) as TirePressures,
    atMs,
  });
}

function u16(d: readonly number[], i: number): number {
  return ((d[i]! & 0xff) << 8) | (d[i + 1]! & 0xff);
}

/** 0x81 (Renault): [0–1] ort. tüketim ÷10 · [2–3] ort. hız ÷10 · [4–5]+bit [6].0 toplam km ÷10. */
export function decodeTrip(d: readonly number[], atMs: number): CanTripState | null {
  if (d.length < 7) return null;
  const fuel  = u16(d, 0);
  const speed = u16(d, 2);
  const km    = ((d[6]! & 0x01) << 16) | u16(d, 4);
  return Object.freeze({
    avgFuelL100km: fuel === 0xffff ? null : fuel / 10,
    avgSpeedKmh:   speed === 0xffff ? null : speed / 10,
    totalKm:       (u16(d, 4) === 0xffff) ? null : km / 10,
    atMs,
  });
}

/** 0x71: [7] bit5 ambiyans · bit4 ön · bit3 arka · bit0-2 renk; [8] parlaklık. */
export function decodeAmbient(d: readonly number[], atMs: number): CanAmbientState | null {
  if (d.length < 9) return null;
  const b = d[7]!;
  return Object.freeze({
    on:         (b & 0x20) !== 0,
    front:      (b & 0x10) !== 0,
    rear:       (b & 0x08) !== 0,
    colorIndex: b & 0x07,
    brightness: d[8]!,
    atMs,
  });
}

const EMPTY_MASSAGE = {
  driverOn: null, mode: null, strength: null, speed: null, passengerOn: null,
} as const;

/** 0x72: [ayar no, değer] — masaj alanlarını bir öncekinin üzerine işler; masaj dışı → null. */
export function applyMassageItem(
  prev: CanMassageState | null, d: readonly number[], atMs: number,
): CanMassageState | null {
  if (d.length < 2) return null;
  const [id, v] = [d[0]!, d[1]!];
  const base = prev ?? { ...EMPTY_MASSAGE, atMs };
  switch (id) {
    case CENTRAL_ID.MASSAGE_DRIVER_ON:    return Object.freeze({ ...base, driverOn: v !== 0, atMs });
    case CENTRAL_ID.MASSAGE_MODE:         return Object.freeze({ ...base, mode: v, atMs });
    case CENTRAL_ID.MASSAGE_STRENGTH:     return Object.freeze({ ...base, strength: v, atMs });
    case CENTRAL_ID.MASSAGE_SPEED:        return Object.freeze({ ...base, speed: v, atMs });
    case CENTRAL_ID.MASSAGE_PASSENGER_ON: return Object.freeze({ ...base, passengerOn: v !== 0, atMs });
    default: return null;
  }
}
