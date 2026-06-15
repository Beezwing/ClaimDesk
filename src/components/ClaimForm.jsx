import { useRef } from 'react'
import { Printer } from 'lucide-react'
import { useSalary } from '../context/SalaryContext'
import { useAuth } from '../context/AuthContext'
import { GRADES } from '../data/rates'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

function dateLabel(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`
}

// Map a duty typeId to the correct form columns and labels
function dutyToRow(typeId, taxi) {
  const base = {
    normalHrs: '8AM-4PM', overallDuty: '',
    rstWday: '', rstSat: '', rstSunHol: '',
    casWday: '', casSat: '', casSunHol: '',
    wrdWday: '', wrdSat: '', wrdSunHol: '',
    taxiMark: taxi ? '✓' : '', nature: '',
  }
  switch (typeId) {
    case 'weekday':
      return { ...base, overallDuty: '4PM-8AM', rstWday: '16', nature: 'Rostered' }
    case 'saturday':
      return { ...base, overallDuty: '4PM-8AM', rstSat: '16', nature: 'Rostered' }
    case 'holiday':
      return { ...base, overallDuty: '4PM-8AM', rstSunHol: '16', nature: 'Rostered' }
    case 'casualty_weekday':
      return { ...base, overallDuty: '4hr Session', casWday: '1', nature: 'Casualty' }
    case 'casualty_saturday':
      return { ...base, overallDuty: '4hr Session', casSat: '1', nature: 'Casualty' }
    case 'casualty_holiday':
      return { ...base, overallDuty: '4hr Session', casSunHol: '1', nature: 'Casualty' }
    case 'ward_weekday':
      return { ...base, overallDuty: '4hr Session', wrdWday: '1', nature: 'Ward Round' }
    case 'ward_saturday':
      return { ...base, overallDuty: '4hr Session', wrdSat: '1', nature: 'Ward Round' }
    case 'ward_holiday':
      return { ...base, overallDuty: '4hr Session', wrdSunHol: '1', nature: 'Ward Round' }
    case 'dayoff1':
      return { ...base, overallDuty: '4PM-8AM', rstSat: '16', casSat: '2', nature: 'Day Off 1' }
    case 'dayoff2':
      return { ...base, overallDuty: '4PM-8AM', rstSunHol: '16', casSunHol: '2', nature: 'Day Off 2' }
    case 'cmc_day':
      return { ...base, normalHrs: '8AM-5PM', overallDuty: '8AM-5PM', nature: 'Day Doctor' }
    default:
      return base
  }
}

// Build the full printable HTML document
function buildPrintHtml(profile, month, year, duties, gradeLabel) {
  const sorted = [...duties].sort((a, b) => a.date.localeCompare(b.date))
  const rows = sorted.map(d => ({ date: dateLabel(d.date), ...dutyToRow(d.typeId, d.taxi) }))

  // Column totals
  const sum = (key) => rows.reduce((acc, r) => acc + (parseFloat(r[key]) || 0), 0)
  const totals = {
    rstWday: sum('rstWday'), rstSat: sum('rstSat'), rstSunHol: sum('rstSunHol'),
    casWday: sum('casWday'), casSat: sum('casSat'), casSunHol: sum('casSunHol'),
    wrdWday: sum('wrdWday'), wrdSat: sum('wrdSat'), wrdSunHol: sum('wrdSunHol'),
    taxi: rows.filter(r => r.taxiMark).length,
  }

  const blankRows = Math.max(0, 22 - rows.length)

  const tr = (r, i) => `
    <tr>
      <td style="text-align:left;padding:1px 3px">${r.date}</td>
      <td>${r.normalHrs}</td>
      <td>${r.overallDuty}</td>
      <td>${r.taxiMark}</td>
      <td>${r.rstWday}</td><td>${r.rstSat}</td><td>${r.rstSunHol}</td>
      <td>${r.casWday}</td><td>${r.casSat}</td><td>${r.casSunHol}</td>
      <td>${r.wrdWday}</td><td>${r.wrdSat}</td><td>${r.wrdSunHol}</td>
      <td style="text-align:left;padding:1px 3px">${r.nature}</td>
    </tr>`

  const blankTr = `<tr>${Array(14).fill('<td>&nbsp;</td>').join('')}</tr>`

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<title>Claim Form — ${profile?.name || ''} — ${MONTHS[month]} ${year}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:Arial,sans-serif; font-size:8.5px; color:#000; padding:6mm; }
  h2 { font-size:10px; font-weight:bold; text-align:center; }
  h3 { font-size:8.5px; font-weight:bold; text-align:center; }
  .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px; }
  .header-left div, .header-right div { margin-bottom:2px; }
  .ul { border-bottom:1px solid #000; display:inline-block; min-width:110px; }
  .ul-sm { border-bottom:1px solid #000; display:inline-block; min-width:70px; }
  table { border-collapse:collapse; width:100%; }
  th, td { border:1px solid #000; padding:1px 2px; text-align:center; vertical-align:middle; line-height:1.3; }
  th { font-weight:bold; font-size:7.5px; background:#f5f5f5; }
  .totals-row td { font-weight:bold; background:#f0f0f0; }
  .sig-section { margin-top:6px; display:flex; gap:16px; flex-wrap:wrap; }
  .sig-section div { margin-bottom:4px; }
  .official-box { border:1px solid #000; padding:4px; margin-top:6px; }
  .official-title { font-weight:bold; font-size:8px; text-align:center; margin-bottom:3px; border-bottom:1px solid #000; padding-bottom:2px; }
  @page { size:A4 landscape; margin:6mm; }
</style>
</head>
<body>

<!-- HEADER -->
<div class="header">
  <div class="header-left">
    <div><strong>FULL NAME:</strong> <span class="ul">${profile?.name || ''}</span></div>
    <div><strong>ADDRESS:</strong> <span class="ul">&nbsp;</span></div>
    <div><strong>EMP. NUMBER:</strong> <span class="ul-sm">&nbsp;</span></div>
    <div><strong>TEL. NUMBER:</strong> <span class="ul-sm">&nbsp;</span></div>
  </div>
  <div style="text-align:center">
    <h2>SOUTHERN REGIONAL HEALTH AUTHORITY</h2>
    <h3>EMPLOYEE CLAIM FORM</h3>
    <div style="font-size:8px">Medical Officers &mdash; Secondary Care</div>
  </div>
  <div class="header-right" style="text-align:right">
    <div><strong>PERIOD:</strong> ${MONTHS[month]} ${year}</div>
    <div><strong>DEPT:</strong> <span class="ul-sm">&nbsp;</span></div>
    <div><strong>SALARY/GRADE:</strong> ${gradeLabel}</div>
    <div><strong>FACILITY:</strong> ${profile?.hospital || ''}</div>
  </div>
</div>

<!-- DUTY GRID -->
<table>
  <thead>
    <tr>
      <th rowspan="2" style="width:52px">DATE</th>
      <th rowspan="2" style="width:42px">NORMAL HRS OF WORK (Shift)</th>
      <th rowspan="2" style="width:42px">OVERALL DUTY (Time)</th>
      <th rowspan="2" style="width:24px">TAXI</th>
      <th colspan="3">SESSIONS / ROSTERED DUTY (PER HR)</th>
      <th colspan="3">CASUALTY SESSIONS (PER 4 HRS)</th>
      <th colspan="3">WARD SESSIONS (PER 4 HRS)</th>
      <th rowspan="2" style="width:52px">NATURE OF DUTY</th>
    </tr>
    <tr>
      <th style="width:26px">W/DAY</th><th style="width:26px">SAT</th><th style="width:30px">SUN/HOL</th>
      <th style="width:26px">W/DAY</th><th style="width:26px">SAT</th><th style="width:30px">SUN/HOL</th>
      <th style="width:26px">W/DAY</th><th style="width:26px">SAT</th><th style="width:30px">SUN/HOL</th>
    </tr>
  </thead>
  <tbody>
    ${rows.map(tr).join('')}
    ${Array(blankRows).fill(blankTr).join('')}
    <tr class="totals-row">
      <td colspan="3" style="text-align:right;padding-right:4px">TOTALS</td>
      <td>${totals.taxi || ''}</td>
      <td>${totals.rstWday || ''}</td><td>${totals.rstSat || ''}</td><td>${totals.rstSunHol || ''}</td>
      <td>${totals.casWday || ''}</td><td>${totals.casSat || ''}</td><td>${totals.casSunHol || ''}</td>
      <td>${totals.wrdWday || ''}</td><td>${totals.wrdSat || ''}</td><td>${totals.wrdSunHol || ''}</td>
      <td></td>
    </tr>
  </tbody>
</table>

<!-- OFFICIAL USE ONLY -->
<div class="official-box" style="margin-top:5px">
  <div class="official-title">FOR OFFICIAL USE ONLY — CALCULATIONS</div>
  <table>
    <thead>
      <tr>
        <th style="width:140px">CATEGORY</th>
        <th>Total (Hours/Days)</th>
        <th>Rate</th>
        <th>Total (HRS/Days)</th>
        <th>Amount</th>
      </tr>
    </thead>
    <tbody>
      ${[
        'Rostered Duty — Weekday', 'Rostered Duty — Saturday', 'Rostered Duty — Sun/Holiday',
        'Casualty Sessions — Weekday', 'Casualty Sessions — Saturday', 'Casualty Sessions — Sun/Holiday',
        'Ward Sessions — Weekday', 'Ward Sessions — Saturday', 'Ward Sessions — Sun/Holiday',
        'Meal / Supper', 'Taxi', 'Holiday',
      ].map(label => `<tr><td style="text-align:left;padding:1px 3px">${label}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>`).join('')}
      <tr style="font-weight:bold;background:#f0f0f0"><td style="text-align:right;padding-right:4px" colspan="4">GRAND TOTAL</td><td>&nbsp;</td></tr>
    </tbody>
  </table>
</div>

<!-- SIGNATURES -->
<div class="sig-section" style="margin-top:6px;font-size:8px">
  <div>Signature of Claimant: <span style="border-bottom:1px solid #000;display:inline-block;width:130px">&nbsp;</span></div>
  <div>Certified Hours Worked (Immediate Supervisor): <span style="border-bottom:1px solid #000;display:inline-block;width:110px">&nbsp;</span></div>
  <div>Date: <span style="border-bottom:1px solid #000;display:inline-block;width:80px">&nbsp;</span></div>
  <div>Approved Hours for Payment (RO#): <span style="border-bottom:1px solid #000;display:inline-block;width:80px">&nbsp;</span></div>
  <div>Checked by: <span style="border-bottom:1px solid #000;display:inline-block;width:110px">&nbsp;</span></div>
  <div>Calculated by: <span style="border-bottom:1px solid #000;display:inline-block;width:110px">&nbsp;</span></div>
  <div>Certified by: <span style="border-bottom:1px solid #000;display:inline-block;width:110px">&nbsp;</span></div>
  <div>Authorized by: <span style="border-bottom:1px solid #000;display:inline-block;width:110px">&nbsp;</span></div>
</div>

</body>
</html>`
}

