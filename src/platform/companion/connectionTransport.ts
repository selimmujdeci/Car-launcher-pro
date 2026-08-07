/**
 * connectionTransport.ts — Taşıma SÖZLEŞMESİ (P1-PREP · YALNIZ ARAYÜZ).
 *
 * ── BU DOSYADA UYGULAMA YOKTUR ──────────────────────────────────────────────
 * Burada YALNIZCA arayüz ve adapter sözleşmesi tanımlanır. Hiçbir taşıma
 * uygulanmaz: BLE · RFCOMM · USB · Wi-Fi Direct · TCP · vendor servisi · MCU
 * köprüsü için tek satır bağlantı kodu YOKTUR. `createBond` · `startDiscovery` ·
 * BLE tarama · RFCOMM/soket bağlantısı · izin isteği bu dosyada ve tüm companion
 * katmanında GEÇMEZ (statik tarama ile kilitli).
 *
 * ── NEDEN PULL (POLL) MODELİ, CALLBACK DEĞİL ────────────────────────────────
 * Adapter'lar `poll()` ile okunur; olay callback'i veya kendi timer'ı YOKTUR.
 * Gerekçe: callback tabanlı taşıma her adapter için ayrı abonelik yaşam döngüsü
 * (ve ayrı sızıntı riski) getirir. Depoda bu hata gerçekten yaşandı (sahipsiz
 * timer'lar, çift abonelik). Pull modelinde sahiplik TEK yerdedir: Session
 * Manager ne zaman okuyacağına karar verir, adapter hiçbir şey PLANLAMAZ.
 *
 * ── FAIL-SOFT SÖZLEŞMESİ ────────────────────────────────────────────────────
 * Uygulayan hiçbir metot THROW ETMEZ; her sonuç `TransportResult` ile döner ve
 * hata SABİT KOD taşır. "Başarılı gibi davran" YOKTUR.
 */

import type { CompanionErrorCode, CompanionTransportType } from './companionDomain';
import type { CompanionEnvelope } from './messageEnvelope';

/* ══════════════════════════════════════════════════════════════════════════
 * Sonuç tipleri
 * ════════════════════════════════════════════════════════════════════════ */

export interface TransportResult {
  readonly ok: boolean;
  readonly error: CompanionErrorCode | null;
}

export const TRANSPORT_OK: TransportResult = Object.freeze({ ok: true, error: null });

export function transportFail(error: CompanionErrorCode): TransportResult {
  return Object.freeze({ ok: false, error });
}

/**
 * Taşımanın açıklığı. GERÇEK BİR SOKET DURUMU DEĞİLDİR — adapter'ın kendi
 * beyanıdır ve doğrulanmamış kabul edilir.
 */
export type TransportLinkState = 'CLOSED' | 'OPENING' | 'OPEN' | 'ERROR' | 'UNKNOWN';

export interface TransportStatus {
  readonly type: CompanionTransportType;
  readonly link: TransportLinkState;
  /** Adapter GERÇEKTEN uygulanmış mı (bu fazda yalnız MOCK true). */
  readonly implemented: boolean;
  /** Gönderilmeye hazır mı (link OPEN ve hata yok). */
  readonly writable: boolean;
  /** Bekleyen gelen mesaj sayısı — sahte 0 değil, gerçek kuyruk boyu. */
  readonly inboundQueued: number;
  readonly sentCount: number;
  readonly receivedCount: number;
  readonly lastErrorCode: CompanionErrorCode | null;
}

/** Adapter'ın kendini tanıtması — PII TAŞIMAZ (cihaz adı/adres YOK). */
export interface TransportDescriptor {
  readonly type: CompanionTransportType;
  /** Kararlı, kimlik taşımayan adapter kimliği (ör. 'mock-1'). */
  readonly adapterId: string;
  readonly implemented: boolean;
  /** Bu adapter'ın BEYAN ettiği azami yük (karakter). */
  readonly maxPayloadChars: number;
  /**
   * Sözleşme gereği desteklemesi gerekmeyen, bu adapter'da EKSİK olan yetenekler
   * (sabit kod listesi) — "her şeyi yapabilir" varsayımını engeller.
   */
  readonly limitations: readonly string[];
}

