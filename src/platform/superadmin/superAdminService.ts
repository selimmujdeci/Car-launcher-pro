/**
 * superAdminService — Super Admin Telemetri Veri Servisi
 *
 * GİZLİLİK: Bireysel araç ID'si veya GPS verisi asla çekilmez/döndürülmez.
 * Tüm veriler anonim toplamalardır.
 *
 * Veri kaynağı: vehicle_events (system_health tipi) + feature_flags tabloları.
 * Sorgular: RLS uyumlu — anon key ile erişilebilir SELECT'ler.
 */

import { getSupabaseClient } from '../supabaseClient';

// ── Tipler ────────────────────────────────────────────────────────────────────

export interface FleetHealthSummary {
  totalEvents:    number
  criticalCount:  number
  stabilityScore: number   // 0-100
  windowHours:    number
}

export interface CriticalEventPayload {
  ts:           string
  thermalLevel: number
  overallHealth: string
  appVersion:   string
}

// ── Yardımcılar ───────────────────────────────────────────────────────────────

function _since(hours: number): string {
  return new Date(Date.now() - hours * 3_600_000).toISOString();
}

// ── Filo Sağlık Özeti ─────────────────────────────────────────────────────────

/**
 * Son `windowHours` saatlik system_health eventlerinden anonim özet üretir.
 * vehicle_id asla döndürülmez.
 */
export async function getFleetHealthSummary(
  windowHours = 1,
): Promise<FleetHealthSummary> {
  const fallback: FleetHealthSummary = {
    totalEvents: 0, criticalCount: 0, stabilityScore: 100, windowHours,
  };

  const sb = getSupabaseClient();
  if (!sb) return fallback;

  try {
    const { data, error } = await sb
      .from('vehicle_events')
      .select('payload')
      .eq('type', 'system_health')
      .gte('created_at', _since(windowHours))
      .limit(500);

    if (error || !data || data.length === 0) return fallback;

    const total    = data.length;
    const critical = data.filter(
      (r) => (r.payload as { overallHealth?: string } | null)?.overallHealth === 'critical',
    ).length;

    return {
      totalEvents:    total,
      criticalCount:  critical,
      stabilityScore: Math.round(((total - critical) / total) * 100),
      windowHours,
    };
  } catch {
    return fallback;
  }
}

// ── 24 Saatlik Kritik Olay Sayısı ─────────────────────────────────────────────

export async function getCriticalCount24h(): Promise<number> {
  const sb = getSupabaseClient();
  if (!sb) return 0;

  try {
    const { count, error } = await sb
      .from('vehicle_events')
      .select('id', { count: 'exact', head: true })
      .eq('type', 'system_health')
      .eq('payload->>overallHealth', 'critical')
      .gte('created_at', _since(24));

    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

// ── Aktif Feature Flag Sayısı ─────────────────────────────────────────────────

export async function getActiveFlagCount(): Promise<{ enabled: number; total: number }> {
  const sb = getSupabaseClient();
  if (!sb) return { enabled: 0, total: 0 };

  try {
    const { data, error } = await sb
      .from('feature_flags')
      .select('enabled');

    if (error || !data) return { enabled: 0, total: 0 };

    return {
      enabled: data.filter((f: { enabled: boolean }) => f.enabled).length,
      total:   data.length,
    };
  } catch {
    return { enabled: 0, total: 0 };
  }
}

// ── Realtime: Kritik Event Akışı ──────────────────────────────────────────────

/**
 * vehicle_events tablosuna yeni 'critical' system_health eventi geldiğinde
 * callback'i ateşler. Privacy-safe: sadece anonim payload alanları iletilir.
 *
 * @returns cleanup fonksiyonu — useEffect return'üne ekle.
 *
 * ⚠ Ön koşul: vehicle_events tablosu Supabase Realtime publication'a eklenmiş olmalı.
 *   SQL: ALTER PUBLICATION supabase_realtime ADD TABLE vehicle_events;
 */
export function subscribeToCriticalEvents(
  onEvent: (payload: CriticalEventPayload) => void,
): () => void {
  const sb = getSupabaseClient();
  if (!sb) return () => undefined;

  const channel = sb
    .channel('sa-mobile-critical')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'vehicle_events' },
      (change: { new: Record<string, unknown> }) => {
        const row     = change.new;
        const type    = row['type'] as string | undefined;
        if (type !== 'system_health') return;

        const p       = (row['payload'] ?? {}) as Record<string, unknown>;
        const health  = (p['overallHealth'] as string | undefined) ?? 'healthy';
        if (health !== 'critical') return;

        onEvent({
          ts:            (row['created_at'] as string | undefined) ?? new Date().toISOString(),
          thermalLevel:  Number(p['thermalLevel'] ?? 0),
          overallHealth: health,
          appVersion:    (p['appVersion']   as string | undefined) ?? 'unknown',
        });
      },
    )
    .subscribe();

  return () => { void sb.removeChannel(channel); };
}
