import { useState } from 'react'
import { format, startOfMonth, endOfMonth, eachDayOfInterval, getDay, isSameMonth } from 'date-fns'
import { X, Plus, Car } from 'lucide-react'
import { useSalary } from '../context/SalaryContext'
import { DUTY_TYPES, getDutyType } from '../data/dutyTypes'
import { calcDutyPay, fmt } from '../services/salary'

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

export default function DutyCalendar({ gradeId, crossCoverage }) {
  const { month, year, setMonth, setYear, duties, addDuty, removeDuty, toggleTaxi } = useSalary()
  const [selectedDate, setSelectedDate] = useState(null)
  const [selectedTypeId, setSelectedTypeId] = useState(DUTY_TYPES[0].id)
  const [addTaxi, setAddTaxi] = useState(false)

  const firstDay = startOfMonth(new Date(year, month))
  const lastDay = endOfMonth(new Date(year, month))
  const days = eachDayOfInterval({ start: firstDay, end: lastDay })
  const startPad = getDay(firstDay)

  function prevMonth() {
    if (month === 0) { setMonth(11); setYear(y => y - 1) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setMonth(0); setYear(y => y + 1) }
    else setMonth(m => m + 1)
  }

  function handleDayClick(date) {
    const key = format(date, 'yyyy-MM-dd')
    setSelectedDate(prev => prev === key ? null : key)
  }

  function handleAddDuty() {
    if (!selectedDate) return
    addDuty(selectedDate, selectedTypeId, addTaxi)
    setAddTaxi(false)
  }

  const dutiesForDay = selectedDate ? duties.filter(d => d.date === selectedDate) : []
  const selectedDutyType = getDutyType(selectedTypeId)

  function getDayDuties(dateStr) {
    return duties.filter(d => d.date === dateStr)
  }

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      {/* Calendar grid */}
      <div className="flex-1 bg-white rounded-2xl border border-gray-200 p-4">
        {/* Month nav */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={prevMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600">&#8592;</button>
          <span className="font-semibold text-gray-900">{MONTHS[month]} {year}</span>
          <button onClick={nextMonth} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-600">&#8594;</button>
        </div>

        {/* Day headers */}
        <div className="grid grid-cols-7 mb-1">
          {DAY_LABELS.map(d => (
            <div key={d} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
          ))}
        </div>

        {/* Days */}
        <div className="grid grid-cols-7 gap-0.5">
          {Array(startPad).fill(null).map((_, i) => (
            <div key={`pad-${i}`} />
          ))}
          {days.map(date => {
            const key = format(date, 'yyyy-MM-dd')
            const dayDuties = getDayDuties(key)
            const isSelected = selectedDate === key

            return (
              <button
                key={key}
                onClick={() => handleDayClick(date)}
                className={`
                  relative min-h-[52px] rounded-lg p-1 text-left transition-colors
                  ${isSelected ? 'bg-blue-50 border-2 border-blue-500' : 'hover:bg-gray-50 border-2 border-transparent'}
                `}
              >
                <span className={`text-xs font-medium block text-right ${isSelected ? 'text-blue-600' : 'text-gray-700'}`}>
                  {format(date, 'd')}
                </span>
                <div className="flex flex-wrap gap-0.5 mt-0.5">
                  {dayDuties.slice(0, 3).map(d => {
                    const dt = getDutyType(d.typeId)
                    return (
                      <div
                        key={d.id}
                        className="w-2 h-2 rounded-full"
                        style={{ backgroundColor: dt?.color || '#6b7280' }}
                        title={dt?.label}
                      />
                    )
                  })}
                  {dayDuties.length > 3 && (
                    <span className="text-xs text-gray-400">+{dayDuties.length - 3}</span>
                  )}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* Side panel */}
      <div className="lg:w-72 bg-white rounded-2xl border border-gray-200 p-4 flex flex-col">
        {selectedDate ? (
          <>
            <h3 className="font-semibold text-gray-900 mb-3">
              {format(new Date(selectedDate + 'T12:00:00'), 'EEEE, MMMM d')}
            </h3>

            {/* Existing duties */}
            {dutiesForDay.length > 0 && (
              <div className="space-y-2 mb-4">
                {dutiesForDay.map(duty => {
                  const dt = getDutyType(duty.typeId)
                  const pay = calcDutyPay(duty, gradeId, crossCoverage)
                  return (
                    <div
                      key={duty.id}
                      className="flex items-start gap-2 p-2 rounded-lg text-sm"
                      style={{ backgroundColor: dt?.bg }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-gray-800 truncate" style={{ color: dt?.color }}>{dt?.label}</div>
                        <div className="text-gray-500 text-xs">{fmt(pay)}{duty.taxi ? ` + ${fmt(2000)} taxi` : ''}</div>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {dt?.taxiEligible && (
                          <button
                            onClick={() => toggleTaxi(duty.id)}
                            title="Toggle taxi allowance"
                            className={`p-1 rounded ${duty.taxi ? 'text-amber-600' : 'text-gray-300 hover:text-gray-500'}`}
                          >
                            <Car size={14} />
                          </button>
                        )}
                        <button onClick={() => removeDuty(duty.id)} className="p-1 rounded text-gray-300 hover:text-red-500">
                          <X size={14} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Add duty form */}
            <div className="border-t border-gray-100 pt-3">
              <p className="text-xs font-medium text-gray-500 mb-2">Add duty</p>
              <select
                value={selectedTypeId}
                onChange={e => setSelectedTypeId(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-2 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {DUTY_TYPES.map(dt => (
                  <option key={dt.id} value={dt.id}>{dt.label}</option>
                ))}
              </select>

              {/* Rate preview */}
              {gradeId && selectedDutyType && (
                <div className="bg-gray-50 rounded-lg p-2 text-xs text-gray-600 mb-2">
                  Pay: <span className="font-semibold text-gray-900">
                    {fmt(calcDutyPay({ typeId: selectedTypeId, taxi: false }, gradeId, crossCoverage))}
                  </span>
                </div>
              )}

              {selectedDutyType?.taxiEligible && (
                <label className="flex items-center gap-2 text-sm text-gray-700 mb-3 cursor-pointer">
                  <input type="checkbox" checked={addTaxi} onChange={e => setAddTaxi(e.target.checked)} className="accent-blue-600" />
                  <Car size={14} className="text-amber-500" />
                  Add taxi allowance
                </label>
              )}

              <button
                onClick={handleAddDuty}
                className="w-full flex items-center justify-center gap-2 bg-blue-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                <Plus size={16} />
                Add to calendar
              </button>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center text-center text-gray-400 text-sm">
            <div>
              <Calendar size={32} className="mx-auto mb-2 opacity-30" />
              <p>Select a date to add or view duties</p>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Calendar({ size, className }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className={className}>
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  )
}
