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
  /** Anonim cihaz parmak izi (6 char) — gerçek vehicle_id asla açığa çıkmaz */
  deviceHash:    string;
  thermalLevel:  number;
  uiFreezeCount: number;
  restartCount:  number;
  overallHealth: string;
  appVersion:    string;
  severity:      'warning' | 'critical';
}

/** Black Box replay için tek bir telemetri snapshot'ı */
export interface IncidentDataPoint {
  ts:             string;
  thermalLevel:   number;   // 0-3
  ramPressure:    number;   // 0-100 (%)
  workerRestarts: number;
  uiFreezeCount:  number;
  overallHealth:  string;
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
  id:          string;
  created_at:  string;
  vehicle_id?: string;
  payload:     HealthPayload | null;
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
      .select('id, created_at, vehicle_id, payload')
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
        deviceHash:    _hashDevice(row.vehicle_id ?? row.id),
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

// ── Remote Diagnostics ────────────────────────────────────────────────────────

export interface KnownDevice {
  hash:         string    // 6-char anonymized ID
  lastSeen:     string
  eventCount:   number
  lastHealth:   'healthy' | 'degraded' | 'critical'
  thermalLevel: number
}

export interface DiagnosticReport {
  deviceHash:  string
  events:      IncidentDataPoint[]
  lastPanic:   Record<string, unknown> | null
  loadedAt:    string
}

/**
 * Son 24 saatte görülen tüm anonim cihaz hash'lerini döner.
 * vehicle_id asla açığa çıkmaz — yalnızca 6-char hash.
 */
export async function getKnownDevices(): Promise<KnownDevice[]> {
  try {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
    const { data, error } = await supabase
      .from('vehicle_events')
      .select('vehicle_id, payload, created_at')
      .eq('type', 'system_health')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(500)

    if (error || !data) return []

    type Row = { vehicle_id?: string; payload: HealthPayload; created_at: string }
    const map = new Map<string, { count: number; lastSeen: string; health: string; thermal: number }>()

    for (const row of data as Row[]) {
      const hash   = _hashDevice((row.vehicle_id as string | undefined) ?? row.created_at)
      const p      = row.payload ?? {}
      const health = _str(p.overallHealth, 'healthy')
      const prev   = map.get(hash)
      if (!prev) {
        map.set(hash, { count: 1, lastSeen: row.created_at, health, thermal: _num(p.thermalLevel, 0) })
      } else {
        prev.count++
      }
    }

    return [...map.entries()]
      .map(([hash, v]) => ({
        hash,
        lastSeen:     v.lastSeen,
        eventCount:   v.count,
        lastHealth:   v.health as KnownDevice['lastHealth'],
        thermalLevel: v.thermal,
      }))
      .slice(0, 20)
  } catch {
    return []
  }
}

/**
 * Belirli bir cihaz için teşhis raporu oluşturur.
 * Tüm debug oturumları audit_logs'a kaydedilir.
 * Privacy: GPS verisi kesinlikle dahil edilmez.
 */
export async function getDiagnosticReport(
  deviceHash: string,
  actorId:    string,
): Promise<DiagnosticReport> {
  const sessionId = crypto.randomUUID()
  const loadedAt  = new Date().toISOString()

  await auditAction({
    actor_id:    actorId,
    action:      'system.debug_session_started',
    target_type: 'system',
    target_id:   deviceHash,
    before:      null,
    after:       { deviceHash, sessionId, loadedAt },
    metadata:    { sessionId },
    severity:    'warning',
  })

  try {
    const since = new Date(Date.now() - 15 * 60_000).toISOString()
    const { data } = await supabase
      .from('vehicle_events')
      .select('vehicle_id, payload, created_at')
      .eq('type', 'system_health')
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(100)

    type Row = { vehicle_id?: string; payload: HealthPayload; created_at: string }
    const rows = ((data ?? []) as Row[]).filter(
      (r) => _hashDevice((r.vehicle_id as string | undefined) ?? '') === deviceHash,
    )

    const events: IncidentDataPoint[] = rows.map((r) => ({
      ts:             r.created_at,
      thermalLevel:   Math.max(0, Math.min(3, _num(r.payload?.thermalLevel, 0))),
      ramPressure:    Math.round(_num(r.payload?.ramPressureRatio, 0) * 100),
      workerRestarts: _num(r.payload?.workerRestartTotal, 0),
      uiFreezeCount:  _num(r.payload?.uiFreezeCount, 0),
      overallHealth:  _str(r.payload?.overallHealth, 'healthy'),
    }))

    // Panic snapshot — kritik sağlık eventi varsa son birini al
    const panicRow = rows.findLast((r) => _str(r.payload?.overallHealth, '') === 'critical')
    const lastPanic = panicRow
      ? { ts: panicRow.created_at, thermal: _num(panicRow.payload?.thermalLevel, 0), ...panicRow.payload }
      : null

    return { deviceHash, events, lastPanic, loadedAt }
  } catch {
    return { deviceHash, events: [], lastPanic: null, loadedAt }
  }
}

/**
 * Belirli bir cihaz için realtime log akışını başlatır.
 * Gelen tüm system_health eventleri client-side hash filtresiyle ayrılır.
 * @returns cleanup fonksiyonu
 */
export function subscribeToDeviceLogs(
  deviceHash: string,
  onLog:      (event: LiveEvent) => void,
): () => void {
  const channel = supabase
    .channel(`sa-device-debug-${deviceHash}`)
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'vehicle_events' },
      (change: { new: Record<string, unknown> }) => {
        const row    = change.new
        const rawId  = (row['vehicle_id'] as string | undefined) ?? (row['id'] as string | undefined)
        const hash   = _hashDevice(rawId)
        if (hash !== deviceHash) return   // başka cihaz → filtrele

        const type    = _str(row['type'], '')
        if (type !== 'system_health' && type !== 'critical_error') return

        const payload  = (row['payload'] ?? {}) as HealthPayload
        const { tag, message } = _parseEvent(type, payload)

        onLog({
          id:         _str(row['id'], crypto.randomUUID()),
          ts:         _str(row['created_at'], new Date().toISOString()),
          deviceHash: hash,
          tag,
          message,
          count:      1,
          isNew:      true,
        })
      },
    )
    .subscribe()

  return () => { void supabase.removeChannel(channel) }
}

