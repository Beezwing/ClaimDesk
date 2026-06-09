import { useState, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart2, CheckCircle, XCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { GRADES, SALARY_SCALES, getMonthlySalary } from '../data/rates'

// Disposable / throwaway email domains to block
const BLOCKED_DOMAINS = [
  'mailinator.com','guerrillamail.com','tempmail.com','throwam.com','yopmail.com',
  'sharklasers.com','guerrillamailblock.com','grr.la','guerrillamail.info',
  'spam4.me','trashmail.com','trashmail.me','dispostable.com','maildrop.cc',
  'mailnull.com','spamgourmet.com','10minutemail.com','10minutemail.net',
  'fakeinbox.com','tempinbox.com','discard.email','mailnesia.com',
  'spamhereplease.com','spamhereplease.net','getairmail.com','filzmail.com',
]

function isDisposableEmail(email) {
  const domain = email.split('@')[1]?.toLowerCase()
  return domain ? BLOCKED_DOMAINS.includes(domain) : false
}

function validatePassword(pw) {
  return {
    length:  pw.length >= 8,
    upper:   /[A-Z]/.test(pw),
    lower:   /[a-z]/.test(pw),
    numSym:  /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?`~]/.test(pw),
  }
}

function PasswordRule({ met, label }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs ${met ? 'text-green-600' : 'text-gray-400'}`}>
      {met ? <CheckCircle size={12} /> : <XCircle size={12} />}
      {label}
    </div>
  )
}

const HOSPITALS = [
  'Kingston Public Hospital (KPH)',
  'University Hospital of the West Indies (UHWI)',
  'Cornwall Regional Hospital',
  'Spanish Town Hospital',
  'Mandeville Regional Hospital',
  'May Pen Hospital',
  'St. Ann\'s Bay Regional Hospital',
  'Port Maria Hospital',
  'Savanna-la-Mar Hospital',
  'Black River Hospital',
  'Other',
]

