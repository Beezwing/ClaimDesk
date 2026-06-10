import { Link, useNavigate } from 'react-router-dom'
import { LogOut, User, Clock } from 'lucide-react'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, profile, logout } = useAuth()
  const navigate = useNavigate()

  async function handleLogout() {
    await logout()
    navigate('/login')
  }

  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 h-64 flex items-center justify-between">
        <Link to="/">
          <img src="/logo.png" alt="ClaimDesk" className="h-60 w-auto" />
        </Link>

        {user ? (
          <div className="flex items-center gap-3">
            <Link to="/history" className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900">
              <Clock size={16} />
              <span className="hidden sm:inline">History</span>
            </Link>
            <Link to="/profile" className="flex items-center gap-2 text-sm text-gray-600 hover:text-gray-900">
              <User size={16} />
              <span className="hidden sm:inline">{profile?.name || user.email}</span>
            </Link>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1 text-sm text-gray-500 hover:text-red-600 transition-colors"
            >
              <LogOut size={16} />
              <span className="hidden sm:inline">Sign out</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-3">
            <Link to="/login" className="text-sm text-gray-600 hover:text-gray-900">Sign in</Link>
            <Link to="/register" className="text-sm bg-blue-600 text-white px-3 py-1.5 rounded-lg hover:bg-blue-700 transition-colors">
              Get started
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}
