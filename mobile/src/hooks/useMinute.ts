import { useEffect, useState } from 'react'

/** The current time, moved on once a minute, so "Today" becomes "Yesterday" at midnight without redrawing every second. */
export function useMinute(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])
  return now
}
