import type { ReactNode } from 'react'

interface Props {
  title:        string
  description?: string
  children?:    ReactNode
}

export function PageHeader({ title, description, children }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && <p className="text-sm text-[--adm-muted] mt-0.5">{description}</p>}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  )
}
