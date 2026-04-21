import { useState } from 'react'

export function useModal<T = undefined>() {
  const [open,    setOpen]    = useState(false)
  const [payload, setPayload] = useState<T | undefined>(undefined)

  function show(data?: T) { setPayload(data); setOpen(true) }
  function hide()          { setOpen(false) }

  return { open, payload, show, hide }
}
