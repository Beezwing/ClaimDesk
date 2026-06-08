import { createContext, useContext, useState, useCallback } from 'react'
import { calcMonthlySalary } from '../services/salary'
import { useAuth } from './AuthContext'

const SalaryContext = createContext(null)

export function SalaryProvider({ children }) {
  const { user } = useAuth()
  // Demo mode ONLY for the hardcoded demo user (no Firebase configured at all)
  const isDemo = user?.uid === 'demo'
  const today = new Date()
  const [month, setMonth] = useState(isDemo ? 9 : today.getMonth())
  const [year,  setYear]  = useState(isDemo ? 2024 : today.getFullYear())
  const [duties, setDuties] = useState(isDemo ? [
    { id: 'demo-1', date: '2024-10-03', typeId: 'weekday',  taxi: false },
    { id: 'demo-2', date: '2024-10-08', typeId: 'weekday',  taxi: false },
    { id: 'demo-3', date: '2024-10-09', typeId: 'weekday',  taxi: false },
    { id: 'demo-4', date: '2024-10-18', typeId: 'weekday',  taxi: false },
    { id: 'demo-5', date: '2024-10-19', typeId: 'saturday', taxi: false },
    { id: 'demo-6', date: '2024-10-21', typeId: 'holiday',  taxi: false },
    { id: 'demo-7', date: '2024-10-24', typeId: 'weekday',  taxi: false },
    { id: 'demo-8', date: '2024-10-28', typeId: 'weekday',  taxi: false },
    { id: 'demo-9', date: '2024-10-29', typeId: 'weekday',  taxi: false },
  ] : [])

  function addDuty(dateStr, typeId, taxi = false) {
    setDuties(prev => {
      // Prevent exact duplicates on same date+type
      const exists = prev.some(d => d.date === dateStr && d.typeId === typeId)
      if (exists) return prev
      return [...prev, { id: `${dateStr}-${typeId}-${Date.now()}`, date: dateStr, typeId, taxi }]
    })
  }

  function removeDuty(id) {
    setDuties(prev => prev.filter(d => d.id !== id))
  }

  function toggleTaxi(id) {
    setDuties(prev => prev.map(d => d.id === id ? { ...d, taxi: !d.taxi } : d))
  }

  function clearDuties() {
    setDuties([])
  }

  function loadDuties(list) {
    setDuties(list)
  }

  const getSummary = useCallback((gradeId, baseSalary, crossCoverage) => {
    return calcMonthlySalary({ duties, gradeId, baseSalary, crossCoverage })
  }, [duties])

  return (
    <SalaryContext.Provider value={{
      month, year, setMonth, setYear,
      duties, addDuty, removeDuty, toggleTaxi, clearDuties, loadDuties,
      getSummary,
    }}>
      {children}
    </SalaryContext.Provider>
  )
}

export function useSalary() {
  return useContext(SalaryContext)
}
