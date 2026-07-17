/**
 * kwpRecoveryEvidence — PR-KWP-EVID: native KWP ölü-oturum kurtarmasının BOUNDED aynası.
 *
 * KÖK PROBLEM (saha 2026-07-17, Trafic/KWP proto 5): `ElmProtocol.noteKwpSessionHealth`
 * ardışık çekirdek NO_DATA'da ATPC gönderiyordu ama DIŞARIDAN GÖRÜNMEZDİ. Tanı raporunda
 * yalnız `lastDisc=OBD_DATA_GATE_TIMEOUT` vardı; şunlar CEVAPSIZDI:
 *   · kurtarma denendi mi, kaç kez?  · ATPC sonrası veri döndü mü, kaç ms'de?
 *   · yoksa Data Gate kurtarma sürerken bağlantıyı mı yıktı?
 *
 * Bu modül native sayaçları PULL eder (boşta sıfır maliyet — yalnız "Tanı Gönder" anında)
 * ve ham log DÖKMEZ: yalnız bounded sayaç + son durum (PII-güvenli, Malı-400 dostu).
 *
 * CAN'de tüm alanlar boş / status NOT_ATTEMPTED kalır — native kapısı (isSlowSerialActive)
 * KWP/ISO9141'e özeldir; CAN kurtarması AYRI motordur (TS, bkz. obdService._maybeRunEcuRecovery).
 */

import { Capacitor } from '@capacitor/core';
import { CarLauncher } from '../nativePlugin';

/** Kurtarma akışının son durumu — native {@code KwpRecoveryEvidence.Status} ile birebir. */
export type KwpRecoveryStatus =
  /** Bu oturumda hiç kurtarma tetiklenmedi (KWP değil VEYA oturum sağlıklı). */
  | 'NOT_ATTEMPTED'
  /** ATPC gönderildi, ilk geçerli PID HENÜZ gelmedi. */
  | 'IN_PROGRESS'
  /** ATPC sonrası geçerli PID geldi → oturum dirildi. */
  | 'RECOVERED'
  /** ATPC sonrası veri dönmedi (yeni eşik / tavan doldu / Data Gate yıktı). */
  | 'FAILED';

export interface KwpRecoveryEvidenceSnapshot {
  status: KwpRecoveryStatus;
  /** Şu anki ardışık çekirdek NO_DATA (eşiğe doğru sayan). */
  coreNoDataStreak: number;
  /** Oturumda görülen EN YÜKSEK ardışık NO_DATA — eşiğe yaklaşıldı mı. */
  maxCoreNoDataStreak: number;
  /** ATPC kaç kez gönderildi. */
  recoveryCount: number;
  /** Tavan dolduğu için ATPC'nin GÖNDERİLMEDİĞİ kez. */
  suppressedCount: number;
  /** ATPC gönderimi kanal hatasına düştü (denendi ama gitmedi). */
  atpcSendFailures: number;
  /** Son kurtarma tetik zamanı (epoch ms); 0 = hiç. */
  lastRecoveryAt: number;
  /** Son BAŞARILI kurtarmada ATPC→ilk geçerli PID süresi (ms); -1 = ölçülmedi. */
  lastRecoveryToFirstPidMs: number;
  /** Data Gate, kurtarma IN_PROGRESS iken oturumu kaç kez yıktı. */
  killedByDataGate: number;
  /** Kurtarma tetiklendiğindeki aktif protokol ('5'/'4'/'3'); null = hiç. */
  protocolAtRecovery: string | null;
  /** Eşik (ardışık NO_DATA) — native sabiti, raporda görünsün. */
  threshold: number;
  /** Oturum başına kurtarma tavanı — native sabiti. */
  maxPerSession: number;
}

let _snapshot: KwpRecoveryEvidenceSnapshot | null = null;

/**
 * Native kanıtı tazeler (yalnız rapor üretimi sırasında çağrılır — boşta sıfır maliyet).
 * Eski APK'da metod yoksa / hata olursa snapshot null kalır → rapor bölümü "kanıt yok" der
 * (uydurma YOK, fail-soft).
 */
export async function refreshKwpRecoveryEvidence(): Promise<void> {
  if (!Capacitor.isNativePlatform() || !CarLauncher.getObdKwpRecoveryEvidence) {
    _snapshot = null;
    return;
  }
  try {
    const r = await CarLauncher.getObdKwpRecoveryEvidence();
    _snapshot = {
      status: (r.status as KwpRecoveryStatus) ?? 'NOT_ATTEMPTED',
      coreNoDataStreak: r.coreNoDataStreak ?? 0,
      maxCoreNoDataStreak: r.maxCoreNoDataStreak ?? 0,
      recoveryCount: r.recoveryCount ?? 0,
      suppressedCount: r.suppressedCount ?? 0,
      atpcSendFailures: r.atpcSendFailures ?? 0,
      lastRecoveryAt: r.lastRecoveryAt ?? 0,
      lastRecoveryToFirstPidMs: r.lastRecoveryToFirstPidMs ?? -1,
      killedByDataGate: r.killedByDataGate ?? 0,
      protocolAtRecovery: r.protocolAtRecovery ?? null,
      threshold: r.threshold ?? 0,
      maxPerSession: r.maxPerSession ?? 0,
    };
  } catch {
    _snapshot = null; // fail-soft — kanıt yoksa YOK de, uydurma
  }
}

/** Son tazelenen kanıt (null = native vermedi / eski APK). */
export function getKwpRecoveryEvidence(): KwpRecoveryEvidenceSnapshot | null {
  return _snapshot;
}

/**
 * JS Data Gate bağlantıyı yıktı → native kanıta işle.
 *
 * Data Gate NATIVE'in BİLMEDİĞİ bir JS kavramıdır. "Kurtarma sürerken oturum kapatıldı mı"
 * sorusu ancak JS bildirirse cevaplanabilir — sahadaki en kritik hipotez tam olarak bu
 * (18s gate, ATPC'nin oturumu diriltmesine fırsat tanımadan bağlantıyı yıkıyor olabilir).
 *
 * Fail-soft ve ATEŞLE-UNUT: gate yolunu BLOKLAMAZ (await edilmez), eski APK'da no-op.
 */
export function notifyKwpDataGateTeardown(): void {
  if (!Capacitor.isNativePlatform() || !CarLauncher.notifyObdDataGateTeardown) return;
  void CarLauncher.notifyObdDataGateTeardown().catch(() => { /* kanıt kaydı kritik değil */ });
}

/** İnsan-okur özet (rapor "KWP KURTARMA" bölümü). */
export function describeKwpRecovery(s: KwpRecoveryStatus): string {
  switch (s) {
    case 'NOT_ATTEMPTED': return 'Kurtarma gerekmedi/uygulanmadı (KWP değil veya oturum sağlıklı)';
    case 'IN_PROGRESS':   return 'ATPC gönderildi — ilk geçerli PID bekleniyor';
    case 'RECOVERED':     return 'ATPC sonrası veri GERİ GELDİ — oturum dirildi';
    case 'FAILED':        return 'ATPC sonrası veri DÖNMEDİ';
  }
}

/** Test yardımcısı — üretim kodu çağırmaz. */
export const _internals = {
  setSnapshot(s: KwpRecoveryEvidenceSnapshot | null): void { _snapshot = s; },
};