// ── Fleet Inventory ────────────────────────────────────────────────────────────

export interface GpuClassBucket {
  label:        string   // 'HIGH-END', 'MID-RANGE', 'LEGACY (MALI-400)'
  count:        number
  pct:          number
  avgStability: number
}

export interface VersionBucket {
  version:   string
  count:     number   // unique device count
  pct:       number
  stability: number
}

export interface FleetInventory {
  totalDevices: number
  gpuClasses:   GpuClassBucket[]
  versionDist:  VersionBucket[]
  ramProfile: {
    low:    number   // % devices with avg RAM < 40%
    medium: number   // % devices with avg RAM 40-70%
    high:   number   // % devices with avg RAM > 70%
  }
  lastScanned: string | null
}

const _FLEET_EMPTY: FleetInventory = {
  totalDevices: 0,
  gpuClasses:   [],
  versionDist:  [],
  ramProfile:   { low: 0, medium: 0, high: 0 },
  lastScanned:  null,
}

/**
 * Son 24 saatin system_health eventlerinden anonim filo envanteri üretir.
 *
 * GPU Sınıfı Heuristiği (gerçek GPU verisi payload'da yok):
 *   avgThermal ≥ 2 VEYA avgRAM ≥ 70%  → LEGACY (MALI-400)
 *   avgThermal ≥ 1 VEYA avgRAM ≥ 40%  → MID-RANGE
 *   diğer                               → HIGH-END
 *
 * Privacy: vehicle_id yalnızca gruplama için hash'lenir, hiçbir zaman dışarı çıkmaz.
 */
