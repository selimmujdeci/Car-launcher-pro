import { useEffect, type ReactNode } from 'react'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { Button } from './Button'

interface Props {
  open:      boolean
  onClose:   () => void
  title:     string
  children:  ReactNode
  footer?:   ReactNode
  size?:     'sm' | 'md' | 'lg'
}

const SIZE = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }

export function Modal({ open, onClose, title, children, footer, size = 'md' }: Props) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Panel */}
      <div className={cn(
        'relative w-full rounded-xl border border-[--adm-border] bg-[--adm-card] shadow-2xl',
        SIZE[size],
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[--adm-border]">
          <h2 className="text-base font-semibold">{title}</h2>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Body */}
        <div className="px-5 py-4">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[--adm-border]">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}
