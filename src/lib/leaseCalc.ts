import type { LeaseInvoice, LeaseSnapshot } from '../types/lease'

// Pure calculations for the Arrendamientos module. Invoicing (accrual) and collection (cash) are kept apart on purpose:
//  * accrual figures use the period (month) an invoice / expense belongs to;
//  * cash figures use the real payment / reception dates.
export interface Range { from: string; to: string }

const pad = (n: number) => String(n).padStart(2, '0')
export const monthStart = (d: string) => `${d.slice(0, 7)}-01`
export const lastDay = (y: number, m: number) => `${y}-${pad(m)}-${pad(new Date(y, m, 0).getDate())}`
export const rangeOfMonth = (y: number, m: number): Range => ({ from: `${y}-${pad(m)}-01`, to: lastDay(y, m) })
export const rangeOfYear = (y: number): Range => ({ from: `${y}-01-01`, to: `${y}-12-31` })
export const inRange = (d: string, r: Range) => d.slice(0, 10) >= r.from && d.slice(0, 10) <= r.to
export const periodIn = (p: string, r: Range) => p.slice(0, 10) >= monthStart(r.from) && p.slice(0, 10) <= r.to
export const invoicePeriod = (i: Pick<LeaseInvoice, 'period_year' | 'period_month'>) => `${i.period_year}-${pad(i.period_month)}-01`
export const monthInputToPeriod = (ym: string) => `${ym}-01`
export const periodToMonthInput = (p: string) => p.slice(0, 7)
export const today = () => new Date().toISOString().slice(0, 10)
export const isOverdue = (due: string | null, balance: number) => !!due && balance > 0 && due < today()

const sum = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((a, r) => a + f(r), 0)

export function summarize(s: LeaseSnapshot, r: Range) {
  const invoices = s.invoices.filter(i => i.status !== 'void' && periodIn(invoicePeriod(i), r))
  const expenses = s.expenses.filter(e => periodIn(e.period, r))
  const invoiced = sum(invoices, i => i.total)
  const customerPending = sum(invoices, i => i.balance)
  const receivedClients = sum(s.customerPayments.filter(p => inRange(p.paid_at, r)), p => p.amount)
  const slb = sum(s.slbPayments.filter(p => inRange(p.received_at, r)), p => p.amount)
  const expensesTotal = sum(expenses, e => e.amount)
  const expensesPaid = sum(expenses, e => e.paid)
  const expensesPending = sum(expenses, e => e.balance)
  const paidCash = sum(s.expensePayments.filter(p => inRange(p.paid_at, r)), p => p.amount)
  return {
    invoiced, receivedClients, customerPending, slb, expensesTotal, expensesPaid, expensesPending, paidCash,
    resultInvoicing: invoiced - expensesTotal,
    cashFlow: receivedClients + slb - paidCash,
  }
}

export interface MonthRow { ym: string; invoiced: number; receivedClients: number; slb: number; expenses: number; paidExpenses: number; resultInvoicing: number; cashFlow: number }
export function monthly(s: LeaseSnapshot, r: Range): MonthRow[] {
  const rows: MonthRow[] = []
  let y = Number(r.from.slice(0, 4)), m = Number(r.from.slice(5, 7))
  const endY = Number(r.to.slice(0, 4)), endM = Number(r.to.slice(5, 7))
  while ((y < endY || (y === endY && m <= endM)) && rows.length < 60) {
    const ym = `${y}-${pad(m)}`
    const isMonth = (d: string) => d.slice(0, 7) === ym
    const invoiced = sum(s.invoices.filter(i => i.status !== 'void' && invoicePeriod(i).slice(0, 7) === ym), i => i.total)
    const receivedClients = sum(s.customerPayments.filter(p => isMonth(p.paid_at) && inRange(p.paid_at, r)), p => p.amount)
    const slb = sum(s.slbPayments.filter(p => isMonth(p.received_at) && inRange(p.received_at, r)), p => p.amount)
    const expenses = sum(s.expenses.filter(e => e.period.slice(0, 7) === ym), e => e.amount)
    const paidExpenses = sum(s.expensePayments.filter(p => isMonth(p.paid_at) && inRange(p.paid_at, r)), p => p.amount)
    rows.push({ ym, invoiced, receivedClients, slb, expenses, paidExpenses, resultInvoicing: invoiced - expenses, cashFlow: receivedClients + slb - paidExpenses })
    m++; if (m > 12) { m = 1; y++ }
  }
  return rows
}

export interface SpaceRow { id: string | null; name: string; invoiced: number; received: number; expenses: number; result: number; margin: number | null }
/** Profitability by space (invoicing basis). Expenses / invoices without a space go to «General (sin espacio)». */
export function bySpace(s: LeaseSnapshot, r: Range): SpaceRow[] {
  const invoiceSpace = new Map(s.invoices.map(i => [i.id, i.space_id]))
  const ids: (string | null)[] = [...s.spaces.map(x => x.id), null]
  return ids.map(id => {
    const invoiced = sum(s.invoices.filter(i => i.status !== 'void' && i.space_id === id && periodIn(invoicePeriod(i), r)), i => i.total)
    const received = sum(s.customerPayments.filter(p => invoiceSpace.get(p.invoice_id) === id && inRange(p.paid_at, r)), p => p.amount)
    const expenses = sum(s.expenses.filter(e => e.space_id === id && periodIn(e.period, r)), e => e.amount)
    return { id, name: id ? (s.spaces.find(x => x.id === id)?.name ?? 'Espacio') : 'General (sin espacio)', invoiced, received, expenses, result: invoiced - expenses, margin: invoiced > 0 ? (invoiced - expenses) / invoiced : null }
  }).filter(x => x.id !== null || x.invoiced || x.received || x.expenses)
}
