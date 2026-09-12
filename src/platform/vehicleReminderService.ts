/**
 * Vehicle Reminder Service — Araç bakım ve belge hatırlatıcıları.
 *
 * Saf hesaplama modülü: state yok, side-effect yok.
 * Tüm kararlar `MaintenanceInfo` verisinden üretilir.
 */

import type { MaintenanceInfo } from '../store/useStore';

/* ── Tipler ──────────────────────────────────────────────── */

/**
 * `unknown` = kararı verecek VERİ YOK (saha 2026-08-05 · kütük #420).
 *
 * SAHADA ÖLÇÜLDÜ: "SON DEĞİŞİMDEKİ SAYAÇ" alanı BOŞ iken ekran yeşil
 * **"Tüm bakımlar güncel"** diyordu. Kök: yağ hesabı `lastOilChangeKm ?? 0` +
 * `nextOilChangeKm ?? 10000` varsayılanlarıyla, hiç veri yokken bile "ok"
 * üretiyordu; tarihi girilmemiş muayene/sigorta/kasko ise listeye HİÇ
 * eklenmediği için boşluk görünmüyordu. İkisi birleşince ürün, bilmediği bir
 * şeyi "sağlıklı" diye iddia ediyordu — kanıtsız bilgi üretme yasağının ihlali.
 */
export type ReminderUrgency = 'ok' | 'soon' | 'urgent' | 'overdue' | 'unknown';

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

  // Yağ değişimi — lastOilChangeKm: son değişimdeki sayaç, nextOilChangeKm: aralık.
  // Kütük #420: son değişim sayacı YOKSA kalan km hesaplanamaz. Eskiden `?? 0`
  // varsayımıyla sahte bir "ok" üretiliyordu; artık bilinmiyor olarak RAPORLANIR.
  const oilBaseKnown = m.lastOilChangeKm != null && Number.isFinite(m.lastOilChangeKm);
  if (!oilBaseKnown) {
    items.push({
      id: 'oil_change',
      label: 'Yağ Değişimi',
      urgency: 'unknown',
      detail: 'Son değişim sayacı girilmedi',
    });
  } else {
    const oilKmLeft = (m.lastOilChangeKm as number) + (m.nextOilChangeKm ?? 10000) - currentKm;
    items.push({
      id: 'oil_change',
      label: 'Yağ Değişimi',
      urgency: kmUrgency(oilKmLeft),
      detail: oilKmLeft > 0
        ? `${Math.round(oilKmLeft).toLocaleString('tr-TR')} km kaldı`
        : 'Gecikmiş',
    });
  }

  // Tarihe bağlı kalemler — Kütük #420: girilmemiş tarih artık GİZLENMEZ,
  // `unknown` olarak listelenir. Görünmeyen boşluk, "sorun yok" sanılıyordu.
  const dated: Array<{ id: ReminderItem['id']; label: string; value?: string }> = [
    { id: 'inspection', label: 'Muayene', value: m.inspectionDate },
    { id: 'insurance',  label: 'Sigorta', value: m.insuranceExpiry },
    { id: 'kasko',      label: 'Kasko',   value: m.kaskoExpiry },
  ];
  for (const { id, label, value } of dated) {
    if (!value) {
      items.push({ id, label, urgency: 'unknown', detail: 'Tarih girilmedi' });
      continue;
    }
    const d = daysUntil(value);
    items.push({
      id,
      label,
      urgency: dateUrgency(d),
      detail: d >= 0 ? `${d} gün kaldı` : `${Math.abs(d)} gün gecikti`,
    });
  }

  return items;
}

/**
 * Bakım durumu hakkında POZİTİF bir iddia ("hepsi güncel") üretilebilir mi?
 * Kütük #420: yalnız EN AZ BİR gerçek veri varsa ve hiçbiri sorunlu değilse.
 * Hepsi `unknown` ise ürünün söyleyebileceği tek dürüst şey "veri girilmedi"dir.
 */
export function canClaimAllHealthy(items: ReminderItem[]): boolean {
  const known = items.filter((i) => i.urgency !== 'unknown');
  return known.length > 0 && known.every((i) => i.urgency === 'ok');
}

/** Sesli asistan için kısa özet metin döner. */
export function getMaintenanceSummary(m: MaintenanceInfo, currentKm = 0): string {
  const items   = computeReminders(m, currentKm);
  const issues  = items.filter((i) => i.urgency !== 'ok' && i.urgency !== 'unknown');
  const unknown = items.filter((i) => i.urgency === 'unknown');

  // Kütük #420: bilinmeyeni "sorun yok" diye sunmak YASAK.
  if (issues.length === 0) {
    if (unknown.length === items.length) {
      return 'Bakım bilgisi girilmemiş — durum bilinmiyor.';
    }
    const tail = unknown.length > 0
      ? ` Bilinmeyen: ${unknown.map((i) => i.label).join(', ')}.`
      : '';
    return `Girilen bakımlar güncel.${tail}`;
  }

  const head = issues.map((i) => `${i.label}: ${i.detail}`).join('. ');
  return unknown.length > 0
    ? `${head}. Bilinmeyen: ${unknown.map((i) => i.label).join(', ')}.`
    : head;
}

/** Acil veya gecikmiş hatırlatıcı var mı? */
export function hasUrgentReminders(items: ReminderItem[]): boolean {
  return items.some((i) => i.urgency === 'urgent' || i.urgency === 'overdue');
}
