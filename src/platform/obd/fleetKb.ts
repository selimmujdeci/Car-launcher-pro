/**
 * fleetKb — Filo Bilgi Tabanı: araçtan öğren, sonraki sefere hazır gel (OBD-OS-F4-4).
 *
 * VİZYON BAĞLAMI: Tesla kendi aracını TANIR — ECU haritası, DID'leri, kod tabanı fabrikadan
 * bellidir. Biz BİLMEDİĞİMİZ yüzlerce marka/modele bakıyoruz. Tek üstünlüğümüz ÖĞRENMEK:
 * bir araçta keşfettiğimiz topolojiyi (hangi ECU'lar var, hangi servisleri destekliyor)
 * saklarız; aynı araca dönünce keşfi baştan yapmayız, hazır geliriz.
 *
 * ⚠️ ZERO-TRUST — BU MODÜLÜN EN ÖNEMLİ KURALI:
 * Hafızadaki bilgi bir İDDİADIR, KANIT DEĞİLDİR. Araç değişmiş olabilir (aynı dongle başka
 * araca takıldı — sahada YAŞANDI: Doblo→Trafic), ECU sökülmüş olabilir, yazılım güncellenmiş
 * olabilir. Bu yüzden öğrenilen topoloji **poll/teşhis kararlarını DOĞRUDAN beslemez**;
 * yalnız "nereye bakacağımızı" söyler — bulgular yine CANLI KANITLA doğrulanır.
 * Öğrenilen ECU yanıt vermiyorsa envanterden DÜŞER (hafızaya değil, araca inanırız).
 *
 * FINGERPRINT: VIN varsa VIN (en güçlü). VIN yoksa desteklenen-PID bitmap + ECU adresleri
 * karması (aynı model aynı imzayı üretir). Fingerprint YOKSA öğrenme YAPILMAZ — yanlış araca
 * yanlış profil yüklemek, hiç profil yüklememekten kötüdür.
 *
 * TİCARİ LİSANS (CLAUDE.md): öğrenilen veri KULLANICININ KENDİ ARACINDAN gelir — hiçbir
 * üçüncü-taraf kod tabanı/veri seti gömülmez (kopyaleft/NC risk yok).
 *
 * SAF: modül-durumu yok, I/O yok — depolama çağırana ait (test edilebilir).
 */

import type { DiscoveredEcu, VehicleTopology } from './ecuDiscovery';

/** Öğrenilmiş araç profili — İDDİA, kanıt değil (canlı doğrulama şart). */
export interface FleetProfile {
  /** Araç kimliği: VIN (varsa) veya türetilmiş imza. */
  fingerprint: string;
  /** Kimliğin kaynağı — güven seviyesini belirler. */
  fingerprintSource: 'vin' | 'signature';
  /** Keşfedilen ECU'lar (tx/rx/rol). */
  ecus: DiscoveredEcu[];
  /** UDS 0x19'u destekleyen ECU'lar (tx header) — sonraki taramada doğrudan sorulur. */
  udsCapableEcus: string[];
  /** Kaç kez doğrulandı — güven bununla artar (tek gözlem KANIT DEĞİLDİR). */
  observationCount: number;
  /** Son görülme (Unix ms). */
  lastSeenAt: number;
}

/** Profilin ne kadar güvenilir olduğu — tek gözlemli profil zayıftır. */
export function profileConfidence(p: FleetProfile): number {
  const base = p.fingerprintSource === 'vin' ? 0.6 : 0.4;   // VIN daha güçlü kimlik
  // Her ek gözlem güveni artırır ama 1'e ASLA ulaşmaz (araç her an değişebilir).
  const observed = Math.min(0.35, p.observationCount * 0.1);
  return Number(Math.min(0.95, base + observed).toFixed(2));
}

/**
 * Araç imzası üretir. VIN varsa VIN kullanılır (en güçlü kimlik).
 * VIN yoksa: desteklenen PID sayısı + ECU adresleri → aynı model aynı imzayı üretir.
 *
 * FAIL-CLOSED: yeterli kanıt yoksa (ECU yok VE PID yok) → null. Kimliksiz öğrenme YASAK:
 * yanlış araca yanlış profil yüklemek, hiç profil yüklememekten KÖTÜDÜR.
 */
