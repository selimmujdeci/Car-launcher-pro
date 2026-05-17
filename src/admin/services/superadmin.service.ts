/**
 * superadmin.service.ts — Filo Sağlık İstatistikleri & Incident Sorgulama
 *
 * Privacy-First:
 *   Bireysel araç veya kullanıcı verisi döndürülmez.
 *   Tüm sorgular anonim, filo geneli toplamalara dayanır.
 *
 * Veri Kaynağı: vehicle_events tablosu, type = 'system_health'
 *   Payload: { ts, thermalLevel, ramPressureRatio, workerRestartTotal,
 *              uiFreezeCount, appVersion, services[], overallHealth }
 *
 * Bağımlılık:
 *   telemetryService her 5dk'da bir bu şemada system_health eventi push'lar.
 *   push_vehicle_event RPC payload'ı vehicle_events.payload JSONB kolonuna yazar.
 */

import { supabase }                      from '../lib/supabaseClient'
import type { FeatureFlag, RuntimePolicy } from '../types/superadmin'
import { auditAction }                     from '../types/superadmin'

// ── Tipler ─────────────────────────────────────────────────────────────────────

export interface FleetHealthStats {
  /** 0-100 — filo geneli kararlılık skoru */
  stabilityScore:     number;
  totalEvents:        number;
  healthyEvents:      number;
  degradedEvents:     number;
  criticalEvents:     number;
  /** 0.0-3.0 ortalama termal seviye */
  avgThermalLevel:    number;
  thermalL3Count:     number;
  uiFreezeTotal:      number;
  workerRestartTotal: number;
  /** Uygulama versiyonu bazında hata dağılımı */
  errorsByVersion: Array<{ version: string; count: number }>;
  /** Son event'in ISO timestamp'i */
  lastUpdated: string | null;
}

export interface IncidentLog {
  id:            string;
  ts:            string;
  thermalLevel:  number;
  uiFreezeCount: number;
  restartCount:  number;
  overallHealth: string;
  appVersion:    string;
  severity:      'warning' | 'critical';
}

// ── Raw payload tipi ───────────────────────────────────────────────────────────

interface HealthPayload {
  ts?:                 number;
  thermalLevel?:       number;
  ramPressureRatio?:   number;
  workerRestartTotal?: number;
  uiFreezeCount?:      number;
  appVersion?:         string;
  overallHealth?:      'healthy' | 'degraded' | 'critical';
}

interface VehicleEventRow {
  id:         string;
  created_at: string;
  payload:    HealthPayload | null;
}

// ── Yardımcılar ────────────────────────────────────────────────────────────────

