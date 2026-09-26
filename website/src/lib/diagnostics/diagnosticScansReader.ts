/**
 * diagnosticScansReader — teşhis geçmişinin TEK istemci okuma otoritesi (F5.4A).
 *
 * ── NEDEN TEK YER ────────────────────────────────────────────────────────
 * Araç Hafızası ve Paylaşım Özeti AYNI veriye ihtiyaç duyar. Her biri kendi
 * Supabase sorgusunu yazsaydı, zamanla kolon/sıralama/limit farkları doğar ve
 * kullanıcı aynı araç için hafızada başka, raporda başka bir geçmiş görürdü.
 * Bu dosya o okumanın TEK sahibidir; sunucu tarafı (`consumer-notify-scan`)
 * kendi okuma sınırında kalır — o ayrı bir güven bölgesidir.
 *
 * ── BU DOSYA HÜKÜM VERMEZ ────────────────────────────────────────────────
 * Satırları `rowToDiagnosticScanRecord` (F5.4) ile kanonik sözleşmeye çevirir.
 * Yeni parser, yeni severity, yeni tarayıcı YOKTUR. Ham Supabase satırı
 * sunum katmanına SIZDIRILMAZ.
 *
 * ── ÜÇ DURUM BİRBİRİNE ÇEVRİLMEZ (§5) ────────────────────────────────────
 *   `undefined` → kaynak bu kurulumda YOK (tablo henüz uygulanmadı)
 *   `null`      → kaynak var ama OKUNAMADI (ağ/RLS/sunucu hatası)
 *   `[]`        → okundu, KAYIT YOK
 *
 * ÜÇÜ DE "araçta arıza yok" DEĞİLDİR. Özellikle `tablo yok → []` dönüşümü
 * YASAKTIR: o dönüşüm sessizce "geçmiş yok" iddiasına dönerdi.
 */

import { supabaseBrowser } from '@/lib/supabase';
import {
  rowToDiagnosticScanRecord,
  type DiagnosticScanRecord,
  type DiagnosticScanRow,
} from './diagnosticHistory';

/** Okunan kolonlar — fazlası istenmez (en az yetki ilkesi). */
const COLUMNS =
  'vehicle_id, source_command_id, status, measured_at, completed_at, partial, ' +
  'completeness, permanent_supported, dtcs, failure_reason';

/**
 * PostgREST'in "tablo/şema bulunamadı" kodu.
 *
 * Bu, bir OKUMA HATASI değil KAYNAK YOKLUĞUDUR: migration 080 henüz
 * uygulanmadığında tam olarak bu döner. İkisini ayırmak, rapora "bu kurulumda
 * tutulmuyor" ile "okunamadı" arasında DOĞRU cümleyi kurdurur.
 */
const TABLE_MISSING = 'PGRST205';

/**
 * Okunacak azami tarama — mevcut hafıza sayfa boyutu (yeni sabit UYDURULMAZ).
 *
 * Rapor "son tarama" ve "son BAŞARILI tarama"yı kullanır; ikisi de en yeni
 * kayıtlar arasındadır. Bu pencere gerçekçi kullanımda son başarılı taramayı
 * KAPSAR; kapsamadığı uç durumda rapor yine yalan söylemez, yalnız
 * "tamamlanamadı" sınırını yazar.
 */
export const DIAGNOSTIC_SCANS_PAGE_SIZE = 50;

/**
 * Bir ARACIN teşhis taramalarını yeniden eskiye okur.
 *
 * @returns `undefined` kaynak yok · `null` okunamadı · dizi okundu
 */
export async function loadDiagnosticScans(
  vehicleId: string,
): Promise<readonly DiagnosticScanRecord[] | null | undefined> {
  /* Supabase yapılandırılmamışsa kaynak YOK demektir — "kayıt yok" DEĞİL. */
  if (!supabaseBrowser) return undefined;

  try {
    const { data, error } = await supabaseBrowser
      .from('vehicle_diagnostic_scans')
      .select(COLUMNS)
      /* ARAÇ KAPSAMI: yetki RLS'tedir, bu filtre yetki DEĞİL — yanlış aracın
         satırının istemciye hiç gelmemesi içindir. */
      .eq('vehicle_id', vehicleId)
      .order('measured_at', { ascending: false, nullsFirst: false })
      .limit(DIAGNOSTIC_SCANS_PAGE_SIZE);

    if (error) {
      /* Tablo yok → KAYNAK YOK (migration uygulanmadı). Okuma hatası DEĞİL. */
      if ((error as { code?: string }).code === TABLE_MISSING) return undefined;
      return null;
    }

    const rows = (data ?? []) as DiagnosticScanRow[];
    /* Bozuk satır kayıt UYDURMAZ: `rowToDiagnosticScanRecord` `null` döner ve
       elenir. Kalan geçerli satırlar korunur (tek bozuk satır turu durdurmaz). */
    return rows
      .map(rowToDiagnosticScanRecord)
      .filter((r): r is DiagnosticScanRecord => r !== null);
  } catch {
    /* Ağ/istemci hatası → OKUNAMADI. Sessizce boş liste ÜRETİLMEZ. */
    return null;
  }
}
