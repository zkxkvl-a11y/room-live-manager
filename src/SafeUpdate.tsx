import { useEffect, useRef, useState } from 'react'

declare const __ROOM_LIVE_BUILD__: string

const CHECK_INTERVAL_MS = 5 * 60 * 1000
const IDLE_BEFORE_RELOAD_MS = 30 * 1000
const EDITING_SELECTOR = 'input:not([type="checkbox"]):not([type="radio"]),textarea,select,[contenteditable="true"]'

function canRefresh(lastActivity: number): boolean {
  if (document.visibilityState !== 'visible') return false
  if (Date.now() - lastActivity < IDLE_BEFORE_RELOAD_MS) return false
  if (document.querySelector('.overlay, [role="dialog"], .modal, .room-detail, .room-alert-settings')) return false
  const focused = document.activeElement
  if (focused instanceof HTMLElement && focused.matches(EDITING_SELECTOR)) return false
  return true
}

export default function SafeUpdate() {
  const [pendingVersion, setPendingVersion] = useState('')
  const lastActivity = useRef(Date.now())
  const checking = useRef(false)

  useEffect(() => {
    if (!import.meta.env.PROD || __ROOM_LIVE_BUILD__ === 'local-dev') return
    let disposed = false
    const activity = () => { lastActivity.current = Date.now() }
    const check = async () => {
      if (checking.current || document.visibilityState !== 'visible') return
      checking.current = true
      try {
        const response = await fetch('/version.json', { cache: 'no-store' })
        if (!response.ok) return
        const payload: unknown = await response.json()
        const version = typeof payload === 'object' && payload !== null && 'version' in payload ? (payload as {version?:unknown}).version : null
        if (typeof version !== 'string' || !version || version === __ROOM_LIVE_BUILD__) return
        if (!disposed && sessionStorage.getItem('room-live-update-attempt') !== version) setPendingVersion(version)
      } catch { /* Offline or deployment in progress: retry later. */ }
      finally { checking.current = false }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('pointerdown', activity, { passive: true })
    document.addEventListener('keydown', activity, { passive: true })
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onVisible)
    const initial = window.setTimeout(() => { void check() }, 15000)
    const interval = window.setInterval(() => { void check() }, CHECK_INTERVAL_MS)
    return () => {
      disposed = true
      window.clearTimeout(initial)
      window.clearInterval(interval)
      document.removeEventListener('pointerdown', activity)
      document.removeEventListener('keydown', activity)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onVisible)
    }
  }, [])

  useEffect(() => {
    if (!pendingVersion) return
    const tryRefresh = () => {
      if (!canRefresh(lastActivity.current)) return
      sessionStorage.setItem('room-live-update-attempt', pendingVersion)
      window.location.reload()
    }
    tryRefresh()
    const interval = window.setInterval(tryRefresh, 5000)
    return () => window.clearInterval(interval)
  }, [pendingVersion])

  if (!pendingVersion) return null
  return <div className="safe-update-notice" role="status"><span>새 버전이 준비됐어요. 작업이 끝나면 자동 갱신됩니다.</span><button type="button" onClick={() => {
    if (document.querySelector('.overlay, [role="dialog"], .modal, .room-detail, .room-alert-settings')) return
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.matches(EDITING_SELECTOR)) { focused.blur(); return }
    sessionStorage.setItem('room-live-update-attempt', pendingVersion)
    window.location.reload()
  }}>지금 갱신</button></div>
}
