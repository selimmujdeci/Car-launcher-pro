/**
 * VoiceDiagPanel — araç detayı: son 50 voice_diag kaydı (zaman sıralı, en yeni üstte).
 *
 * "Komut hangi katmanda kayboldu?" sorusunun araç-bazlı görünümü:
 * voice_start → listening → transcript → processing → intent →
 * command_execute → success zincirinde hangi aşamadan sonra kayıt
 * kesiliyorsa kayıp oradadır. voice_error/timeout/cognitive_pause
 * sapmaları renkli işaretlenir.
 *
 * Veri: getRemoteIncidents({ type:'voice_diag', vehicleId, limit:50 })
 * — Remote Log v1 / IncidentCenter ile aynı yol (RLS: super_admin policy 021).
 */
import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Mic, AlertTriangle } from 'lucide-react'
import {
  getRemoteIncidents,
  type IncidentEntry,
} from '../../services/superadmin.service'
import { Button } from '../ui/Button'

const LIMIT = 50

/** Aşama → renk: yeşil ilerleme, kırmızı sapma, mor başlangıç. */
const STAGE_COLOR: Record<string, string> = {
  voice_start:           '#a78bfa',
  voice_listening:       '#60a5fa',
  voice_transcript:      '#34d399',
  voice_processing:      '#34d399',
  voice_intent:          '#34d399',
  voice_command_execute: '#34d399',
  voice_success:         '#10b981',
  voice_error:           '#ef4444',
  voice_timeout:         '#f59e0b',
  voice_cognitive_pause: '#f59e0b',
}

function _fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
  } catch { return iso }
}

function _s(v: unknown): string {
  return typeof v === 'string' || typeof v === 'number' ? String(v) : '—'
}

export function VoiceDiagPanel({ vehicleId }: { vehicleId: string }) {
  const [rows, setRows]       = useState<IncidentEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await getRemoteIncidents({ type: 'voice_diag', vehicleId, limit: LIMIT })
      setRows(result.rows) // created_at DESC — en yeni üstte (zaman sıralı)
      setError(result.error)
    } finally {
      setLoading(false)
    }
  }, [vehicleId])

  useEffect(() => { void load() }, [load])

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Mic className="h-3.5 w-3.5 text-purple-400" />
          <span className="text-xs text-[--adm-muted]">
            Son {LIMIT} sesli asistan tanı kaydı (en yeni üstte)
          </span>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => { void load() }}>
          <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-xs text-red-400">
          <AlertTriangle className="h-3 w-3" /> {error}
        </div>
      )}

      <div className="max-h-80 overflow-y-auto rounded border border-[--adm-border]">
        <div
          className="grid sticky top-0 bg-[--adm-bg] px-2 py-1.5 text-[10px] uppercase tracking-wider text-[--adm-muted] border-b border-[--adm-border]"
          style={{ gridTemplateColumns: '110px 1fr 110px 70px 90px' }}
        >
          <span>Zaman</span><span>Aşama</span><span>Intent/Komut</span><span>Süre</span><span>Hata</span>
        </div>

        {loading && rows.length === 0 ? (
          <p className="px-2 py-4 text-xs text-[--adm-muted]">Yükleniyor…</p>
        ) : rows.length === 0 ? (
          <p className="px-2 py-4 text-xs text-[--adm-muted]">
            {error ? 'Kayıtlar alınamadı' : 'Bu araç için voice_diag kaydı yok'}
          </p>
        ) : (
          rows.map((r) => {
            const md = r.metadata ?? {}
            const stage = _s(md['stage'])
            return (
              <div
                key={r.id}
                className="grid px-2 py-1 text-[11px] font-mono border-b border-[--adm-border]/50 items-center"
                style={{ gridTemplateColumns: '110px 1fr 110px 70px 90px' }}
              >
                <span className="text-[--adm-muted]">{_fmt(r.created_at)}</span>
                <span style={{ color: STAGE_COLOR[stage] ?? '#94a3b8' }}>
                  {stage}
                  {md['transcriptLength'] != null && (
                    <span className="text-[--adm-muted]"> · {_s(md['transcriptLength'])} kr</span>
                  )}
                </span>
                <span className="text-[--adm-text] truncate">{_s(md['intent'] ?? md['command'])}</span>
                <span className="text-[--adm-muted] tabular-nums">{_s(md['durationMs'])}ms</span>
                <span className={md['errorCode'] ? 'text-amber-400' : 'text-[--adm-muted]'}>
                  {_s(md['errorCode'])}
                </span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
