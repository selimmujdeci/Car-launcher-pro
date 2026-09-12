/**
 * pduRouting — P0-VDK-F4A · LEGACY ⇄ GENEL KÖPRÜ YÖNLENDİRME POLİTİKASI.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── NEDEN BİR POLİTİKA KATMANI ────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * F4A iki şeyi AYNI ANDA yapmak zorundadır:
 *
 *  (a) Yeni bir salt-okunur servis eklemek artık yeni bir köprü metodu
 *      GEREKTİRMEMELİ  → genel köprü kullanılmalı.
 *  (b) Kanıtlanmış legacy yol, generic sonuç KANITLANMADAN değiştirilmemeli
 *      → mevcut ürün davranışı sessizce genel köprüye kaymamalı.
 *
 * Bu ikisi çelişmez; ayrı sorulardır. Politika ikisini AÇIKÇA ayırır:
 *
 *   `legacy_first`  (VARSAYILAN) — legacy taşıyabiliyorsa legacy; taşıyamadığı
 *                    HER ŞEY genel köprüden gider. Yani (a) sağlanır ve
 *                    mevcut yolların davranışı BİR BAYT değişmez.
 *   `generic_first` — genel köprü öncelikli; taşıyamazsa legacy'ye düşer.
 *                    Saha parity'si MATCH çıkınca açılacak olan konum.
 *   `generic_only`  — yalnız genel köprü (parity tanığı / kabul kanıtı).
 *   `legacy_only`   — yalnız legacy (parity tanığı).
 *
 * ⚠️ Varsayılanın `legacy_first` olması bir çekingenlik değil, F4A §6'nın
 * ("generic sonuç kanıtlanmadan legacy yolu kaldırma") doğrudan uygulamasıdır.
 * Varsayılanı değiştirmek TEK SATIRLIK ve kütükle izlenen bir karardır.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ── BU DOSYA NE DEĞİLDİR ──────────────────────────────────────────────────
 * ══════════════════════════════════════════════════════════════════════════
 * (1) İKİNCİ TAŞIMA OTORİTESİ DEĞİLDİR — Real/Virtual anahtarı `vdkTransport`ta.
 * (2) YANIT ÜRETMEZ — yalnız hangi uygulamanın çağrılacağını seçer.
 * (3) SESSİZ DÜŞÜŞ YAPMAZ: bir yol taşıyamayıp diğerine geçildiyse bu
 *     `PduResponse.detail` içinde YAZILIDIR.
 */

import { canCarry, type PduSendOptions, type PduTransport, type PduCapabilities } from './pduTransport';
import { GenericPduTransport, genericBridgeAvailable } from './genericPduTransport';
import type { DiagnosticPdu, PduResponse } from './pdu';

export type PduRoutePolicy =
  | 'legacy_first' | 'generic_first' | 'generic_only' | 'legacy_only';

/**
 * ÜRÜN VARSAYILANI.
 *
 * Saha parity'si (§6) MATCH kanıtlanana kadar `legacy_first`tir. Kütük maddesi:
 * `P0-VDK-F4A-PARITY` — 🟢 olduğunda `generic_first`e alınacaktır.
 */
export const DEFAULT_PDU_ROUTE_POLICY: PduRoutePolicy = 'legacy_first';

let _policy: PduRoutePolicy = DEFAULT_PDU_ROUTE_POLICY;

export function getPduRoutePolicy(): PduRoutePolicy { return _policy; }

/**
 * Politikayı değiştirir. Ürün kodu bunu ÇAĞIRMAZ — parity koşusu ve LAB
 * kabul kanıtı içindir. Varsayılanı değiştirmek `DEFAULT_PDU_ROUTE_POLICY`
 * satırını değiştirmektir, çalışma anında sürüklenmek DEĞİLDİR.
 */
export function _setPduRoutePolicyForTest(p: PduRoutePolicy): void { _policy = p; }
export function _resetPduRoutePolicyForTest(): void { _policy = DEFAULT_PDU_ROUTE_POLICY; }

/** Bir sonucun "istek HİÇ gitmedi, başka yol denenebilir" anlamına gelip gelmediği. */
function _isTransportGap(r: PduResponse): boolean {
  return r.outcome === 'NOT_SUPPORTED_BY_TRANSPORT';
}

/**
 * Legacy ve genel köprüyü politikaya göre birleştiren taşıma.
 *
 * `capabilities` iki uygulamanın BİRLEŞİMİDİR ve `supportsArbitraryPdu`
 * yalnız genel köprü GERÇEKTEN varsa `true`dur (iddia değil, ölçüm).
 */
export class HybridPduTransport implements PduTransport {
  private readonly legacy: PduTransport;
  private readonly generic: PduTransport;

  constructor(legacy: PduTransport, generic: PduTransport = new GenericPduTransport()) {
    this.legacy = legacy;
    this.generic = generic;
  }

  get capabilities(): PduCapabilities {
    const hasGeneric = genericBridgeAvailable();
    const merged = new Set<string>([...this.legacy.capabilities.supportedServices]);
    if (hasGeneric) {
      for (const s of this.generic.capabilities.supportedServices) merged.add(s);
    }
    return Object.freeze({
      kind: this.legacy.capabilities.kind,
      supportedServices: Object.freeze([...merged].sort()),
      supportsArbitraryPdu: hasGeneric,
    });
  }

  async send(pdu: DiagnosticPdu, opts: PduSendOptions = {}): Promise<PduResponse> {
    switch (_policy) {
      case 'legacy_only':
        return this.legacy.send(pdu, opts);

      case 'generic_only':
        return this.generic.send(pdu, opts);

      case 'generic_first': {
        const g = await this.generic.send(pdu, opts);
        if (!_isTransportGap(g)) return g;
        const l = await this.legacy.send(pdu, opts);
        return _withFallbackNote(l, 'genel köprü taşıyamadı → legacy denendi');
      }

      case 'legacy_first':
      default: {
        /* Legacy'nin taşıyabildiği bir PDU için legacy AYNEN çalışır — mevcut
           ürün davranışı korunur. Taşıyamadığı her şey (yeni CDDL servisleri,
           22/1A/17/21 …) artık genel köprüden GİDER: F4A'nın açtığı yol budur. */
        if (canCarry(this.legacy, pdu)) return this.legacy.send(pdu, opts);
        const g = await this.generic.send(pdu, opts);
        return _withFallbackNote(g, 'legacy köprüde karşılığı yok → genel köprü kullanıldı');
      }
    }
  }
}

/** Düşüşün SESSİZ kalmaması için gerekçeyi kanıta ekler (üzerine yazmaz). */
function _withFallbackNote(r: PduResponse, note: string): PduResponse {
  return { ...r, detail: r.detail === null ? note : `${note} · ${r.detail}` };
}
