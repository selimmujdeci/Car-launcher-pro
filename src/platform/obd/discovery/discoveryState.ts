/**
 * discoveryState — P0 Deep PID/DID Explorer Faz-1 · keşif DURUM MODELİ (SAF, tek kaynak).
 *
 * AMAÇ: bir PID/DID adayının keşif yaşam-döngüsünü TEK yerde tanımlar. Geçişler
 * `capabilityOutcome.ts` (mevcut zero-trust sınıflandırma sözlüğü — PR-CAP-1) ÜZERİNDEN
 * türetilir; ikinci bir "sonuç anlamı" icat edilmez, yalnız keşif BAĞLAMINA taşınır.
 *
 * KRİTİK DOĞRULUK İLKESİ (CLAUDE.md): bir DID'in cevap vermesi anlamının bilindiği
 * anlamına GELMEZ. Bu yüzden 'working' + bilinmeyen decoder → DISCOVERED_UNKNOWN (yalnız
 * keşif kaydı); 'working' + bilinen decoder → DECODER_KNOWN (henüz canlı doğrulanmadı).
 * VERIFIED'a geçiş bu modülde DEĞİL — DiscoveryValidator'ın 10-koşul kapısındadır
 * (discoveryValidator.ts) — durum sınıflandırması ile otomatik-ekleme kararı AYRI kalır.
 *
 * SAF: modül-durumu yok, I/O yok — tam test edilebilir.
 */

import { isCapabilityEvidence, type CapabilityOutcome } from '../capabilityOutcome';

/** Bir PID/DID adayının keşif durumu — tek yetkili sözlük. */
export type DiscoveryStatus =
  | 'CANDIDATE'            // aday listede, henüz sorgulanmadı / geçici sonuçtan sonra tekrar sıraya girdi
  | 'SUPPORTED'             // (yalnız Mode 01 bitmap) araç destekliyor — decoder henüz eşlenmedi
  | 'DISCOVERED_UNKNOWN'    // pozitif yanıt geldi ama decoder/anlam BİLİNMİYOR — yalnız keşif kaydı
  | 'DECODER_KNOWN'         // pozitif yanıt + kayıtlı decoder — henüz canlıya eklenmedi (10-koşul bekliyor)
  | 'VALIDATING'            // doğrulama örnekleri toplanıyor (birkaç bağımsız okuma bekleniyor)
  | 'VERIFIED'              // 10-koşulun TAMAMI sağlandı — canlıya eklenmeye UYGUN
  | 'SUSPICIOUS'            // yanıt geldi ama tutarsız/bozuk (byte uzunluğu, decode hatası) — polling'e girmez
  | 'REJECTED'              // güvenlik/karantina — bir daha otomatik önerilmez
  | 'UNSUPPORTED'           // araç bu kimliği hiç tanımıyor — KALICI, bir daha sorulmaz
  | 'TIMEOUT';              // iletişim hatası — araç hakkında kanıt DEĞİL, geçici

export const DISCOVERY_STATUSES: readonly DiscoveryStatus[] = Object.freeze([
  'CANDIDATE', 'SUPPORTED', 'DISCOVERED_UNKNOWN', 'DECODER_KNOWN', 'VALIDATING',
  'VERIFIED', 'SUSPICIOUS', 'REJECTED', 'UNSUPPORTED', 'TIMEOUT',
]);

/** KALICI durumlar — aday bir daha otomatik sorulmamalı (unsupported/security → capabilityOutcome ile hizalı). */
export function isTerminalStatus(status: DiscoveryStatus): boolean {
  return status === 'UNSUPPORTED' || status === 'REJECTED';
}

/** Yalnız bu durum canlı polling'e (auto-add) UYGUN adaydır. */
export function isAutoAddEligible(status: DiscoveryStatus): boolean {
  return status === 'VERIFIED';
}

/**
 * Ham sonuç (capabilityOutcome) + decoder bilgisi → TEMEL keşif durumu. Bu yalnız İLK
 * sınıflandırmadır; VERIFIED'a geçiş DiscoveryValidator'ın 10-koşul kapısından geçer
 * (discoveryValidator.evaluateAutoAddGate) — bu fonksiyon asla doğrudan VERIFIED üretmez.
 */
export function classifyDiscoveryOutcome(
  outcome: CapabilityOutcome,
  hasKnownDecoder: boolean,
): DiscoveryStatus {
  switch (outcome) {
    case 'working':
      return hasKnownDecoder ? 'DECODER_KNOWN' : 'DISCOVERED_UNKNOWN';
    case 'unsupported':
      return 'UNSUPPORTED';
    case 'security_required':
      // Kapsam DIŞI (bypass YOK) — bir daha otomatik ÖNERİLMEZ, ama "arıza" değildir.
      return 'REJECTED';
    case 'parse_error':
      // ECU yanıt verdi ama çözülemedi (byte uzunluğu/format) — güvenle otomatik eklenemez.
      return 'SUSPICIOUS';
    case 'no_data':
      // ECU sessiz — araç hakkında zayıf kanıt; kalıcı ELENMEZ, sıraya geri döner.
      return 'CANDIDATE';
    case 'condition_required':
      // Kimlik VAR ama şu an okunamıyor — GEÇİCİ, sonra tekrar denenir.
      return 'CANDIDATE';
    case 'timeout':
      // Hat/adaptör hatası — araç hakkında KANIT DEĞİL.
      return 'TIMEOUT';
  }
}

/**
 * Önceki keşif durumu + yeni gözlem → birleşmiş durum (capabilityOutcome.mergeOutcome ile
 * AYNI zero-trust ilke: `timeout` kanıt DEĞİLDİR, önceki durum KORUNUR; diğer her sonuç
 * hafızayı ezer — araç/ECU değişmiş olabilir).
 */
export function mergeDiscoveryStatus(
  previous: DiscoveryStatus | null,
  outcome: CapabilityOutcome,
  hasKnownDecoder: boolean,
): DiscoveryStatus {
  if (!isCapabilityEvidence(outcome)) return previous ?? 'TIMEOUT';
  return classifyDiscoveryOutcome(outcome, hasKnownDecoder);
}
