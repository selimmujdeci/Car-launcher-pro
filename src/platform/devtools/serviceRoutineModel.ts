/**
 * serviceRoutineModel — Servis Fonksiyonları ekranının SAF karar katmanı.
 *
 * SÖZLEŞME: I/O YOK · timer YOK · `Date.now` YOK · global durum YOK · React YOK.
 *
 * ⚠️ KAPI BURADA YENİDEN YAZILMAZ. Karar `serviceFunctions.evaluateServiceRoutine`
 * tarafından verilir — bu dosya yalnız onu GERÇEK veriyle çağırır ve sonucu
 * gösterilebilir hâle getirir. İkinci bir izin motoru kurmak, sahada hangisinin
 * geçerli olduğunu belirsizleştirirdi (araca yazan yolda bu KABUL EDİLEMEZ).
 *
 * ⚠️ İKİ KAPI KÜMESİ AYRI RAPORLANIR:
 *   · ARAÇ ÖNKOŞULLARI — bağlantı · tazelik · hız · motor durumu. Bunlar aracın
 *     ŞU ANKİ hâliyle ilgilidir ve bu ekranda GERÇEKTEN ölçülür.
 *   · İNSAN/KANIT KAPILARI — kullanıcı onayı · risk kabulü · rutin destek kanıtı.
 *     Bunlar bu ekranda DAİMA KAPALIDIR (ekran komut göndermez, onay toplamaz).
 * Karıştırmak "hazır" yanılsaması üretirdi: araç uygun olabilir ama rutin yine de
 * çalıştırılamaz — ve çalıştırılmamalıdır.
 */
import {
  evaluateServiceRoutine, SERVICE_ROUTINES,
  type ServiceRoutineKind, type ServiceRoutineSpec,
} from '../obd/serviceFunctions';
import type { ServiceRoutineRawSnapshot } from './serviceRoutineSources';
import type { Observability } from './sessionInspectorModel';

export const SERVICE_ROUTINE_ORDER: readonly ServiceRoutineKind[] = [
  'dpf_regeneration', 'service_reset', 'throttle_adaptation',
] as const;

/** Motor ön koşulunun Türkçe karşılığı. */
export const ENGINE_REQUIREMENT_LABEL: Readonly<Record<ServiceRoutineSpec['engine'], string>> = {
  must_run:    'MOTOR ÇALIŞMALI',
  must_be_off: 'MOTOR DURMALI',
  any:         'MOTOR DURUMU ÖNEMSİZ',
} as const;

/** Araç önkoşullarının sonucu. */
export type VehicleReadiness =
  /** Araç tarafındaki tüm önkoşullar şu an uygun. */
  | 'READY'
  /** Araç tarafında en az bir önkoşul kapalı (mesaj gerçek kapıdan gelir). */
  | 'BLOCKED'
  /** OBD anlık görüntüsü okunamadı — hiçbir şey iddia edilmez. */
  | 'UNKNOWN';

export const READINESS_LABEL: Readonly<Record<VehicleReadiness, string>> = {
  READY:   'ARAÇ ÖNKOŞULLARI UYGUN',
  BLOCKED: 'ARAÇ ÖNKOŞULU KAPALI',
  UNKNOWN: 'ARAÇ DURUMU BİLİNMİYOR',
} as const;

export interface ServiceRoutineView {
  readonly kind:        ServiceRoutineKind;
  readonly title:       string;
  readonly engineLabel: string;
  readonly risk:        string;
  readonly readiness:   VehicleReadiness;
  readonly klass:       Observability;
  /** Araç önkoşulu kapalıysa KAPININ KENDİ mesajı (burada yeniden yazılmaz). */
  readonly blockedMessage: string | null;
}

/**
 * Araç önkoşullarını ölçer.
 *
 * NASIL: gerçek kapı, insan/kanıt kapıları AÇIK VARSAYILARAK çağrılır
 * (`confirmed` · `supported` · `riskAcknowledged` = true). Böylece geriye yalnız
 * ARACIN durumu kalır ve kapının kendi mantığı yeniden yazılmadan ölçülür.
 *
 * ⚠️ Bu varsayım YALNIZ ÖLÇÜM içindir. Hiçbir yazma yolu bu fonksiyonun çıktısına
 * bakarak çalıştırılmaz; gerçek çağrı yine tüm kapılardan geçmek zorundadır.
 */
