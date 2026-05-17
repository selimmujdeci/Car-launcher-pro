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

// ── Incident Black Box ────────────────────────────────────────────────────────

export interface RecentIncident {
  id:           string
  ts:           string
  deviceHash:   string   // 6-char anonim
  thermalLevel: number
  overallHealth: 'degraded' | 'critical'
  appVersion:   string
  severity:     'warning' | 'critical'
}

export interface IncidentDataPoint {
  ts:             string
  thermalLevel:   number   // 0-3
  ramPressure:    number   // 0-100 %
  workerRestarts: number
  uiFreezeCount:  number
  overallHealth:  string
}

function _hashId(id: string | null | undefined): string {
  if (!id) return 'UNKNWN';
  return id.replace(/-/g, '').slice(0, 6).toUpperCase();
}

function _num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _str(v: unknown, fallback = ''): string {
  return v != null ? String(v) : fallback;
}

/**
 * Son `limit` adet healthy-olmayan system_health eventini döner.
 * adminClient üzerinden — RLS: super_admin JWT gerekli.
 * GPS verisi asla dahil edilmez.
 */
export async function getRecentIncidents(limit = 20): Promise<RecentIncident[]> {
  const client = getAdminClient();
  if (!client) return [];

  try {
    const { data, error } = await client
      .from('vehicle_events')
      .select('id, created_at, vehicle_id, payload')
      .eq('type', 'system_health')
      .neq('payload->>overallHealth', 'healthy')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error || !data) return [];

    type Row = { id: string; created_at: string; vehicle_id?: string; payload: Record<string, unknown> | null };

    return (data as Row[]).map((row) => {
      const p = row.payload ?? {};
      const health = _str(p['overallHealth'], 'degraded');
      return {
        id:           row.id,
        ts:           row.created_at,
        deviceHash:   _hashId(row.vehicle_id ?? row.id),
        thermalLevel: _num(p['thermalLevel'], 0),
        overallHealth: (health === 'critical' ? 'critical' : 'degraded') as 'critical' | 'degraded',
        appVersion:   _str(p['appVersion'], 'unknown'),
        severity:     (health === 'critical' ? 'critical' : 'warning') as 'warning' | 'critical',
      };
    });
  } catch {
    return [];
  }
}

/**
 * Olay anına ait 5 dakikalık telemetri penceresini döner.
 * Client-side deviceHash filtresi — SQL substring yerine güvenli/hızlı.
 * GPS verisi dahil edilmez.
 */
export async function getIncidentContext(
  deviceHash: string,
  targetTs:   string,
): Promise<IncidentDataPoint[]> {
  const client = getAdminClient();
  if (!client) return [];

  const windowStart = new Date(new Date(targetTs).getTime() - 5 * 60_000).toISOString();

  try {
    const { data, error } = await client
      .from('vehicle_events')
      .select('id, created_at, vehicle_id, payload')
      .eq('type', 'system_health')
      .gte('created_at', windowStart)
      .lte('created_at', targetTs)
      .order('created_at', { ascending: true })
      .limit(60);

    if (error || !data) return [];

    type Row = { id: string; created_at: string; vehicle_id?: string; payload: Record<string, unknown> | null };

    // Client-side deviceHash filtresi — O(n) ama küçük veri seti (max 60 row)
    return (data as Row[])
      .filter((r) => _hashId(r.vehicle_id ?? r.id) === deviceHash)
      .map((r) => {
        const p = r.payload ?? {};
        return {
          ts:             r.created_at,
          thermalLevel:   Math.max(0, Math.min(3, _num(p['thermalLevel'], 0))),
          ramPressure:    Math.round(_num(p['ramPressureRatio'], 0) * 100),
          workerRestarts: _num(p['workerRestartTotal'], 0),
          uiFreezeCount:  _num(p['uiFreezeCount'], 0),
          overallHealth:  _str(p['overallHealth'], 'healthy'),
        };
      });
  } catch {
    return [];
  }
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
