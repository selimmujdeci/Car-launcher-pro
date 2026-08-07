/**
 * aiMechanicLabSource.ts — AI MECHANIC TEK OKUMA KATMANI (SALT-OKUNUR).
 *
 * KURALLAR (CLAUDE.md §Zorunlu Gözlemlenebilirlik):
 *   · SALT-OKUNUR — analiz TETİKLEMEZ, karar üretmez, hiçbir şey yazmaz.
 *   · Okuma kendi `try/catch`'i içinde; patlarsa panel çökmez.
 *   · Bilinmeyen alan `null` döner — sahte 0 / sahte tarih YASAK.
 *   · HASSAS VERİ TAŞINMAZ: ad, plaka, VIN, konum, rota YOK.
 *
 * ⚠️ Oturum yoksa sunucu fail-closed davranır ve BOŞ döner; bu katman bunu
 * "analiz yok" diye değil **okunamadı** diye raporlar — ikisi farklı şeydir.
 */

import { getSupabaseBrowserClient } from '@/lib/supabaseBrowser';
import type { AiMechanicSummaryRow } from '@/lib/fleet/aiMechanicView';

export interface AiMechanicLabReading {
  /** `null` = okunamadı (boş sonuç DEĞİL). */
  readonly summary: AiMechanicSummaryRow | null;
  readonly summaryReadable: boolean;
  readonly readAt: number;
}

const UNREADABLE: Omit<AiMechanicLabReading, 'readAt'> = Object.freeze({
  summary: null,
  summaryReadable: false,
});

/** AI Mechanic özetini okur — `get_ai_mechanic_summary()` (migration 060). */
export async function readAiMechanicLab(userId: string | null): Promise<AiMechanicLabReading> {
  const readAt = Date.now();
  if (userId === null) return { ...UNREADABLE, readAt };

  const supabase = getSupabaseBrowserClient();
  if (supabase === null) return { ...UNREADABLE, readAt };

  let summary: AiMechanicSummaryRow | null = null;
  let summaryReadable = false;

  try {
    const { data, error } = await supabase.rpc('get_ai_mechanic_summary');
    if (!error) {
      summaryReadable = true;
      const rows = Array.isArray(data) ? data : [];
      summary = (rows[0] as AiMechanicSummaryRow | undefined) ?? null;
    }
  } catch {
    summaryReadable = false;
  }

  return { summary, summaryReadable, readAt };
}
