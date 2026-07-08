import Link from 'next/link';

type Variant = 'primary' | 'secondary' | 'ghost';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps {
  href?: string;
  onClick?: () => void;
  variant?: Variant;
  size?: Size;
  children: React.ReactNode;
  className?: string;
  external?: boolean;
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent-solid hover:bg-accent-strong text-white shadow-glow-sm hover:shadow-glow',
  secondary: 'bg-surface hover:bg-surface-2 text-ink border border-line hover:border-line-2',
  ghost: 'text-ink-2 hover:text-ink hover:bg-surface',
};

const sizes: Record<Size, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-7 py-3.5 text-base',
};

export default function Button({
  href,
  onClick,
  variant = 'primary',
  size = 'md',
  children,
  className = '',
  external = false,
}: ButtonProps) {
  const base = `inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 ${variants[variant]} ${sizes[size]} ${className}`;

  if (href) {
    if (external) {
      return (
        <a href={href} target="_blank" rel="noopener noreferrer" className={base}>
          {children}
        </a>
      );
    }
    return <Link href={href} className={base}>{children}</Link>;
  }

  return (
    <button onClick={onClick} className={base}>
      {children}
    </button>
  );
}
