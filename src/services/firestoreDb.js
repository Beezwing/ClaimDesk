import { doc, setDoc, getDoc, collection, query, where, orderBy, getDocs, deleteDoc } from 'firebase/firestore'
import { db, FIREBASE_CONFIGURED } from './firebase'

// In-memory store for demo mode
let demoRecords = []

export async function saveMonthRecord({ userId, month, year, duties, summary, profile }) {
  const recordId = `${userId}_${year}_${String(month + 1).padStart(2, '0')}`
  const data = {
    userId,
    month,
    year,
    duties,
    summary: {
      baseSalary: summary.baseSalary,
      claimTotal: summary.claimTotal,
      taxiTotal: summary.taxiTotal,
      grossPay: summary.grossPay,
      totalDeductions: summary.totalDeductions,
      takeHome: summary.takeHome,
    },
    gradeId: profile?.gradeId,
    gradeName: profile?.gradeName,
    crossCoverage: profile?.crossCoverage || false,
    savedAt: new Date().toISOString(),
  }

  if (!FIREBASE_CONFIGURED || userId === 'demo') {
    const idx = demoRecords.findIndex(r => r.id === recordId)
    if (idx >= 0) demoRecords[idx] = { id: recordId, ...data }
    else demoRecords.push({ id: recordId, ...data })
    return recordId
  }

  await setDoc(doc(db, 'salaryRecords', recordId), data)
  return recordId
}

export async function getUserRecords(userId) {
  if (!FIREBASE_CONFIGURED || userId === 'demo') {
    return [...demoRecords].sort((a, b) => {
      if (a.year !== b.year) return b.year - a.year
      return b.month - a.month
    })
  }

  const q = query(
    collection(db, 'salaryRecords'),
    where('userId', '==', userId),
    orderBy('year', 'desc'),
    orderBy('month', 'desc')
  )
  const snap = await getDocs(q)
  return snap.docs.map(d => ({ id: d.id, ...d.data() }))
}

export async function deleteRecord(recordId, userId) {
  if (!FIREBASE_CONFIGURED || userId === 'demo') {
    demoRecords = demoRecords.filter(r => r.id !== recordId)
    return
  }
  await deleteDoc(doc(db, 'salaryRecords', recordId))
}
