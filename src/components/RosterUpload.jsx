import { useState, useRef } from 'react'
import { Upload, CheckCircle, AlertCircle, Loader, UserX, Trash2, Plus, PenLine } from 'lucide-react'
import { useSalary } from '../context/SalaryContext'
import { useAuth } from '../context/AuthContext'
import { DUTY_TYPES, getDutyType } from '../data/dutyTypes'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']

function getDayName(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return DAY_NAMES[d.getDay()]
}

function formatDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00')
  return d.toLocaleDateString('en-JM', { month: 'short', day: 'numeric' })
}

// Compress image to JPEG — cap longest side at 2400px
async function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      const MAX = 2400
      let { width: w, height: h } = img
      if (w > MAX || h > MAX) {
        if (w > h) { h = Math.round(h * MAX / w); w = MAX }
        else        { w = Math.round(w * MAX / h); h = MAX }
      }
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => {
        if (!blob) { reject(new Error('Compression failed')); return }
        const reader = new FileReader()
        reader.onload = () => resolve({ base64: reader.result.split(',')[1], mediaType: 'image/jpeg' })
        reader.onerror = reject
        reader.readAsDataURL(blob)
      }, 'image/jpeg', 0.92)
    }
    img.onerror = reject
    img.src = url
  })
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ base64: reader.result.split(',')[1], mediaType: file.type })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

