'use client'
import React from 'react'

const baseClasses = 'bg-white/5 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:border-white/30 transition-all w-full'

// Text Input
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  error?: boolean
}
export function Input({ error, className = '', ...props }: InputProps) {
  return (
    <input
      className={[
        baseClasses,
        'px-4 py-2.5',
        error ? 'border-red-500/50' : '',
        className,
      ].join(' ')}
      {...props}
    />
  )
}

// Textarea
interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  error?: boolean
}
export function Textarea({ error, className = '', ...props }: TextareaProps) {
  return (
    <textarea
      className={[
        baseClasses,
        'px-4 py-2.5 resize-none',
        error ? 'border-red-500/50' : '',
        className,
      ].join(' ')}
      {...props}
    />
  )
}

// Select
interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  error?: boolean
  children?: React.ReactNode
}
export function Select({ error, children, className = '', ...props }: SelectProps) {
  return (
    <select
      className={[
        baseClasses,
        'px-4 py-2.5 appearance-none cursor-pointer',
        error ? 'border-red-500/50' : '',
        className,
      ].join(' ')}
      {...props}
    >
      {children}
    </select>
  )
}

export default Input
