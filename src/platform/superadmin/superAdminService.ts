/**
 * superAdminService — Super Admin Telemetri Veri Servisi
 *
 * GİZLİLİK: Bireysel araç ID'si veya GPS verisi asla çekilmez/döndürülmez.
 * Tüm veriler anonim toplamalardır.
 *
 * Veri kaynağı: vehicle_events (system_health tipi) + feature_flags tabloları.
 * Sorgular: RLS uyumlu — anon key ile erişilebilir SELECT'ler.
 */

import { getSupabaseClient }  from '../supabaseClient';
import { getAdminClient }     from '../roleSystem/RoleStore';

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

// ── Write API — Tüm işlemler adminClient (persistSession:true) üzerinden ──────

export interface FeatureFlag {
  id:              string
  key:             string
  name:            string
  enabled:         boolean
  rollout_percent: number
  updated_at:      string
}

const LIMP_MODE_FLAG_KEYS = [
  'crm', 'hazard_intelligence', 'safety_copilot', 'predictive_intelligence', 'voice_extras',
] as const;

/**
 * Tüm feature flag'leri döner (admin client — authenticated SELECT).
 */
export async function getFeatureFlags(): Promise<FeatureFlag[]> {
  const client = getAdminClient();
  if (!client) return [];
  try {
    const { data, error } = await client
      .from('feature_flags')
      .select('id, key, name, enabled, rollout_percent, updated_at')
      .order('key', { ascending: true });
    if (error || !data) return [];
    return data as FeatureFlag[];
  } catch {
    return [];
  }
}

/**
 * Audit log'a kayıt düşer.
 * ATOMIK KURAL: Bu fonksiyon başarısız olursa asıl işlem DURDURULMALI.
 */
export async function logAdminAction(
  action:   string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const client = getAdminClient();
  if (!client) throw new Error('AUDIT_FAILED: Admin client yok');

  const { data: userData } = await client.auth.getUser();
  const actorId = userData?.user?.id ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client.from('audit_logs') as any).insert({
    actor_id:  actorId,
    action,
    target:    (metadata['target'] as string | undefined) ?? 'system',
    after_val: metadata,
    severity:  (metadata['severity'] as string | undefined) ?? 'warning',
  });

  if (error) throw new Error(`AUDIT_FAILED: ${error.message}`);
}

/**
 * Belirli bir feature flag'i günceller.
 * Atomic: önce audit log → başarılıysa update.
 */
export async function updateFeatureFlag(
  key:     string,
  enabled: boolean,
): Promise<void> {
  const client = getAdminClient();
  if (!client) throw new Error('Kimlik doğrulama yok');

  // 1. Audit log — başarısız olursa burada durur
  await logAdminAction(`flag.${enabled ? 'enable' : 'disable'}`, {
    target:   `flag:${key}`,
    key,
    enabled,
    severity: 'warning',
  });

  // 2. Update
  const now = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client.from('feature_flags') as any)
    .update({ enabled, updated_at: now })
    .eq('key', key);

  if (error) throw new Error((error as { message: string }).message);
}

/**
 * Tüm kritik flag'leri devre dışı bırakır (Fleet Limp Mode).
 * Atomic: önce audit log → başarılıysa batch update.
 */
export async function activateFleetLimpMode(): Promise<void> {
  const client = getAdminClient();
  if (!client) throw new Error('Kimlik doğrulama yok');

  // 1. Audit log — başarısız olursa burada durur
  await logAdminAction('system.emergency_limp_mode', {
    target:       'fleet',
    affectedFlags: LIMP_MODE_FLAG_KEYS,
    severity:     'critical',
  });

  // 2. Batch update
  const now = new Date().toISOString();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (client.from('feature_flags') as any)
    .update({ enabled: false, rollout_percent: 0, updated_at: now })
    .in('key', [...LIMP_MODE_FLAG_KEYS]);

  if (error) throw new Error((error as { message: string }).message);
}