export async function getFleetInventory(): Promise<FleetInventory> {
  try {
    const since = new Date(Date.now() - 24 * 3_600_000).toISOString()
    const { data, error } = await supabase
      .from('vehicle_events')
      .select('vehicle_id, payload, created_at')
      .eq('type', 'system_health')
      .gte('created_at', since)
      .order('created_at', { ascending: false })
      .limit(1000)

    if (error || !data || data.length === 0) return _FLEET_EMPTY

    type Row = { vehicle_id?: string; payload: HealthPayload; created_at: string }

    // Cihaz başına metrik biriktir — sadece hash, hiç raw ID dışarı çıkmaz
    const deviceMap = new Map<string, {
      ramSamples:  number[]
      thermalSamples: number[]
      criticals:   number
      total:       number
      appVersion:  string
    }>()

    let lastTs: string | null = null

    for (const row of data as Row[]) {
      const p     = row.payload ?? {}
      const hash  = _hashDevice((row.vehicle_id as string | undefined) ?? '')
      const prev  = deviceMap.get(hash) ?? {
        ramSamples: [], thermalSamples: [], criticals: 0, total: 0,
        appVersion: _str(p.appVersion, 'unknown'),
      }
      prev.ramSamples.push(_num(p.ramPressureRatio, 0) * 100)
      prev.thermalSamples.push(_num(p.thermalLevel, 0))
      if (_str(p.overallHealth, 'healthy') === 'critical') prev.criticals++
      prev.total++
      deviceMap.set(hash, prev)
      if (!lastTs) lastTs = row.created_at
    }

    const totalDevices = deviceMap.size
    if (totalDevices === 0) return _FLEET_EMPTY

    const gpuMap  = new Map<string, { count: number; stabilities: number[] }>()
    const verMap  = new Map<string, { count: number; stabilities: number[] }>()
    let ramLow = 0, ramMedium = 0, ramHigh = 0

    for (const stats of deviceMap.values()) {
      const avgRam     = stats.ramSamples.reduce((a, b) => a + b, 0) / stats.ramSamples.length
      const avgThermal = stats.thermalSamples.reduce((a, b) => a + b, 0) / stats.thermalSamples.length
      const stability  = _calcStabilityScore(stats.total, stats.criticals, 0, 0)

      // GPU class heuristic
      const gpuLabel = avgThermal >= 2 || avgRam >= 70
        ? 'LEGACY (MALI-400)'
        : avgThermal >= 1 || avgRam >= 40
        ? 'MID-RANGE'
        : 'HIGH-END'

      const g = gpuMap.get(gpuLabel) ?? { count: 0, stabilities: [] }
      g.count++; g.stabilities.push(stability)
      gpuMap.set(gpuLabel, g)

      // Version distribution
      const v = verMap.get(stats.appVersion) ?? { count: 0, stabilities: [] }
      v.count++; v.stabilities.push(stability)
      verMap.set(stats.appVersion, v)

      // RAM profile
      if (avgRam < 40) ramLow++
      else if (avgRam < 70) ramMedium++
      else ramHigh++
    }

    const avg = (arr: number[]) =>
      arr.length > 0 ? Math.round(arr.reduce((a, b) => a + b, 0) / arr.length) : 100

    const gpuClasses: GpuClassBucket[] = ['HIGH-END', 'MID-RANGE', 'LEGACY (MALI-400)']
      .filter((l) => gpuMap.has(l))
      .map((l) => {
        const b = gpuMap.get(l)!
        return { label: l, count: b.count, pct: Math.round((b.count / totalDevices) * 100), avgStability: avg(b.stabilities) }
      })

    const versionDist: VersionBucket[] = [...verMap.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([version, b]) => ({
        version,
        count:     b.count,
        pct:       Math.round((b.count / totalDevices) * 100),
        stability: avg(b.stabilities),
      }))

    const toP = (n: number) => Math.round((n / totalDevices) * 100)

    return {
      totalDevices,
      gpuClasses,
      versionDist,
      ramProfile: { low: toP(ramLow), medium: toP(ramMedium), high: toP(ramHigh) },
      lastScanned: lastTs,
    }
  } catch {
    return _FLEET_EMPTY
  }
}

