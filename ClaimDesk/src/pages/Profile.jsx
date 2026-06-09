import { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { GRADES, SALARY_SCALES, getMonthlySalary } from '../data/rates'
import { CheckCircle } from 'lucide-react'

const HOSPITALS = [
  'Kingston Public Hospital (KPH)',
  'University Hospital of the West Indies (UHWI)',
  'Cornwall Regional Hospital',
  'Spanish Town Hospital',
  'Mandeville Regional Hospital',
  'May Pen Hospital',
  "St. Ann's Bay Regional Hospital",
  'Port Maria Hospital',
  'Savanna-la-Mar Hospital',
  'Black River Hospital',
  'Other',
]

export default function Profile() {
  const { profile, updateUserProfile } = useAuth()
  const [form, setForm] = useState({
    name: profile?.name || '',
    hospital: profile?.hospital || '',
    gradeId: profile?.gradeId || '',
    scaleYear: profile?.scaleYear || '2024',
    salaryStep: profile?.salaryStep ?? 0,
    baseSalary: profile?.baseSalary || '',
    salaryMode: 'scale', // 'scale' = auto from grade+step, 'manual' = custom entry
    crossCoverage: profile?.crossCoverage || false,
  })
  const [saved, setSaved] = useState(false)
  const [loading, setLoading] = useState(false)

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  const autoSalary = form.gradeId ? getMonthlySalary(form.gradeId, form.scaleYear, parseInt(form.salaryStep)) : 0
  const effectiveBaseSalary = form.salaryMode === 'scale' ? autoSalary : (parseFloat(form.baseSalary) || 0)

  async function handleSave(e) {
    e.preventDefault()
    setLoading(true)
    await updateUserProfile({
      name: form.name,
      hospital: form.hospital,
      gradeId: form.gradeId,
      scaleYear: form.scaleYear,
      salaryStep: parseInt(form.salaryStep),
      baseSalary: effectiveBaseSalary,
      crossCoverage: form.crossCoverage,
    })
    setLoading(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  const doctorGrades = GRADES.filter(g => g.category === 'doctor')
  const nurseGrades = GRADES.filter(g => g.category === 'nurse')
  const selectedGrade = GRADES.find(g => g.id === form.gradeId)

  return (
    <div className="max-w-lg mx-auto px-4 py-8">
      <h1 className="text-xl font-bold text-gray-900 mb-6">Your Profile</h1>

      <form onSubmit={handleSave} className="bg-white rounded-2xl border border-gray-200 p-6 space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
          <input
            type="text"
            required
            value={form.name}
            onChange={e => update('name', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Hospital / Clinic</label>
          <select
            required
            value={form.hospital}
            onChange={e => update('hospital', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select hospital</option>
            {HOSPITALS.map(h => <option key={h} value={h}>{h}</option>)}
          </select>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Grade / Level</label>
          <select
            required
            value={form.gradeId}
            onChange={e => update('gradeId', e.target.value)}
            className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select grade</option>
            <optgroup label="Doctors (JMDA rates)">
              {doctorGrades.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </optgroup>
            <optgroup label="Nurses (placeholder rates — to be updated)">
              {nurseGrades.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
            </optgroup>
          </select>
        </div>

        {/* Salary section */}
        <div className="border border-gray-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-medium text-gray-700">Monthly base salary (40hr/week)</p>
          <div className="flex gap-2">
            <button type="button" onClick={() => update('salaryMode', 'scale')}
              className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${form.salaryMode === 'scale' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}>
              From salary scale
            </button>
            <button type="button" onClick={() => update('salaryMode', 'manual')}
              className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${form.salaryMode === 'manual' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600 hover:border-blue-400'}`}>
              Enter manually
            </button>
          </div>

          {form.salaryMode === 'scale' ? (
            <div className="space-y-2">
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Scale year</label>
                  <select value={form.scaleYear} onChange={e => update('scaleYear', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="2024">From April 2024</option>
                    <option value="2023">From April 2023</option>
                    <option value="existing">Pre-2023 (Existing)</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-xs text-gray-500 mb-1">Salary step</label>
                  <select value={form.salaryStep} onChange={e => update('salaryStep', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {(SALARY_SCALES[form.scaleYear]?.[form.gradeId] || [0]).map((amt, i) => (
                      <option key={i} value={i}>Step {i + 1} — {new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD', maximumFractionDigits: 0 }).format(amt / 12)}/mo</option>
                    ))}
                  </select>
                </div>
              </div>
              {autoSalary > 0 && (
                <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
                  Base salary: <strong>{new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD', minimumFractionDigits: 2 }).format(autoSalary)}/month</strong>
                  <span className="text-blue-500 ml-1">({new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD', maximumFractionDigits: 0 }).format(autoSalary * 12)}/year)</span>
                </div>
              )}
            </div>
          ) : (
            <input
              type="number"
              required
              min={0}
              value={form.baseSalary}
              onChange={e => update('baseSalary', e.target.value)}
              className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Monthly amount in JMD"
            />
          )}
        </div>

        {selectedGrade?.crossCoverageEligible && (
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={form.crossCoverage}
              onChange={e => update('crossCoverage', e.target.checked)}
              className="w-4 h-4 accent-blue-600"
            />
            <span className="text-sm text-gray-700">Rostered at more than one hospital (cross-coverage rates)</span>
          </label>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {saved ? (
            <><CheckCircle size={16} /> Saved</>
          ) : loading ? 'Saving…' : 'Save profile'}
        </button>
      </form>

      <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm text-amber-800">
        <strong>Note:</strong> Nurse rates are placeholder values until official rate sheets are received. Doctor (JMDA) rates are accurate as of December 2021. Confirm with your HR if rates have been updated.
      </div>
    </div>
  )
}