export function buildServiceRoutineViews(
  snap: ServiceRoutineRawSnapshot,
): readonly ServiceRoutineView[] {
  return SERVICE_ROUTINE_ORDER.map((kind) => {
    const spec = SERVICE_ROUTINES[kind];
    const base = {
      kind,
      title: spec.title,
      engineLabel: ENGINE_REQUIREMENT_LABEL[spec.engine],
      risk: spec.risk,
    };

    if (snap.gate === null) {
      return {
        ...base,
        readiness: 'UNKNOWN' as VehicleReadiness,
        klass: 'UNAVAILABLE' as Observability,
        blockedMessage: null,
      };
    }

    const decision = evaluateServiceRoutine({
      kind,
      gate: { ...snap.gate, confirmed: true },   // yalnız ÖLÇÜM varsayımı
      supported: true,                            // insan/kanıt kapıları ayrı raporlanır
      riskAcknowledged: true,
    });

    return {
      ...base,
      readiness: (decision.allowed ? 'READY' : 'BLOCKED') as VehicleReadiness,
      klass: 'OBSERVED' as Observability,
      blockedMessage: decision.allowed ? null : decision.userMessage,
    };
  });
}

/** İnsan/kanıt kapıları — bu ekranda DAİMA kapalı; nedeni açıkça yazılır. */
export interface HumanGateRow {
  readonly id:    string;
  readonly label: string;
  readonly state: 'CLOSED' | 'NO_EVIDENCE_CHANNEL';
  readonly note:  string;
}

export function buildHumanGates(): readonly HumanGateRow[] {
  return [
    {
      id: 'confirmation',
      label: 'Kullanıcı onayı',
      state: 'CLOSED',
      note: 'Bu ekran onay TOPLAMAZ ve komut GÖNDERMEZ — kapı burada bilerek kapalıdır.',
    },
    {
      id: 'risk-ack',
      label: 'Bilgilendirilmiş rıza (risk kabulü)',
      state: 'CLOSED',
      note: 'Riski GÖRMEDEN verilen onay, onay değildir. Metin aşağıda ham gösterilir.',
    },
    {
      id: 'routine-support',
      label: 'Rutin destek kanıtı',
      state: 'NO_EVIDENCE_CHANNEL',
      note: 'Bu araçta hangi rutinin desteklendiğini KANITLAYAN bir keşif kanalı YOK. '
          + 'Bilinmiyor ≠ destekli: gerçek çağrıda kapı fail-closed reddeder.',
    },
  ];
}

/** Ekranın bütünsel hükmü — YAZMA HAZIRLIĞI hakkında, araç sağlığı hakkında DEĞİL. */
export type ServiceRoutineVerdict =
  /** OBD okunamadı. */
  | 'UNKNOWN'
  /** Araç önkoşulları uygun ama insan/kanıt kapıları kapalı (beklenen durum). */
  | 'VEHICLE_READY_GATES_CLOSED'
  /** Araç önkoşulları da kapalı. */
  | 'VEHICLE_BLOCKED';

export const SERVICE_VERDICT_LABEL: Readonly<Record<ServiceRoutineVerdict, string>> = {
  UNKNOWN:                   'ARAÇ DURUMU BİLİNMİYOR',
  VEHICLE_READY_GATES_CLOSED:'ARAÇ UYGUN · YAZMA KAPILARI KAPALI',
  VEHICLE_BLOCKED:           'ARAÇ ÖNKOŞULLARI KAPALI',
} as const;

export interface ServiceRoutineVerdictResult {
  readonly status:  ServiceRoutineVerdict;
  readonly reasons: readonly string[];
}

export function deriveServiceRoutineVerdict(
  snap: ServiceRoutineRawSnapshot,
  views: readonly ServiceRoutineView[],
): ServiceRoutineVerdictResult {
  const reasons: string[] = [];

  if (snap.gate === null) {
    reasons.push(snap.error ? `OBD okunamadı: ${snap.error}` : 'OBD anlık görüntüsü yok.');
    return { status: 'UNKNOWN', reasons };
  }

  const ready   = views.filter((v) => v.readiness === 'READY').length;
  const blocked = views.filter((v) => v.readiness === 'BLOCKED').length;
  reasons.push(`${views.length} rutin · araç önkoşulu uygun ${ready} · kapalı ${blocked}`);
  reasons.push('Kullanıcı onayı ve risk kabulü bu ekranda DAİMA kapalıdır — komut gönderilmez.');

  return ready > 0
    ? { status: 'VEHICLE_READY_GATES_CLOSED', reasons }
    : { status: 'VEHICLE_BLOCKED', reasons };
}
