import { useCallback, useState } from 'react'

const KEY = 'openagentic-live'

export function useLiveMode() {
  const [live, setLive] = useState<boolean>(() => {
    try { return localStorage.getItem(KEY) === '1' } catch { return false }
  })

  const toggle = useCallback(() => {
    setLive(prev => {
      const next = !prev
      try { localStorage.setItem(KEY, next ? '1' : '0') } catch { /* ignore */ }
      return next
    })
  }, [])

  return { live, toggle }
}
