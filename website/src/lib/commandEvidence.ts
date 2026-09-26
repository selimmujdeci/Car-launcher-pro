/**
 * commandEvidence.ts — KOMUT SONUCUNUN KANIT SEVİYESİ (F0.3).
 *
 * ── NEDEN VAR ────────────────────────────────────────────────────────────
 * `vehicle_commands.status = 'completed'` bugün fiziksel eylemin
 * GERÇEKLEŞTİĞİNİ kanıtlamaz. Araç tarafında ölçülen gerçek şudur:
 *
 *   `commandListener` → `nativeCommandBridge.executeMcuCommand`
 *     → `CarLauncher.lockDoors()` → `CarLauncherPlugin.sendMcuCommand`
 *     → `CanBusManager.sendCommand` → `transport.write(packet)`
 *
 * Zincirin son halkası "paket taşıma katmanına yazıldı" der. MCU yanıtı
 * okunmaz, CAN'den kilit durumu gelmez (CAN yalnız `doorOpen` üretir),
 * echo/ACK eşleştirmesi yoktur. Yani CarOS'ta bugün **kanonik bir donanım
 * ACK otoritesi YOKTUR**.
 *
 * Buna rağmen arayüz "Onaylandı ✓" ve "Araçta onaylandı" diyordu; komut
 * etiketleri de geçmiş zaman kipindeydi ("Kapılar Kilitlendi"). Bu, kanıttan
 * güçlü konuşmaktır (CLAUDE.md §8).
 *
 * ── BU MODÜL NE YAPAR ────────────────────────────────────────────────────
 * SAF eşleme. Yeni bir durum deposu, ikinci bir otorite, sahte bir ACK veya
 * uydurma bir kilit durumu ÜRETMEZ. Yalnız DB'nin legacy durum adını,
 * arayüzün dürüstçe söyleyebileceği kanıt seviyesine çevirir.
 *
 * ── ŞEMA KIRILMAZ ────────────────────────────────────────────────────────
 * DB'deki `completed` LEGACY olarak yerinde kalır (araç tarafı, filo paneli
 * ve mevcut migration'lar onu yazar/okur). Değişen tek şey, arayüzün onu
 * `VERIFIED` diye YORUMLAMAMASIDIR.
 */

import type { CommandStatus, CommandType } from './commandService';
import { COMMAND_TTL_MINUTES } from './commandService';

/**
 * Kanıt seviyeleri — zayıftan güçlüye.
 *
 * `VERIFIED` bilinçli olarak REZERVEDİR: bugün hiçbir komut bu seviyeye
 * ULAŞMAZ. Araç tarafında gerçek bir donanım ACK'i (MCU yanıtı · CAN'den
 * okunan durum geçişi · geri okuma) doğdukları gün `evidenceLevelFor`
 * içindeki eşleme o komut için `VERIFIED`e yükseltilir — arayüzün geri
 * kalanı DEĞİŞMEZ.
 */
export type CommandEvidenceLevel =
  | 'QUEUED'     // araç çevrimdışı; satır TTL içinde bekliyor
  | 'RECEIVED'   // araç satırı okudu
  | 'DELIVERED'  // komut araca iletildi (taşıma kabul etti) — fiziksel kanıt YOK
  | 'VERIFIED'   // fiziksel eylem ÖLÇÜLDÜ  ⚠️ bugün ulaşılamaz (bkz. yukarısı)
  | 'REJECTED'   // güvenlik/hareket kapısı reddetti (gerçek kanıt)
  | 'FAILED'     // araç yürütemedi / taşıma başarısız
  | 'EXPIRED';   // TTL doldu, araç hiç almadı

/**
 * Fiziksel (MCU/CAN) komutlar. Araç tarafındaki `MCU_COMMANDS` kümesiyle
 * ve `CommandService.java` ile birebir aynıdır. Bunların hiçbirinde bugün
 * geri okuma yoktur.
 */
const PHYSICAL_COMMANDS: ReadonlySet<CommandType> = new Set<CommandType>([
  'lock', 'unlock', 'horn', 'alarm_on', 'alarm_off', 'lights_on',
]);

export function isPhysicalCommand(type: CommandType): boolean {
  return PHYSICAL_COMMANDS.has(type);
}

/**
 * DB durumu → kanıt seviyesi.
 *
 * `queued` çağıran tarafından bilinir (araç çevrimdışıyken `sendCommand`
 * `queued: true` döner); DB durumu değildir, bu yüzden ayrı parametredir.
 */
export function evidenceLevelFor(
  status: CommandStatus,
  _type: CommandType,
  queued = false,
): CommandEvidenceLevel {
  if (queued && status === 'pending') return 'QUEUED';

  switch (status) {
    case 'pending':
      return 'QUEUED';
    case 'accepted':
      return 'RECEIVED';
    case 'executing':
      return 'RECEIVED';
    /* LEGACY EŞLEME — BU SATIR F0.3'ÜN ÖZÜDÜR.
       `completed` = "araç komutu yürüttü ve taşıma kabul etti". Fiziksel
       eylemin gerçekleştiği ÖLÇÜLMEDİ → `VERIFIED` DEĞİL, `DELIVERED`. */
    case 'completed':
      return 'DELIVERED';
    case 'rejected':
      return 'REJECTED';
    case 'expired':
      return 'EXPIRED';
    case 'failed':
    default:
      return 'FAILED';
  }
}

/** Kullanıcıya gösterilen başlık — kanıt seviyesinden türetilir. */
export const EVIDENCE_TITLE: Readonly<Record<CommandEvidenceLevel, string>> = Object.freeze({
  QUEUED:    'Sıraya alındı',
  RECEIVED:  'Araç aldı',
  DELIVERED: 'Araca iletildi',
  VERIFIED:  'Araçta doğrulandı',
  REJECTED:  'Araç reddetti',
  FAILED:    'İletilemedi',
  EXPIRED:   'Araca ulaşmadı',
});

/**
 * Başlığın altındaki açıklama. `DELIVERED` satırı kullanıcıya sınırı
 * DÜRÜSTÇE söyler — sessizce "oldu" ima etmez.
 */
export const EVIDENCE_DETAIL: Readonly<Record<CommandEvidenceLevel, string>> = Object.freeze({
  QUEUED:    `Araç ${COMMAND_TTL_MINUTES} dk içinde çevrimiçi olursa çalışacak; sonra iptal olur`,
  RECEIVED:  'Araç komutu okudu, yürütüyor',
  DELIVERED: 'Araç komutu yürüttü — sonucu araçtan kontrol edin',
  VERIFIED:  'Araç eylemin gerçekleştiğini bildirdi',
  REJECTED:  'Güvenlik kuralı nedeniyle çalıştırılmadı',
  FAILED:    'Araç komutu yürütemedi',
  EXPIRED:   'Süre doldu; araç çevrimdışı kalmış olabilir',
});

/** Kanıt seviyesi olumlu bir sonuç mu (renk/ikon seçimi için). */
export function isPositiveEvidence(level: CommandEvidenceLevel): boolean {
  return level === 'DELIVERED' || level === 'VERIFIED';
}
