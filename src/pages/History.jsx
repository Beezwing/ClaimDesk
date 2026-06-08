import { useState, useEffect } from 'react'
import { useAuth } from '../context/AuthContext'
import { getUserRecords, deleteRecord } from '../services/firestoreDb'
import { GRADES } from '../data/rates'
import { FileText, Trash2, ChevronRight, BarChart2 } from 'lucide-react'
import { exportSalaryPDF } from '../services/exportPdf'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmt(n) {
  return new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD', maximumFractionDigits: 0 }).format(n)
}

export default function History() {
  const { user, profile } = useAuth()
  const [records, setRecords] = useState([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState(null)

  useEffect(() => {
    if (!user) return
    getUserRecords(user.uid).then(r => {
      setRecords(r)
      setLoading(false)
    })
  }, [user])

  async function handleDelete(id) {
    if (!confirm('Delete this record?')) return
    setDeleting(id)
    await deleteRecord(id, user.uid)
    setRecords(prev => prev.filter(r => r.id !== id))
    setDeleting(null)
  }

  function handleExportPDF(record) {
    // Reconstruct summary object for PDF export
    const summary = {
      ...record.summary,
      nis: record.summary.grossPay * 0.025,
      nht: record.summary.grossPay * 0.02,
      edTax: record.summary.grossPay * 0.0225,
      incomeTax: record.summary.grossPay * 0.33,
      dutyBreakdown: record.duties || [],
    }
    exportSalaryPDF({ summary, profile, month: record.month, year: record.year })
  }

  if (loading) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12 text-center text-gray-400">
        <div className="animate-spin w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full mx-auto mb-3" />
        Loading history…
      </div>
    )
  }

  if (records.length === 0) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-16 text-center">
        <BarChart2 size={40} className="mx-auto mb-4 text-gray-300" />
        <h2 className="text-lg font-semibold text-gray-700 mb-2">No saved records yet</h2>
        <p className="text-gray-400 text-sm">After calculating a month's salary, click <strong>Save Record</strong> on the dashboard to store it here.</p>
      </div>
    )
  }

  const totalTakeHome = records.reduce((sum, r) => sum + r.summary.takeHome, 0)
  const totalClaimed = records.reduce((sum, r) => sum + r.summary.claimTotal, 0)

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-xl font-bold text-gray-900 mb-2">Claim History</h1>
      <p className="text-sm text-gray-500 mb-6">{records.length} saved month{records.length !== 1 ? 's' : ''}</p>

      {/* Totals summary */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600 mb-1">Total claimed</p>
          <p className="text-lg font-bold text-blue-700">{fmt(totalClaimed)}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600 mb-1">Total take-home</p>
          <p className="text-lg font-bold text-green-700">{fmt(totalTakeHome)}</p>
        </div>
      </div>

      {/* Record list */}
      <div className="space-y-3">
        {records.map(record => {
          const grade = GRADES.find(g => g.id === record.gradeId)
          return (
            <div key={record.id} className="bg-white rounded-2xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="font-semibold text-gray-900">
                      {MONTHS[record.month]} {record.year}
                    </h3>
                    {record.crossCoverage && (
                      <span className="text-xs bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full font-medium">Cross-coverage</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-400 mb-3">{grade?.label || record.gradeId} · {record.duties?.length || 0} duties</p>

                  <div className="grid grid-cols-3 gap-2 text-sm">
                    <div>
                      <p className="text-xs text-gray-400">Claim</p>
                      <p className="font-semibold text-gray-800">{fmt(record.summary.claimTotal)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Gross</p>
                      <p className="font-semibold text-gray-800">{fmt(record.summary.grossPay)}</p>
                    </div>
                    <div>
                      <p className="text-xs text-gray-400">Take home</p>
                      <p className="font-semibold text-green-700">{fmt(record.summary.takeHome)}</p>
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 ml-3 flex-shrink-0">
                  <button
                    onClick={() => handleExportPDF(record)}
                    title="Export PDF"
                    className="p-2 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                  >
                    <FileText size={16} />
                  </button>
                  <button
                    onClick={() => handleDelete(record.id)}
                    disabled={deleting === record.id}
                    title="Delete record"
                    className="p-2 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors disabled:opacity-40"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>

              {record.savedAt && (
                <p className="text-xs text-gray-300 mt-2">
                  Saved {new Date(record.savedAt).toLocaleDateString('en-JM')}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
