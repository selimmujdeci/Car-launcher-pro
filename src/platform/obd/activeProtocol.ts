/**
 * activeProtocol — PR-OBD-KWP-1: aktif OBD protokolünün paylaşılan, bağımlılıksız kaydı.
 *
 * NEDEN AYRI MODÜL: manufacturerPidService / didDiscoveryService gibi veri-yolu katmanları
 * "şu an hangi protokol sınıfındayız?" bilgisine muhtaç (CAN profili KWP hattında sorgulanırsa
 * COMM_ERROR fırtınası doğar) — ama obdService'i import etmeleri döngüsel bağımlılık üretir.
 * Bu modül tek yazar (obdService: bağlantı başarısında ATDPN, kopmada null) + çok okuyucu
 * desenidir; hiçbir şey import etmez.
 *
 * ZERO-TRUST: değer YOKSA null döner — "bilinmiyor" ≠ "CAN". Okuyucular null'da
 * protokol-kısıtlı davranışları fail-soft atlamalıdır (kısıt uygulanamaz → sorgu serbest,
 * ama kanıt katmanı sonucu yine dürüst kaydeder).
 */

import { classifyProtocol, type ProtocolClass } from './protocolProfile';

let _active: string | null = null;

/** obdService yazar: bağlantı başarısında ATDPN rakamı (ör. '5'), kopmada null. */
export function setActiveObdProtocol(protocol: string | null): void {
  _active = protocol;
}

/** Aktif ELM protokol rakamı (ör. '5' = KWP fast) — bağlı değilken/bilinmiyorken null. */
export function getActiveObdProtocol(): string | null {
  return _active;
}

/** Aktif protokol SINIFI — bağlı değilken/bilinmiyorken null (unknown'dan ayrı: unknown =
 *  bağlıyız ama ATDPN çözülemedi; null = protokol bilgisi hiç yok). */
export function getActiveProtocolClass(): ProtocolClass | null {
  return _active === null ? null : classifyProtocol(_active);
}
