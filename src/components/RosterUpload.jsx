import { useState, useRef } from 'react'
import { Upload, CheckCircle, AlertCircle, Loader, UserX } from 'lucide-react'
import { useSalary } from '../context/SalaryContext'
import { useAuth } from '../context/AuthContext'

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// Compress image to JPEG and cap longest side at 1500px to stay well under Netlify's 6MB function limit
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
      canvas.width = w
      canvas.height = h
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

// PDFs are sent as-is (can't canvas-compress them)
async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ base64: reader.result.split(',')[1], mediaType: file.type })
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export default function RosterUpload({ gradeId }) {
  const { month, year, loadDuties, duties } = useSalary()
  const { profile, user } = useAuth()
  const [state, setState] = useState('idle') // idle | loading | done | error | notfound
  const [message, setMessage] = useState('')
  const fileRef = useRef()

  const fullName = profile?.name || ''
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

      // ── Compress / encode image ──────────────────────────────────────────
      let encoded
      if (file.type === 'application/pdf') {
        encoded = await fileToBase64(file)
      } else {
        encoded = await compressImage(file)
      }

      // ── Get Firebase ID token ────────────────────────────────────────────
      const idToken = await user.getIdToken()

      // ── Call secure Netlify Function ─────────────────────────────────────
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
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Server error ${res.status}`)
      }

      const claudeData = await res.json()
      const text = claudeData.content?.[0]?.text?.trim() || '{}'

      // ── Parse Claude response ─────────────────────────────────────────────
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

      const newDuties = extracted.map((d, i) => ({
        id: `scan-${d.date}-${d.typeId}-${i}`,
        date: d.date,
        typeId: d.typeId,
        taxi: false,
      }))

      loadDuties([...duties.filter(d => !d.id.startsWith('scan-')), ...newDuties])
      setState('done')
      setMessage(`Found ${newDuties.length} duties for ${fullName} in ${MONTHS[month]} ${year}.`)

    } catch (err) {
      console.error('Roster scan error:', err)
      setState('error')
      setMessage(err.message || 'Could not read the roster. Try a clearer photo or add duties manually.')
    }
  }

  // ── Demo simulation (demo user only) ──────────────────────────────────────
  async function simulateScan() {
    await new Promise(r => setTimeout(r, 1500))
    if (!lastName.includes('MUIRHEAD') && !fullName.toUpperCase().includes('MUIRHEAD')) {
      setState('notfound')
      setMessage(`"${lastName}" was not found on the demo roster. (Demo mode uses the Muirhead October 2024 roster.)`)
      return
    }
    const pad = n => String(n).padStart(2, '0')
    const y = year, m = pad(month + 1)
    const mockDuties = [
      { date: `${y}-${m}-03`, typeId: 'weekday' },
      { date: `${y}-${m}-08`, typeId: 'weekday' },
      { date: `${y}-${m}-09`, typeId: 'weekday' },
      { date: `${y}-${m}-18`, typeId: 'weekday' },
      { date: `${y}-${m}-19`, typeId: 'saturday' },
      { date: `${y}-${m}-21`, typeId: 'holiday' },
      { date: `${y}-${m}-24`, typeId: 'weekday' },
      { date: `${y}-${m}-28`, typeId: 'weekday' },
      { date: `${y}-${m}-29`, typeId: 'weekday' },
    ].map((d, i) => ({ ...d, id: `demo-${d.date}-${d.typeId}-${i}`, taxi: false }))
    loadDuties(mockDuties)
    setState('done')
    setMessage(`Loaded 9 duties for Dr. Muirhead — ${MONTHS[month]} ${year}.`)
  }

  function onDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function reset() {
    setState('idle')
    setMessage('')
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-900 mb-1">Upload Roster</h3>
      <p className="text-sm text-gray-500 mb-1">
        Upload a photo or PDF of your monthly roster. We'll find <strong>{fullName || 'your name'}</strong> and extract your duties automatically.
      </p>
      {fullName && (
        <p className="text-xs text-blue-600 mb-4">
          Searching for: <strong>{lastName}</strong> on the roster
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
            <p className="text-sm">Scanning roster for <strong>{lastName}</strong>…</p>
            <p className="text-xs text-gray-400">This usually takes 5–10 seconds</p>
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
