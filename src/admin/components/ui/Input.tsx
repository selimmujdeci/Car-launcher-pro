import { forwardRef, type InputHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

interface Props extends InputHTMLAttributes<HTMLInputElement> {
  label?:  string
  error?:  string
}

export const Input = forwardRef<HTMLInputElement, Props>(
  ({ label, error, className, ...rest }, ref) => (
    <div className="space-y-1">
      {label && <label className="block text-xs font-medium text-[--adm-muted]">{label}</label>}
      <input
        ref={ref}
        className={cn(
          'w-full h-9 rounded-[--adm-radius] border border-[--adm-border] bg-[--adm-surface]',
          'px-3 text-sm text-[--adm-text] placeholder:text-[--adm-muted]',
          'transition-colors focus:outline-none focus:border-blue-500/60',
          error && 'border-red-500/50',
          className,
        )}
        {...rest}
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  ),
)
Input.displayName = 'Input'