function _num(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function _str(v: unknown, fallback = ''): string {
  return v != null ? String(v) : fallback;
}

/**
 * Kararlılık skoru hesapla (0-100).
 * Temel: sağlıklı event oranı × 100.
 * Cezalar: kritik event başına -10, termal-L3 başına -5, UI donma başına -5.
 */
function _calcStabilityScore(
  total: number,
  critical: number,
  thermalL3: number,
  uiFreezeTotal: number,
): number {
  if (total === 0) return 100;
  const base    = Math.round(((total - critical) / total) * 100);
  const penalty = Math.min(40, critical * 10 + thermalL3 * 5 + uiFreezeTotal * 5);
  return Math.max(0, base - penalty);
}

// ── API ─────────────────────────────────────────────────────────────────────────

/**
 * Son `hoursBack` saate ait system_health eventlerinden filo sağlık istatistikleri üretir.
 * Hata veya veri yoksa güvenli varsayılanlar döner.
 */
export async function getFleetHealthStats(hoursBack = 24): Promise<FleetHealthStats> {
  const since = new Date(Date.now() - hoursBack * 3_600_000).toISOString()

  const empty: FleetHealthStats = {
    stabilityScore:     100,
    totalEvents:        0,
    healthyEvents:      0,
    degradedEvents:     0,
    criticalEvents:     0,
    avgThermalLevel:    0,
    thermalL3Count:     0,
    uiFreezeTotal:      0,
    workerRestartTotal: 0,
    errorsByVersion:    [],
    lastUpdated:        null,
  }

  try {
    const { data, error } = await supabase
      .from('vehicle_events')
      .select('id, created_at, payload')
      .eq('type', 'system_health')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error || !data || data.length === 0) return empty

    const rows = data as VehicleEventRow[]

    let healthyCount = 0
    let degradedCount = 0
    let criticalCount = 0
    let thermalSum = 0
    let thermalL3 = 0
    let freezeTotal = 0
    let restartTotal = 0
    const versionErrorMap = new Map<string, number>()

    for (const row of rows) {
      const p: HealthPayload = row.payload ?? {}
      const health     = _str(p.overallHealth, 'healthy')
      const thermal    = _num(p.thermalLevel, 0)
      const freezes    = _num(p.uiFreezeCount, 0)
      const restarts   = _num(p.workerRestartTotal, 0)
      const version    = _str(p.appVersion, 'unknown')

      thermalSum   += thermal
      freezeTotal  += freezes
      restartTotal += restarts
      if (thermal >= 3) thermalL3++

      if (health === 'healthy')       healthyCount++
      else if (health === 'degraded') degradedCount++
      else if (health === 'critical') criticalCount++

      if (health !== 'healthy') {
        versionErrorMap.set(version, (versionErrorMap.get(version) ?? 0) + 1)
      }
    }

    const total = rows.length
    const errorsByVersion = [...versionErrorMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([version, count]) => ({ version, count }))

    return {
      stabilityScore:     _calcStabilityScore(total, criticalCount, thermalL3, freezeTotal),
      totalEvents:        total,
      healthyEvents:      healthyCount,
      degradedEvents:     degradedCount,
      criticalEvents:     criticalCount,
      avgThermalLevel:    total > 0 ? Math.round((thermalSum / total) * 10) / 10 : 0,
      thermalL3Count:     thermalL3,
      uiFreezeTotal:      freezeTotal,
      workerRestartTotal: restartTotal,
      errorsByVersion,
      lastUpdated:        rows[0]?.created_at ?? null,
    }
  } catch {
    return empty
  }
}

/**
 * Son `limit` adet critical/degraded sistem olayını döner.
 * Bireysel araç ID'si döndürülmez — privacy-first.
 */
export async function getIncidentLogs(limit = 50): Promise<IncidentLog[]> {
  try {
    const { data, error } = await supabase
      .from('vehicle_events')
      .select('id, created_at, payload')
      .eq('type', 'system_health')
      .neq('payload->>overallHealth', 'healthy')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (error || !data) return []

    return (data as VehicleEventRow[]).map((row) => {
      const p: HealthPayload = row.payload ?? {}
      const health  = _str(p.overallHealth, 'degraded')
      return {
        id:            row.id,
        ts:            row.created_at,
        thermalLevel:  _num(p.thermalLevel, 0),
        uiFreezeCount: _num(p.uiFreezeCount, 0),
        restartCount:  _num(p.workerRestartTotal, 0),
        overallHealth: health,
        appVersion:    _str(p.appVersion, 'unknown'),
        severity:      (health === 'critical' ? 'critical' : 'warning') as 'warning' | 'critical',
      }
    })
  } catch {
    return []
  }
}

// ── Feature Flags ──────────────────────────────────────────────────────────────

