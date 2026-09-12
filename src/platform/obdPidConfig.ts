import type { VehicleType } from './obdTypes';

/**
 * SAE J1979 (Mode 01) PID listesini araç tipine göre döner.
 *
 * EV'de ICE PID'leri (0x0C RPM, 0x05 ECT, 0x2F Fuel) sorgulamak neden
 * tehlikelidir: ELM327 her desteklenmeyen PID için 200 ms NO-DATA bekler.
 * 3 PID × 200 ms = 600 ms kayıp / poll cycle. Bazı ELM327 klonları arka
 * arkaya NO-DATA aldıklarında RFCOMM akışını bozar (AT komutları kayar →
 * disconnected). ISO 15031-5 §6.3.3: ECU P3 timeout = 55 ms; ELM327 default
 * = 200 ms.  EV için sadece 0x0D (speed) + OEM batarya PID'leri sorgulanmalı.
 */

const UNIVERSAL_PIDS  = ['0x0D'];                                        // PID 0x0D: speed
const ICE_PIDS        = ['0x0C', '0x05', '0x11', '0x0F'];               // RPM, ECT, throttle, IAT
// 0x2F (fuel) kaldırıldı — Fiat/PSA/Renault araçlarının çoğu desteklemiyor,
// her cycle'da 200ms NO-DATA bekletir, RPM güncellemesini yavaşlatır.
// Yakıt seviyesi ATMA/ham CAN yoluyla alınacak.
const DIESEL_PIDS     = [...ICE_PIDS, '0x0B'];                           // + manifold pressure (boost)

export function getPidListForVehicle(type: VehicleType): string[] {
  switch (type) {
    case 'ev':     return UNIVERSAL_PIDS;                         // EV: sadece hız; batarya OEM-specific
    case 'ice':    return [...UNIVERSAL_PIDS, ...ICE_PIDS];
    case 'diesel': return [...UNIVERSAL_PIDS, ...DIESEL_PIDS];
    case 'hybrid':
    case 'phev':   return [...UNIVERSAL_PIDS, ...ICE_PIDS];       // ICM aktif olduğunda tam set
    default:       return [...UNIVERSAL_PIDS, ...ICE_PIDS];
  }
}

/* ══════════════════════════════════════════════════════════════════════════
   Capability-güdümlü poll listesi rafinasyonu (W5-OBD-PR1)

   Handshake bitmap keşfinden gelen KANIT ile statik listeyi rafine eder.
   Statik `getPidListForVehicle` tabanı DEĞİŞMEZ (fail-soft): handshake
   çalışmadıysa/başarısızsa taban aynen döner → mevcut poll zinciri regresyonsuz.
══════════════════════════════════════════════════════════════════════════ */

/** PID 0x2F — yakıt seviyesi (yalnız bitmap kanıtı varsa oto-aktive edilir). */
const FUEL_PID_HEX  = '0x2F';
const FUEL_PID_NUM  = 0x2F;
const BLOCK_SIZE    = 32;

/** '0x0D' / '0x2f' → 13 / 47 (decimal). Geçersizse null. */
function _pidToNumber(pidStr: string): number | null {
  const n = parseInt(pidStr.replace(/^0x/i, ''), 16);
  return Number.isNaN(n) ? null : n;
}

/** PID'i yöneten bitmap bloğunun taban probe PID'i (0x00/0x20/0x40 …). */
function _governingBlock(pidNum: number): number {
  return Math.floor((pidNum - 1) / BLOCK_SIZE) * BLOCK_SIZE;
}

/**
 * Handshake keşfiyle statik poll listesini rafine eder.
 *
 * Zero-trust + fail-soft disiplini:
 *  • `readBlocks` boşsa (kanıt yok) → taban liste AYNEN döner (regresyonsuz).
 *  • Bir taban PID YALNIZ yöneten bloğu gerçekten okundu VE bit 0 ise ELENİR
 *    (kanıtlı desteklenmiyor). Okunmayan blok PID'i "bilinmiyor" → KORUNUR.
 *  • PID 0x2F (yakıt) bitmap'te KANITLI destekleniyorsa listeye eklenir
 *    (statik kara liste kaldırıldı — varsayım yok, yalnız pozitif kanıt).
 *
 * @param base        `getPidListForVehicle` çıktısı ('0x0D' biçimi).
 * @param supported   Handshake'ten ayrıştırılmış desteklenen PID numaraları.
 * @param readBlocks  Gerçekten okunan bitmap bloklarının taban PID'leri.
 * @returns Rafine edilmiş, sırası korunmuş PID listesi (kopya — girdi mutasyona uğramaz).
 */
export function refinePidList(
  base: readonly string[],
  supported: ReadonlySet<number>,
  readBlocks: ReadonlySet<number>,
): string[] {
  // Kanıt yok → hiç dokunma (fail-soft; mevcut davranış birebir korunur).
  if (readBlocks.size === 0) return [...base];

  const out: string[] = [];
  for (const pidStr of base) {
    const num = _pidToNumber(pidStr);
    if (num == null) { out.push(pidStr); continue; } // AT komutu vb. — dokunma
    const block = _governingBlock(num);
    // Yöneten blok okunmadıysa → "bilinmiyor" → koru (zero-trust, regresyonsuz).
    if (!readBlocks.has(block)) { out.push(pidStr); continue; }
    // Blok okundu → yalnız kanıtlı destekleniyorsa tut.
    if (supported.has(num)) out.push(pidStr);
  }

  // Yakıt (0x2F): bitmap'te kanıtlı destekleniyorsa oto-aktive et.
  if (supported.has(FUEL_PID_NUM) && !out.some((p) => _pidToNumber(p) === FUEL_PID_NUM)) {
    out.push(FUEL_PID_HEX);
  }

  return out;
}
