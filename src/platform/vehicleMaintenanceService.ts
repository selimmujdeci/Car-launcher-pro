/**
 * Vehicle Maintenance Service — Bakım & Muayene Asistanı.
 *
 * Güvenlik Standartları:
 *   1. sensitiveKeyStore: Tarih ve KM verileri şifreli saklanır.
 *   2. Zero-Leak: Listener kullanılmaz, saf fonksiyonel/async yapı.
 *   3. Write Throttling: 4s debounce — yüksek frekanslı çağrılarda tek yazma.
 *   4. Sensor Resiliency: currentKm, VehicleSignalResolver'ın hız birikimiyle useVehicleStore.odometer'dan beslenir.
 */

import { sensitiveKeyStore } from './sensitiveKeyStore';
import { useUnifiedVehicleStore as useVehicleStore } from './vehicleDataLayer/UnifiedVehicleStore';
import { addSystemNotification } from './notificationService';
import { speakAlert } from './ttsService';

/* ── Tipler ──────────────────────────────────────────────── */

export type MaintenanceStatus = 'ok' | 'warning' | 'critical';

export interface MaintenanceAssessment {
  id: 'inspection' | 'oil_change' | 'insurance';
  label: string;
  status: MaintenanceStatus;
  daysLeft?: number;
  kmsLeft?: number;
  message: string;
  /** Durum critical ise AI Doctor'a iletilecek randevu önerisi */
  appointmentSuggestion?: string;
}

/* ── Write Throttle ──────────────────────────────────────── */

type SaveBuffer = {
  inspectionDate?: string;
  oilChangeKm?:    number;
  insuranceDate?:  string;
};

let _writeBuffer: SaveBuffer = {};
let _writeTimer: ReturnType<typeof setTimeout> | null = null;

/** 4s debounce ile birleştirilmiş yazma — automotive grade write throttling. */
async function _flushBuffer(): Promise<void> {
  const buf = _writeBuffer;
  _writeBuffer = {};
  _writeTimer  = null;

  try {
    const writes: Promise<void>[] = [];
    if (buf.inspectionDate !== undefined)
      writes.push(sensitiveKeyStore.set('maint_inspection_date', buf.inspectionDate));
    if (buf.oilChangeKm !== undefined)
      writes.push(sensitiveKeyStore.set('maint_oil_change_km', String(buf.oilChangeKm)));
    if (buf.insuranceDate !== undefined)
      writes.push(sensitiveKeyStore.set('maint_insurance_date', buf.insuranceDate));
    await Promise.all(writes);
  } catch (e) {
    console.error('Maintenance write error:', e);
  }
}

/* ── Yardımcılar ─────────────────────────────────────────── */