/** Tablo boşken veya erişim yokken gösterilecek varsayılan flagler */
const FLAG_DEFAULTS: FeatureFlag[] = [
  {
    id: 'crm', key: 'crm',
    name: 'CRM Topluluk Özellikleri',
    description: 'Radar raporları ve gerçek zamanlı trafik verisi paylaşımı',
    enabled: true, rollout_percent: 100, target_scope: 'all',
    depends_on: [], created_at: '', updated_at: '', updated_by: '',
  },
  {
    id: 'hazard_intelligence', key: 'hazard_intelligence',
    name: 'Hazard Intelligence',
    description: 'Yapay zeka destekli tehlike tespiti ve önlem önerileri',
    enabled: true, rollout_percent: 100, target_scope: 'all',
    depends_on: [], created_at: '', updated_at: '', updated_by: '',
  },
  {
    id: 'safety_copilot', key: 'safety_copilot',
    name: 'Safety Co-Pilot',
    description: 'Aktif güvenlik asistanı, ihlal koruması ve acil müdahale',
    enabled: true, rollout_percent: 100, target_scope: 'all',
    depends_on: [], created_at: '', updated_at: '', updated_by: '',
  },
  {
    id: 'predictive_intelligence', key: 'predictive_intelligence',
    name: 'Predictive Intelligence',
    description: 'Sürücü davranış tahmini, Markov motoru ve bağlamsal öneri',
    enabled: false, rollout_percent: 0, target_scope: 'pilot',
    depends_on: [], created_at: '', updated_at: '', updated_by: '',
  },
  {
    id: 'voice_extras', key: 'voice_extras',
    name: 'Voice Extras',
    description: 'Gelişmiş sesli komut, TTS çıkışı ve doğal dil anlama',
    enabled: false, rollout_percent: 0, target_scope: 'pilot',
    depends_on: [], created_at: '', updated_at: '', updated_by: '',
  },
]

/**
 * feature_flags tablosundaki tüm flagleri döner.
 * Tablo yoksa veya boşsa FLAG_DEFAULTS döner.
 */
export async function getFeatureFlags(): Promise<FeatureFlag[]> {
  try {
    const { data, error } = await supabase
      .from('feature_flags')
      .select('*')
      .order('key', { ascending: true })

    if (error || !data || data.length === 0) return FLAG_DEFAULTS

    // Bilinmeyen key'ler için defaults ile merge et
    const remoteKeys = new Set((data as FeatureFlag[]).map((f) => f.key))
    const missing    = FLAG_DEFAULTS.filter((f) => !remoteKeys.has(f.key))
    return [...(data as FeatureFlag[]), ...missing]
  } catch {
    return FLAG_DEFAULTS
  }
}

/**
 * Feature flag'i günceller ve audit trail oluşturur.
 * @param key      Flag key'i (örn: 'crm')
 * @param updates  enabled ve/veya rollout_percent
 * @param actorId  Değişikliği yapan Super Admin UUID'si
 */
export async function updateFeatureFlag(
  key:     string,
  updates: Pick<FeatureFlag, 'enabled' | 'rollout_percent'>,
  actorId: string,
): Promise<void> {
  // Mevcut değeri önce oku (audit before/after için)
  const { data: existing } = await supabase
    .from('feature_flags')
    .select('*')
    .eq('key', key)
    .maybeSingle()

  const { error } = await supabase
    .from('feature_flags')
    .upsert({
      key,
      ...updates,
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    }, { onConflict: 'key' })

  if (error) throw new Error(error.message)

  await auditAction({
    actor_id:    actorId,
    action:      `flag.${updates.enabled ? 'enable' : 'disable'}`,
    target_type: 'flag',
    target_id:   key,
    before:      existing ?? null,
    after:       { key, ...updates },
    metadata:    {},
    severity:    'warning',
  })
}

// ── Runtime Policies ───────────────────────────────────────────────────────────

