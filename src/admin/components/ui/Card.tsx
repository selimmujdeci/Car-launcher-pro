import { cn } from '../../lib/utils'

interface CardProps { className?: string; children: React.ReactNode }

export function Card({ className, children }: CardProps) {
  return (
    <div className={cn(
      'rounded-xl border border-[--adm-border] bg-[--adm-card] p-5',
      className,
    )}>
      {children}
    </div>
  )
}
