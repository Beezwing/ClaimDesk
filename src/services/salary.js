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
