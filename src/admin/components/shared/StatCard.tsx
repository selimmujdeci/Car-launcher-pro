import type { LucideIcon } from 'lucide-react'
import { Card } from '../ui/Card'
import { cn } from '../../lib/utils'

interface Props {
  title:      string
  value:      string | number
  subtitle?:  string
  icon:       LucideIcon
  iconClass?: string
  trend?:     { pct: number; label: string }
}

export function StatCard({ title, value, subtitle, icon: Icon, iconClass = 'text-blue-400', trend }: Props) {
  return (
    <Card className="flex items-start justify-between gap-3">
      <div className="min-w-0 space-y-0.5">
        <p className="text-[11px] font-semibold text-[--adm-muted] uppercase tracking-wider truncate">{title}</p>
        <p className="text-2xl font-bold tracking-tight">{value}</p>
        {subtitle && <p className="text-xs text-[--adm-muted]">{subtitle}</p>}
        {trend && (
          <p className={cn('text-xs font-medium', trend.pct >= 0 ? 'text-green-400' : 'text-red-400')}>
            {trend.pct >= 0 ? '+' : ''}{trend.pct}% {trend.label}
          </p>
        )}
      </div>
      <div className={cn('p-2.5 rounded-lg bg-white/5 shrink-0', iconClass)}>
        <Icon className="h-5 w-5" />
      </div>
    </Card>
  )
}