// ── Rollout Plans ─────────────────────────────────────────────────────────────

import type { RolloutPlan, RolloutStage, RolloutStageStatus } from '../types/superadmin'

export interface RolloutHealthStats {
  version:        string
  stabilityScore: number
  criticalEvents: number
  totalEvents:    number
  /** true → sağlık kritik eşiğin altında, ilerleme durdurulmalı */
  circuitBreaker: boolean
}

export interface CreateRolloutDTO {
  version:     string
  description: string
  rollback_to: string | null
}

/** Varsayılan 3-aşamalı canary pipeline */
function _defaultStages(): RolloutStage[] {
  return [
    { order: 0, target: 'internal',   percent: 1,   status: 'pending', started_at: null, completed_at: null, error_threshold_pct: 5  },
    { order: 1, target: 'pilot',      percent: 5,   status: 'pending', started_at: null, completed_at: null, error_threshold_pct: 3  },
    { order: 2, target: 'production', percent: 100, status: 'pending', started_at: null, completed_at: null, error_threshold_pct: 1  },
  ]
}

/**
 * Rollout planlarını döner.
 * rollout_plans tablosu yoksa boş dizi döner (offline graceful).
 *
 * Şema: supabase/migrations/20260610000018_ota_release_registry.sql
 * (elle SQL bağımlılığı kaldırıldı — tablo, GRANT, RLS ve policy artık
 * gerçek migration'da; ota_releases ile rollout_plan_id üzerinden ilişkili).
 */
export async function getRolloutPlans(): Promise<RolloutPlan[]> {
  try {
    const { data, error } = await supabase
      .from('rollout_plans')
      .select('*')
      .order('created_at', { ascending: false })

    if (error || !data) return []
    return data as unknown as RolloutPlan[]
  } catch {
    return []
  }
}

/** Yeni rollout planı oluşturur ve audit log'a kaydeder. */
export async function createRolloutPlan(
  dto:     CreateRolloutDTO,
  actorId: string,
): Promise<RolloutPlan> {
  const now  = new Date().toISOString()
  const plan = {
    name:        `Release ${dto.version}`,
    version:     dto.version,
    description: dto.description,
    status:      'draft',
    stages:      _defaultStages(),
    rollback_to: dto.rollback_to,
    created_at:  now,
    created_by:  actorId,
    approved_by: null,
    approved_at: null,
  }

  const { data, error } = await supabase
    .from('rollout_plans')
    .insert(plan)
    .select()
    .single()

  if (error) throw new Error(error.message)

  await auditAction({
    actor_id:    actorId,
    action:      'rollout.create',
    target_type: 'rollout',
    target_id:   (data as { id: string }).id,
    before:      null,
    after:       plan,
    metadata:    { version: dto.version },
    severity:    'info',
  })

  return data as unknown as RolloutPlan
}

