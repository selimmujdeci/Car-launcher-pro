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