export default function Register() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showRules, setShowRules] = useState(false)

  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    hospital: '',
    gradeId: '',
    scaleYear: '2024',
    salaryStep: 0,
    baseSalary: '',
    salaryMode: 'scale',
    crossCoverage: false,
  })

  const pwRules = useMemo(() => validatePassword(form.password), [form.password])
  const pwValid = Object.values(pwRules).every(Boolean)

  function update(field, value) {
    setForm(prev => ({ ...prev, [field]: value }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (step === 1) {
      // Validate before moving to step 2
      if (isDisposableEmail(form.email)) {
        setError('Please use a real email address — disposable emails are not allowed.')
        return
      }
      if (!pwValid) {
        setError('Please make sure your password meets all the requirements below.')
        setShowRules(true)
        return
      }
      setError('')
      setStep(2)
      return
    }

    setLoading(true)
    setError('')
    try {
      const autoSalary = form.gradeId ? getMonthlySalary(form.gradeId, form.scaleYear, parseInt(form.salaryStep)) : 0
      const effectiveBaseSalary = form.salaryMode === 'scale' ? autoSalary : (parseFloat(form.baseSalary) || 0)
      const firebaseUser = await register(form.email, form.password, {
        name: form.name,
        hospital: form.hospital,
        gradeId: form.gradeId,
        scaleYear: form.scaleYear,
        salaryStep: parseInt(form.salaryStep),
        baseSalary: effectiveBaseSalary,
        crossCoverage: form.crossCoverage,
      })

      // Send welcome email (best-effort — don't block navigation)
      try {
        const idToken = await firebaseUser.getIdToken()
        fetch('/.netlify/functions/send-welcome-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ name: form.name, email: form.email }),
        })
      } catch (emailErr) {
        console.warn('Welcome email failed (non-critical):', emailErr)
      }

      navigate('/dashboard')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const doctorGrades = GRADES.filter(g => g.category === 'doctor')
  const nurseGrades = GRADES.filter(g => g.category === 'nurse')

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link to="/" className="inline-flex items-center gap-2 text-blue-600 font-bold text-xl">
            <BarChart2 size={24} />
            ClaimDesk
          </Link>
          <p className="text-gray-500 mt-2 text-sm">Create your account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-200 p-8">
          {/* Step indicator */}
          <div className="flex items-center gap-2 mb-6">
            {[1, 2].map(s => (
              <div key={s} className={`flex-1 h-1.5 rounded-full transition-colors ${step >= s ? 'bg-blue-600' : 'bg-gray-200'}`} />
            ))}
          </div>

          <h2 className="font-bold text-gray-900 text-lg mb-6">
            {step === 1 ? 'Account details' : 'Your work profile'}
          </h2>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm p-3 rounded-lg mb-4">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {step === 1 && (
              <>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Full name</label>
                  <input
                    type="text"
                    required
                    value={form.name}
                    onChange={e => update('name', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Dr. Jane Smith"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email address</label>
                  <input
                    type="email"
                    required
                    value={form.email}
                    onChange={e => update('email', e.target.value)}
                    className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="doctor@hospital.gov.jm"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
                  <input
                    type="password"
                    required
                    value={form.password}
                    onChange={e => { update('password', e.target.value); setShowRules(true) }}
                    onFocus={() => setShowRules(true)}
                    className={`w-full border rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                      form.password && !pwValid ? 'border-red-300' : form.password && pwValid ? 'border-green-400' : 'border-gray-300'
                    }`}
                    placeholder="Min. 8 characters"
                  />
                  {showRules && (
                    <div className="mt-2 grid grid-cols-2 gap-1 p-2 bg-gray-50 rounded-lg">
                      <PasswordRule met={pwRules.length} label="8+ characters" />
                      <PasswordRule met={pwRules.upper}  label="Capital letter" />
                      <PasswordRule met={pwRules.lower}  label="Lowercase letter" />
                      <PasswordRule met={pwRules.numSym} label="Number or symbol" />
                    </div>
                  )}
                </div>
              </>
            )}

            {step === 2 && (
              <>
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
                    <optgroup label="Nurses (rates pending — placeholder)">
                      {nurseGrades.map(g => <option key={g.id} value={g.id}>{g.label}</option>)}
                    </optgroup>
                  </select>
                </div>

                {/* Salary section */}
                <div className="border border-gray-200 rounded-xl p-4 space-y-3">
                  <p className="text-sm font-medium text-gray-700">Monthly base salary (40hr/week)</p>
                  <div className="flex gap-2">
                    <button type="button" onClick={() => update('salaryMode', 'scale')}
                      className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${form.salaryMode === 'scale' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
                      From salary scale
                    </button>
                    <button type="button" onClick={() => update('salaryMode', 'manual')}
                      className={`flex-1 py-1.5 text-sm rounded-lg border transition-colors ${form.salaryMode === 'manual' ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-300 text-gray-600'}`}>
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
                      {form.gradeId && (
                        <div className="bg-blue-50 rounded-lg p-3 text-sm text-blue-800">
                          Base salary: <strong>{new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD', minimumFractionDigits: 2 }).format(getMonthlySalary(form.gradeId, form.scaleYear, parseInt(form.salaryStep)))}/month</strong>
                        </div>
                      )}
                    </div>
                  ) : (
                    <input
                      type="number"
                      min={0}
                      value={form.baseSalary}
                      onChange={e => update('baseSalary', e.target.value)}
                      className="w-full border border-gray-300 rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      placeholder="Monthly amount in JMD"
                    />
                  )}
                </div>

                {GRADES.find(g => g.id === form.gradeId)?.crossCoverageEligible && (
                  <label className="flex items-center gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.crossCoverage}
                      onChange={e => update('crossCoverage', e.target.checked)}
                      className="w-4 h-4 accent-blue-600"
                    />
                    <span className="text-sm text-gray-700">I am rostered at more than one hospital (cross-coverage rates apply)</span>
                  </label>
                )}
              </>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              {loading ? 'Creating account…' : step === 1 ? 'Continue' : 'Create account'}
            </button>
          </form>

          <p className="text-center text-sm text-gray-500 mt-4">
            Already have an account?{' '}
            <Link to="/login" className="text-blue-600 hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  )
}
