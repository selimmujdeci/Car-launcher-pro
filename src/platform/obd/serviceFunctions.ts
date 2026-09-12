/**
 * serviceFunctions — Servis Fonksiyonları & Aktüatör (OBD-OS-F4-5).
 *
 * ⚠️ BU DOSYA ARACA YAZAN TEK PROFESYONEL YOLDUR. Buradaki her satır, birinin aracına
 * kalıcı bir şey yapabilir: DPF rejenerasyonu başlatmak, servis aralığı sıfırlamak,
 * adaptasyon değeri yazmak. Yanlış anda yapılan bir rutin motoru bozabilir, garantiyi
 * düşürebilir, sürücüyü tehlikeye atabilir.
 *
 * BU YÜZDEN: burada ÇALIŞAN KOD YOK — yalnız KAPI var. Fonksiyonlar niyeti alır, TÜM
 * kapılardan geçirir ve yalnız hepsi açıksa "izin verildi" der. Native yazma çağrısı
 * (UDS 0x2E / 0x31 / 0x27) bu kapıdan geçmeden ASLA yapılmaz — F0-6'daki Mode 04
 * WriteGate deseninin genişletilmiş hâli.
 *
 * KAPILAR (hepsi geçilmeli — fail-closed):
 *   1. Bağlantı canlı mı           (WriteGate)
 *   2. Telemetri taze mi           (WriteGate — bayat veriyle "duruyor" demek yasak)
 *   3. Araç duruyor mu             (WriteGate)
 *   4. Motor durumu uygun mu       (rutine göre: bazıları motor ÇALIŞIR ister, bazıları DURUR)
 *   5. Kullanıcı açıkça onayladı mı (WriteGate)
 *   6. Rutin bu araçta destekli mi  (kanıt: keşif — uydurma rutin çalıştırılmaz)
 *   7. Riski kullanıcıya söylendi mi (bilgilendirilmiş rıza — ne olacağını BİLMELİ)
 *
 * BU PR'DA NATIVE YAZMA UYGULANMADI (bilinçli): kapı ve model önce, yazma sonra. Kapıyı
 * kanıtlamadan yazma kodu eklemek, bu ürünün "araca zarar vermem" sözünü riske atardı.
 *
 * SAF: modül-durumu yok, I/O yok — tam test edilebilir.
 */

import { evaluateDtcClearGate, type WriteGateContext, type WriteGateDecision } from './writeGate';

/** Desteklenen servis fonksiyonu türleri (UDS 0x31 RoutineControl tabanlı). */
export type ServiceRoutineKind =
  | 'dpf_regeneration'      // DPF zorlamalı rejenerasyon
  | 'service_reset'         // servis/bakım aralığı sıfırlama
  | 'throttle_adaptation';  // gaz kelebeği adaptasyonu

/** Rutinin motor durumu ön koşulu — hepsi "araç durmalı" der, motor farklıdır. */
export type EngineRequirement = 'must_run' | 'must_be_off' | 'any';

export interface ServiceRoutineSpec {
  kind: ServiceRoutineKind;
  title: string;
  engine: EngineRequirement;
  /**
   * Kullanıcıya SÖYLENMESİ ZORUNLU risk. Bilgilendirilmiş rıza olmadan yazma yapılmaz —
   * "ne olacağını bilmeden onayladı" hukuken ve etik olarak onay değildir.
   */
  risk: string;
}

export const SERVICE_ROUTINES: Record<ServiceRoutineKind, ServiceRoutineSpec> = {
  dpf_regeneration: {
    kind: 'dpf_regeneration',
    title: 'DPF zorlamalı rejenerasyon',
    engine: 'must_run',   // rejenerasyon egzozu 600°C'ye çıkarır — motor çalışmalı
    risk: 'Egzoz sıcaklığı çok yükselir. Araç açık alanda, yanıcı madde uzağında olmalı ve '
        + 'işlem bitene kadar (15-30 dk) motor durdurulmamalıdır. Yarıda kesilirse DPF zarar görebilir.',
  },
  service_reset: {
    kind: 'service_reset',
    title: 'Servis aralığı sıfırlama',
    engine: 'must_be_off',
    risk: 'Bakım sayacı sıfırlanır. Bakım gerçekten yapılmadıysa aracın bakım takibi bozulur.',
  },
  throttle_adaptation: {
    kind: 'throttle_adaptation',
    title: 'Gaz kelebeği adaptasyonu',
    engine: 'must_be_off',
    risk: 'Adaptasyon sırasında kontak kesilirse gaz kelebeği kalibrasyonu bozulabilir; '
        + 'araç rölantide düzensiz çalışabilir.',
  },
};

