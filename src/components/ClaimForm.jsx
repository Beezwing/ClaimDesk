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

function dutyToRow(typeId, taxi) {
  const base = {
    normalHrs: '8AM-4PM', overallDuty: '',
    rstWday: '', rstSat: '', rstSunHol: '',
    casWday: '', casSat: '', casSunHol: '',
    wrdWday: '', wrdSat: '', wrdSunHol: '',
    taxiMark: taxi ? '✓' : '', nature: '',
  }
  switch (typeId) {
    case 'weekday':      return { ...base, overallDuty: '4PM-8AM',    rstWday: '16', nature: 'Rostered' }
    case 'saturday':     return { ...base, overallDuty: '4PM-8AM',    rstSat: '16',  nature: 'Rostered' }
    case 'holiday':      return { ...base, overallDuty: '4PM-8AM',    rstSunHol: '16', nature: 'Rostered' }
    case 'casualty_weekday': return { ...base, overallDuty: '4hr Session', casWday: '1', nature: 'Casualty' }
    case 'casualty_saturday': return { ...base, overallDuty: '4hr Session', casSat: '1', nature: 'Casualty' }
    case 'casualty_holiday':  return { ...base, overallDuty: '4hr Session', casSunHol: '1', nature: 'Casualty' }
    case 'ward_weekday':  return { ...base, overallDuty: '4hr Session', wrdWday: '1', nature: 'Ward Round' }
    case 'ward_saturday': return { ...base, overallDuty: '4hr Session', wrdSat: '1',  nature: 'Ward Round' }
    case 'ward_holiday':  return { ...base, overallDuty: '4hr Session', wrdSunHol: '1', nature: 'Ward Round' }
    case 'dayoff1': return { ...base, overallDuty: '4PM-8AM', rstSat: '16',    casSat: '2',    nature: 'Day Off 1' }
    case 'dayoff2': return { ...base, overallDuty: '4PM-8AM', rstSunHol: '16', casSunHol: '2', nature: 'Day Off 2' }
    case 'cmc_day': return { ...base, normalHrs: '8AM-5PM', overallDuty: '8AM-5PM', nature: 'Day Doctor' }
    default: return base
  }
}

const DUTY_GRID_HEADER = `
  <thead>
    <tr>
      <th rowspan="2" style="width:52px">DATE</th>
      <th rowspan="2" style="width:42px">NORMAL HRS OF WORK (Shift)</th>
      <th rowspan="2" style="width:42px">OVERALL DUTY (Time)</th>
      <th rowspan="2" style="width:22px">TAXI</th>
      <th colspan="3">SESSIONS / ROSTERED DUTY (PER HR)</th>
      <th colspan="3">CASUALTY SESSIONS (PER 4 HRS)</th>
      <th colspan="3">WARD SESSIONS (PER 4 HRS)</th>
      <th rowspan="2" style="width:50px">NATURE OF DUTY</th>
    </tr>
    <tr>
      <th style="width:26px">W/DAY</th><th style="width:26px">SAT</th><th style="width:32px">SUN/HOL</th>
      <th style="width:26px">W/DAY</th><th style="width:26px">SAT</th><th style="width:32px">SUN/HOL</th>
      <th style="width:26px">W/DAY</th><th style="width:26px">SAT</th><th style="width:32px">SUN/HOL</th>
    </tr>
  </thead>`

function dutyTr(r) {
  return `<tr>
    <td style="text-align:left;padding:1px 3px">${r.date}</td>
    <td>${r.normalHrs}</td>
    <td>${r.overallDuty}</td>
    <td>${r.taxiMark}</td>
    <td>${r.rstWday}</td><td>${r.rstSat}</td><td>${r.rstSunHol}</td>
    <td>${r.casWday}</td><td>${r.casSat}</td><td>${r.casSunHol}</td>
    <td>${r.wrdWday}</td><td>${r.wrdSat}</td><td>${r.wrdSunHol}</td>
    <td style="text-align:left;padding:1px 3px">${r.nature}</td>
  </tr>`
}

const blankTr = `<tr>${Array(14).fill('<td>&nbsp;</td>').join('')}</tr>`

const CALC_CATEGORIES = [
  { label: 'Sessions/Rostered Duty — Weekday',       key: 'rstWday' },
  { label: 'Sessions/Rostered Duty — Saturday',      key: 'rstSat' },
  { label: 'Sessions/Rostered Duty — Sun/Holiday',   key: 'rstSunHol' },
  { label: 'Casualty Sessions — Weekday',            key: 'casWday' },
  { label: 'Casualty Sessions — Saturday',           key: 'casSat' },
  { label: 'Casualty Sessions — Sun/Holiday',        key: 'casSunHol' },
  { label: 'Ward Sessions — Weekday',                key: 'wrdWday' },
  { label: 'Ward Sessions — Saturday',               key: 'wrdSat' },
  { label: 'Ward Sessions — Sun/Holiday',            key: 'wrdSunHol' },
  { label: 'Meal / Supper',                          key: null },
  { label: 'Taxi',                                   key: 'taxi' },
  { label: 'Holiday',                                key: null },
]

