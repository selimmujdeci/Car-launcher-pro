/**
 * RemoteCommandPanel — Araç Uzak Komut Gönderimi
 *
 * Protocol (admin tarafı):
 *   1. vehicle_commands tablosuna 'pending' satır INSERT et
 *   2. Supabase Realtime: o satırın status değişimini izle
 *   3. status === 'completed' | 'failed' | 'rejected' | 'expired' → son durum göster
 *   4. 10 saniye içinde araçtan yanıt gelmezse → "Zaman Aşımı: Araç Çevrimdışı olabilir"
 *
 * Güvenlik notu: lock/unlock gibi kritik komutlar araç tarafında E2E şifreleme
 * gerektirir; admin paneli bu türleri göndermez.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { Loader2, CheckCircle2, XCircle, AlertTriangle, RotateCcw } from 'lucide-react'
import { supabase } from '../../lib/supabaseClient'
import type { RealtimeChannel } from '@supabase/supabase-js'

// ── Sabitler ────────────────────────────────────────────────────────────────

const ACK_TIMEOUT_MS = 10_000

// ── Tipler ──────────────────────────────────────────────────────────────────

type CmdStatus = 'idle' | 'processing' | 'completed' | 'failed' | 'timeout' | 'rejected'

interface RemoteCommand {
  type:  string
  label: string
  icon:  string
}

const COMMANDS: RemoteCommand[] = [
  { type: 'horn',   label: 'Korna',     icon: '📢' },
  { type: 'locate', label: 'Aracı Bul', icon: '📍' },
  // open_trunk kaldırıldı (C7): araç tarafında handler yok — ölü/yanıltıcı buton.
  // horn artık E2E-kritik; bu panel E2E göndermediğinden araç tarafında reddedilir
  // (kasıtlı — güvenlikten taviz yok; admin-web E2E akışı ayrı iş).
]

// ── Component ────────────────────────────────────────────────────────────────

interface Props {
  vehicleId: string
}

export function RemoteCommandPanel({ vehicleId }: Props) {
  const [cmdStatus,  setCmdStatus]  = useState<CmdStatus>('idle')
  const [activeCmd,  setActiveCmd]  = useState<RemoteCommand | null>(null)
  const [statusText, setStatusText] = useState('')

  const channelRef = useRef<RealtimeChannel | null>(null)
  const timerRef   = useRef<ReturnType<typeof setTimeout> | null>(null)

  const cleanup = useCallback(() => {
    if (timerRef.current)   { clearTimeout(timerRef.current);          timerRef.current   = null }
    if (channelRef.current) { channelRef.current.unsubscribe();        channelRef.current = null }
  }, [])

  // Bileşen unmount'ta kaynakları temizle
  useEffect(() => cleanup, [cleanup])

  const sendCommand = useCallback(async (cmd: RemoteCommand) => {
    cleanup()
    setActiveCmd(cmd)
    setCmdStatus('processing')
    setStatusText('İşleniyor...')

    // 1. vehicle_commands tablosuna komut ekle
    const { data, error } = await supabase
      .from('vehicle_commands')
      .insert({
        vehicle_id: vehicleId,
        type:       cmd.type,
        status:     'pending',
        ttl_ms:     30_000,
      })
      .select('id')
      .single()

    if (error || !data) {
      setCmdStatus('failed')
      setStatusText('Komut gönderilemedi')
      return
    }

    const commandId = (data as { id: string }).id

    // 2. Realtime: bu komutun status güncellemelerini dinle
    channelRef.current = supabase
      .channel(`rcmd-${commandId}`)
      .on(
        'postgres_changes',
        {
          event:  'UPDATE',
          schema: 'public',
          table:  'vehicle_commands',
          filter: `id=eq.${commandId}`,
        },
        (evt) => {
          const row = evt.new as { status?: string }
          if (row.status === 'completed') {
            cleanup(); setCmdStatus('completed'); setStatusText('Araç komutu onayladı')
          } else if (row.status === 'failed') {
            cleanup(); setCmdStatus('failed'); setStatusText('Komut başarısız oldu')
          } else if (row.status === 'rejected') {
            cleanup(); setCmdStatus('rejected'); setStatusText('Güvenlik reddi')
          } else if (row.status === 'expired') {
            cleanup(); setCmdStatus('timeout'); setStatusText('Zaman Aşımı: Araç Çevrimdışı olabilir')
          }
        },
      )
      .subscribe()

    // 3. 10 saniye timeout — araç yanıt vermezse uyar
    timerRef.current = setTimeout(() => {
      cleanup()
      setCmdStatus('timeout')
      setStatusText('Zaman Aşımı: Araç Çevrimdışı olabilir')
    }, ACK_TIMEOUT_MS)
  }, [vehicleId, cleanup])

  const reset = useCallback(() => {
    cleanup()
    setCmdStatus('idle')
    setActiveCmd(null)
    setStatusText('')
  }, [cleanup])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className="mt-4 rounded-xl border p-4"
      style={{ background: 'rgba(255,255,255,0.02)', borderColor: 'rgba(255,255,255,0.08)' }}
    >
      <p className="mb-3 text-xs uppercase tracking-wider text-[--adm-muted]">Uzak Komut</p>

      {cmdStatus === 'idle' && (
        <div className="flex flex-wrap gap-2">
          {COMMANDS.map((cmd) => (
            <button
              key={cmd.type}
              onClick={() => { void sendCommand(cmd) }}
              className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm transition-opacity hover:opacity-80"
              style={{
                background:  'rgba(59,130,246,0.1)',
                border:      '1px solid rgba(59,130,246,0.25)',
                color:       '#93c5fd',
              }}
            >
              <span>{cmd.icon}</span>
              <span>{cmd.label}</span>
            </button>
          ))}
        </div>
      )}

      {cmdStatus === 'processing' && (
        <div className="flex items-center gap-3">
          <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
          <span className="text-sm text-[--adm-text]">
            {activeCmd?.icon} {activeCmd?.label} — {statusText}
          </span>
        </div>
      )}

      {cmdStatus !== 'idle' && cmdStatus !== 'processing' && (
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            {cmdStatus === 'completed' && <CheckCircle2 className="h-4 w-4 text-green-400" />}
            {(cmdStatus === 'failed' || cmdStatus === 'rejected') && (
              <XCircle className="h-4 w-4 text-red-400" />
            )}
            {cmdStatus === 'timeout' && <AlertTriangle className="h-4 w-4 text-amber-400" />}
            <span
              className="text-sm"
              style={{
                color: cmdStatus === 'completed' ? '#4ade80'
                     : cmdStatus === 'timeout'   ? '#d97706'
                     :                             '#f87171',
              }}
            >
              {statusText}
            </span>
          </div>
          <button
            onClick={reset}
            className="flex items-center gap-1 px-2 py-1 text-xs text-[--adm-muted] transition-colors hover:text-[--adm-text]"
          >
            <RotateCcw className="h-3 w-3" />
            Tekrar
          </button>
        </div>
      )}
    </div>
  )
}