/** Belirli bir aşamanın durumunu günceller. */
export async function updateRolloutStage(
  planId:   string,
  stageIdx: number,
  status:   RolloutStageStatus,
  actorId:  string,
): Promise<void> {
  // Mevcut aşamaları oku
  const { data: existing, error: fetchErr } = await supabase
    .from('rollout_plans')
    .select('stages, status, version')
    .eq('id', planId)
    .single()

  if (fetchErr || !existing) throw new Error('Plan bulunamadı')

  const stages = [...((existing as { stages: RolloutStage[] }).stages)]
  if (!stages[stageIdx]) throw new Error('Aşama bulunamadı')

  const now = new Date().toISOString()
  stages[stageIdx] = {
    ...stages[stageIdx],
    status,
    started_at:   status === 'active'   ? now : stages[stageIdx].started_at,
    completed_at: status === 'complete' ? now : null,
  }

  // Plan genel durumunu hesapla
  const allComplete = stages.every((s) => s.status === 'complete')
  const anyFailed   = stages.some((s) => s.status === 'failed')
  const anyActive   = stages.some((s) => s.status === 'active')
  const planStatus: RolloutPlan['status'] = allComplete ? 'complete'
    : anyFailed ? 'paused'
    : anyActive ? 'rolling'
    : (existing as { status: string }).status as RolloutPlan['status']

  const { error } = await supabase
    .from('rollout_plans')
    .update({ stages, status: planStatus })
    .eq('id', planId)

  if (error) throw new Error(error.message)

  await auditAction({
    actor_id:    actorId,
    action:      status === 'active' ? 'rollout.start' : `rollout.stage.${status}`,
    target_type: 'rollout',
    target_id:   planId,
    before:      null,
    after:       { stageIdx, status, version: (existing as { version: string }).version },
    metadata:    { stageIdx, version: (existing as { version: string }).version },
    severity:    status === 'failed' ? 'warning' : 'info',
  })
}

/**
 * Belirli bir versiyon için telemetri tabanlı sağlık raporu döner.
 * circuit_breaker: stability < 60 ise true (ilerleme durdurulmalı).
 */
export async function getRolloutHealth(version: string): Promise<RolloutHealthStats> {
  const fallback: RolloutHealthStats = {
    version, stabilityScore: 100, criticalEvents: 0, totalEvents: 0, circuitBreaker: false,
  }
  try {
    const since = new Date(Date.now() - 6 * 3_600_000).toISOString()
    const { data, error } = await supabase
      .from('vehicle_events')
      .select('payload')
      .eq('type', 'system_health')
      .gte('created_at', since)
      .limit(200)

    if (error || !data) return fallback

    const rows = (data as Array<{ payload: HealthPayload }>)
      .filter((r) => _str(r.payload?.appVersion, '') === version)

    if (rows.length === 0) return fallback

    let critical = 0
    rows.forEach((r) => {
      if (_str(r.payload?.overallHealth, 'healthy') === 'critical') critical++
    })

    const score = _calcStabilityScore(rows.length, critical, 0, 0)
    return {
      version,
      stabilityScore: score,
      criticalEvents: critical,
      totalEvents:    rows.length,
      circuitBreaker: score < 60,
    }
  } catch {
    return fallback
  }
}

// ── Audit Log API ─────────────────────────────────────────────────────────────

export interface AuditLogEntry {
  id:         string
  actor_id:   string | null
  action:     string
  target:     string
  before_val: unknown
  after_val:  unknown
  severity:   'info' | 'warning' | 'critical'
  created_at: string
}

/**
 * Denetim kayıtlarını döner.
 * @param limit        Maksimum kayıt sayısı (varsayılan 100)
 * @param criticalOnly Yalnızca 'critical' severity kayıtları
 */
export async function getAuditLogs(
  limit        = 100,
  criticalOnly = false,
): Promise<AuditLogEntry[]> {
  try {
    let query = supabase
      .from('audit_logs')
      .select('id, actor_id, action, target, before_val, after_val, severity, created_at')
      .order('created_at', { ascending: false })
      .limit(limit)

    if (criticalOnly) query = query.eq('severity', 'critical')

    const { data, error } = await query
    if (error || !data) return []
    return data as AuditLogEntry[]
  } catch {
    return []
  }
}

/**
 * Tek bir denetim kaydının tüm detaylarını döner.
 */
export async function getAuditLogDetail(id: string): Promise<AuditLogEntry | null> {
  try {
    const { data, error } = await supabase
      .from('audit_logs')
      .select('*')
      .eq('id', id)
      .maybeSingle()
    if (error || !data) return null
    return data as AuditLogEntry
  } catch {
    return null
  }
}

