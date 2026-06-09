/**
 * Push notification helpers for ClaimDesk
 */

export async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')
    return reg
  } catch (err) {
    console.warn('SW registration failed:', err)
    return null
  }
}

export async function requestNotificationPermission() {
  if (!('Notification' in window)) return 'unsupported'
  if (Notification.permission === 'granted') return 'granted'
  if (Notification.permission === 'denied') return 'denied'
  const result = await Notification.requestPermission()
  return result
}

export function scheduleMonthlyReminder() {
  // Show a local notification reminder on the 25th of each month
  // to prompt users to log their duties before month end
  const now = new Date()
  const reminderDay = 25
  let target = new Date(now.getFullYear(), now.getMonth(), reminderDay, 9, 0, 0)
  if (target <= now) {
    // Already past the 25th this month — schedule for next month
    target = new Date(now.getFullYear(), now.getMonth() + 1, reminderDay, 9, 0, 0)
  }
  const delay = target.getTime() - now.getTime()

  setTimeout(() => {
    if (Notification.permission === 'granted') {
      new Notification('ClaimDesk Reminder 📋', {
        body: 'Have you logged all your on-call duties this month? Export your claim before month end.',
        icon: '/icons/icon-192.png',
      })
    }
    // Reschedule for next month
    scheduleMonthlyReminder()
  }, delay)
}

export async function enableNotifications() {
  const permission = await requestNotificationPermission()
  if (permission !== 'granted') return false
  await registerServiceWorker()
  scheduleMonthlyReminder()
  return true
}
