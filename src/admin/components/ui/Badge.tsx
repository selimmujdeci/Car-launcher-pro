import { cn } from '../../lib/utils'

type Variant = 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted'

const V: Record<Variant, string> = {
  default: 'bg-blue-500/15 text-blue-400 border-blue-500/20',
  success: 'bg-green-500/15 text-green-400 border-green-500/20',
  warning: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/20',
  danger:  'bg-red-500/15 text-red-400 border-red-500/20',
  info:    'bg-sky-500/15 text-sky-400 border-sky-500/20',
  muted:   'bg-white/5 text-[--adm-muted] border-white/8',
}

interface Props { variant?: Variant; children: React.ReactNode; className?: string }

export function Badge({ variant = 'default', children, className }: Props) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium',
      V[variant], className,
    )}>
      {children}
    </span>
  )
}
