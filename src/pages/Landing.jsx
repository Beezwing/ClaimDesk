import { Link } from 'react-router-dom'
import { CheckCircle, Calendar, FileText, Shield, TrendingUp, Upload } from 'lucide-react'

const features = [
  { icon: Calendar, title: 'Calendar duty entry', desc: 'Tap a date, select your duty type. The calculator does the rest instantly.' },
  { icon: Upload, title: 'Roster scan', desc: 'Upload your monthly roster and ClaimDesk automatically maps every duty to the calendar.' },
  { icon: TrendingUp, title: 'Exact salary breakdown', desc: 'Gross pay, NIS, income tax, NHT — see your exact take-home before you claim.' },
  { icon: FileText, title: 'PDF & Excel export', desc: 'Export your salary summary as a PDF or spreadsheet. Share via email or WhatsApp.' },
  { icon: Shield, title: 'Your rates, your grade', desc: 'Real JMDA rates for all doctor grades. Nurse rates coming soon.' },
  { icon: CheckCircle, title: 'Claim with confidence', desc: 'Stop underclaiming. Stop redoing paperwork. Know exactly what you are owed.' },
]

export default function Landing() {
  return (
    <div className="min-h-screen bg-white">
      {/* Hero */}
      <section className="bg-gradient-to-br from-blue-600 to-blue-800 text-white py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block bg-blue-500 bg-opacity-30 text-blue-100 text-sm font-medium px-3 py-1 rounded-full mb-6">
            Built for Jamaican healthcare workers
          </div>
          <h1 className="text-4xl sm:text-5xl font-bold mb-6 leading-tight">
            Know exactly what<br />you are owed. Every month.
          </h1>
          <p className="text-xl text-blue-100 mb-10 max-w-2xl mx-auto">
            ClaimDesk calculates your full monthly salary claim using real JMDA rates — rostered duties, ward sessions, casualty sessions, and all deductions — so you never underclaim again.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/register"
              className="bg-white text-blue-700 font-semibold px-8 py-3 rounded-xl hover:bg-blue-50 transition-colors"
            >
              Start free trial
            </Link>
            <Link
              to="/login"
              className="border border-blue-300 text-white font-semibold px-8 py-3 rounded-xl hover:bg-blue-700 transition-colors"
            >
              Sign in
            </Link>
          </div>
          <p className="text-blue-200 text-sm mt-4">14-day free trial · No credit card required</p>
        </div>
      </section>

      {/* Problem statement */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-2xl font-bold text-gray-900 mb-4">The problem with manual salary claims</h2>
          <p className="text-gray-600 text-lg">
            Every month, doctors and nurses across Jamaica spend hours manually calculating their claimable duties across six different duty types, three day-rate tiers, and multiple deduction categories. Claims get submitted wrong. When you underclaim, that money is gone — you cannot recover it.
          </p>
        </div>
      </section>

      {/* Features */}
      <section className="py-16 px-4">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center text-gray-900 mb-12">Everything you need to claim correctly</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} className="p-6 border border-gray-200 rounded-xl hover:border-blue-300 transition-colors">
                <Icon size={24} className="text-blue-600 mb-3" />
                <h3 className="font-semibold text-gray-900 mb-2">{title}</h3>
                <p className="text-gray-500 text-sm">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-md mx-auto text-center">
          <h2 className="text-3xl font-bold text-gray-900 mb-4">Simple pricing</h2>
          <div className="bg-white border-2 border-blue-600 rounded-2xl p-8 shadow-sm">
            <div className="text-5xl font-bold text-blue-600 mb-1">$4.99<span className="text-lg text-gray-400 font-normal">/month</span></div>
            <p className="text-gray-500 mb-6">USD · billed monthly</p>
            <ul className="text-left space-y-3 mb-8">
              {[
                'Unlimited monthly salary calculations',
                'Real JMDA doctor rates (all grades)',
                'Nurse rates when available',
                'PDF & Excel export',
                'Roster upload & scan',
                'Claim history',
              ].map(f => (
                <li key={f} className="flex items-center gap-2 text-sm text-gray-700">
                  <CheckCircle size={16} className="text-green-500 flex-shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <Link
              to="/register"
              className="block w-full bg-blue-600 text-white font-semibold py-3 rounded-xl hover:bg-blue-700 transition-colors"
            >
              Start 14-day free trial
            </Link>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-8 px-4 border-t border-gray-200 text-center text-sm text-gray-400">
        <p>ClaimDesk &copy; {new Date().getFullYear()} · Built for Jamaica's healthcare workers</p>
      </footer>
    </div>
  )
}
