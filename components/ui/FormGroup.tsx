'use client'
import React from 'react'

interface FormGroupProps {
  label?: string
  error?: string
  helper?: string
  required?: boolean
  children: React.ReactNode
  className?: string
}

export function FormGroup({ label, error, helper, required, children, className = '' }: FormGroupProps) {
  return (
    <div className={['space-y-1', className].join(' ')}>
      {label && (
        <label className="text-xs text-white/50 block">
          {label}
          {required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
      )}
      {children}
      {error && <p className="text-xs text-red-400 mt-1">{error}</p>}
      {!error && helper && <p className="text-xs text-white/30 mt-1">{helper}</p>}
    </div>
  )
}

export default FormGroup