// ── Incident Log API (Remote Log v1 / Commit 5) ──────────────────────────────
// vehicle_events tablosundaki uzak tanı kayıtları: critical_error (crash),
// obd_diag (bağlantı tanısı), support_snapshot (kullanıcı tetiklemeli rapor).
// Payload'lar cihazda remoteLogService sanitizer'ından geçer (allowlist +
// deny-list + maske); redactIncidentMetadata görüntüleme öncesi ikinci
// savunma katmanıdır (sanitizer öncesi eski kayıtlar için).

export const INCIDENT_TYPES = ['critical_error', 'obd_diag', 'support_snapshot'] as const
export type IncidentType = (typeof INCIDENT_TYPES)[number]

export interface IncidentEntry {
  id:         string
  vehicle_id: string
  type:       IncidentType
  /** Cihazda sanitize edilmiş tanı payload'ı (vehicle_events.metadata JSONB) */
  metadata:   Record<string, unknown>
  created_at: string
}

export interface IncidentFilter {
  type?:       IncidentType   // verilmezse üç tip birden
  vehicleId?:  string
  appVersion?: string         // metadata->>appVersion
  since?:      string         // ISO — created_at >= since
  until?:      string         // ISO — created_at <= until
  limit?:      number         // sayfa boyutu (varsayılan 50)
  offset?:     number         // pagination başlangıcı
}

export interface IncidentQueryResult {
  rows:  IncidentEntry[]
  /** null = başarılı; UI hata durumunu bundan gösterir (sessiz [] değil) */
  error: string | null
}

/**
 * Uzak tanı kayıtlarını filtreli + sayfalı döner. Sıralama: created_at DESC.
 * (getIncidentLogs zaten system_health tabanlı HealthCenter listesi —
 * bu API Remote Log v1 tipleri için ayrıdır.)
 * NOT: JSONB kolonu `metadata` — push_vehicle_event RPC bu kolona yazar
 * (migration 012/017/020; getRolloutHealth'teki 'payload' seçimi eski şema
 * yorumundan kalmadır, bu API doğru kolonu kullanır).
 */
export async function getRemoteIncidents(filter: IncidentFilter = {}): Promise<IncidentQueryResult> {
  try {
    const limit  = filter.limit  ?? 50
    const offset = filter.offset ?? 0

    let q = supabase
      .from('vehicle_events')
      .select('id, vehicle_id, type, metadata, created_at')
      .in('type', filter.type ? [filter.type] : [...INCIDENT_TYPES])
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1)

    if (filter.vehicleId)  q = q.eq('vehicle_id', filter.vehicleId)
    if (filter.appVersion) q = q.eq('metadata->>appVersion', filter.appVersion)
    if (filter.since)      q = q.gte('created_at', filter.since)
    if (filter.until)      q = q.lte('created_at', filter.until)

    const { data, error } = await q
    if (error) return { rows: [], error: error.message }
    return { rows: (data ?? []) as IncidentEntry[], error: null }
  } catch (e) {
    return { rows: [], error: e instanceof Error ? e.message : 'unknown_error' }
  }
}

/** Görüntüleme katmanı deny-list'i — cihaz sanitizer'ı ile aynı set. */
const INCIDENT_DENY_KEYS = new Set([
  'lat', 'lng', 'latitude', 'longitude', 'location', 'address',
  'vin', 'plate', 'plaka', 'phone', 'contact',
  'ssid', 'bssid', 'mac', 'api_key', 'token',
])

/**
 * Defense-in-depth: metadata'dan hassas anahtarları HER derinlikte düşürür.
 * Cihaz tarafı zaten sanitize eder; bu katman sanitizer ÖNCESİ yazılmış
 * eski kayıtların admin ekranında konum/kimlik sızdırmamasını garantiler.
 */
