/**
 * remoteDiagnosticCommands.ts — "Arabam Cebimde" teşhis komutlarının ARAÇ TARAFI
 *
 * ÖLÇÜLEN KUSUR (2026-08-14): PWA `read_dtc` · `clear_dtc` · `read_voltage`
 * komutlarını gönderiyordu ama araç tarafında bu tipler HİÇ tanımlı değildi
 * (`commandListener` union'ında da, `CommandService.java` switch'inde de yok) →
 * `default: rejected`. Telefondaki Teşhis sekmesi ölü uçtu. Bu modül o ucu
 * gerçek okuma katmanına (`dtcService` · `obdService`) bağlar.
 *
 * DÜRÜSTLÜK SÖZLEŞMESİ (bu modülün varlık sebebi):
 *  1. **Araç bağlı değilse "arıza yok" DENMEZ.** `readAllDTCs()` web/demo modda
 *     bilinçli boş liste döner; bu liste uzak kullanıcıya "temiz" diye
 *     sunulursa YALAN olur → native olmayan platformda komut `failed`.
 *  2. **Kısmi tarama gizlenmez.** Mode 03/07/0A'dan biri düşerse sonuç
 *     `partial: true` taşır; bulunan kodlar gerçektir ama "temiz" hükmü verilemez.
 *  3. **Sahte 0 V yasak.** `batteryVoltage` ölçülmediyse `null`'dur → komut
 *     `failed`; 0 V "ölçülmedi" demektir, ölçüm değil.
 *  4. **Yalancı temizleme yok.** `clear_dtc` write-gate kararına tabidir
 *     (hız/rpm/bağlantı); kapı reddederse komut `rejected` + gerçek gerekçe.
 *
 * Not: `dtcService`/`obdService` DEĞİŞTİRİLMEZ — yalnız okunur.
 */

import { Capacitor } from '@capacitor/core';
import {
  readAllDTCs, readDTCCodes, clearDTCCodes,
  type DTCCodeWithStatus, type ReadAllDTCsResult,
} from './dtcService';
import { getOBDDataSnapshot } from './obdService';

/* ── Sonuç sözleşmesi ─────────────────────────────────────────────────────── */

/** Telefonun (`/api/pwa/dtc-result`) beklediği kod biçimi + kaynak durumu. */
export interface RemoteDtcCode {
  code:     string;
  severity: 'critical' | 'warning' | 'info';
  system:   string;
  desc:     string;
  /** Hangi moddan geldi: kayıtlı (03) · bekleyen (07) · kalıcı (0A). */
  status:   'stored' | 'pending' | 'permanent';
}

export interface RemoteDtcScanResult {
  dtcs:  RemoteDtcCode[];
  /** true → en az bir mod okunamadı; boş liste "temiz" ANLAMINA GELMEZ. */
  partial: boolean;
  /** false → araç/adaptör Mode 0A'yı hiç desteklemiyor (kalıcı kod yok DEĞİL). */
  permanentSupported: boolean;
  /** Mod bazlı ham sonuç — telefonda ayrıntı gösterimi için. */
  completeness: ReadAllDTCsResult['completeness'];
}

/**
 * Uzak kanalın KENDİ ölçtüğü güvenlik kanıtı.
 *
 * ⚠️ Yalnız `commandListener` (kanalın sahibi) doldurabilir. Bir alt katman
 * `e2eVerified: true` uyduramaz — kilit testi çağıran sahibini sabitler.
 */
export interface RemoteChannelEvidence {
  /** Uçtan uca şifre çözme BAŞARILI mı (kriptografik kimlik kanıtı). */
  readonly e2eVerified?: boolean;
}

export type RemoteDiagOutcome =
  | { outcome: 'completed'; result: Record<string, unknown> }
  | { outcome: 'failed';    reason: string }
  | { outcome: 'rejected';  reason: string };

/* ── Saf dönüştürücüler (I/O yok — kilitlenebilir) ────────────────────────── */

/**
 * `dtcService` kaydını telefonun beklediği alan adlarına çevirir.
 * `description` → `desc` (PWA sözleşmesi). Bilinmeyen alan UYDURULMAZ.
 */
export function toRemoteDtcCode(c: DTCCodeWithStatus): RemoteDtcCode {
  return {
    code:     c.code,
    severity: c.severity,
    system:   c.system,
    desc:     c.description,
    status:   c.status,
  };
}

/**
 * Tarama bütünlüğünden "kısmi mi" hükmünü verir. `unsupported` KISMİ DEĞİLDİR —
 * araç o modu hiç bilmiyor demektir (belirsizlik üretmez); yalnız `failed`
 * gerçek bir okuma kaybıdır.
 */
export function isPartialScan(c: ReadAllDTCsResult['completeness']): boolean {
  return c.stored === 'failed' || c.pending === 'failed' || c.permanent === 'failed';
}

/** Ham tarama sonucunu telefon sözleşmesine çevirir (saf). */
export function buildRemoteScanResult(r: ReadAllDTCsResult): RemoteDtcScanResult {
  return {
    dtcs:               r.codes.map(toRemoteDtcCode),
    partial:            isPartialScan(r.completeness),
    permanentSupported: r.permanentSupported,
    completeness:       r.completeness,
  };
}

/**
 * Ölçülen voltajın raporlanabilir olup olmadığını söyler (saf).
 * `null`/`undefined` → ölçüm yok. `<= 0` → fiziksel olarak imkânsız, ATRV
 * okunmamış demektir. İkisi de "0 V" diye raporlanamaz.
 */
