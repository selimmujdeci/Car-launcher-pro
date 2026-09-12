/**
 * recoveryMonitorSources.ts — CAROS LAB · Kurtarma İzleyici TEK okuma katmanı.
 *
 * Desen (A3–A8 turlarıyla aynı): senkron getter, kendi try/catch'i içinde.
 * HİÇBİR şey başlatmaz/durdurmaz, komut göndermez, timer kurmaz, ağa çıkmaz.
 * Kurtarmayı TETİKLEYEMEZ, kapı zorlayamaz, cooldown sıfırlayamaz, tavan açamaz.
 *
 * ── NEDEN İKİ MOTOR ─────────────────────────────────────────────────────────
 * "Kurtarma merdiveni" TEK bir şey değildir; protokole göre AYRI iki motordur:
 *   · CAN (ATSP 6/7/8/9/A/B/C) → TS merdiveni (`_maybeRunEcuRecovery`):
 *     protocol_close → elm_reinit → transport_reconnect
 *   · KWP2000 / ISO9141      → NATIVE ATPC (`ElmProtocol.noteKwpSessionHealth`)
 * İkisi BİLEREK aynı anda çalışmaz (çift ATPC = oturumu sürekli kapatır). Bu
 * ekranın asıl işi, aktif protokolde HANGİ motorun otorite olduğunu ve diğerinin
 * neden sessiz durduğunu göstermektir — "kurtarma çalışmıyor" sanılan durumların
 * çoğu aslında "bu protokolde o motor zaten devre dışı"dır.
 *
 * ── TAZELEME SINIRI (sessionInspectorSources ile AYNI karar) ────────────────
 * `refreshKwpRecoveryEvidence()` BİLEREK çağrılmaz: o ASYNC bir native pull'dur
 * ve bu katman salt-okunur/senkrondur. KWP kanıtı LAB'ın "TÜMÜNÜ YENİLE" turunda
 * (`kwp-recovery` bölümü) ve "Tanı Gönder" akışında tazelenir. Bu yüzden model
 * `refreshedAt` damgasını ZORUNLU olarak yaşıyla birlikte gösterir — bayat bir
 * `NOT_ATTEMPTED` taze kanıt gibi sunulamaz (#642 saha dersi).
 *
 * ── GİZLİLİK (CLAUDE.md gözlemlenebilirlik kuralı 6) ────────────────────────
 * VIN, adaptör MAC, cihaz adı, ham çerçeve ve ham komut BU KATMANDAN GEÇMEZ.
 * Yalnız enum · adet · süre · protokol etiketi · voltaj skaleri taşınır.
 */

import {
  getEcuRecoveryLadder, getLinkLossLedger, getObdReconnectLifecycle,
} from '../obdService';
import {
  getKwpRecoveryEvidence, type KwpRecoveryEvidenceSnapshot,
} from '../obd/kwpRecoveryEvidence';

type EcuLadder = ReturnType<typeof getEcuRecoveryLadder>;
type ReconnectLifecycle = ReturnType<typeof getObdReconnectLifecycle>;
type LinkLossLedger = ReturnType<typeof getLinkLossLedger>;

export interface RecoveryMonitorRawSnapshot {
  readonly readAt: number;
  /**
   * CAN merdiveni. `null` = okuma HATA VERDİ (kaynak yok DEĞİL) — model bu ikisini
   * ayrı sınıflandırır; sahte "hiç denenmedi" üretilmez.
   */
  readonly ladder: EcuLadder | null;
  /** KWP native ATPC kanıtı. `null` = önbellek boş VEYA bu platformda yok. */
  readonly kwp: KwpRecoveryEvidenceSnapshot | null;
  /** Reconnect (son çare basamağının sonucunu okuyan) kanonik yaşam döngüsü. */
  readonly reconnect: ReconnectLifecycle | null;
  /** Kopma defteri — kurtarmanın GERÇEKTEN ölçülmüş süresi buradadır. */
  readonly linkLoss: LinkLossLedger | null;
}

/**
 * Tek okuma turu. Her kaynak KENDİ try/catch'inde: biri patlarsa diğerleri yine
 * okunur (fail-soft) ve düşen kaynak `null` kalır — "0" ile karıştırılmaz.
 *
 * @param nowMs Çağıranın bastığı duvar saati damgası. Bu katman `Date.now()`
 *              ÇAĞIRMAZ; zaman tek yerden (ekran) gelir, böylece testte sabitlenir.
 */
export function readRecoveryMonitorSnapshot(nowMs: number): RecoveryMonitorRawSnapshot {
  let ladder: EcuLadder | null = null;
  try { ladder = getEcuRecoveryLadder(); } catch { ladder = null; }

  let kwp: KwpRecoveryEvidenceSnapshot | null = null;
  try { kwp = getKwpRecoveryEvidence(); } catch { kwp = null; }

  let reconnect: ReconnectLifecycle | null = null;
  try { reconnect = getObdReconnectLifecycle(); } catch { reconnect = null; }

  let linkLoss: LinkLossLedger | null = null;
  try { linkLoss = getLinkLossLedger(); } catch { linkLoss = null; }

  return { readAt: nowMs, ladder, kwp, reconnect, linkLoss };
}