export function redactIncidentMetadata(value: unknown, depth = 0): unknown {
  if (value == null || typeof value !== 'object' || depth > 6) return value
  if (Array.isArray(value)) return value.map((v) => redactIncidentMetadata(v, depth + 1))
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(value as Record<string, unknown>)) {
    if (INCIDENT_DENY_KEYS.has(key.toLowerCase())) continue
    out[key] = redactIncidentMetadata((value as Record<string, unknown>)[key], depth + 1)
  }
  return out
}

// ── Fleet Limp Mode ───────────────────────────────────────────────────────────

const ALL_FLAG_KEYS = [
  'crm',
  'hazard_intelligence',
  'safety_copilot',
  'predictive_intelligence',
  'voice_extras',
] as const

/**
 * Acil durum: tüm feature flag'leri devre dışı bırakır.
 * remoteConfigService 10 dakika içinde değişikliği araçlara iletir.
 * Audit log'a 'system.emergency_limp_mode' / 'critical' kaydeder.
 *
 * @throws İşlem başarısız olursa hata fırlatır — UI yakalayıp göstermelidir.
 */
export async function activateFleetLimpMode(actorId: string): Promise<void> {
  // Mevcut flag durumlarını kaydet (audit before)
  const { data: before } = await supabase
    .from('feature_flags')
    .select('key, enabled')

  // Tüm flagleri kapat (batch upsert)
  const now = new Date().toISOString()
  const { error } = await supabase
    .from('feature_flags')
    .upsert(
      ALL_FLAG_KEYS.map((key) => ({
        key,
        enabled:         false,
        rollout_percent: 0,
        updated_at:      now,
        updated_by:      actorId,
      })),
      { onConflict: 'key' },
    )

  if (error) throw new Error(`Limp Mode failed: ${error.message}`)

  // Audit kaydı — kritik önem
  await auditAction({
    actor_id:    actorId,
    action:      'system.emergency_limp_mode',
    target_type: 'system',
    target_id:   'fleet',
    before:      before ?? [],
    after:       {
      allFlagsDisabled: true,
      affectedFlags:    ALL_FLAG_KEYS,
      timestamp:        now,
    },
    metadata:    { flagCount: ALL_FLAG_KEYS.length, reason: 'MANUAL_EMERGENCY' },
    severity:    'critical',
  })
}

// ── Incident Black Box Replay ──────────────────────────────────────────────────

/**
 * Belirli bir olayın öncesindeki 15 dakikalık sistem snapshot dizisini getirir.
 * Filo geneli zaman penceresi kullanılır — cihaz filtreleme gizlilik sebebiyle
 * yalnızca deviceHash görüntü amaçlıdır, SQL filtreye uygulanmaz.
 *
 * @param _deviceHash Görüntüleme amacıyla saklanır, filtre için kullanılmaz.
 * @param targetTs    İncident zaman damgası (window'un sonu).
 * @returns Kronolojik sıralı, maksimum 50 veri noktası.
 */
export async function getIncidentSequence(
  _deviceHash: string,
  targetTs:    string,
): Promise<IncidentDataPoint[]> {
  const windowStart = new Date(
    new Date(targetTs).getTime() - 15 * 60_000,
  ).toISOString()

  try {
    const { data, error } = await supabase
      .from('vehicle_events')
      .select('id, created_at, payload')
      .eq('type', 'system_health')
      .gte('created_at', windowStart)
      .lte('created_at', targetTs)
      .order('created_at', { ascending: true })
      .limit(50)

    if (error || !data || data.length === 0) return []

    return (data as VehicleEventRow[]).map((row) => {
      const p = row.payload ?? {}
      return {
        ts:             row.created_at,
        thermalLevel:   Math.max(0, Math.min(3, _num(p.thermalLevel, 0))),
        ramPressure:    Math.round(_num(p.ramPressureRatio, 0) * 100),
        workerRestarts: _num(p.workerRestartTotal, 0),
        uiFreezeCount:  _num(p.uiFreezeCount, 0),
        overallHealth:  _str(p.overallHealth, 'healthy'),
      }
    })
  } catch {
    return []
  }
}

