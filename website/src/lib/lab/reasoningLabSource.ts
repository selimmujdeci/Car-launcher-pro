/**
 * reasoningLabSource.ts — KARAR MOTORU TEK OKUMA KATMANI (SALT-OKUNUR).
 *
 * KURALLAR (CLAUDE.md §Zorunlu Gözlemlenebilirlik):
 *   · SALT-OKUNUR — **karar TETİKLEMEZ**, durum ilerletmez, hiçbir şey yazmaz.
 *     (Zaten `mavi_reason` `authenticated` için EXECUTE'a kapalıdır; bu katman
 *     onu çağırmayı DENEMEZ bile.)
 *   · Her okuma kendi `try/catch`'i içinde; biri patlarsa panel çökmez.
 *   · Bilinmeyen alan `null` döner — sahte 0 / sahte tarih YASAK.
 *   · HASSAS VERİ TAŞINMAZ: ad, plaka, VIN, konum, rota YOK.
 */

import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import type {
  ReasoningQueueRow, ReasoningSummaryRow, RecentReasoningRow,
  SchedulerHealthRow,
} from '@/lib/fleet/reasoningView';

export interface ReasoningLabReading {
  /** `null` = okunamadı (boş sonuç DEĞİL). */
  readonly summary: ReasoningSummaryRow | null;
  readonly recent: readonly RecentReasoningRow[] | null;
  /** Üretim olay kuyruğu (migration 058). */
  readonly queue: ReasoningQueueRow | null;
  /** Kuyruk koşucusunun zamanlanmış koşum sağlığı (migration 059). */
  readonly scheduler: SchedulerHealthRow | null;
  readonly summaryReadable: boolean;
  readonly recentReadable: boolean;
  readonly queueReadable: boolean;
  readonly schedulerReadable: boolean;
  readonly readAt: number;
}

const UNREADABLE: Omit<ReasoningLabReading, 'readAt'> = Object.freeze({
  summary: null, recent: null, queue: null, scheduler: null,
  summaryReadable: false, recentReadable: false, queueReadable: false,
  schedulerReadable: false,
});

/**
 * Karar özetini ve son kararları okur.
 *
 * ⚠️ Oturum yoksa sunucu fail-closed davranır ve BOŞ döner; bu katman bunu
 * "karar yok" diye değil, **okunamadı** diye raporlar — ikisi farklı şeydir.
 */
export async function readReasoningLab(userId: string | null): Promise<ReasoningLabReading> {
  const readAt = Date.now();
  if (userId === null) return { ...UNREADABLE, readAt };

  /* İstemci yapılandırılmamışsa bu "karar yok" DEĞİL, "okunamadı"dır. */
  const supabase = getSupabaseBrowserClient();
  if (supabase === null) return { ...UNREADABLE, readAt };

  let summary: ReasoningSummaryRow | null = null;
  let recent: readonly RecentReasoningRow[] | null = null;
  let queue: ReasoningQueueRow | null = null;
  let scheduler: SchedulerHealthRow | null = null;
  let summaryReadable = false;
  let recentReadable = false;
  let queueReadable = false;
  let schedulerReadable = false;

  try {
    const { data, error } = await supabase.rpc('get_reasoning_summary');
    if (!error) {
      summaryReadable = true;
      const rows = Array.isArray(data) ? data : [];
      summary = (rows[0] as ReasoningSummaryRow | undefined) ?? null;
    }
  } catch {
    summaryReadable = false;
  }

  try {
    const { data, error } = await supabase.rpc('get_recent_reasoning', {
      p_limit: 20,
    });
    if (!error) {
      recentReadable = true;
      recent = Array.isArray(data) ? (data as RecentReasoningRow[]) : [];
    }
  } catch {
    recentReadable = false;
  }

  try {
    const { data, error } = await supabase.rpc('get_reasoning_queue');
    if (!error) {
      queueReadable = true;
      const rows = Array.isArray(data) ? data : [];
      queue = (rows[0] as ReasoningQueueRow | undefined) ?? null;
    }
  } catch {
    queueReadable = false;
  }

  /* Zamanlayıcı AYRI okunur: kuyruk okunup zamanlayıcı okunamadıysa durum
     "sağlıklı" değil BİLİNMEYENDİR (059 sözleşmesi). */
  try {
    const { data, error } = await supabase.rpc('get_reasoning_scheduler_health');
    if (!error) {
      schedulerReadable = true;
      const rows = Array.isArray(data) ? data : [];
      scheduler = (rows[0] as SchedulerHealthRow | undefined) ?? null;
    }
  } catch {
    schedulerReadable = false;
  }

  return {
    summary, recent, queue, scheduler,
    summaryReadable, recentReadable, queueReadable, schedulerReadable, readAt,
  };
}