export function isReportableVoltage(v: number | null | undefined): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0;
}

/* ── Yürütücüler (I/O) ────────────────────────────────────────────────────── */

/** Araç bağlantısı olmayan platformda teşhis okuması ANLAMSIZDIR — dürüst ret. */
const NO_LINK_REASON = 'Araç bağlantısı yok: teşhis okuması yapılamadı';

export async function executeReadDtc(): Promise<RemoteDiagOutcome> {
  if (!Capacitor.isNativePlatform()) {
    // Web/demo boş liste döndürür; uzaktaki kullanıcıya "arıza yok" diye
    // sunulursa YALAN olur → hiç sonuç yazma.
    return { outcome: 'failed', reason: NO_LINK_REASON };
  }
  try {
    const raw = await readAllDTCs();
    const scan = buildRemoteScanResult(raw);
    return { outcome: 'completed', result: { ...scan, readAt: new Date().toISOString() } };
  } catch (err) {
    return {
      outcome: 'failed',
      reason: err instanceof Error ? err.message : 'DTC okuma hatası',
    };
  }
}

export async function executeReadVoltage(): Promise<RemoteDiagOutcome> {
  if (!Capacitor.isNativePlatform()) {
    return { outcome: 'failed', reason: NO_LINK_REASON };
  }
  try {
    const v = getOBDDataSnapshot().batteryVoltage;
    if (!isReportableVoltage(v)) {
      // Sahte 0 V YASAK — ölçülmediyse ölçülmedi denir.
      return { outcome: 'failed', reason: 'Akü voltajı ölçülemedi (adaptörden ATRV gelmiyor)' };
    }
    return { outcome: 'completed', result: { voltage: v, readAt: new Date().toISOString() } };
  } catch (err) {
    return {
      outcome: 'failed',
      reason: err instanceof Error ? err.message : 'Voltaj okuma hatası',
    };
  }
}

/**
 * Uzaktan DTC silme — YIKICI işlem. Write-gate (hız · rpm · bağlantı tazeliği)
 * kararı BURADA EZİLMEZ: kapı reddederse komut `rejected` döner ve kullanıcı
 * gerçek gerekçeyi görür. Silme başarılı sayılmadan önce liste yeniden okunur —
 * "silindi" iddiası ölçüme dayanır, umuda değil.
 */
export async function executeClearDtc(
  channel: RemoteChannelEvidence = {},
): Promise<RemoteDiagOutcome> {
  if (!Capacitor.isNativePlatform()) {
    return { outcome: 'rejected', reason: NO_LINK_REASON };
  }
  try {
    /* `clearDTCCodes` modül durumundaki envantere bakar (boşsa reddeder) → önce
       gerçek okuma yapılır. P0-OBD-10: TAM tarama (03+07+0A) koşulur — yalnız
       Mode 03 okumak, BEKLEYEN kodu envantere sokmaz ve uzak komut "silinecek
       kod yok" diye sessizce hiçbir şey yapmazdı. Bu okuma silme öncesi kanıttır. */
    await readDTCCodes();
    /* Tam tarama FAIL-SOFT: envanteri zenginleştirmek içindir, KARAR değildir.
       Düşerse silme yine denenir (Mode 03 envanteri elimizde) — bir okuma
       hatası yıkıcı komutu sessizce iptal etmemelidir. */
    try { await readAllDTCs(); } catch { /* envanter kısmi kalır; kapı yine işler */ }

    /* ARCH-05: uzak kanal KENDİ principal sınıfıyla ve KENDİ kriptografik
       kanıtıyla çağırır. E2E doğrulanmamış bir komut CLEAR_DTC yetkisi
       ALAMAZ → `clearDTCCodes` içindeki kapı reddeder ve ECU'ya tek bayt
       gitmez. Kanıtı bu dosya ÜRETMEZ, `commandListener`dan taşır. */
    const decision = await clearDTCCodes({
      confirmed: true, principal: 'PHONE_REMOTE',
      channel: { e2eVerified: channel.e2eVerified === true, authenticated: channel.e2eVerified === true },
      operationId: `remote.dtc.clear:${Date.now()}`,
    });
    if (!decision.allowed) {
      return { outcome: 'rejected', reason: decision.userMessage };
    }

    /* P0-OBD-10 — "completed" ARTIK KAPI KARARINA DEĞİL ÖLÇÜME BAĞLI.
       Eskiden kapı izin verdiyse `completed` dönüyordu: ECU reddetse bile uzak
       operatör "silindi" görüyordu. Silme sonrası yeniden okuma zaten
       `clearDTCCodes` içinde yapılır — burada TEKRARLANMAZ (ikinci otorite yok),
       taze envanterden rapor kurulur. */
    const after = await readAllDTCs();
    const scan  = buildRemoteScanResult(after);
    // `clear` alanı YOKSA (web/demo yolu veya kapı öncesi çıkış) hüküm de yoktur.
    const report = decision.clear ?? null;
    if (report !== null && !report.success) {
      return { outcome: 'failed', reason: report.userMessage };
    }
    return {
      outcome: 'completed',
      result: { ...scan, clearedAt: new Date().toISOString(), readAt: new Date().toISOString() },
    };
  } catch (err) {
    return {
      outcome: 'failed',
      reason: err instanceof Error ? err.message : 'DTC silme hatası',
    };
  }
}
