import { forwardRef, type ButtonHTMLAttributes } from 'react'
import { cn } from '../../lib/utils'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
type Size    = 'sm' | 'md' | 'icon'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?:    Size
  loading?: boolean
}

const V: Record<Variant, string> = {
  primary:   'bg-blue-600 hover:bg-blue-700 text-white shadow-sm',
  secondary: 'bg-white/8 hover:bg-white/12 text-[--adm-text]',
  ghost:     'hover:bg-white/6 text-[--adm-muted] hover:text-[--adm-text]',
  danger:    'bg-red-600/90 hover:bg-red-600 text-white shadow-sm',
  outline:   'border border-[--adm-border] hover:bg-white/5 text-[--adm-text]',
}

const S: Record<Size, string> = {
  sm:   'h-7 px-2.5 text-xs gap-1.5',
  md:   'h-9 px-3.5 text-sm gap-2',
  icon: 'h-8 w-8',
}

export const Button = forwardRef<HTMLButtonElement, Props>(
  ({ variant = 'primary', size = 'md', loading, className, disabled, children, ...rest }, ref) => (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center rounded-[--adm-radius] font-medium transition-colors',
        'disabled:opacity-50 disabled:pointer-events-none',
        V[variant], S[size], className,
      )}
      {...rest}
    >
      {loading && (
        <svg className="animate-spin h-3.5 w-3.5 shrink-0" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
      )}
      {children}
    </button>
  ),
)
Button.displayName = 'Button'
