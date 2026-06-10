import {
  getRosteredHourlyRate,
  getSessionRates,
  ROSTERED_HOURS,
  TAX_RATE,
  NIS_RATE,
  NHT_RATE,
  EDUCATION_TAX_RATE,
  TAXI_ALLOWANCE,
} from '../data/rates'
import { getDutyType } from '../data/dutyTypes'

export function calcDutyPay(duty, gradeId, crossCoverage) {
  const dutyType = getDutyType(duty.typeId)
  if (!dutyType) return 0

  if (dutyType.type === 'rostered') {
    const hourlyRate = getRosteredHourlyRate(gradeId, dutyType.dayType, crossCoverage)
    return hourlyRate * ROSTERED_HOURS
  }

  if (dutyType.type === 'session') {
    const rates = getSessionRates(gradeId)
    return rates[dutyType.sessionType]?.[dutyType.dayType] ?? 0
  }

  if (dutyType.type === 'dayoff') {
    // Day Off 1 (Saturday): 8hrs at casualty_saturday rate + 16hrs at saturday rostered rate
    // Day Off 2 (Sunday):   8hrs at casualty_holiday rate  + 16hrs at holiday rostered rate
    const sessionRates = getSessionRates(gradeId)
    const casualtyPer4hr = sessionRates.casualty?.[dutyType.dayType] ?? 0
    const casualtyPay = casualtyPer4hr * 2          // 8 hrs = 2 × 4-hr sessions
    const hourlyRate = getRosteredHourlyRate(gradeId, dutyType.dayType, crossCoverage)
    const rosteredPay = hourlyRate * ROSTERED_HOURS  // 16 hrs
    return casualtyPay + rosteredPay
  }

  return 0
}

export function calcMonthlySalary({ duties, gradeId, baseSalary, crossCoverage }) {
  let claimTotal = 0
  let taxiTotal = 0

  const dutyBreakdown = duties.map(duty => {
    const pay = calcDutyPay(duty, gradeId, crossCoverage)
    const taxi = duty.taxi ? TAXI_ALLOWANCE : 0
    claimTotal += pay
    taxiTotal += taxi
    return { ...duty, pay, taxi }
  })

  const grossPay = (baseSalary || 0) + claimTotal + taxiTotal

  // Deductions — applied to gross (simplified; full threshold calc can be added later)
  const nis = grossPay * NIS_RATE
  const nht = grossPay * NHT_RATE
  const edTax = grossPay * EDUCATION_TAX_RATE
  const incomeTax = grossPay * TAX_RATE
  const totalDeductions = nis + nht + edTax + incomeTax
  const takeHome = grossPay - totalDeductions

  return {
    baseSalary: baseSalary || 0,
    claimTotal,
    taxiTotal,
    grossPay,
    nis,
    nht,
    edTax,
    incomeTax,
    totalDeductions,
    takeHome,
    dutyBreakdown,
  }
}

export function fmt(amount) {
  return new Intl.NumberFormat('en-JM', {
    style: 'currency',
    currency: 'JMD',
    minimumFractionDigits: 2,
  }).format(amount)
}