// ── Review screen ─────────────────────────────────────────────────────────────
function ReviewScreen({ scanned, month, year, fullName, onConfirm, onCancel }) {
  const [duties, setDuties] = useState(
    scanned.map((d, i) => ({ ...d, _key: `r-${i}` }))
  )
  const [addDate, setAddDate] = useState('')
  const [addType, setAddType] = useState('weekday')

  // Sorted by date for display
  const sorted = [...duties].sort((a, b) => a.date.localeCompare(b.date))

  function remove(key) {
    setDuties(prev => prev.filter(d => d._key !== key))
  }

  function changeType(key, typeId) {
    setDuties(prev => prev.map(d => d._key === key ? { ...d, typeId } : d))
  }

  function addDuty() {
    if (!addDate) return
    const key = `r-add-${Date.now()}`
    setDuties(prev => [...prev, { date: addDate, typeId: addType, _key: key }])
    setAddDate('')
  }

  const pad = n => String(n).padStart(2, '0')
  const minDate = `${year}-${pad(month + 1)}-01`
  const maxDate = `${year}-${pad(month + 1)}-${new Date(year, month + 1, 0).getDate()}`

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2">
        <PenLine size={18} className="text-blue-600 mt-0.5 shrink-0" />
        <div>
          <p className="text-sm font-semibold text-gray-800">Review scan results</p>
          <p className="text-xs text-gray-500">
            Found <strong>{duties.length} duties</strong> for <strong>{fullName}</strong> in {MONTHS[month]} {year}.
            Remove any mistakes, correct duty types, or add missing duties — then confirm.
          </p>
        </div>
      </div>

      {/* Duty list */}
      <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 max-h-72 overflow-y-auto">
        {sorted.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-6">No duties yet — add them below.</p>
        )}
        {sorted.map(d => {
          const dt = getDutyType(d.typeId)
          return (
            <div key={d._key} className="flex items-center gap-2 px-3 py-2 bg-white hover:bg-gray-50">
              {/* Date + day */}
              <div className="w-24 shrink-0">
                <p className="text-sm font-medium text-gray-800">{formatDate(d.date)}</p>
                <p className="text-xs text-gray-400">{getDayName(d.date)}</p>
              </div>

              {/* Type selector */}
              <select
                value={d.typeId}
                onChange={e => changeType(d._key, e.target.value)}
                className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
                style={{ borderLeftColor: dt?.color, borderLeftWidth: 3 }}
              >
                {DUTY_TYPES.map(t => (
                  <option key={t.id} value={t.id}>{t.label}</option>
                ))}
              </select>

              {/* Remove */}
              <button
                onClick={() => remove(d._key)}
                className="p-1.5 text-gray-300 hover:text-red-500 transition-colors shrink-0"
                title="Remove this duty"
              >
                <Trash2 size={14} />
              </button>
            </div>
          )
        })}
      </div>

      {/* Add a duty manually */}
      <div className="border border-dashed border-gray-300 rounded-xl p-3">
        <p className="text-xs font-medium text-gray-600 mb-2 flex items-center gap-1">
          <Plus size={12} /> Add a missing duty
        </p>
        <div className="flex gap-2">
          <input
            type="date"
            value={addDate}
            min={minDate}
            max={maxDate}
            onChange={e => setAddDate(e.target.value)}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
          <select
            value={addType}
            onChange={e => setAddType(e.target.value)}
            className="flex-1 text-xs border border-gray-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-blue-500"
          >
            {DUTY_TYPES.map(t => (
              <option key={t.id} value={t.id}>{t.label}</option>
            ))}
          </select>
          <button
            onClick={addDuty}
            disabled={!addDate}
            className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors shrink-0"
          >
            Add
          </button>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 text-sm border border-gray-300 rounded-xl text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={() => onConfirm(duties)}
          className="flex-1 py-2.5 text-sm bg-blue-600 text-white font-semibold rounded-xl hover:bg-blue-700 transition-colors"
        >
          Load {duties.length} {duties.length === 1 ? 'duty' : 'duties'} to calendar
        </button>
      </div>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function RosterUpload({ gradeId }) {
  const { month, year, loadDuties, duties } = useSalary()
  const { profile, user } = useAuth()
  const [state, setState] = useState('idle') // idle | loading | review | done | error | notfound
  const [message, setMessage] = useState('')
  const [scannedDuties, setScannedDuties] = useState([])
  const fileRef = useRef()

  const fullName = profile?.name || ''
  const hospital = profile?.hospital || ''
  const nameParts = fullName.trim().split(/\s+/)
  const lastName = nameParts[nameParts.length - 1]?.toUpperCase() || ''

  async function handleFile(file) {
    if (!file) return
    setState('loading')
    setMessage('')

    try {
      // Demo user — run local simulation, no server call
      if (user?.uid === 'demo') {
        await simulateScan()
        return
      }

      const encoded = file.type === 'application/pdf'
        ? await fileToBase64(file)
        : await compressImage(file)

      const idToken = await user.getIdToken()

      const res = await fetch('/.netlify/functions/scan-roster', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          imageBase64: encoded.base64,
          mediaType: encoded.mediaType,
          month,
          year,
          fullName,
          lastName,
          hospital,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Server error ${res.status}`)
      }

      const claudeData = await res.json()
      const text = claudeData.content?.[0]?.text?.trim() || '{}'

      if (text.includes('"notFound"')) {
        setState('notfound')
        setMessage(`"${lastName}" was not found on this roster. Check that your registered name matches how it appears on your department's roster.`)
        return
      }

      const extracted = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]')

      if (extracted.length === 0) {
        setState('notfound')
        setMessage(`No duties found for "${fullName}" on this roster. Check that your name matches the roster exactly.`)
        return
      }

      setScannedDuties(extracted)
      setState('review')

    } catch (err) {
      console.error('Roster scan error:', err)
      setState('error')
      setMessage(err.message || 'Could not read the roster. Try a clearer photo or add duties manually.')
    }
  }

  function handleConfirm(reviewedDuties) {
    const newDuties = reviewedDuties.map((d, i) => ({
      id: `scan-${d.date}-${d.typeId}-${i}`,
      date: d.date,
      typeId: d.typeId,
      taxi: false,
    }))
    loadDuties([...duties.filter(d => !d.id?.startsWith('scan-')), ...newDuties])
    setState('done')
    setMessage(`Loaded ${newDuties.length} ${newDuties.length === 1 ? 'duty' : 'duties'} for ${fullName} — ${MONTHS[month]} ${year}.`)
  }

  // Demo simulation
  async function simulateScan() {
    await new Promise(r => setTimeout(r, 2000))
    if (!lastName.includes('MUIRHEAD') && !fullName.toUpperCase().includes('MUIRHEAD')) {
      setState('notfound')
      setMessage(`"${lastName}" was not found on the demo roster. (Demo mode uses the Muirhead October 2024 roster.)`)
      return
    }
    const pad = n => String(n).padStart(2, '0')
    const y = year, m = pad(month + 1)
    const mock = [
      { date: `${y}-${m}-03`, typeId: 'weekday' },
      { date: `${y}-${m}-08`, typeId: 'weekday' },
      { date: `${y}-${m}-09`, typeId: 'weekday' },
      { date: `${y}-${m}-18`, typeId: 'weekday' },
      { date: `${y}-${m}-19`, typeId: 'saturday' },
      { date: `${y}-${m}-21`, typeId: 'holiday' },
      { date: `${y}-${m}-23`, typeId: 'weekday' },
      { date: `${y}-${m}-24`, typeId: 'weekday' },
      { date: `${y}-${m}-28`, typeId: 'weekday' },
      { date: `${y}-${m}-29`, typeId: 'weekday' },
    ]
    setScannedDuties(mock)
    setState('review')
  }

  function onDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function reset() {
    setState('idle')
    setMessage('')
    setScannedDuties([])
    if (fileRef.current) fileRef.current.value = ''
  }

  // ── Review state — show the ReviewScreen outside the dashed box ───────────
  if (state === 'review') {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-3">Upload Roster</h3>
        <ReviewScreen
          scanned={scannedDuties}
          month={month}
          year={year}
          fullName={fullName}
          onConfirm={handleConfirm}
          onCancel={reset}
        />
      </div>
    )
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-900 mb-1">Upload Roster</h3>
      <p className="text-sm text-gray-500 mb-1">
        Upload a photo or PDF of your monthly roster. We'll find <strong>{fullName || 'your name'}</strong> and extract your overnight rostered duties.
      </p>
      {fullName && (
        <p className="text-xs text-blue-600 mb-4">
          Searching for: <strong>{lastName}</strong> on this roster
        </p>
      )}

      <div
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => state === 'idle' && fileRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors
          ${state === 'idle' ? 'cursor-pointer hover:border-blue-400 hover:bg-blue-50 border-gray-300' : 'border-gray-200'}
        `}
      >
        {state === 'loading' && (
          <div className="flex flex-col items-center gap-2 text-gray-500">
            <Loader size={28} className="animate-spin text-blue-500" />
            <p className="text-sm font-medium">Analysing roster…</p>
            <p className="text-xs text-gray-400">Pass 1: understanding layout · Pass 2: extracting duties</p>
            <p className="text-xs text-gray-400">This takes 10–20 seconds</p>
          </div>
        )}

        {state === 'done' && (
          <div className="flex flex-col items-center gap-2 text-green-600">
            <CheckCircle size={28} />
            <p className="text-sm font-medium">{message}</p>
            <button onClick={reset} className="text-xs text-gray-400 hover:text-gray-600 underline mt-1">
              Upload a different roster
            </button>
          </div>
        )}

        {state === 'notfound' && (
          <div className="flex flex-col items-center gap-3">
            <UserX size={28} className="text-amber-500" />
            <div className="text-center">
              <p className="text-sm font-semibold text-amber-700 mb-1">Name not found on roster</p>
              <p className="text-xs text-gray-500 max-w-xs mx-auto">{message}</p>
            </div>
            <button onClick={reset} className="text-xs text-blue-600 hover:underline mt-1">
              Try a different roster
            </button>
            <p className="text-xs text-gray-400">Or add duties manually using the Calendar tab.</p>
          </div>
        )}

        {state === 'error' && (
          <div className="flex flex-col items-center gap-2">
            <AlertCircle size={28} className="text-red-500" />
            <p className="text-sm text-red-600 max-w-xs mx-auto">{message}</p>
            <button onClick={reset} className="text-xs text-blue-600 hover:underline">Try again</button>
          </div>
        )}

        {state === 'idle' && (
          <div className="flex flex-col items-center gap-2 text-gray-400">
            <Upload size={28} />
            <p className="text-sm font-medium text-gray-600">Drop your roster here or click to browse</p>
            <p className="text-xs">JPG, PNG, or PDF · max 10 MB</p>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]) }}
      />
    </div>
  )
}
