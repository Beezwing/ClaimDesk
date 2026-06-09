import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import { fmt } from './salary'
import { getDutyType } from '../data/dutyTypes'
import { GRADES } from '../data/rates'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export function exportSalaryPDF({ summary, profile, month, year }) {
  const doc = new jsPDF()
  const grade = GRADES.find(g => g.id === profile?.gradeId)
  const pageW = doc.internal.pageSize.getWidth()

  // Header
  doc.setFillColor(37, 99, 235)
  doc.rect(0, 0, pageW, 30, 'F')
  doc.setTextColor(255, 255, 255)
  doc.setFontSize(18)
  doc.setFont('helvetica', 'bold')
  doc.text('ClaimDesk', 14, 18)
  doc.setFontSize(10)
  doc.setFont('helvetica', 'normal')
  doc.text('Salary Claim Summary', pageW - 14, 18, { align: 'right' })

  doc.setTextColor(0, 0, 0)
  doc.setFontSize(11)
  doc.setFont('helvetica', 'bold')
  doc.text(`${profile?.name || 'Unknown'}`, 14, 42)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(100, 100, 100)
  doc.text(`${grade?.label || profile?.gradeId || ''} · ${profile?.hospital || ''}`, 14, 49)
  doc.text(`Period: ${MONTHS[month]} ${year}`, 14, 55)
  doc.text(`Generated: ${new Date().toLocaleDateString('en-JM')}`, 14, 61)

  // Duty breakdown table
  const rows = summary.dutyBreakdown.map(d => {
    const dt = getDutyType(d.typeId)
    return [
      d.date,
      dt?.label || d.typeId,
      fmt(d.pay),
      d.taxi ? fmt(2000) : '—',
      fmt(d.pay + (d.taxi ? 2000 : 0)),
    ]
  })

  autoTable(doc, {
    startY: 70,
    head: [['Date', 'Duty Type', 'Pay', 'Taxi', 'Total']],
    body: rows,
    styles: { fontSize: 8 },
    headStyles: { fillColor: [37, 99, 235] },
  })

  const afterTable = doc.lastAutoTable.finalY + 10

  // Summary section
  autoTable(doc, {
    startY: afterTable,
    head: [['Description', 'Amount (JMD)']],
    body: [
      ['Base Salary', fmt(summary.baseSalary)],
      ['Claimable Duties', fmt(summary.claimTotal)],
      ['Taxi Allowances', fmt(summary.taxiTotal)],
      ['GROSS PAY', fmt(summary.grossPay)],
      ['', ''],
      ['NIS (2.5%)', `- ${fmt(summary.nis)}`],
      ['NHT (2%)', `- ${fmt(summary.nht)}`],
      ['Education Tax (2.25%)', `- ${fmt(summary.edTax)}`],
      ['Income Tax (33%)', `- ${fmt(summary.incomeTax)}`],
      ['Total Deductions', `- ${fmt(summary.totalDeductions)}`],
      ['', ''],
      ['TAKE-HOME PAY', fmt(summary.takeHome)],
    ],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [37, 99, 235] },
    bodyStyles: {},
    didParseCell(data) {
      const lastRow = data.table.body.length - 1
      if (data.row.index === lastRow) {
        data.cell.styles.fontStyle = 'bold'
        data.cell.styles.fillColor = [220, 252, 231]
        data.cell.styles.textColor = [21, 128, 61]
      }
    },
  })

  // Footer
  const pageH = doc.internal.pageSize.getHeight()
  doc.setFontSize(7)
  doc.setTextColor(150, 150, 150)
  doc.text('ClaimDesk · claimdeskja.app · This document is generated for claim purposes only.', pageW / 2, pageH - 8, { align: 'center' })

  doc.save(`ClaimDesk_${profile?.name?.replace(/\s+/g, '_') || 'Salary'}_${MONTHS[month]}_${year}.pdf`)
}
