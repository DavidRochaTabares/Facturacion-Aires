// OS-independent file handling. Browsers fill File.type from the operating system (Windows registry / macOS UTI), which is often empty or wrong
// (e.g. a PDF with no PDF reader registered on Windows, uppercase .PDF, files dragged from mail or cloud folders). The real type is read from the file's own bytes.

export const MAX_DOC_BYTES = 10 * 1024 * 1024

const BY_EXT: Record<string, string> = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp' }
const IMAGES = ['image/png', 'image/jpeg', 'image/webp']
const at = (b: Uint8Array, sig: number[], from = 0) => sig.every((v, i) => b[from + i] === v)

export function sniffMime(head: Uint8Array): string | null {
  let text = ''
  for (let i = 0; i < Math.min(head.length, 1024); i++) text += String.fromCharCode(head[i])
  if (text.includes('%PDF-')) return 'application/pdf'
  if (at(head, [0x89, 0x50, 0x4e, 0x47])) return 'image/png'
  if (at(head, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (at(head, [0x52, 0x49, 0x46, 0x46]) && at(head, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  return null
}

const unreadable = () => new Error('No se pudo leer el archivo. Si está en OneDrive, iCloud u otra carpeta en la nube, descárgalo primero o cópialo a una carpeta local e inténtalo de nuevo.')

/** Validates a file the user picked/dropped/pasted and returns it with its real MIME type. Throws a user-readable Error. */
export async function normalizeDocFile(file: File, allow: 'pdf' | 'pdf-or-image'): Promise<File> {
  let head: Uint8Array
  try { head = new Uint8Array(await file.slice(0, 1024).arrayBuffer()) } catch { throw unreadable() }
  if (!file.size) throw new Error('El archivo está vacío.')
  if (file.size > MAX_DOC_BYTES) throw new Error('El archivo supera los 10 MB.')
  const mime = sniffMime(head)
  const bad = allow === 'pdf' ? 'Solo se admiten archivos PDF.' : 'Formato no soportado. Usa PDF, PNG, JPG o WEBP.'
  if (!mime) throw new Error(`${bad} El archivo no parece un documento válido o está dañado.`)
  if (mime !== 'application/pdf' && (allow === 'pdf' || !IMAGES.includes(mime))) throw new Error(bad)
  return file.type === mime ? file : new File([file], file.name, { type: mime, lastModified: file.lastModified })
}

/** Lenient version for attachments of any kind: only fills in a missing / generic type, never rejects. */
export async function withMime(file: File): Promise<File> {
  if (file.type && file.type !== 'application/octet-stream') return file
  let mime: string | null = null
  try { mime = sniffMime(new Uint8Array(await file.slice(0, 1024).arrayBuffer())) } catch { /* fall back to extension */ }
  mime ??= BY_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? null
  return mime ? new File([file], file.name, { type: mime, lastModified: file.lastModified }) : file
}

export const mimeFromName = (name: string) => BY_EXT[name.split('.').pop()?.toLowerCase() ?? ''] ?? ''

/** In an installed (standalone) PWA, dropping a file outside the drop zone would navigate the window to the file and leave the app. */
export function blockStrayFileDrops(): () => void {
  const stop = (e: DragEvent) => { if (e.dataTransfer?.types.includes('Files')) e.preventDefault() }
  addEventListener('dragover', stop)
  addEventListener('drop', stop)
  return () => { removeEventListener('dragover', stop); removeEventListener('drop', stop) }
}
