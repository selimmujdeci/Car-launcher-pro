import { forwardRef, type SelectHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

interface Option { value: string; label: string }

interface Props extends SelectHTMLAttributes<HTMLSelectElement> {
  label?:   string
  options:  Option[]
  error?:   string
}

export const Select = forwardRef<HTMLSelectElement, Props>(
  ({ label, options, error, className, ...rest }, ref) => (
    <div className="space-y-1">
      {label && <label className="block text-xs font-medium text-[--adm-muted]">{label}</label>}
      <select
        ref={ref}
        className={cn(
          'w-full h-9 rounded-[--adm-radius] border border-[--adm-border] bg-[--adm-surface]',
          'px-3 text-sm text-[--adm-text] focus:outline-none focus:border-blue-500/60 transition-colors',
          error && 'border-red-500/50',
          className,
        )}
        {...rest}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  ),
)
Select.displayName = 'Select'
