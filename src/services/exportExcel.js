import * as XLSX from 'xlsx'
import { fmt } from './salary'
import { getDutyType } from '../data/dutyTypes'
import { GRADES } from '../data/rates'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export function exportSalaryExcel({ summary, profile, month, year }) {
  const grade = GRADES.find(g => g.id === profile?.gradeId)

  const info = [
    ['ClaimDesk — Salary Claim Summary'],
    [],
    ['Name', profile?.name || ''],
    ['Grade', grade?.label || profile?.gradeId || ''],
    ['Hospital', profile?.hospital || ''],
    ['Period', `${MONTHS[month]} ${year}`],
    ['Generated', new Date().toLocaleDateString('en-JM')],
    [],
  ]

  const dutyHeaders = [['Date', 'Duty Type', 'Pay (JMD)', 'Taxi (JMD)', 'Total (JMD)']]
  const dutyRows = summary.dutyBreakdown.map(d => {
    const dt = getDutyType(d.typeId)
    return [d.date, dt?.label || d.typeId, d.pay, d.taxi ? 2000 : 0, d.pay + (d.taxi ? 2000 : 0)]
  })

  const summaryRows = [
    [],
    ['EARNINGS'],
    ['Base Salary', summary.baseSalary],
    ['Claimable Duties', summary.claimTotal],
    ['Taxi Allowances', summary.taxiTotal],
    ['Gross Pay', summary.grossPay],
    [],
    ['DEDUCTIONS'],
    ['NIS (2.5%)', -summary.nis],
    ['NHT (2%)', -summary.nht],
    ['Education Tax (2.25%)', -summary.edTax],
    ['Income Tax (33%)', -summary.incomeTax],
    ['Total Deductions', -summary.totalDeductions],
    [],
    ['TAKE-HOME PAY', summary.takeHome],
  ]

  const data = [
    ...info,
    ...dutyHeaders,
    ...dutyRows,
    ...summaryRows,
  ]

  const ws = XLSX.utils.aoa_to_sheet(data)
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Salary Summary')

  XLSX.writeFile(wb, `ClaimDesk_${profile?.name?.replace(/\s+/g, '_') || 'Salary'}_${MONTHS[month]}_${year}.xlsx`)
}
