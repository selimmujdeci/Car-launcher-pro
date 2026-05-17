/**
 * ChaosSimulator — Kaos Testi Kontrol Paneli (DEV ONLY)
 *
 * Erişim: /admin/chaos (doğrudan URL girişi gerekli — sidebar'da görünmez)
 * Production: import.meta.env.DEV = false → bileşen null döner, Vite tree-shake eder.
 *
 * İletişim mimarisi:
 *   Bu bileşen (admin panel) ve ana uygulama (CarOS) farklı JS bağlamları.
 *   BroadcastChannel('caros-chaos') ile komutlar iletilir.
 *   Alıcı: SystemBoot._startChaosReceiver()
 *
 * Nav state bozma (Corrupt Nav State) localStorage üzerinden yapılır —
 *   hem admin hem ana uygulama aynı origin'i paylaşır.
 *
 * Navigasyon yıkılmazlığı (indestructible nav) testi:
 *   Corrupt Nav State → ana uygulamayı yenile →
 *   sistem NaN koordinatları reddeder ve sessizce IDLE'a döner.
 */

import { useState } from 'react'
import { Skull, Thermometer, MapPin, Cpu, Database, FileWarning, Activity } from 'lucide-react'
import { Card }   from './components/ui/Card'
import { Button } from './components/ui/Button'
import { Badge }  from './components/ui/Badge'

// ── Sabitler ──────────────────────────────────────────────────────────────────

const IS_DEV         = import.meta.env.DEV
const CHAOS_CHANNEL  = 'caros-chaos'
const PANIC_STORAGE_KEY = 'caros_panic_recovery'
const NAV_SEAL_KEY      = 'nav_crash_state'

// ── Tip tanımları ─────────────────────────────────────────────────────────────

type ChaosCmd =
  | 'trigger_zombie'
  | 'force_thermal_l3'
  | 'corrupt_nav_state'
  | 'simulate_ui_freeze'
  | 'memory_pressure_high'

interface LogEntry {
  ts:    string
  msg:   string
  level: 'ok' | 'warn' | 'error'
}

// ── BroadcastChannel mesaj gönder ─────────────────────────────────────────────

function _broadcast(cmd: ChaosCmd): void {
  if (typeof BroadcastChannel === 'undefined') return
  const bc = new BroadcastChannel(CHAOS_CHANNEL)
  bc.postMessage({ cmd })
  bc.close()
}

// ── Panic raporu doğrudan localStorage'dan oku ────────────────────────────────

function _readPanicReport(): string | null {
  try {
    const raw = localStorage.getItem(PANIC_STORAGE_KEY)
    if (!raw) return null

    const snap = JSON.parse(raw) as {
      ts:         number
      reason:     string
      stores: {
        cognitive?:  Record<string, unknown>
        system?:     Record<string, unknown>
        navigation?: Record<string, unknown>
        vehicle?:    Record<string, unknown>
      }
      lastEvents: Array<{ type: string; ts: number }>
    }

    const field = (obj: Record<string, unknown> | undefined, k: string): string => {
      try { const v = obj?.[k]; return v === null || v === undefined ? 'N/A' : String(v) }
      catch { return 'N/A' }
    }

    const lines = [
      '═══════════════════════════════════════',
      '  CAROS PRO — PANIC REPORT',
      '═══════════════════════════════════════',
      `  Zaman      : ${new Date(snap.ts).toISOString()}`,
      `  Sebep      : ${snap.reason}`,
      '───────────────────────────────────────',
      `  KOGNİTİF   : ${field(snap.stores.cognitive,  'currentMode')}`,
      `  TERMAL LVL : ${field(snap.stores.system,     'thermalLevel')}`,
      `  NAV DURUM  : ${field(snap.stores.navigation, 'status')}`,
      `  ARAÇ HIZI  : ${field(snap.stores.vehicle,    'speed')} km/h`,
      `  YAKIT      : ${field(snap.stores.vehicle,    'fuel')} %`,
      '───────────────────────────────────────',
      `  SON OLAYLAR (${snap.lastEvents.length}):`,
      ...snap.lastEvents.map((e, i) =>
        `    [${i + 1}] ${e.type} @ ${new Date(e.ts).toISOString().slice(11, 23)}`
      ),
      '═══════════════════════════════════════',
    ]
    return lines.join('\n')
  } catch {
    return null
  }
}

