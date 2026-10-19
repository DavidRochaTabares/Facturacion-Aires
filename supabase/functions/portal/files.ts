// File checks for the public portal. The browser-declared type is never trusted: the real type is read from the file's own bytes.
export const MAX_FILE_BYTES = 8 * 1024 * 1024
export const MAX_FILES_TOTAL_BYTES = 40 * 1024 * 1024

export const EXT: Record<string, string> = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }

export function sniffMime(head: Uint8Array): string | null {
  let text = ''
  for (let i = 0; i < Math.min(head.length, 1024); i++) text += String.fromCharCode(head[i])
  const at = (sig: number[], from = 0) => sig.every((v, i) => head[from + i] === v)
  if (text.includes('%PDF-')) return 'application/pdf'
  if (at([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (at([0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (at([0x52, 0x49, 0x46, 0x46]) && at([0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  return null
}

/** Display name only (never used to build storage paths): no directories, no control characters, bounded length. */
export function cleanName(name: string, mime: string): string {
  const base = (name.split(/[\\/]/).pop() ?? '').replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120)
  const ext = EXT[mime]
  return base && new RegExp(`\\.${ext}$`, 'i').test(base) ? base : `${base.replace(/\.[A-Za-z0-9]{1,5}$/, '') || 'archivo'}.${ext}`
}

export interface CheckedFile { bytes: Uint8Array; mime: string; name: string; size: number }

/** Returns the checked file or a user-readable error. */
export async function checkFile(file: File, label: string): Promise<CheckedFile | { error: string }> {
  if (file.size === 0) return { error: `${label}: el archivo está vacío.` }
  if (file.size > MAX_FILE_BYTES) return { error: `${label}: el archivo supera los 8 MB.` }
  const bytes = new Uint8Array(await file.arrayBuffer())
  const mime = sniffMime(bytes)
  if (!mime) return { error: `${label}: formato no permitido. Solo se aceptan PDF, PNG, JPG o WEBP válidos.` }
  return { bytes, mime, name: cleanName(file.name, mime), size: bytes.length }
}