export default function ClaimForm() {
  const { month, year, duties } = useSalary()
  const { profile } = useAuth()

  const gradeLabel = GRADES.find(g => g.id === profile?.gradeId)?.label || ''
  const sorted = [...duties].sort((a, b) => a.date.localeCompare(b.date))

  function handlePrint() {
    const html = buildPrintHtml(profile, month, year, duties, gradeLabel)
    const win = window.open('', '_blank')
    win.document.write(html)
    win.document.close()
    win.focus()
    setTimeout(() => { win.print(); win.close() }, 600)
  }

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold text-gray-900">Ministry of Health Claim Form</h3>
          <p className="text-xs text-gray-500 mt-0.5">
            Auto-filled from your logged duties · Print, sign, and submit
          </p>
        </div>
        <button
          onClick={handlePrint}
          disabled={duties.length === 0}
          className="flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
        >
          <Printer size={15} />
          Print Form
        </button>
      </div>

      {duties.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 text-gray-400">
          <Printer size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Add duties on the Calendar tab first.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          {/* Preview header */}
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
            <p className="text-xs font-medium text-gray-600">
              Preview — {sorted.length} {sorted.length === 1 ? 'duty' : 'duties'} for {MONTHS[month]} {year}
            </p>
            <p className="text-xs text-gray-400">Opens print dialog in a new window</p>
          </div>

          {/* Preview table */}
          <div className="overflow-x-auto p-4">
            <table className="w-full text-[10px] border-collapse">
              <thead>
                <tr className="bg-gray-50">
                  <th className="border border-gray-300 px-1 py-1 text-left">Date</th>
                  <th className="border border-gray-300 px-1 py-1">Shift</th>
                  <th className="border border-gray-300 px-1 py-1">Duty Period</th>
                  <th className="border border-gray-300 px-1 py-1">Taxi</th>
                  <th className="border border-gray-300 px-1 py-1 bg-blue-50" colSpan={3}>Rostered (hrs)</th>
                  <th className="border border-gray-300 px-1 py-1 bg-amber-50" colSpan={3}>Casualty (sessions)</th>
                  <th className="border border-gray-300 px-1 py-1 bg-green-50" colSpan={3}>Ward (sessions)</th>
                  <th className="border border-gray-300 px-1 py-1 text-left">Nature</th>
                </tr>
                <tr className="bg-gray-50 text-[9px]">
                  <th className="border border-gray-300 px-1 py-0.5" colSpan={4}></th>
                  <th className="border border-gray-300 px-1 py-0.5 bg-blue-50">Wday</th>
                  <th className="border border-gray-300 px-1 py-0.5 bg-blue-50">Sat</th>
                  <th className="border border-gray-300 px-1 py-0.5 bg-blue-50">Sun/Hol</th>
                  <th className="border border-gray-300 px-1 py-0.5 bg-amber-50">Wday</th>
                  <th className="border border-gray-300 px-1 py-0.5 bg-amber-50">Sat</th>
                  <th className="border border-gray-300 px-1 py-0.5 bg-amber-50">Sun/Hol</th>
                  <th className="border border-gray-300 px-1 py-0.5 bg-green-50">Wday</th>
                  <th className="border border-gray-300 px-1 py-0.5 bg-green-50">Sat</th>
                  <th className="border border-gray-300 px-1 py-0.5 bg-green-50">Sun/Hol</th>
                  <th className="border border-gray-300 px-1 py-0.5"></th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((duty, i) => {
                  const r = dutyToRow(duty.typeId, duty.taxi)
                  return (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="border border-gray-200 px-1 py-1 font-medium whitespace-nowrap">{dateLabel(duty.date)}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center">{r.normalHrs}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center">{r.overallDuty}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center">{r.taxiMark}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center bg-blue-50/30">{r.rstWday}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center bg-blue-50/30">{r.rstSat}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center bg-blue-50/30">{r.rstSunHol}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center bg-amber-50/30">{r.casWday}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center bg-amber-50/30">{r.casSat}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center bg-amber-50/30">{r.casSunHol}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center bg-green-50/30">{r.wrdWday}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center bg-green-50/30">{r.wrdSat}</td>
                      <td className="border border-gray-200 px-1 py-1 text-center bg-green-50/30">{r.wrdSunHol}</td>
                      <td className="border border-gray-200 px-1 py-1 text-left text-gray-600">{r.nature}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="px-5 py-3 bg-blue-50 border-t border-blue-100">
            <p className="text-xs text-blue-700">
              <strong>Auto-filled:</strong> Name, grade, facility, period, all duty rows. &nbsp;
              <strong>Fill manually before submitting:</strong> Address, Emp #, Tel #, Dept, and all signature lines.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
