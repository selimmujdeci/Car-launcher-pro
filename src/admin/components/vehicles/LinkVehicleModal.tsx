/**
 * LinkVehicleModal — "Araç Bağla" flow.
 *
 * User enters the 6-digit code displayed on the Android device.
 * On success: fires onLinked(vehicleId, name) so the parent can refresh.
 *
 * UX notes:
 *   - 6 individual digit boxes with auto-advance + backspace-to-previous
 *   - Paste support: paste a 6-digit string → fills all boxes
 *   - Submit disabled until all 6 digits entered
 *   - Error cleared on every keystroke
 */

import { useRef, useState, useCallback, type KeyboardEvent, type ClipboardEvent } from 'react'
import { Link2, CheckCircle2 } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { linkVehicleByCode } from '../../services/vehicleLinking.service'
import type { LinkResult } from '../../types'

interface Props {
  open:     boolean
  onClose:  () => void
  onLinked: (result: LinkResult) => void
}

const DIGITS = 6

export function LinkVehicleModal({ open, onClose, onLinked }: Props) {
  const [values,  setValues]  = useState<string[]>(Array(DIGITS).fill(''))
  const [error,   setError]   = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<LinkResult | null>(null)
  const inputRefs = useRef<(HTMLInputElement | null)[]>([])

  const reset = useCallback(() => {
    setValues(Array(DIGITS).fill(''))
    setError(null)
    setLoading(false)
    setSuccess(null)
  }, [])

  const handleClose = useCallback(() => {
    reset()
    onClose()
  }, [reset, onClose])

  const focusBox = (idx: number) => {
    const el = inputRefs.current[idx]
    if (el) { el.focus(); el.select() }
  }

  const handleChange = (idx: number, raw: string) => {
    const digit = raw.replace(/\D/g, '').slice(-1)
    setError(null)
    const next = [...values]
    next[idx] = digit
    setValues(next)
    if (digit && idx < DIGITS - 1) focusBox(idx + 1)
  }

  const handleKeyDown = (idx: number, e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace') {
      if (values[idx]) {
        const next = [...values]; next[idx] = ''; setValues(next)
      } else if (idx > 0) {
        focusBox(idx - 1)
      }
    } else if (e.key === 'ArrowLeft' && idx > 0) {
      focusBox(idx - 1)
    } else if (e.key === 'ArrowRight' && idx < DIGITS - 1) {
      focusBox(idx + 1)
    } else if (e.key === 'Enter' && values.every(Boolean)) {
      void handleSubmit()
    }
  }

  const handlePaste = (e: ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault()
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, DIGITS)
    if (!pasted) return
    const next = Array(DIGITS).fill('')
    for (let i = 0; i < pasted.length; i++) next[i] = pasted[i]
    setValues(next)
    setError(null)
    focusBox(Math.min(pasted.length, DIGITS - 1))
  }

  const handleSubmit = async () => {
    const code = values.join('')
    if (code.length < DIGITS) { setError('Lütfen 6 haneli kodu eksiksiz girin'); return }

    setLoading(true)
    setError(null)
    try {
      const result = await linkVehicleByCode(code)
      setSuccess(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bağlama başarısız oldu')
      setLoading(false)
    }
  }

  const handleDone = () => {
    if (success) onLinked(success)
    handleClose()
  }

  const codeComplete = values.every(Boolean)

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Araç Bağla"
      size="sm"
      footer={
        success ? (
          <Button onClick={handleDone}>Tamam</Button>
        ) : (
          <>
            <Button variant="outline" onClick={handleClose} disabled={loading}>İptal</Button>
            <Button onClick={() => void handleSubmit()} disabled={!codeComplete || loading}>
              {loading ? 'Bağlanıyor…' : 'Bağla'}
            </Button>
          </>
        )
      }
    >
      {success ? (
        /* ── Success state ── */
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="h-10 w-10 text-green-400" />
          <div>
            <p className="text-sm font-semibold" style={{ color: 'var(--adm-text)' }}>
              Araç başarıyla bağlandı!
            </p>
            <p className="text-xs mt-1" style={{ color: 'var(--adm-muted)' }}>
              {[success.plate, success.brand, success.model].filter(Boolean).join(' · ') || success.name}
            </p>
          </div>
        </div>
      ) : (
        /* ── Input state ── */
        <div className="space-y-5">
          <div className="flex items-start gap-3 rounded-lg p-3"
               style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
            <Link2 className="h-4 w-4 mt-0.5 shrink-0 text-blue-400" />
            <p className="text-xs leading-relaxed" style={{ color: 'var(--adm-muted)' }}>
              Araçtaki Caros uygulamasında <strong className="text-blue-400">Ayarlar → Araç Bağla</strong>{' '}
              menüsünü açın ve gösterilen 6 haneli kodu buraya girin.{' '}
              <span className="opacity-70">Kod 60 saniye geçerlidir.</span>
            </p>
          </div>

          {/* 6-box code input */}
          <div className="flex justify-center gap-2">
            {Array.from({ length: DIGITS }, (_, i) => (
              <input
                key={i}
                ref={(el) => { inputRefs.current[i] = el }}
                type="text"
                inputMode="numeric"
                pattern="\d*"
                maxLength={1}
                value={values[i]}
                onChange={(e) => handleChange(i, e.target.value)}
                onKeyDown={(e) => handleKeyDown(i, e)}
                onPaste={handlePaste}
                onFocus={(e) => e.target.select()}
                disabled={loading}
                className="w-10 h-12 rounded-lg border text-center text-lg font-mono font-bold
                           transition-all focus:outline-none"
                style={{
                  background:   values[i] ? 'rgba(59,130,246,0.15)' : 'var(--adm-surface)',
                  borderColor:  error
                    ? 'rgba(239,68,68,0.5)'
                    : values[i]
                      ? 'rgba(59,130,246,0.5)'
                      : 'var(--adm-border)',
                  color:        'var(--adm-text)',
                }}
              />
            ))}
          </div>

          {error && (
            <p className="text-center text-xs text-red-400">{error}</p>
          )}
        </div>
      )}
    </Modal>
  )
}