function buildPrintHtml(profile, month, year, duties, gradeLabel) {
  const sorted = [...duties].sort((a, b) => a.date.localeCompare(b.date))
  const rows = sorted.map(d => ({ date: dateLabel(d.date), ...dutyToRow(d.typeId, d.taxi) }))

  const sum = (key) => rows.reduce((acc, r) => acc + (parseFloat(r[key]) || 0), 0)
  const totals = {
    rstWday: sum('rstWday'), rstSat: sum('rstSat'), rstSunHol: sum('rstSunHol'),
    casWday: sum('casWday'), casSat: sum('casSat'), casSunHol: sum('casSunHol'),
    wrdWday: sum('wrdWday'), wrdSat: sum('wrdSat'), wrdSunHol: sum('wrdSunHol'),
    taxi: rows.filter(r => r.taxiMark).length,
  }

  // Split rows: ~14 on front, rest on back
  const frontRows = rows.slice(0, 14)
  const backRows  = rows.slice(14)
  const frontBlanks = Math.max(0, 14 - frontRows.length)
  const backBlanks  = Math.max(0, 12 - backRows.length)

  const totalsRow = `
    <tr style="font-weight:bold;background:#f0f0f0">
      <td colspan="3" style="text-align:right;padding-right:4px">TOTALS</td>
      <td>${totals.taxi || ''}</td>
      <td>${totals.rstWday || ''}</td><td>${totals.rstSat || ''}</td><td>${totals.rstSunHol || ''}</td>
      <td>${totals.casWday || ''}</td><td>${totals.casSat || ''}</td><td>${totals.casSunHol || ''}</td>
      <td>${totals.wrdWday || ''}</td><td>${totals.wrdSat || ''}</td><td>${totals.wrdSunHol || ''}</td>
      <td></td>
    </tr>`

  const calcRows = CALC_CATEGORIES.map(c => {
    const val = c.key ? (totals[c.key] || '') : ''
    return `<tr>
      <td style="text-align:left;padding:1px 4px">${c.label}</td>
      <td>${val}</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td>
    </tr>`
  }).join('')

  const shared = `
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:Arial,sans-serif; font-size:8.5px; color:#000; }
    h2 { font-size:10px; font-weight:bold; text-align:center; }
    h3 { font-size:8.5px; font-weight:bold; text-align:center; }
    .page { padding:6mm; }
    .header { display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px; gap:8px; }
    .ul { border-bottom:1px solid #000; display:inline-block; min-width:110px; }
    .ul-sm { border-bottom:1px solid #000; display:inline-block; min-width:70px; }
    table { border-collapse:collapse; width:100%; }
    th, td { border:1px solid #000; padding:1px 2px; text-align:center; vertical-align:middle; line-height:1.4; }
    th { font-weight:bold; font-size:7.5px; background:#f5f5f5; }
    .sig-line { border-bottom:1px solid #000; display:inline-block; }
    .page-break { page-break-after:always; break-after:page; }
    @page { size:A4 landscape; margin:0; }`

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"/>
<title>Claim Form — ${profile?.name || ''} — ${MONTHS[month]} ${year}</title>
<style>${shared}</style>
</head><body>

<!-- ═══════════════ PAGE 1 — FRONT ═══════════════ -->
<div class="page page-break">
  <div class="header">
    <div>
      <div style="margin-bottom:2px"><strong>FULL NAME:</strong> <span class="ul">${profile?.name || ''}</span></div>
      <div style="margin-bottom:2px"><strong>ADDRESS:</strong> <span class="ul">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span></div>
      <div style="margin-bottom:2px"><strong>EMP. NUMBER:</strong> <span class="ul-sm">&nbsp;</span></div>
      <div><strong>TEL. NUMBER:</strong> <span class="ul-sm">&nbsp;</span></div>
    </div>
    <div style="text-align:center;min-width:200px">
      <h2>SOUTHERN REGIONAL HEALTH AUTHORITY</h2>
      <h3>EMPLOYEE CLAIM FORM</h3>
      <div style="font-size:8px">Medical Officers &mdash; Secondary Care</div>
    </div>
    <div style="text-align:right">
      <div style="margin-bottom:2px"><strong>PERIOD:</strong> ${MONTHS[month]} ${year}</div>
      <div style="margin-bottom:2px"><strong>DEPT:</strong> <span class="ul-sm">&nbsp;</span></div>
      <div style="margin-bottom:2px"><strong>SALARY/GRADE:</strong> ${gradeLabel}</div>
      <div><strong>FACILITY:</strong> ${profile?.hospital || ''}</div>
    </div>
  </div>

  <table>
    ${DUTY_GRID_HEADER}
    <tbody>
      ${frontRows.map(dutyTr).join('')}
      ${Array(frontBlanks).fill(blankTr).join('')}
    </tbody>
  </table>

  <div style="margin-top:8px;font-size:8px;display:flex;flex-wrap:wrap;gap:12px">
    <div>Signature of Claimant: <span class="sig-line" style="width:130px">&nbsp;</span></div>
    <div>Certified Hours Worked (Immediate Supervisor): <span class="sig-line" style="width:110px">&nbsp;</span></div>
    <div>Date: <span class="sig-line" style="width:80px">&nbsp;</span></div>
    <div>Approved Hours for Payment (RO#): <span class="sig-line" style="width:80px">&nbsp;</span></div>
    <div>Checked by: <span class="sig-line" style="width:110px">&nbsp;</span></div>
  </div>
</div>

<!-- ═══════════════ PAGE 2 — BACK ═══════════════ -->
<div class="page">
  <table style="margin-bottom:6px">
    ${DUTY_GRID_HEADER}
    <tbody>
      ${backRows.map(dutyTr).join('')}
      ${Array(backBlanks).fill(blankTr).join('')}
      ${totalsRow}
    </tbody>
  </table>

  <div style="display:flex;gap:8px;margin-top:4px">
    <!-- Left: back signature block -->
    <div style="min-width:160px;font-size:8px;border:1px solid #000;padding:4px;display:flex;flex-direction:column;gap:8px">
      <div style="font-weight:bold;text-align:center;border-bottom:1px solid #000;padding-bottom:2px;margin-bottom:2px">AUTHORISATIONS</div>
      <div>Calculated By: <span class="sig-line" style="width:90px">&nbsp;</span></div>
      <div>Checked By<br/>(Calculation &amp; Rate): <span class="sig-line" style="width:90px">&nbsp;</span></div>
      <div>Cross-Checked By: <span class="sig-line" style="width:90px">&nbsp;</span></div>
      <div>Certified By: <span class="sig-line" style="width:90px">&nbsp;</span></div>
      <div>Authorized by: <span class="sig-line" style="width:90px">&nbsp;</span></div>
    </div>

    <!-- Right: FOR OFFICIAL USE ONLY calculations -->
    <div style="flex:1">
      <div style="font-weight:bold;text-align:center;border:1px solid #000;padding:2px;background:#f0f0f0;font-size:8px;margin-bottom:2px">
        FOR OFFICIAL USE ONLY — CALCULATIONS
      </div>
      <table>
        <thead>
          <tr>
            <th style="text-align:left;width:180px">CATEGORY</th>
            <th>Total (Hours / Days)</th>
            <th>Rate</th>
            <th>Total (HRS / Days)</th>
            <th>Amount</th>
          </tr>
        </thead>
        <tbody>
          ${calcRows}
          <tr style="font-weight:bold;background:#f0f0f0">
            <td colspan="4" style="text-align:right;padding-right:6px">GRAND TOTAL</td>
            <td>&nbsp;</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

</body></html>`
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
            2-page form (front &amp; back) · Auto-filled from your duties · Print, sign &amp; submit
          </p>
        </div>
        <button
          onClick={handlePrint}
          disabled={duties.length === 0}
          className="flex items-center gap-2 bg-blue-600 text-white text-sm font-semibold px-4 py-2 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-40"
        >
          <Printer size={15} />
          Print Form (2 pages)
        </button>
      </div>

      {duties.length === 0 ? (
        <div className="text-center py-16 bg-white rounded-2xl border border-gray-200 text-gray-400">
          <Printer size={32} className="mx-auto mb-3 opacity-30" />
          <p className="text-sm">Add duties on the Calendar tab first.</p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-200 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between bg-gray-50">
            <p className="text-xs font-medium text-gray-600">
              Preview — {sorted.length} {sorted.length === 1 ? 'duty' : 'duties'} · Page 1 shows first 14 rows, Page 2 shows remainder + calculations
            </p>
          </div>

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
                    <tr key={i} className={i === 13 ? 'border-t-4 border-blue-300' : ''}>
                      <td className="border border-gray-200 px-1 py-1 font-medium whitespace-nowrap">
                        {i === 14 && <span className="text-blue-500 text-[8px] mr-1">pg2→</span>}
                        {dateLabel(duty.date)}
                      </td>
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
              <strong>Page 1 (front):</strong> Header + first 14 duty rows + claimant signature lines. &nbsp;
              <strong>Page 2 (back):</strong> Remaining duties + column totals + FOR OFFICIAL USE ONLY calculations table + authorisation signatures.
              &nbsp; Fill in Address, Emp #, Tel #, and Dept manually before submitting.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
