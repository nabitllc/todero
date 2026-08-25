// Owner directive, 2026-08-24: Todero must not autonomously dispatch agents
// while it is itself being rebuilt. Claude builds Todero; Todero does not
// build Todero.
//
// Why this exists as a hard guard rather than a note: /api/cron/queue-refill
// and /api/cron/watchdog pull real backlog tasks, mark them in_progress, and
// spawn `claude --permission-mode bypassPermissions` with a detached watcher
// that re-POSTs /api/run-agent when the child exits — a self-sustaining loop.
// On this host that only ever failed because /bin/bash is absent, and the
// portable-spawn work is actively removing that accidental protection.
//
// Default is OFF. Opt in explicitly with TODERO_DISPATCH_ENABLED=1.

export function isDispatchEnabled(): boolean {
  return process.env.TODERO_DISPATCH_ENABLED === '1'
}

export class DispatchDisabledError extends Error {
  readonly code = 'DISPATCH_DISABLED'
  constructor() {
    super(
      'Agent dispatch is disabled on this instance. ' +
      'Set TODERO_DISPATCH_ENABLED=1 to allow Todero to spawn agents.'
    )
    this.name = 'DispatchDisabledError'
  }
}

/** Throws unless dispatch has been explicitly enabled. Call before any spawn. */
export function assertDispatchEnabled(): void {
  if (!isDispatchEnabled()) throw new DispatchDisabledError()
}
