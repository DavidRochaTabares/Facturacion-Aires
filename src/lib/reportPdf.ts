import type { ReportTable } from './reportColumns'

export interface ReportMeta { title: string; client: string; period: string; extra: string; generatedAt: string }

// Standard PDF fonts only cover Latin-1: normalise anything outside it.
const clean = (s: string) => s.replace(/\u00a0/g, ' ').replace(/→/g, '>').replace(/[—–]/g, '-').replace(/[^\x00-\xff]/g, '')

export async function imageToDataUrl(src: string): Promise<string> {
  const blob = await (await fetch(src)).blob()
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.onerror = () => reject(r.error)
    r.readAsDataURL(blob)
  })
}

export async function downloadReportPdf(meta: ReportMeta, tables: ReportTable[], logo: string | undefined, filename: string) {
  const { jsPDF } = await import('jspdf')
  const autoTable = (await import('jspdf-autotable')).default
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
  const W = doc.internal.pageSize.getWidth()
  const H = doc.internal.pageSize.getHeight()

  let x = 14
  if (logo) { doc.addImage(logo, 'PNG', 14, 8, 14, 17); x = 32 }
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(110); doc.text('Aires y Destinos', x, 12)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(17); doc.setTextColor(20); doc.text(clean(meta.title), x, 20)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(80)
  const lines = [`Cliente: ${meta.client}`, `Periodo: ${meta.period}`, meta.extra ? `Filtros: ${meta.extra}` : '', `Generado: ${meta.generatedAt}`].filter(Boolean)
  lines.forEach((l, i) => doc.text(clean(l), x, 27 + i * 4.5))
  let y = 27 + lines.length * 4.5 + 6

  tables.forEach(t => {
    if (y > H - 40) { doc.addPage(); y = 16 }
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(30); doc.text(clean(t.title), 14, y)
    autoTable(doc, {
      startY: y + 3,
      head: [t.cols.map(c => clean(c.label))],
      body: t.body.map(r => r.map(clean)),
      foot: t.foot ? [t.foot.map(clean)] : undefined,
      showFoot: 'lastPage',
      theme: 'grid',
      styles: { fontSize: 8, cellPadding: 1.8, lineColor: [226, 232, 240], lineWidth: 0.1, textColor: [30, 41, 59] },
      headStyles: { fillColor: [37, 99, 235], textColor: 255 },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: Object.fromEntries(t.cols.map((c, i) => [i, c.money ? { halign: 'right' as const } : {}])),
      margin: { left: 14, right: 14, bottom: 16 },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 10
  })

  const pages = doc.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(130)
    doc.text('Aires y Destinos', 14, H - 8)
    doc.text(`Página ${i} de ${pages}`, W - 14, H - 8, { align: 'right' })
  }
  doc.save(filename)
}