// ── Live Event Stream ──────────────────────────────────────────────────────────

export type LiveEventTag = 'OK' | 'RECOVERY' | 'WARN' | 'PANIC'

export interface LiveEvent {
  /** Supabase row UUID */
  id:         string
  /** ISO timestamp */
  ts:         string
  /** 6-char anonymized device fingerprint */
  deviceHash: string
  tag:        LiveEventTag
  message:    string
  /** Hysteresis gruplama sayacı */
  count:      number
  /** Fade-in için mount flag — bileşen tarafında temizlenir */
  isNew:      boolean
}

/** 6 karakterlik anonimleştirilmiş cihaz parmak izi */
function _hashDevice(id: string | null | undefined): string {
  if (!id) return 'UNKNWN'
  return id.replace(/-/g, '').slice(0, 6).toUpperCase()
}

/** Ham payload → insan okunabilir operasyonel mesaj */
function _parseEvent(
  type:    string,
  payload: HealthPayload,
): { tag: LiveEventTag; message: string } {
  if (type === 'critical_error') {
    return { tag: 'PANIC', message: 'Critical Error: System Fault Detected' }
  }

  const health   = _str(payload.overallHealth, 'healthy')
  const thermal  = _num(payload.thermalLevel, 0)
  const freezes  = _num(payload.uiFreezeCount, 0)
  const restarts = _num(payload.workerRestartTotal, 0)
  const version  = _str(payload.appVersion, '?')

  if (thermal >= 3)           return { tag: 'PANIC',    message: 'Thermal: L3 Emergency — System Evacuation Active' }
  if (health === 'critical')  return { tag: 'PANIC',    message: `System: Critical Health — Services Failing (v${version})` }
  if (thermal === 2)          return { tag: 'WARN',     message: 'Thermal: Entered L2 Throttling — CRM Suspended' }
  if (health === 'degraded')  return { tag: 'WARN',     message: `System: Degraded State — Service Pressure Detected (v${version})` }
  if (thermal === 1)          return { tag: 'WARN',     message: 'Thermal: L1 Warning — Throttling Active' }
  if (freezes > 0)            return { tag: 'WARN',     message: `UI: Thread Freeze ×${freezes} Detected` }
  if (restarts > 0)           return { tag: 'RECOVERY', message: `Worker: Restart ×${restarts} — Auto-Recovery Active` }

  return { tag: 'OK', message: `System: All Services Nominal (v${version})` }
}

/**
 * vehicle_events tablosunu gerçek zamanlı dinler.
 * system_health ve critical_error tipleri için callback ateşlenir.
 * Privacy-First: vehicle_id asla callback'e iletilmez — yalnızca 6-char hash.
 *
 * @returns cleanup fonksiyonu — useEffect return'üne ekle.
 *
 * ⚠️ Ön koşul: Supabase Dashboard → Database → Replication →
 *    "vehicle_events" tablosu realtime publication'a eklenmiş olmalı.
 */
export function subscribeToLiveEvents(
  onEvent: (event: LiveEvent) => void,
): () => void {
  const channel = supabase
    .channel('sa-live-vehicle-events')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'vehicle_events' },
      (change: { new: Record<string, unknown> }) => {
        const row = change.new
        const type = _str(row['type'], '')

        // İstemci tarafı filtre — sadece ilgili tipler
        if (type !== 'system_health' && type !== 'critical_error') return

        const payload    = (row['payload'] ?? {}) as HealthPayload
        const deviceHash = _hashDevice(
          (row['vehicle_id'] as string | undefined) ?? (row['id'] as string | undefined),
        )
        const { tag, message } = _parseEvent(type, payload)

        onEvent({
          id:         _str(row['id'], crypto.randomUUID()),
          ts:         _str(row['created_at'], new Date().toISOString()),
          deviceHash,
          tag,
          message,
          count:      1,
          isNew:      true,
        })
      },
    )
    .subscribe()

  return () => { void supabase.removeChannel(channel) }
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
