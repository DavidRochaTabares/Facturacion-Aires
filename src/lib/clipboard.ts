/** Copies text to the clipboard. Uses the async API when available (needs HTTPS / installed PWA / localhost) and falls back to execCommand. Throws if both fail. */
export async function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return } catch { /* permission denied or insecure context: try the fallback */ }
  }
  const ta = document.createElement('textarea')
  ta.value = text
  ta.setAttribute('readonly', '')
  ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none'
  document.body.appendChild(ta)
  ta.select(); ta.setSelectionRange(0, text.length)
  try {
    if (!document.execCommand('copy')) throw new Error('copy rejected')
  } finally { ta.remove() }
}
