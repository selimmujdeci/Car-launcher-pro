/**
 * ARAÇ DURUM / SERVİS ÖZETİ — paylaşılabilir metin (F5).
 *
 * ── NEDEN METİN, NEDEN PDF DEĞİL ─────────────────────────────────────────
 * Kullanıcının bu özetle yapacağı şey bellidir: servise/alıcıya göndermek.
 * Bunun için yeni bir PDF üretim zinciri ve backend otoritesi kurmak gerekmez;
 * paylaşım tarayıcının kendi `navigator.share` yüzeyiyle yapılır, panoya
 * kopyalama da yedektir. Yeni sunucu ucu, yeni tablo, yeni imza YOKTUR.
 *
 * ── BU DOSYA HİÇBİR ŞEY ÖLÇMEZ ───────────────────────────────────────────
 * Rapor yalnız ZATEN ÜRETİLMİŞ projeksiyonları düz metne çevirir:
 *   · kimlik  : `vehicleDisplay` (AracimHome.identity)
 *   · sağlık  : F2.2 `VehicleHealthSummary` (kendi limitations'ıyla)
 *   · hafta   : F5 `WeeklySummary`
 *   · kayıtlar: F4.3 `VehicleMemory` (vehicle_fuel_logs · vehicle_service_records)
 *
 * ── RAPORDA ASLA BULUNMAYACAKLAR ─────────────────────────────────────────
 * Toplam araç kilometresi (odometre kanıtı yok · F4.2), ortalama tüketim
 * (ölçülmedi · F3.2), arıza geçmişi (kalıcı DTC kaydı yok · F4.3), "park
 * edildi"/"kilitli" (fiziksel ACK yok · F0.3). Bunlar EKSİKLİK olarak
 * raporun sonunda AÇIKÇA yazılır; sessizce atlanmaz.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

import type { VehicleHealthSummary } from '@/lib/diagnostics/vehicleHealth';
import type { WeeklySummary } from '@/lib/home/weeklySummary';
import type { VehicleMemoryEvent } from '@/lib/memory/vehicleMemory';

export interface ShareReportInput {
  readonly now: number;
  readonly title: string;
  readonly subtitle: string | null;
  /** `null` = sağlık HENÜZ OKUNMADI / OKUNAMADI — "sorun yok" DEĞİL. */
  readonly health: VehicleHealthSummary | null;
  readonly weekly: WeeklySummary | null;
  /** Hafıza olayları (yeniden eskiye). `null` = okunamadı. */
  readonly events: readonly VehicleMemoryEvent[] | null;
  /** Rapora girecek azami kayıt sayısı (tür başına). */
  readonly maxRecords?: number;
}

export interface ShareReport {
  readonly title: string;
  readonly text: string;
  /** Raporun NEYİ SÖYLEYEMEDİĞİ — her zaman doludur. */
  readonly limitations: readonly string[];
}

export const SHARE_MAX_RECORDS = 5;