// ── ChaosSimulator (public export — null in prod) ─────────────────────────────

export function ChaosSimulator() {
  if (!IS_DEV) return null
  return <ChaosSimulatorInner />
}

// ── İç bileşen ────────────────────────────────────────────────────────────────

function ChaosSimulatorInner() {
  const [log,         setLog]         = useState<LogEntry[]>([])
  const [panicReport, setPanicReport] = useState<string | null>(null)
  const [running,     setRunning]     = useState<ChaosCmd | null>(null)

  function _addLog(msg: string, level: LogEntry['level'] = 'ok'): void {
    const ts = new Date().toISOString().slice(11, 23)
    setLog((prev) => [{ ts, msg, level }, ...prev].slice(0, 40))
  }

  // ── Kaos Aksiyonları ───────────────────────────────────────────────────────

  function handleTriggerZombie(): void {
    setRunning('trigger_zombie')
    _broadcast('trigger_zombie')
    _addLog(
      'Zombie worker oluşturuldu (ChaosZombie, OPTIONAL). ZombieDetection ~30s içinde 3 yanıtsız PING tespit edecek.',
      'warn',
    )
    setRunning(null)
  }

  function handleForceThermalL3(): void {
    setRunning('force_thermal_l3')
    _broadcast('force_thermal_l3')
    _addLog(
      'injectDeviceTemp(70) gönderildi → ThermalWatchdog L3 eşiği (≥65°C) aşıldı. runtimeManager POWER_SAVE tavan uygulamalı.',
      'warn',
    )
    setRunning(null)
  }

  function handleCorruptNavState(): void {
    setRunning('corrupt_nav_state')
    const corrupt = JSON.stringify({
      status:          'ACTIVE',
      destination: {
        id:        'chaos_corrupt',
        name:      'CHAOS NAV TARGET',
        latitude:  NaN,
        longitude: NaN,
        address:   '[CORRUPTED BY CHAOS SIMULATOR]',
      },
      isOfflineResult: false,
      isNavigating:    true,
      isRerouting:     false,
    })
    try {
      localStorage.setItem(NAV_SEAL_KEY, corrupt)
      _addLog(
        `nav_crash_state = NaN koordinatlar yazıldı. Uygulamayı yenile → navigationService NaN'ı reddedecek → sessiz IDLE restore.`,
        'warn',
      )
    } catch {
      _addLog('localStorage yazma başarısız — quota veya private mode.', 'error')
    }
    _broadcast('corrupt_nav_state')
    setRunning(null)
  }

  function handleUIFreeze(): void {
    setRunning('simulate_ui_freeze')
    _broadcast('simulate_ui_freeze')
    _addLog(
      'UI Freeze komutu gönderildi. Ana uygulama main thread\'i ~6 saniye bloke edecek. UIWatchdog (5s eşiği) tetiklenip ThermalJournal PANIC_MARKER yazmalı.',
      'warn',
    )
    setRunning(null)
  }

  function handleMemoryPressure(): void {
    setRunning('memory_pressure_high')
    _broadcast('memory_pressure_high')
    _addLog(
      'handleMemoryPressure(CRITICAL) gönderildi → OPTIONAL worker\'lar (VisionCompute, NavigationCompute) sonlandırılacak.',
      'warn',
    )
    setRunning(null)
  }

  function handleGetPanicReport(): void {
    const report = _readPanicReport()
    setPanicReport(report)
    if (report) {
      _addLog('Panic report okundu — caros_panic_recovery localStorage kaydı mevcut.', 'ok')
    } else {
      _addLog('Panic snapshot bulunamadı. Önce bir kaos senaryosu çalıştırın.', 'ok')
    }
  }

  function handleClearNavCorrupt(): void {
    try {
      localStorage.removeItem(NAV_SEAL_KEY)
      _addLog('nav_crash_state temizlendi — nav state restore sağlandı.', 'ok')
    } catch {
      _addLog('nav_crash_state temizleme başarısız.', 'error')
    }
  }

  // ── Buton tanımları ────────────────────────────────────────────────────────

  const CHAOS_BUTTONS: Array<{
    id:     ChaosCmd
    label:  string
    desc:   string
    icon:   React.ReactNode
    color:  string
    action: () => void
  }> = [
    {
      id:     'trigger_zombie',
      label:  'Trigger Zombie',
      desc:   'OPTIONAL worker\'a PONG yanıtsız infinite wait simülasyonu — ZombieDetection test',
      icon:   <Skull    className="h-4 w-4" />,
      color:  '#f87171',
      action: handleTriggerZombie,
    },
    {
      id:     'force_thermal_l3',
      label:  'Force Thermal L3',
      desc:   'injectDeviceTemp(70°C) → ThermalWatchdog L3 eşiği → runtimeManager POWER_SAVE tavan',
      icon:   <Thermometer className="h-4 w-4" />,
      color:  '#fb923c',
      action: handleForceThermalL3,
    },
    {
      id:     'corrupt_nav_state',
      label:  'Corrupt Nav State',
      desc:   'nav_crash_state\'e NaN koordinatlar yaz → navigasyon indestructibility doğrula',
      icon:   <MapPin   className="h-4 w-4" />,
      color:  '#facc15',
      action: handleCorruptNavState,
    },
    {
      id:     'simulate_ui_freeze',
      label:  'Simulate UI Freeze',
      desc:   'Main thread 6s busy-loop → UIWatchdog (5s eşiği) → PANIC_MARKER ThermalJournal',
      icon:   <Cpu      className="h-4 w-4" />,
      color:  '#a78bfa',
      action: handleUIFreeze,
    },
    {
      id:     'memory_pressure_high',
      label:  'Memory Pressure High',
      desc:   'AdaptiveRuntimeManager.handleMemoryPressure(CRITICAL) → OPTIONAL worker\'lar sonlandır',
      icon:   <Database className="h-4 w-4" />,
      color:  '#60a5fa',
      action: handleMemoryPressure,
    },
  ]

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-5 max-w-4xl">

      {/* Başlık */}
      <div className="flex items-center gap-3">
        <Skull size={22} style={{ color: '#f87171' }} />
        <div>
          <h1 className="text-lg font-semibold" style={{ color: 'var(--adm-text)' }}>
            Kaos Simülatörü
          </h1>
          <p className="text-xs" style={{ color: 'var(--adm-muted)' }}>
            Resilience test paneli — Üretim derlemesinde tree-shaked. Yalnızca DEV ortamında erişilebilir.
          </p>
        </div>
        <Badge variant="danger" className="ml-auto">DEV ONLY</Badge>
      </div>

      {/* Uyarı bandı */}
      <div
        className="px-4 py-3 rounded-lg text-xs leading-relaxed"
        style={{
          background: 'rgba(239,68,68,0.07)',
          border:     '1px solid rgba(239,68,68,0.18)',
          color:      '#fca5a5',
        }}
      >
        Komutlar <code className="font-mono">BroadcastChannel('caros-chaos')</code> üzerinden ana uygulamaya iletilir.
        Alıcı: <code className="font-mono">SystemBoot._startChaosReceiver()</code>.&nbsp;
        <span style={{ color: '#f87171' }}>Nav Corrupt</span> testi için: butona bas → ana uygulamayı yenile → sistem NaN koordinatları reddedip sessizce IDLE'a dönmeli.
      </div>

      {/* Kaos butonları */}
      <Card>
        <p
          className="text-[11px] font-semibold uppercase tracking-wider mb-4"
          style={{ color: 'var(--adm-muted)' }}
        >
          Kaos Senaryoları
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {CHAOS_BUTTONS.map((btn) => (
            <button
              key={btn.id}
              onClick={btn.action}
              disabled={running !== null}
              className="flex items-start gap-3 p-3.5 rounded-lg text-left transition-all"
              style={{
                background:  'rgba(255,255,255,0.035)',
                border:      '1px solid rgba(255,255,255,0.07)',
                opacity:     running !== null ? 0.5 : 1,
                cursor:      running !== null ? 'not-allowed' : 'pointer',
              }}
              onMouseEnter={(e) => {
                if (running !== null) return
                const el = e.currentTarget as HTMLButtonElement
                el.style.borderColor = btn.color + '44'
                el.style.background  = btn.color + '0a'
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLButtonElement
                el.style.borderColor = 'rgba(255,255,255,0.07)'
                el.style.background  = 'rgba(255,255,255,0.035)'
              }}
            >
              <span style={{ color: btn.color, marginTop: 1, flexShrink: 0 }}>{btn.icon}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight" style={{ color: 'var(--adm-text)' }}>
                  {btn.label}
                </p>
                <p className="text-[11px] mt-0.5 leading-relaxed" style={{ color: 'var(--adm-muted)' }}>
                  {btn.desc}
                </p>
              </div>
            </button>
          ))}
        </div>
      </Card>

      {/* Panic Report */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <FileWarning size={15} style={{ color: '#f87171' }} />
            <span className="text-sm font-medium" style={{ color: 'var(--adm-text)' }}>
              Panic Report
            </span>
            {panicReport && (
              <Badge variant="danger">Snapshot mevcut</Badge>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={handleClearNavCorrupt}>
              Nav Temizle
            </Button>
            <Button variant="outline" size="sm" onClick={handleGetPanicReport}>
              Snapshot Oku
            </Button>
          </div>
        </div>
        {panicReport ? (
          <pre
            className="text-[11px] font-mono overflow-auto rounded-lg p-3"
            style={{
              background: 'rgba(0,0,0,0.5)',
              color:      '#4ade80',
              maxHeight:  280,
              lineHeight: 1.6,
            }}
          >
            {panicReport}
          </pre>
        ) : (
          <p className="text-xs" style={{ color: 'var(--adm-muted)' }}>
            Kayıtlı panic snapshot yok. Bir kaos senaryosu çalıştırın, ardından "Snapshot Oku" butonuna basın.
          </p>
        )}
      </Card>

      {/* Aktivite logu */}
      <Card>
        <div className="flex items-center gap-2 mb-3">
          <Activity size={14} style={{ color: 'var(--adm-muted)' }} />
          <p
            className="text-[11px] font-semibold uppercase tracking-wider"
            style={{ color: 'var(--adm-muted)' }}
          >
            Aktivite Logu
          </p>
        </div>
        {log.length === 0 ? (
          <p className="text-xs" style={{ color: 'var(--adm-muted)' }}>
            Henüz işlem yok. Yukarıdaki kaos butonlarından birini tetikleyin.
          </p>
        ) : (
          <ul className="space-y-1.5 max-h-64 overflow-auto">
            {log.map((entry, i) => (
              <li key={i} className="flex gap-2 text-[11px] font-mono">
                <span style={{ color: 'var(--adm-muted)', flexShrink: 0 }}>
                  [{entry.ts}]
                </span>
                <span
                  style={{
                    color: entry.level === 'error'
                      ? '#f87171'
                      : entry.level === 'warn'
                        ? '#fbbf24'
                        : '#4ade80',
                  }}
                >
                  {entry.msg}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

    </div>
  )
}