/** Varsayılan runtime politikaları — tablo yoksa kullanılır */
const POLICY_DEFAULTS: RuntimePolicy[] = [
  // Thermal
  { id: 't1', key: 'thermal.l1_temp_c',   name: 'L1 Termal Eşik',           category: 'thermal',  value: 55,     min: 40,   max: 80,    unit: '°C',  description: 'Termal uyarı başladığı sıcaklık',           updated_at: '', updated_by: null },
  { id: 't2', key: 'thermal.l2_temp_c',   name: 'L2 Yüksek Isı',            category: 'thermal',  value: 65,     min: 50,   max: 90,    unit: '°C',  description: 'CRM durdurma ve throttling başlangıcı',     updated_at: '', updated_by: null },
  { id: 't3', key: 'thermal.l3_temp_c',   name: 'L3 Kritik Eşik',           category: 'thermal',  value: 75,     min: 60,   max: 100,   unit: '°C',  description: 'Sistem tahliyesi ve LIMP_HOME modu',        updated_at: '', updated_by: null },
  { id: 't4', key: 'thermal.recovery_c',  name: 'Recovery Hysteresis',       category: 'thermal',  value: 5,      min: 2,    max: 15,    unit: '°C',  description: 'Seviye düşürme için minimum soğuma farkı',  updated_at: '', updated_by: null },
  // Sync Intervals
  { id: 's1', key: 'sync.obd_interval_ms',    name: 'OBD Heartbeat',         category: 'sync',     value: 5000,   min: 1000, max: 30000, unit: 'ms',  description: 'OBD sinyali bekleme aralığı',               updated_at: '', updated_by: null },
  { id: 's2', key: 'sync.gps_interval_ms',    name: 'GPS Güncelleme',         category: 'sync',     value: 3000,   min: 500,  max: 15000, unit: 'ms',  description: 'GPS konum güncellemesi aralığı',            updated_at: '', updated_by: null },
  { id: 's3', key: 'sync.telemetry_ms',       name: 'Telemetri Heartbeat',    category: 'sync',     value: 5000,   min: 1000, max: 60000, unit: 'ms',  description: 'Supabase telemetri push aralığı (sürüşte)', updated_at: '', updated_by: null },
  // Watchdog
  { id: 'w1', key: 'watchdog.vehicle_deadline_ms', name: 'VehicleLayer Deadline', category: 'watchdog', value: 30000, min: 5000, max: 120000, unit: 'ms',   description: 'VehicleDataLayer heartbeat zaman aşımı',   updated_at: '', updated_by: null },
  { id: 'w2', key: 'watchdog.gps_deadline_ms',     name: 'GPS Deadline',          category: 'watchdog', value: 60000, min: 5000, max: 300000, unit: 'ms',   description: 'GPS heartbeat zaman aşımı',                updated_at: '', updated_by: null },
  { id: 'w3', key: 'watchdog.max_restarts',        name: 'Max Restart',           category: 'watchdog', value: 3,     min: 1,    max: 10,     unit: 'adet', description: 'Servis yeniden başlatma limiti',           updated_at: '', updated_by: null },
]

/**
 * runtime_policies tablosundaki politikaları döner.
 * Tablo yoksa veya boşsa POLICY_DEFAULTS döner.
 */
export async function getRuntimePolicies(): Promise<RuntimePolicy[]> {
  try {
    const { data, error } = await supabase
      .from('runtime_policies')
      .select('*')
      .order('category', { ascending: true })

    if (error || !data || data.length === 0) return POLICY_DEFAULTS

    const remoteKeys = new Set((data as RuntimePolicy[]).map((p) => p.key))
    const missing    = POLICY_DEFAULTS.filter((p) => !remoteKeys.has(p.key))
    return [...(data as RuntimePolicy[]), ...missing]
  } catch {
    return POLICY_DEFAULTS
  }
}

/**
 * Runtime politikasını günceller ve audit trail oluşturur.
 * @param key      Politika key'i (örn: 'thermal.l1_temp_c')
 * @param value    Yeni sayısal değer
 * @param actorId  Değişikliği yapan Super Admin UUID'si
 */
export async function updateRuntimePolicy(
  key:     string,
  value:   number,
  actorId: string,
): Promise<void> {
  const { data: existing } = await supabase
    .from('runtime_policies')
    .select('value')
    .eq('key', key)
    .maybeSingle()

  const { error } = await supabase
    .from('runtime_policies')
    .upsert({
      key,
      value,
      updated_at: new Date().toISOString(),
      updated_by: actorId,
    }, { onConflict: 'key' })

  if (error) throw new Error(error.message)

  await auditAction({
    actor_id:    actorId,
    action:      'policy.update',
    target_type: 'policy',
    target_id:   key,
    before:      existing ? { value: (existing as { value: number }).value } : null,
    after:       { value },
    metadata:    {},
    severity:    'warning',
  })
}
