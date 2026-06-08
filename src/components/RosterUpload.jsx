import { useState, useRef } from 'react'
import { Upload, CheckCircle, AlertCircle, Loader } from 'lucide-react'
import { useSalary } from '../context/SalaryContext'
import { format } from 'date-fns'

export default function RosterUpload({ gradeId }) {
  const { month, year, loadDuties, duties } = useSalary()
  const [state, setState] = useState('idle') // idle | loading | done | error
  const [message, setMessage] = useState('')
  const [preview, setPreview] = useState(null)
  const fileRef = useRef()

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

  async function handleFile(file) {
    if (!file) return
    setState('loading')
    setMessage('')

    try {
      // Convert file to base64 for Claude API
      const base64 = await fileToBase64(file)
      const apiKey = import.meta.env.VITE_CLAUDE_API_KEY

      if (!apiKey) {
        // Demo mode — simulate scan with placeholder result
        await simulateScan()
        return
      }

      const response = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1024,
          messages: [{
            role: 'user',
            content: [
              {
                type: 'image',
                source: { type: 'base64', media_type: file.type, data: base64 },
              },
              {
                type: 'text',
                text: `This is a monthly hospital roster for ${MONTHS[month]} ${year}. Find all duties for the person named in the query: "${gradeId}".

Extract every date this person appears and what type of duty it is. Return ONLY a JSON array like:
[{"date":"${year}-${String(month+1).padStart(2,'0')}-03","typeId":"weekday"},...]

typeId must be one of: weekday, saturday, holiday, ward_weekday, ward_saturday, ward_holiday, casualty_weekday, casualty_saturday, casualty_holiday

If a date falls on a Saturday use saturday or ward_saturday or casualty_saturday. If it is a Sunday or public holiday use holiday etc.
Return ONLY the JSON array, no explanation.`,
              },
            ],
          }],
        }),
      })

      const data = await response.json()
      const text = data.content?.[0]?.text || '[]'
      const extracted = JSON.parse(text.match(/\[[\s\S]*\]/)?.[0] || '[]')

      const newDuties = extracted.map((d, i) => ({
        id: `scan-${d.date}-${d.typeId}-${i}`,
        date: d.date,
        typeId: d.typeId,
        taxi: false,
      }))

      loadDuties([...duties, ...newDuties])
      setState('done')
      setMessage(`Found ${newDuties.length} duties from the roster.`)

    } catch (err) {
      console.error(err)
      setState('error')
      setMessage('Could not read the roster. Please add duties manually.')
    }
  }

  async function simulateScan() {
    await new Promise(r => setTimeout(r, 1800))
    // Simulate Dr. Muirhead's October 2024 duties
    const pad = n => String(n).padStart(2, '0')
    const y = year, m = pad(month + 1)
    const mockDuties = [
      { date: `${y}-${m}-03`, typeId: 'weekday' },
      { date: `${y}-${m}-08`, typeId: 'weekday' },
      { date: `${y}-${m}-09`, typeId: 'weekday' },
      { date: `${y}-${m}-19`, typeId: 'saturday' },
      { date: `${y}-${m}-21`, typeId: 'holiday' },
      { date: `${y}-${m}-24`, typeId: 'weekday' },
      { date: `${y}-${m}-28`, typeId: 'weekday' },
      { date: `${y}-${m}-29`, typeId: 'weekday' },
    ].map((d, i) => ({ ...d, id: `demo-${d.date}-${d.typeId}-${i}`, taxi: false }))

    loadDuties(mockDuties)
    setState('done')
    setMessage(`Demo: loaded 8 duties for ${MONTHS[month]} ${year} (Dr. Muirhead's roster).`)
  }

  function onDrop(e) {
    e.preventDefault()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-5">
      <h3 className="font-semibold text-gray-900 mb-1">Upload Roster</h3>
      <p className="text-sm text-gray-500 mb-4">Upload a photo or PDF of your monthly roster and we'll extract your duties automatically.</p>

      <div
        onDrop={onDrop}
        onDragOver={e => e.preventDefault()}
        onClick={() => fileRef.current?.click()}
        className="border-2 border-dashed border-gray-300 rounded-xl p-8 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
      >
        {state === 'loading' ? (
          <div className="flex flex-col items-center gap-2 text-gray-500">
            <Loader size={28} className="animate-spin text-blue-500" />
            <p className="text-sm">Scanning roster…</p>
          </div>
        ) : state === 'done' ? (
          <div className="flex flex-col items-center gap-2 text-green-600">
            <CheckCircle size={28} />
            <p className="text-sm font-medium">{message}</p>
            <p className="text-xs text-gray-400">Click to upload a different roster</p>
          </div>
        ) : state === 'error' ? (
          <div className="flex flex-col items-center gap-2 text-red-500">
            <AlertCircle size={28} />
            <p className="text-sm">{message}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-gray-400">
            <Upload size={28} />
            <p className="text-sm font-medium text-gray-600">Drop your roster here or click to browse</p>
            <p className="text-xs">JPG, PNG, or PDF · max 10MB</p>
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={e => handleFile(e.target.files[0])}
      />

      {!import.meta.env.VITE_CLAUDE_API_KEY && state === 'idle' && (
        <p className="text-xs text-amber-600 mt-2">
          Demo mode — add <code>VITE_CLAUDE_API_KEY</code> to your .env to enable real scanning.
        </p>
      )}
    </div>
  )
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}
