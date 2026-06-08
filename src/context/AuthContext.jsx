import { createContext, useContext, useEffect, useState } from 'react'
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  updateProfile,
} from 'firebase/auth'
import { doc, setDoc, getDoc } from 'firebase/firestore'
import { auth, db, FIREBASE_CONFIGURED } from '../services/firebase'

const AuthContext = createContext(null)

const DEMO_USER = { uid: 'demo', email: 'demo@claimdesk.app', displayName: 'Dr. Muirhead (Demo)' }
const DEMO_PROFILE = {
  name: 'Dr. Muirhead',
  hospital: 'Kingston Public Hospital (KPH)',
  gradeId: 'mo1',
  baseSalary: 566611.17, // MO1 minimum step, April 2024 scale ($6,799,334 / 12)
  scaleYear: '2024',
  salaryStep: 0,
  crossCoverage: false,
  subscription: 'demo',
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(FIREBASE_CONFIGURED ? null : DEMO_USER)
  const [profile, setProfile] = useState(FIREBASE_CONFIGURED ? null : DEMO_PROFILE)
  const [loading, setLoading] = useState(FIREBASE_CONFIGURED)

  useEffect(() => {
    if (!FIREBASE_CONFIGURED) return

    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u)
      if (u) {
        const snap = await getDoc(doc(db, 'users', u.uid))
        if (snap.exists()) setProfile(snap.data())
      } else {
        setProfile(null)
      }
      setLoading(false)
    })
    return unsub
  }, [])

  async function register(email, password, profileData) {
    if (!FIREBASE_CONFIGURED) throw new Error('Firebase not configured — add env vars to enable real accounts.')
    const cred = await createUserWithEmailAndPassword(auth, email, password)
    await updateProfile(cred.user, { displayName: profileData.name })
    await setDoc(doc(db, 'users', cred.user.uid), {
      ...profileData,
      email,
      createdAt: new Date().toISOString(),
      subscription: 'trial',
    })
    setProfile(profileData)
    return cred.user
  }

  async function login(email, password) {
    if (!FIREBASE_CONFIGURED) throw new Error('Firebase not configured — add env vars to enable real accounts.')
    return signInWithEmailAndPassword(auth, email, password)
  }

  async function logout() {
    if (!FIREBASE_CONFIGURED) {
      setUser(null)
      setProfile(null)
      return
    }
    await signOut(auth)
    setProfile(null)
  }

  async function updateUserProfile(data) {
    if (user?.uid === 'demo') {
      setProfile(prev => ({ ...prev, ...data }))
      return
    }
    if (!user) return
    await setDoc(doc(db, 'users', user.uid), data, { merge: true })
    setProfile(prev => ({ ...prev, ...data }))
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, isDemo: !FIREBASE_CONFIGURED, register, login, logout, updateUserProfile }}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
