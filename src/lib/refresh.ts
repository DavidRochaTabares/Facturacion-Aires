// Global silent-refresh bus: every mounted useAsync query re-runs when a write succeeds.
// Kept in lib/ (not hooks/) so the data services can trigger it without a circular import.

const refreshListeners = new Set<() => void>()
const idleWaiters = new Set<() => void>()
let pending = 0
let quietFailures = 0
let queued: ReturnType<typeof setTimeout> | null = null

export const onRefresh = (l: () => void) => { refreshListeners.add(l); return () => { refreshListeners.delete(l) } }
export const trackStart = () => { pending++ }
export const trackEnd = (failed: boolean) => { if (failed) quietFailures++; pending--; if (pending <= 0) { pending = 0; [...idleWaiters].forEach(f => f()) } }

/**
 * Silently re-runs every mounted useAsync query (current data stays on screen until the new data arrives, so nothing flickers;
 * forms keep their own state). Resolves when all queries settled (or after maxMs); false if any of them failed.
 */
export async function refreshAll(maxMs = 15000): Promise<boolean> {
  quietFailures = 0
  refreshListeners.forEach(l => l())
  await new Promise<void>(r => setTimeout(r, 60))
  if (pending > 0) {
    await new Promise<void>(resolve => {
      let t: ReturnType<typeof setTimeout>
      const done = () => { clearTimeout(t); idleWaiters.delete(done); resolve() }
      t = setTimeout(done, maxMs)
      idleWaiters.add(done)
    })
  }
  return quietFailures === 0
}

/** Call after a successful write. Collapses bursts (e.g. one save per reservation passenger) into a single broadcast. */
export function queueRefresh() {
  if (queued) clearTimeout(queued)
  queued = setTimeout(() => { queued = null; void refreshAll() }, 80)
}
