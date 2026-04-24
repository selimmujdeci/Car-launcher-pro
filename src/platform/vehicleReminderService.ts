/**
 * Vehicle Reminder Service — Araç bakım ve belge hatırlatıcıları.
 *
 * Saf hesaplama modülü: state yok, side-effect yok.
 * Tüm kararlar `MaintenanceInfo` verisinden üretilir.
 */

import type { MaintenanceInfo } from '../store/useStore';

/* ── Tipler ──────────────────────────────────────────────── */

export type ReminderUrgency = 'ok' | 'soon' | 'urgent' | 'overdue';

export interface ReminderItem {
  id: 'oil_change' | 'inspection' | 'insurance' | 'kasko';
  label: string;
  urgency: ReminderUrgency;
  detail: string;
}

/* ── Yardımcılar ─────────────────────────────────────────── */

function daysUntil(dateStr: string): number {
  const target = new Date(dateStr).getTime();
  return Math.round((target - Date.now()) / 86400000);
}

function dateUrgency(days: number): ReminderUrgency {
  if (days < 0) return 'overdue';
  if (days <= 7) return 'urgent';
  if (days <= 30) return 'soon';
  return 'ok';
}

function kmUrgency(kmLeft: number): ReminderUrgency {
  if (kmLeft <= 0) return 'overdue';
  if (kmLeft <= 500) return 'urgent';
  if (kmLeft <= 1500) return 'soon';
  return 'ok';
}

/* ── Public API ──────────────────────────────────────────── */

/**
 * MaintenanceInfo'dan tüm hatırlatıcıları hesaplar.
 * Tarih girilmemiş alanlar listeye eklenmez.
 * currentKm — useVehicleStore.odometer'dan beslenir, yoksa 0.
 */
export function computeReminders(m: MaintenanceInfo, currentKm = 0): ReminderItem[] {
  const items: ReminderItem[] = [];

  // Yağ değişimi — lastOilChangeKm: son değişimdeki sayaç, nextOilChangeKm: aralık
  const oilKmLeft = (m.lastOilChangeKm ?? 0) + (m.nextOilChangeKm ?? 10000) - currentKm;
  items.push({
    id: 'oil_change',
    label: 'Yağ Değişimi',
    urgency: kmUrgency(oilKmLeft),
    detail: oilKmLeft > 0
      ? `${Math.round(oilKmLeft).toLocaleString('tr-TR')} km kaldı`
      : 'Gecikmiş',
  });

  // Muayene
  if (m.inspectionDate) {
    const d = daysUntil(m.inspectionDate);
    items.push({
      id: 'inspection',
      label: 'Muayene',
      urgency: dateUrgency(d),
      detail: d >= 0 ? `${d} gün kaldı` : `${Math.abs(d)} gün gecikti`,
    });
  }

  // Sigorta
  if (m.insuranceExpiry) {
    const d = daysUntil(m.insuranceExpiry);
    items.push({
      id: 'insurance',
      label: 'Sigorta',
      urgency: dateUrgency(d),
      detail: d >= 0 ? `${d} gün kaldı` : `${Math.abs(d)} gün gecikti`,
    });
  }

  // Kasko
  if (m.kaskoExpiry) {
    const d = daysUntil(m.kaskoExpiry);
    items.push({
      id: 'kasko',
      label: 'Kasko',
      urgency: dateUrgency(d),
      detail: d >= 0 ? `${d} gün kaldı` : `${Math.abs(d)} gün gecikti`,
    });
  }

  return items;
}

/** Sesli asistan için kısa özet metin döner. */
export function getMaintenanceSummary(m: MaintenanceInfo, currentKm = 0): string {
  const items = computeReminders(m, currentKm);
  const issues = items.filter((i) => i.urgency !== 'ok');
  if (issues.length === 0) return 'Tüm bakımlar güncel, sorun yok.';
  return issues.map((i) => `${i.label}: ${i.detail}`).join('. ');
}

/** Acil veya gecikmiş hatırlatıcı var mı? */
export function hasUrgentReminders(items: ReminderItem[]): boolean {
  return items.some((i) => i.urgency === 'urgent' || i.urgency === 'overdue');
}
