import { useState, useMemo } from 'react'
import { FileText, Download, BarChart2, Trash2, Save, CheckCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useSalary } from '../context/SalaryContext'
import DutyCalendar from '../components/DutyCalendar'
import SalaryBreakdown from '../components/SalaryBreakdown'
import RosterUpload from '../components/RosterUpload'
import { exportSalaryPDF } from '../services/exportPdf'
import { exportSalaryExcel } from '../services/exportExcel'
import { saveMonthRecord } from '../services/firestoreDb'
import { GRADES } from '../data/rates'

const TABS = ['Calendar', 'Roster Upload', 'Salary Summary']

export default function Dashboard() {
  const { user, profile } = useAuth()
  const { month, year, duties, getSummary, clearDuties } = useSalary()
  const [tab, setTab] = useState(0)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const gradeId = profile?.gradeId
  const baseSalary = profile?.baseSalary || 0
  const crossCoverage = profile?.crossCoverage || false
  const grade = GRADES.find(g => g.id === gradeId)

  const summary = useMemo(
    () => getSummary(gradeId, baseSalary, crossCoverage),
    [getSummary, gradeId, baseSalary, crossCoverage]
  )

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

  function handleExportPDF() {
    exportSalaryPDF({ summary, profile, month, year })
  }

  function handleExportExcel() {
    exportSalaryExcel({ summary, profile, month, year })
  }

  async function handleSaveRecord() {
    if (!user || duties.length === 0) return
    setSaving(true)
    await saveMonthRecord({ userId: user.uid, month, year, duties, summary, profile })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (!profile?.gradeId) {
    return (
      <div className="max-w-lg mx-auto mt-20 text-center p-8">
        <BarChart2 size={40} className="text-gray-300 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-700 mb-2">Complete your profile</h2>
        <p className="text-gray-500 text-sm">Visit your profile page to set your grade and base salary.</p>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">
            {MONTHS[month]} {year}
          </h1>
          <p className="text-sm text-gray-500">
            {grade?.label} · {profile?.hospital}
            {crossCoverage && <span className="ml-2 text-blue-600 text-xs font-medium bg-blue-50 px-2 py-0.5 rounded-full">Cross-coverage</span>}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {duties.length > 0 && (
            <button
              onClick={() => { if (confirm('Clear all duties for this month?')) clearDuties() }}
              className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 border border-red-200 hover:border-red-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              <Trash2 size={14} />
              Clear
            </button>
          )}
          <button
            onClick={handleExportExcel}
            disabled={duties.length === 0}
            className="flex items-center gap-1.5 text-sm border border-gray-300 hover:border-gray-400 text-gray-700 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            <Download size={14} />
            Excel
          </button>
          <button
            onClick={handleSaveRecord}
            disabled={duties.length === 0 || saving}
            className="flex items-center gap-1.5 text-sm border border-green-500 text-green-700 hover:bg-green-50 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            {saved ? <CheckCircle size={14} /> : <Save size={14} />}
            {saved ? 'Saved!' : saving ? 'Saving…' : 'Save'}
          </button>
          <button
            onClick={handleExportPDF}
            disabled={duties.length === 0}
            className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded-lg transition-colors disabled:opacity-40"
          >
            <FileText size={14} />
            Export PDF
          </button>
        </div>
      </div>

      {/* Quick stats */}
      {duties.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <Stat label="Duties logged" value={duties.length} />
          <Stat label="Claim total" value={new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD', maximumFractionDigits: 0 }).format(summary.claimTotal)} />
          <Stat label="Gross pay" value={new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD', maximumFractionDigits: 0 }).format(summary.grossPay)} />
          <Stat label="Take home" value={new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD', maximumFractionDigits: 0 }).format(summary.takeHome)} green />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-xl w-fit mb-6">
        {TABS.map((t, i) => (
          <button
            key={t}
            onClick={() => setTab(i)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === i ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 0 && <DutyCalendar gradeId={gradeId} crossCoverage={crossCoverage} />}
      {tab === 1 && (
        <div className="max-w-lg">
          <RosterUpload gradeId={gradeId} />
        </div>
      )}
      {tab === 2 && (
        <div className="max-w-lg">
          {duties.length === 0 ? (
            <div className="text-center py-12 text-gray-400">
              <BarChart2 size={36} className="mx-auto mb-3 opacity-30" />
              <p className="text-sm">Add duties on the Calendar tab to see your salary breakdown.</p>
            </div>
          ) : (
            <SalaryBreakdown summary={summary} month={month} year={year} />
          )}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, green }) {
  return (
    <div className={`rounded-xl p-3 ${green ? 'bg-green-50' : 'bg-white border border-gray-200'}`}>
      <p className={`text-xs font-medium mb-0.5 ${green ? 'text-green-600' : 'text-gray-500'}`}>{label}</p>
      <p className={`font-bold text-sm ${green ? 'text-green-700' : 'text-gray-900'}`}>{value}</p>
    </div>
  )
}
