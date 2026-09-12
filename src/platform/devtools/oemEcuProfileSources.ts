/**
 * oemEcuProfileSources — CAROS LAB · OEM ECU Profilleri ekranının TEK OKUMA KATMANI.
 *
 * SENKRON: her getter try/catch'lidir ve okunamayan alan `null` döner (sahte 0 /
 * sahte "sağlıklı" YASAK). Hiçbir şey BAŞLATMAZ: tarama · keşif · el sıkışması ·
 * OBD komutu · timer YOK. Ekranı açmak araca tek bayt göndermez.
 *
 * GİZLİLİK (CLAUDE.md §6): HAM VIN bu katmandan GEÇMEZ — yalnız VAR/YOK ve WMI
 * (VIN'in ilk 3 hanesi; üretici tahsisi, kişi tanımlayıcı değil ve profil
 * eşleşmesinin "neden/neden değil" sorusunun tek yanıtı odur). Konum, kullanıcı
 * verisi, API anahtarı ve ham komut/transkript taşınmaz.
 */

import { getEcuInventory, type EcuInventory } from '../obd/ecuIdentityService';
import { getObdSessionEpoch, getHandshakeDiagnostics } from '../obdService';
import { OEM_ECU_PROFILES, getProductOemProfiles, validateOemProfileRegistry } from '../obd/oem/oemProfileRegistry';
import type { OemEcuProfile } from '../obd/oem/oemEcuProfile';

export interface OemProfileSourceSnapshot {
  /** Defterdeki TÜM profiller (doğrulanmış + doğrulanmamış). */
  readonly all: readonly OemEcuProfile[];
  /** Ürün yoluna girebilen profiller (yalnız doğrulanmış ECU'larıyla). */
  readonly product: readonly OemEcuProfile[];
  /** Defterin yapısal doğrulama hataları — boş dizi = defter tutarlı. */
  readonly registryErrors: readonly string[];
  /** Son ECU envanteri; hiç üretilmediyse `null`. */
  readonly inventory: EcuInventory | null;
  /** Envanter başka bir OBD oturumuna aitse `true` (bayat). */
  readonly inventoryStale: boolean;
  /** Aktif OBD oturum numarası; okunamadıysa `null`. */
  readonly sessionEpoch: number | null;
  /** Aktif protokol hanesi (ATDPN ile GERÇEKTEN okunan); okunamadıysa `null`. */
  readonly protocolActive: string | null;
  /** VIN okundu mu — HAM DEĞER TAŞINMAZ. */
  readonly vinPresent: boolean;
  /** VIN'in WMI öneki (3 hane); yoksa `null`. */
  readonly wmi: string | null;
}

function _safe<T>(fn: () => T, fallback: T): T {
  try { return fn(); } catch { return fallback; }
}

/** Tek atışta anlık görüntü — çağıran (ekran) bunu açılışta ve elle YENİLE ile okur. */
export function readOemProfileSources(): OemProfileSourceSnapshot {
  const inv = _safe(() => getEcuInventory(), { inventory: null, stale: false, runs: 0 });

  const handshake = _safe<Record<string, unknown> | null>(
    () => getHandshakeDiagnostics() as unknown as Record<string, unknown>, null);
  const protoRaw = handshake === null ? null : handshake.protocolActive ?? handshake.protocol;
  const protocolActive = typeof protoRaw === 'string' && protoRaw.length > 0 ? protoRaw : null;

  /* VIN yalnız VARLIK ve WMI olarak taşınır — ham değer bu katmandan ÇIKMAZ. */
  const vinRaw = handshake === null ? null : handshake.vin;
  const vin = typeof vinRaw === 'string' && vinRaw.trim().length >= 3 ? vinRaw.trim() : null;

  return {
    all: _safe(() => OEM_ECU_PROFILES, []),
    product: _safe(() => getProductOemProfiles(), []),
    registryErrors: _safe(() => validateOemProfileRegistry(), ['defter doğrulanamadı']),
    inventory: inv.inventory,
    inventoryStale: inv.stale,
    sessionEpoch: _safe<number | null>(() => getObdSessionEpoch(), null),
    protocolActive,
    vinPresent: vin !== null,
    wmi: vin === null ? null : vin.slice(0, 3).toUpperCase(),
  };
}
