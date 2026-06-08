import { TrendingDown, TrendingUp, DollarSign } from 'lucide-react'
import { fmt } from '../services/salary'
import { getDutyType } from '../data/dutyTypes'

export default function SalaryBreakdown({ summary, month, year }) {
  if (!summary) return null

  const { baseSalary, claimTotal, taxiTotal, grossPay, nis, nht, edTax, incomeTax, totalDeductions, takeHome, dutyBreakdown } = summary

  const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

  // Group duties by type for the breakdown table
  const grouped = {}
  dutyBreakdown.forEach(d => {
    if (!grouped[d.typeId]) grouped[d.typeId] = { count: 0, total: 0, taxiTotal: 0 }
    grouped[d.typeId].count++
    grouped[d.typeId].total += d.pay
    grouped[d.typeId].taxiTotal += d.taxi ? 2000 : 0
  })

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-blue-50 rounded-xl p-4">
          <p className="text-xs font-medium text-blue-600 mb-1">Gross Pay</p>
          <p className="text-xl font-bold text-blue-700">{fmt(grossPay)}</p>
        </div>
        <div className="bg-red-50 rounded-xl p-4">
          <p className="text-xs font-medium text-red-600 mb-1">Deductions</p>
          <p className="text-xl font-bold text-red-700">{fmt(totalDeductions)}</p>
        </div>
        <div className="bg-green-50 rounded-xl p-4">
          <p className="text-xs font-medium text-green-600 mb-1">Take Home</p>
          <p className="text-xl font-bold text-green-700">{fmt(takeHome)}</p>
        </div>
      </div>

      {/* Earnings breakdown */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingUp size={16} className="text-blue-600" />
          Earnings — {MONTHS[month]} {year}
        </h3>
        <div className="space-y-2 text-sm">
          <Row label="Base salary (40hr/week)" value={baseSalary} />
          <div className="border-t border-dashed border-gray-100 pt-2">
            {Object.entries(grouped).map(([typeId, data]) => {
              const dt = getDutyType(typeId)
              return (
                <Row
                  key={typeId}
                  label={`${dt?.label} ×${data.count}`}
                  value={data.total + data.taxiTotal}
                  sub={data.taxiTotal > 0 ? `incl. ${fmt(data.taxiTotal)} taxi` : null}
                  dot={dt?.color}
                />
              )
            })}
            {taxiTotal > 0 && <Row label="Taxi allowances total" value={taxiTotal} />}
          </div>
          <div className="border-t border-gray-200 pt-2">
            <Row label="Gross pay" value={grossPay} bold />
          </div>
        </div>
      </div>

      {/* Deductions */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <h3 className="font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <TrendingDown size={16} className="text-red-500" />
          Deductions
        </h3>
        <div className="space-y-2 text-sm">
          <Row label="NIS (2.5%)" value={-nis} negative />
          <Row label="NHT (2%)" value={-nht} negative />
          <Row label="Education Tax (2.25%)" value={-edTax} negative />
          <Row label="Income Tax (33%)" value={-incomeTax} negative />
          <div className="border-t border-gray-200 pt-2">
            <Row label="Total deductions" value={-totalDeductions} bold negative />
          </div>
        </div>
      </div>

      {/* Net */}
      <div className="bg-gradient-to-r from-green-600 to-green-700 rounded-2xl p-5 text-white">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-green-100 text-sm font-medium">Take-home pay</p>
            <p className="text-3xl font-bold mt-1">{fmt(takeHome)}</p>
          </div>
          <DollarSign size={40} className="text-green-300 opacity-50" />
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, negative, bold, sub, dot }) {
  return (
    <div className="flex items-start justify-between py-0.5">
      <div className="flex items-center gap-2">
        {dot && <div className="w-2 h-2 rounded-full mt-0.5 flex-shrink-0" style={{ backgroundColor: dot }} />}
        <div>
          <span className={`text-gray-${bold ? '900' : '600'} ${bold ? 'font-semibold' : ''}`}>{label}</span>
          {sub && <div className="text-xs text-gray-400">{sub}</div>}
        </div>
      </div>
      <span className={`font-${bold ? 'bold' : 'medium'} ${negative ? 'text-red-600' : 'text-gray-900'} ml-4`}>
        {new Intl.NumberFormat('en-JM', { style: 'currency', currency: 'JMD', minimumFractionDigits: 2 }).format(Math.abs(value))}
        {negative && value !== 0 ? '' : ''}
      </span>
    </div>
  )
}