/** Tarih — geçersizse satır HİÇ üretilmez (uydurma tarih YOK). */
function trDate(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`;
}

const VERDICT_TEXT: Record<VehicleHealthSummary['verdict'], string> = {
  VERIFIED:    'Kontrol edilen sistemlerde sorun görülmedi',
  WARNING:     'Kontrol edilmesi gereken bir durum var',
  CRITICAL:    'Acil kontrol gerektiren bir durum var',
  NO_EVIDENCE: 'Araçtan doğrulanmış bir ölçüm alınamadı',
};

export function buildVehicleShareReport(input: ShareReportInput): ShareReport {
  const max = input.maxRecords ?? SHARE_MAX_RECORDS;
  const lines: string[] = [];
  const limitations: string[] = [];

  /* ── Kimlik ──────────────────────────────────────────────────────────── */
  lines.push(`ARAÇ DURUM ÖZETİ — ${input.title}`);
  if (input.subtitle) lines.push(input.subtitle);
  const created = trDate(input.now);
  if (created) lines.push(`Özet tarihi: ${created}`);

  /* ── Durum ───────────────────────────────────────────────────────────── */
  lines.push('', 'DURUM');
  if (!input.health) {
    /* Okunmamış sağlık "sorun yok" SAYILMAZ. */
    lines.push('· Araç durumu bu özet alınırken okunamadı.');
    limitations.push('Araç durumu okunamadığı için bu özet sağlık hükmü içermiyor.');
  } else {
    lines.push(`· ${VERDICT_TEXT[input.health.verdict]}`);
    lines.push(`· ${input.health.headline}`);
    const measured = input.health.measuredAt !== null ? trDate(input.health.measuredAt) : null;
    lines.push(measured
      ? `· Son araç ölçümü: ${measured}`
      : '· Son araç ölçümünün tarihi bilinmiyor');

    if (input.health.dtcs.length > 0) {
      lines.push('', 'ARIZA KODLARI (bu okumada)');
      for (const d of input.health.dtcs) lines.push(`· ${d.code} — ${d.desc}`);
    }
    /* Sağlığın KENDİ kapsam sınırları aynen taşınır; yeniden yazılmaz. */
    for (const l of input.health.limitations) limitations.push(l);
  }

  /* ── Son 7 gün ───────────────────────────────────────────────────────── */
  if (input.weekly) {
    lines.push('', `SON 7 GÜN`);
    if (input.weekly.headline) lines.push(`· ${input.weekly.headline}`);
    for (const f of input.weekly.facts) {
      if (f.id === 'TRIPS' || f.id === 'DISTANCE') continue;  // başlıkta zaten var
      lines.push(`· ${f.label}: ${f.value}${f.detail ? ` (${f.detail})` : ''}`);
    }
    for (const s of input.weekly.unreadableSources) {
      limitations.push(`${s} okunamadı; bu özet o kaynağı kapsamıyor.`);
    }
  }

  /* ── Kayıtlar ────────────────────────────────────────────────────────── */
  if (input.events === null) {
    limitations.push('Geçmiş kayıtlar okunamadı; bu özet servis/yakıt geçmişi içermiyor.');
  } else {
    const services = input.events.filter((e) => e.type === 'SERVICE_RECORD').slice(0, max);
    const fuel = input.events.filter((e) => e.type === 'FUEL_RECORD').slice(0, max);

    lines.push('', 'SERVİS KAYITLARI');
    if (services.length === 0) lines.push('· Kayıtlı servis işlemi yok.');
    else for (const e of services) {
      const d = trDate(e.occurredAt);
      const km = e.measurements.find((m) => m.label.startsWith('Kilometre'));
      lines.push(`· ${d ?? 'Tarih yok'} — ${e.title}${km ? ` (${km.value}, kullanıcı girişi)` : ''}`);
    }

    lines.push('', 'YAKIT KAYITLARI');
    if (fuel.length === 0) lines.push('· Kayıtlı yakıt alımı yok.');
    else for (const e of fuel) {
      const d = trDate(e.occurredAt);
      lines.push(`· ${d ?? 'Tarih yok'} — ${e.summary ?? 'Yakıt alındı'}`);
    }

    if (services.length > 0 || fuel.length > 0) {
      limitations.push('Servis ve yakıt kayıtları araç sahibinin kendi girişidir; araçtan doğrulanmamıştır.');
    }
  }

  /* ── DAİMA yazılan sınırlar ──────────────────────────────────────────── */
  limitations.push('Aracın toplam kilometresi bu özette yer almaz: araçtan doğrulanmış odometre okuması yoktur.');
  limitations.push('Ortalama yakıt tüketimi bu özette yer almaz: araç tüketimi ölçmemektedir.');
  limitations.push('Geçmiş arıza kodları bu özette yer almaz: kalıcı arıza geçmişi tutulmamaktadır.');

  lines.push('', 'BU ÖZETİN KAPSAMADIKLARI');
  for (const l of limitations) lines.push(`· ${l}`);

  lines.push('', 'Arabam Cebimde ile oluşturuldu.');

  return {
    title: `Araç Durum Özeti — ${input.title}`,
    text: lines.join('\n'),
    limitations,
  };
}