function calculateDaysLeft(targetDate: string): number {
  if (!targetDate) return 9999;
  const target = new Date(targetDate).getTime();
  const diff = target - Date.now();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

function getStatusByDays(days: number): MaintenanceStatus {
  if (days <= 7) return 'critical';
  if (days <= 30) return 'warning';
  return 'ok';
}

function getStatusByKm(km: number): MaintenanceStatus {
  if (km <= 200) return 'critical';
  if (km <= 1000) return 'warning';
  return 'ok';
}

function appointmentByStatus(
  id: MaintenanceAssessment['id'],
  status: MaintenanceStatus,
): string | undefined {
  if (status !== 'critical') return undefined;
  switch (id) {
    case 'inspection': return 'TÜVTÜRK\'ten araç muayene randevusu alın.';
    case 'oil_change': return 'En yakın servise yağ değişimi randevusu alın.';
    case 'insurance':  return 'Sigortanızı derhal yenileyin.';
  }
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * Maintenance verilerini sensitiveKeyStore'a kaydeder.
 * Write Throttling: 4s debounce — ardışık çağrılarda tek atomic yazma.
 * Fire-and-forget: caller await etmeden devam edebilir.
 */
export function saveMaintenanceData(data: {
  inspectionDate?: string;
  oilChangeKm?:    number;
  insuranceDate?:  string;
}): void {
  // Pending buffer ile birleştir — son çağrı kazanır (LWW)
  _writeBuffer = { ..._writeBuffer, ...data };

  if (_writeTimer) clearTimeout(_writeTimer);
  _writeTimer = setTimeout(() => { void _flushBuffer(); }, 4000);
}

/** Kayıtlı tüm bakım verilerini döner. */
export async function getMaintenanceData() {
  const [inspection, oil, insurance] = await Promise.all([
    sensitiveKeyStore.get('maint_inspection_date'),
    sensitiveKeyStore.get('maint_oil_change_km'),
    sensitiveKeyStore.get('maint_insurance_date'),
  ]);

  return {
    inspectionDate: inspection,
    oilChangeKm:    oil ? parseInt(oil, 10) : 0,
    insuranceDate:  insurance,
  };
}

/**
 * Tüm bakım kalemlerini analiz eder, statüleri ve randevu önerilerini belirler.
 * AI ve UI bu fonksiyondan beslenir.
 *
 * Sensor Resiliency: currentKm, useVehicleStore.odometer — Tek Gerçeklik Kaynağı.
 * Sıfır değer durumunda kalan km hesabı sıfırlanır yerine null guard ile yönetilir.
 */
export async function getMaintenanceAssessment(): Promise<MaintenanceAssessment[]> {
  const data = await getMaintenanceData();
  const currentKm = useVehicleStore.getState().odometer ?? 0;
  const assessments: MaintenanceAssessment[] = [];

  // 1. Muayene
  if (data.inspectionDate) {
    const days   = calculateDaysLeft(data.inspectionDate);
    const status = getStatusByDays(days);
    assessments.push({
      id: 'inspection',
      label: 'Muayene',
      status,
      daysLeft: days,
      message: days < 0 ? 'Muayene tarihi geçmiş' : `${days} gün kaldı`,
      appointmentSuggestion: appointmentByStatus('inspection', status),
    });
  }

  // 2. Yağ Bakımı — currentKm sıfırsa "bilinmiyor" durumu (sensor henüz beslenmedi)
  if (data.oilChangeKm) {
    const kmLeft = data.oilChangeKm - currentKm;
    const status = currentKm > 0 ? getStatusByKm(kmLeft) : 'ok';
    assessments.push({
      id: 'oil_change',
      label: 'Yağ Değişimi',
      status,
      kmsLeft: currentKm > 0 ? kmLeft : undefined,
      message: currentKm === 0
        ? 'Sayaç bekleniyor (henüz seyahat yok)'
        : kmLeft < 0 ? 'Bakım km\'si dolmuş' : `${kmLeft} km kaldı`,
      appointmentSuggestion: appointmentByStatus('oil_change', status),
    });
  }

  // 3. Sigorta
  if (data.insuranceDate) {
    const days   = calculateDaysLeft(data.insuranceDate);
    const status = getStatusByDays(days);
    assessments.push({
      id: 'insurance',
      label: 'Sigorta',
      status,
      daysLeft: days,
      message: days < 0 ? 'Sigorta süresi dolmuş' : `${days} gün kaldı`,
      appointmentSuggestion: appointmentByStatus('insurance', status),
    });
  }

  return assessments;
}

/**
 * Kritik bakım kalemlerini kontrol eder; bulunursa sesli + görsel uyarı verir
 * ve AI Doctor context'ine randevu önerisi sinyali gönderir.
 * Uygulama açılışında veya periyodik olarak çağrılabilir.
 */
export async function checkAndSignalAIDoctor(): Promise<void> {
  const assessments = await getMaintenanceAssessment();
  const criticals = assessments.filter((a) => a.status === 'critical');

  for (const item of criticals) {
    const suggestion = item.appointmentSuggestion ?? `${item.label} için randevu alınması önerilir.`;
    addSystemNotification('Bakım Uyarısı', suggestion, true);
    speakAlert(suggestion);
  }
}

/** AI için özet metin oluşturur (8 kelime kuralına uygunluk AI'da yönetilir). */
export async function getMaintenanceSummaryText(): Promise<string> {
  const assessments = await getMaintenanceAssessment();
  const issues = assessments.filter(a => a.status !== 'ok');

  if (issues.length === 0) return 'Tüm araç bakımları güncel görünüyor.';

  const parts = issues.map((a) => {
    const base = `${a.label}: ${a.message}`;
    return a.appointmentSuggestion ? `${base}. ${a.appointmentSuggestion}` : base;
  });
  return parts.join('. ');
}
