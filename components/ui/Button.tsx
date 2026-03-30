'use client'
import React from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'icon'
type Size = 'sm' | 'md' | 'lg'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  loading?: boolean
  children?: React.ReactNode
}

const variantClasses: Record<Variant, string> = {
  primary:   'bg-white text-black hover:bg-white/90 font-medium',
  secondary: 'bg-white/10 text-white hover:bg-white/15',
  ghost:     'text-white/50 hover:text-white',
  danger:    'bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20',
  icon:      'w-8 h-8 flex items-center justify-center text-white/40 hover:text-white hover:bg-white/10 p-0',
}

const sizeClasses: Record<Size, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
}

export function Button({
  variant = 'secondary',
  size = 'md',
  loading = false,
  disabled,
  children,
  className = '',
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading
  const isIcon = variant === 'icon'

  return (
    <button
      disabled={isDisabled}
      className={[
        'rounded-lg transition-all focus:outline-none focus:ring-2 focus:ring-white/30',
        isIcon ? variantClasses.icon : `${variantClasses[variant]} ${sizeClasses[size]}`,
        isDisabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
        'flex items-center gap-2',
        className,
      ].join(' ')}
      {...props}
    >
      {loading ? (
        <>
          <span className="animate-spin h-4 w-4 border-2 border-white/30 border-t-white rounded-full shrink-0" />
          {!isIcon && children}
        </>
      ) : children}
    </button>
  )
}

export default Button
