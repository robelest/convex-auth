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
    if (!listRef.current) return
    listRef.current.scrollTo({
      top: listRef.current.scrollHeight,
      behavior: 'smooth',
    })
  }, [dependencyKey])

  return (
    <ol
      ref={listRef}
      className="flex h-full flex-col gap-4 overflow-y-auto p-5"
    >
      {children}
    </ol>
  )
}