export type ServiceDenyReason =
  | 'write_gate'          // temel WriteGate kapılarından biri kapalı
  | 'engine_state'        // motor durumu rutinin gerektirdiği gibi değil
  | 'not_supported'       // bu araçta/ECU'da rutin destekli değil (kanıt yok)
  | 'risk_not_ack';       // kullanıcı riski AÇIKÇA kabul etmedi

export type ServiceDecision =
  | { allowed: true; spec: ServiceRoutineSpec }
  | { allowed: false; reason: ServiceDenyReason; userMessage: string; spec: ServiceRoutineSpec };

export interface ServiceRequestContext {
  kind: ServiceRoutineKind;
  /** WriteGate kanıtı — OBD servisinden okunur, çağıranın iddiası DEĞİL (F0-6 dersi). */
  gate: WriteGateContext;
  /** Rutin bu araçta destekli mi — KANIT (keşif/FleetKB). null = bilinmiyor → fail-closed. */
  supported: boolean | null;
  /** Kullanıcı riski AÇIKÇA kabul etti mi (metni GÖRDÜKTEN sonra). */
  riskAcknowledged: boolean;
}

/**
 * Servis fonksiyonu yazma kapısı — TÜM kapılar geçilmeden `allowed:true` DÖNMEZ.
 *
 * Sıra fail-closed: en temel önkoşuldan en spesifiğe. İlk kapalı kapı kararı verir.
 */
export function evaluateServiceRoutine(ctx: ServiceRequestContext): ServiceDecision {
  const spec = SERVICE_ROUTINES[ctx.kind];

  // 1-3, 5) Temel yazma kapıları (bağlantı, tazelik, hız, onay) — F0-6 ile ORTAK.
  //    Not: gate.confirmed = kullanıcının "evet, yap" onayı.
  const gate: WriteGateDecision = evaluateDtcClearGate(ctx.gate);
  if (!gate.allowed) {
    return { allowed: false, reason: 'write_gate', userMessage: gate.userMessage, spec };
  }

  // 6) Rutin destekli mi? KANIT yoksa çalıştırma (bilinmiyor ≠ destekli).
  if (ctx.supported !== true) {
    return {
      allowed: false,
      reason: 'not_supported',
      userMessage: 'Bu işlemin araçta desteklendiği doğrulanmadı — güvenlik gereği çalıştırılmadı.',
      spec,
    };
  }

  // 4) Motor durumu — rutine göre değişir. rpm bilinmiyorsa (null/negatif) FAIL-CLOSED.
  const rpm = ctx.gate.rpm;
  const rpmKnown = Number.isFinite(rpm) && rpm >= 0;
  if (spec.engine !== 'any') {
    if (!rpmKnown) {
      return {
        allowed: false,
        reason: 'engine_state',
        userMessage: 'Motor durumu doğrulanamıyor — güvenlik gereği işlem yapılmadı.',
        spec,
      };
    }
    const running = rpm > 0;
    if (spec.engine === 'must_run' && !running) {
      return {
        allowed: false,
        reason: 'engine_state',
        userMessage: `${spec.title} için motor ÇALIŞIR durumda olmalı.`,
        spec,
      };
    }
    if (spec.engine === 'must_be_off' && running) {
      return {
        allowed: false,
        reason: 'engine_state',
        userMessage: `${spec.title} için motor DURDURULMALI (kontak açık kalabilir).`,
        spec,
      };
    }
  }

  // 7) Bilgilendirilmiş rıza — riski GÖRMEDEN verilen onay, onay değildir.
  if (!ctx.riskAcknowledged) {
    return {
      allowed: false,
      reason: 'risk_not_ack',
      userMessage: spec.risk,
      spec,
    };
  }

  return { allowed: true, spec };
}
