import { useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

export function MessageList({
  children,
  dependencyKey,
}: {
  children: ReactNode
  dependencyKey: number
}) {
  const listRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    if (!listRef.current) {
      return
    }
    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [dependencyKey])

  return (
    <ol
      ref={listRef}
      className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4 sm:p-6"
    >
      {children}
    </ol>
  )
}
