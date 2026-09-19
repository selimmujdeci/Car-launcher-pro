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
 * (ölçülmedi · F3.2), "park edildi"/"kilitli" (fiziksel ACK yok · F0.3).
 * Bunlar EKSİKLİK olarak raporun sonunda AÇIKÇA yazılır; sessizce atlanmaz.
 *
 * ── ARIZA GEÇMİŞİ (F5.4 · güncellendi) ───────────────────────────────────
 * F4.3'te "kalıcı DTC kaydı yok" yazıyordu; F5.3 o kaynağı kurdu
 * (`vehicle_diagnostic_scans`). Rapor artık ÜÇ DURUMU ayırır ve hiçbirini
 * "arıza yok" diye sunmaz:
 *   `undefined` → kaynak bu kurulumda YOK (migration uygulanmadı)
 *   `null`      → kaynak var ama OKUNAMADI
 *   `[]`        → kaynak okundu, KAYIT YOK
 * Üçü de "araçta arıza yok" DEMEK DEĞİLDİR.
 *
 * SAF: I/O YOK · timer YOK · `Date.now()` YOK · React YOK.
 */

import {
  latestSuccessfulScan,
  summarizeScan,
  type DiagnosticScanRecord,
} from '@/lib/diagnostics/diagnosticHistory';
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
  /**
   * Kalıcı teşhis taramaları (yeniden eskiye · F5.4).
   *   `undefined` = kaynak bu kurulumda YOK (080 uygulanmadı)
   *   `null`      = kaynak var ama OKUNAMADI
   *   `[]`        = okundu, kayıt YOK
   * ÜÇÜ DE "arıza yok" DEĞİLDİR ve rapor üçünü AYRI cümlelerle söyler.
   */
  readonly diagnosticScans?: readonly DiagnosticScanRecord[] | null;
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

  /* ── Arıza taraması (F5.4) ───────────────────────────────────────────
   * Rapor TARİHSEL bir belgedir: eski tarama GÖSTERİLEBİLİR ama GÜNCEL
   * durum gibi SUNULAMAZ. Bu yüzden her cümlede tarama TARİHİ vardır ve
   * hiçbir cümle "tamir edildi / araç sağlam / şu anda arıza var" demez.
   * Hüküm dili F2.2'nin DURUM bölümünde kalır; burası yalnız ne ölçüldüğünü
   * anlatır. */
  lines.push('', 'ARIZA TARAMASI');
  if (input.diagnosticScans === undefined) {
    /* KAYNAK YOK ≠ GEÇMİŞ YOK ≠ ARIZA YOK. */
    lines.push('· Kalıcı arıza taraması kaydı bu kurulumda tutulmuyor.');
    limitations.push('Arıza tarama geçmişi bu özette yer almaz: kalıcı teşhis kaydı bu kurulumda mevcut değil. Bu, "araçta arıza yok" anlamına GELMEZ.');
  } else if (input.diagnosticScans === null) {
    lines.push('· Arıza tarama geçmişi bu özet alınırken okunamadı.');
    limitations.push('Arıza tarama geçmişi okunamadı; bu özet arıza taramalarını kapsamıyor. Bu, "araçta arıza yok" anlamına GELMEZ.');
  } else if (input.diagnosticScans.length === 0) {
    lines.push('· Bu araç için kayıtlı arıza taraması bulunmuyor.');
    limitations.push('Bu araç hiç arıza taramasından geçmemiş; tarama yapılmadığı için arıza olup olmadığı BİLİNMİYOR.');
  } else {
    const latest = input.diagnosticScans[0]!;
    const lastOk = latestSuccessfulScan(input.diagnosticScans);

    /* En son tarama BAŞARISIZSA bunu saklamayız: "tarama tamamlanamadı"
       ile "arıza bulunmadı" AYNI ŞEY DEĞİLDİR. */
    const latestSummary = summarizeScan(latest);
    const latestAt = latest.measuredAt ?? latest.completedAt;
    const latestDate = latestAt ? trDate(Date.parse(latestAt)) : null;
    lines.push(latestDate
      ? `· Son tarama (${latestDate}): ${latestSummary.headline}`
      : `· Son tarama: ${latestSummary.headline}`);

    /* Başarılı tarama ayrı gösterilir: son deneme düşmüş olabilir ama daha
       önce gerçekten ölçülmüş bir sonuç VARDIR. */
    if (lastOk && lastOk.sourceCommandId !== latest.sourceCommandId) {
      const okAt = lastOk.measuredAt ?? lastOk.completedAt;
      const okDate = okAt ? trDate(Date.parse(okAt)) : null;
      const okSummary = summarizeScan(lastOk);
      lines.push(okDate
        ? `· Son başarılı tarama (${okDate}): ${okSummary.headline}`
        : `· Son başarılı tarama: ${okSummary.headline}`);
    }

    /* Kodlar TARİHİYLE birlikte: "görüldü" dili, "var" dili DEĞİL. */
    if (lastOk && lastOk.dtcs.length > 0) {
      const okAt = lastOk.measuredAt ?? lastOk.completedAt;
      const okDate = okAt ? trDate(Date.parse(okAt)) : null;
      lines.push('', okDate
        ? `TARAMADA GÖRÜLEN ARIZA KODLARI (${okDate})`
        : 'TARAMADA GÖRÜLEN ARIZA KODLARI');
      for (const d of lastOk.dtcs.slice(0, max)) lines.push(`· ${d.code} — ${d.desc}`);
      if (lastOk.dtcs.length > max) {
        lines.push(`· … ve ${lastOk.dtcs.length - max} kod daha`);
      }
      limitations.push('Taramada görülen arıza kodları o tarihteki ölçümdür; bugün hâlâ mevcut olup olmadıkları bu özetten ANLAŞILAMAZ.');
    }

    /* Kapsam sınırları KAYBOLMAZ. */
    for (const l of latestSummary.limitations) limitations.push(l);
    if (lastOk && lastOk.sourceCommandId !== latest.sourceCommandId) {
      for (const l of summarizeScan(lastOk).limitations) limitations.push(l);
    }
    if (!lastOk) {
      limitations.push('Kayıtlı taramaların hiçbiri tamamlanamadı; arıza olup olmadığı BİLİNMİYOR.');
    }
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

  lines.push('', 'BU ÖZETİN KAPSAMADIKLARI');
  for (const l of limitations) lines.push(`· ${l}`);

  lines.push('', 'Arabam Cebimde ile oluşturuldu.');

  return {
    title: `Araç Durum Özeti — ${input.title}`,
    text: lines.join('\n'),
    limitations,
  };
}
