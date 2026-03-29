'use client'
import React from 'react'
import { LucideIcon } from 'lucide-react'
import { Button } from './Button'

// Standard Card
interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  clickable?: boolean
  children?: React.ReactNode
}
export function Card({ clickable, children, className = '', ...props }: CardProps) {
  return (
    <div
      className={[
        'bg-[#0f0f0f] border border-white/10 rounded-xl p-4 transition-all',
        clickable ? 'hover:border-white/20 cursor-pointer' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </div>
  )
}

// Card Header
interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {
  title: string
  meta?: React.ReactNode
  action?: React.ReactNode
}
export function CardHeader({ title, meta, action, className = '', ...props }: CardHeaderProps) {
  return (
    <div
      className={['px-4 py-3 border-b border-white/10 flex items-center justify-between', className].join(' ')}
      {...props}
    >
      <h3 className="text-sm font-medium">{title}</h3>
      <div className="flex items-center gap-2">
        {meta && <span className="text-xs text-white/40">{meta}</span>}
        {action}
      </div>
    </div>
  )
}

// Card Content
export function CardContent({ children, className = '', ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={['p-4', className].join(' ')} {...props}>
      {children}
    </div>
  )
}

// Section Card (header + content)
interface SectionCardProps {
  title: string
  meta?: React.ReactNode
  action?: React.ReactNode
  children?: React.ReactNode
  className?: string
}
export function SectionCard({ title, meta, action, children, className = '' }: SectionCardProps) {
  return (
    <div className={['bg-[#0f0f0f] border border-white/10 rounded-xl overflow-hidden', className].join(' ')}>
      <CardHeader title={title} meta={meta} action={action} />
      <div className="p-4">{children}</div>
    </div>
  )
}

// Stat Card
interface StatCardProps {
  label: string
  value: React.ReactNode
  subtext?: string
  className?: string
}
export function StatCard({ label, value, subtext, className = '' }: StatCardProps) {
  return (
    <div className={['bg-[#0f0f0f] border border-white/10 rounded-xl p-4', className].join(' ')}>
      <div className="text-xs text-white/40 mb-1">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
      {subtext && <div className="text-xs text-white/30 mt-1">{subtext}</div>}
    </div>
  )
}

// Empty State
interface EmptyStateProps {
  icon?: LucideIcon
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  className?: string
}
export function EmptyState({ icon: Icon, title, description, action, className = '' }: EmptyStateProps) {
  return (
    <div className={['flex flex-col items-center justify-center py-12 text-center', className].join(' ')}>
      {Icon && <Icon className="w-8 h-8 text-white/20 mb-3" />}
      <div className="text-sm text-white/40">{title}</div>
      {description && <div className="text-xs text-white/30 mt-1">{description}</div>}
      {action && (
        <button
          onClick={action.onClick}
          className="mt-3 text-xs text-white/50 hover:text-white transition-all"
        >
          {action.label} →
        </button>
      )}
    </div>
  )
}

export default Card
