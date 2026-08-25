'use client'
// One visible, identical error banner for every tab that loads data.
// Renders `data unavailable — <status> from <endpoint>: <server message>` so an
// operator (or an auditor) can tell a refused request from an empty dataset
// without opening devtools.

import React from 'react'
import { formatApiError, type ApiError } from '@/hooks/useApiData'

export default function ApiErrorBanner({
  error,
  onRetry,
  className = '',
}: {
  error: ApiError
  onRetry?: () => void
  className?: string
}) {
  return (
    <div
      role="alert"
      data-testid="api-error-banner"
      className={`rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-start gap-3 ${className}`}
    >
      <span aria-hidden="true" className="text-red-400 text-sm shrink-0 leading-5">⚠️</span>
      <p className="flex-1 min-w-0 text-red-400 text-sm break-words leading-5">
        {formatApiError(error)}
      </p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="shrink-0 text-xs px-2.5 py-1 rounded-lg bg-red-500/15 hover:bg-red-500/25 text-red-400 font-medium transition-colors"
        >
          Retry
        </button>
      )}
    </div>
  )
}