export function buildFingerprint(
  vin: string | null,
  ecus: DiscoveredEcu[],
  supportedPidCount: number,
): { fingerprint: string; source: 'vin' | 'signature' } | null {
  const v = (vin ?? '').trim().toUpperCase();
  if (v.length === 17) return { fingerprint: v, source: 'vin' };

  if (ecus.length === 0 && supportedPidCount === 0) return null;   // kanıt yok → öğrenme YOK

  const addrs = ecus.map((e) => e.txHeader).sort().join('-');
  return { fingerprint: `sig:${addrs}:${supportedPidCount}`, source: 'signature' };
}

/**
 * Yeni gözlemi profile işler (öğrenme). Var olan profil GÜNCELLENİR, gözlem sayısı artar.
 *
 * ÖNEMLİ: ECU listesi BİRLEŞTİRİLMEZ, DEĞİŞTİRİLİR. Neden: bir ECU artık yanıt vermiyorsa
 * (söküldü/bozuldu) hafızada tutmak YALAN olur. Araca inanırız, hafızaya değil.
 */
export function learnProfile(
  existing: FleetProfile | null,
  fingerprint: { fingerprint: string; source: 'vin' | 'signature' },
  topology: VehicleTopology,
  udsCapableEcus: string[],
  nowMs: number,
): FleetProfile {
  const sameVehicle = existing?.fingerprint === fingerprint.fingerprint;
  return {
    fingerprint: fingerprint.fingerprint,
    fingerprintSource: fingerprint.source,
    ecus: topology.ecus,                                   // CANLI kanıt kazanır
    udsCapableEcus: [...new Set(udsCapableEcus)],
    observationCount: sameVehicle ? (existing!.observationCount + 1) : 1,
    lastSeenAt: nowMs,
  };
}

/**
 * Öğrenilmiş profilden "nereye bakacağımızı" çıkarır — ama KANIT olarak DEĞİL, İPUCU olarak.
 *
 * Dönen ECU listesi taramaya HAZIR aday listesidir; her biri yine canlı prob/okuma ile
 * doğrulanır. Yanıt vermeyen aday envantere GİRMEZ (fail-closed).
 */
export function suggestScanTargets(profile: FleetProfile | null): {
  ecus: DiscoveredEcu[];
  udsFirst: string[];
  hint: string;
} {
  if (!profile || profile.ecus.length === 0) {
    return { ecus: [], udsFirst: [], hint: 'Bu araç daha önce taranmadı — tam keşif yapılacak.' };
  }
  return {
    ecus: profile.ecus,
    udsFirst: profile.udsCapableEcus,
    hint: `Bu araç daha önce ${profile.observationCount} kez tarandı — `
      + `${profile.ecus.length} ECU biliniyor (yine de canlı doğrulanacak).`,
  };
}

/**
 * Öğrenilen profil ile CANLI keşfi karşılaştırır — araç değişimi / ECU kaybı tespiti.
 *
 * Bu, sahada yaşanan "dongle Doblo'dan Trafic'e taşındı" vakasının teşhis karşılığıdır:
 * hafıza bir şey der, araç başka şey der → ARACA İNAN, hafızayı güncelle.
 */
export function diffProfile(profile: FleetProfile, live: VehicleTopology): {
  missing: string[];    // profilde var, araçta YOK (söküldü/bozuldu/araç değişti)
  added: string[];      // araçta var, profilde YOK (yeni öğrenilecek)
  vehicleChanged: boolean;
} {
  const known = new Set(profile.ecus.map((e) => e.txHeader));
  const seen = new Set(live.ecus.map((e) => e.txHeader));

  const missing = [...known].filter((a) => !seen.has(a));
  const added = [...seen].filter((a) => !known.has(a));

  // Hiçbir ortak ECU yoksa ve araç gerçekten yanıt veriyorsa → BAŞKA ARAÇ.
  const overlap = [...known].filter((a) => seen.has(a)).length;
  const vehicleChanged = live.ecus.length > 0 && overlap === 0;

  return { missing, added, vehicleChanged };
}