/** Gelen kayıt — zarf HAM haliyle gelir; doğrulama üst katmanın işidir. */
export interface TransportInbound {
  readonly receivedAt: number;
  /** Ham gövde: geçerli zarf OLMAYABİLİR (bozuk kanıtı kaybetmemek için). */
  readonly raw: unknown;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Adapter sözleşmesi
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * ConnectionTransport — tüm Companion taşımalarının ortak sözleşmesi.
 *
 * SÖZLEŞME KURALLARI (uygulayan HER adapter için bağlayıcı):
 *  1. Hiçbir metot THROW ETMEZ.
 *  2. Hiçbir metot TIMER kurmaz, abonelik açmaz, izin İSTEMEZ.
 *  3. `open()` yalnız adapter'ın kendi kaynağını hazırlar; sistem seviyesinde
 *     eşleştirme/keşif/tarama BAŞLATMAZ.
 *  4. `close()` İDEMPOTENTTİR ve tüm kaynağı bırakır (zero-leak).
 *  5. `poll()` çağrılana kadar hiçbir veri işlenmez; adapter kendi başına
 *     üst katmanı UYANDIRMAZ.
 *  6. `send()` uygulama mesajı gönderim kapısını KENDİ kontrol etmez — durum
 *     kapısı (yalnız CONNECTED/DEGRADED) Session Manager'ın sorumluluğudur.
 */
export interface ConnectionTransport {
  readonly type: CompanionTransportType;
  readonly adapterId: string;

  describe(): TransportDescriptor;

  /** Adapter kaynağını hazırlar. Sistem eşleştirmesi/keşfi BAŞLATMAZ. */
  open(): TransportResult;

  /** İdempotent kapatma — tüm kaynağı bırakır. */
  close(): TransportResult;

  /** Zarfı kuyruğa verir. Gerçek gönderim garantisi ACK ile doğrulanır. */
  send(envelope: CompanionEnvelope): TransportResult;

  /** Bekleyen gelenleri TÜKETEREK döndürür (bounded). Timer kurmaz. */
  poll(): readonly TransportInbound[];

  status(): TransportStatus;
}

/* ══════════════════════════════════════════════════════════════════════════
 * Uygulanmamış taşımalar için ortak yer tutucu
 * ════════════════════════════════════════════════════════════════════════ */

/**
 * Uygulanmamış bir taşıma tipi için DÜRÜST yer tutucu.
 *
 * Neden var: `transportType` bir gün BLE olarak yapılandırılırsa, kod sessizce
 * "bağlandı" davranmak yerine `TRANSPORT_NOT_IMPLEMENTED` döndürmelidir. Bu
 * fabrika o dürüst reddi tek yerde üretir — her çağrı fail-closed'dur.
 */
export function createUnimplementedTransport(
  type: CompanionTransportType, adapterId = 'unimplemented',
): ConnectionTransport {
  const descriptor: TransportDescriptor = Object.freeze({
    type,
    adapterId,
    implemented: false,
    maxPayloadChars: 0,
    limitations: Object.freeze(['NOT_IMPLEMENTED_IN_THIS_BUILD']),
  });
  const status: TransportStatus = Object.freeze({
    type,
    link: 'CLOSED',
    implemented: false,
    writable: false,
    inboundQueued: 0,
    sentCount: 0,
    receivedCount: 0,
    lastErrorCode: 'TRANSPORT_NOT_IMPLEMENTED',
  });
  const fail = transportFail('TRANSPORT_NOT_IMPLEMENTED');

  return Object.freeze({
    type,
    adapterId,
    describe: () => descriptor,
    open: () => fail,
    /* Kapatma idempotenttir: uygulanmamış taşımayı "kapatmak" hata değildir. */
    close: () => TRANSPORT_OK,
    send: () => fail,
    poll: () => Object.freeze([]),
    status: () => status,
  });
}
