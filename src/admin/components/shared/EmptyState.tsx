import type { LucideIcon } from 'lucide-react'

interface Props {
  icon?:        LucideIcon
  title:        string
  description?: string
  action?:      React.ReactNode
}

export function EmptyState({ icon: Icon, title, description, action }: Props) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {Icon && (
        <div className="mb-4 p-4 rounded-full bg-white/5">
          <Icon className="h-7 w-7 text-[--adm-muted]" />
        </div>
      )}
      <p className="text-sm font-medium mb-1">{title}</p>
      {description && <p className="text-xs text-[--adm-muted] max-w-xs">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
