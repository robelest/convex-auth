import type { ReactNode } from 'react'

import { cn } from '@/lib/utils'

export function Message({
  author,
  authorName,
  viewer,
  children,
}: {
  author: string
  authorName: string
  viewer: string
  children: ReactNode
}) {
  const fromViewer = author === viewer

  return (
    <li
      className={cn(
        'flex w-full flex-col gap-1 text-sm',
        fromViewer ? 'items-end' : 'items-start',
      )}
    >
      <p className="text-muted-foreground px-1 text-xs font-medium">{authorName}</p>
      <p
        className={cn(
          'bg-card max-w-[min(34rem,85vw)] border px-3 py-2',
          fromViewer ? 'bg-primary text-primary-foreground border-primary' : 'border-border',
        )}
      >
        {children}
      </p>
    </li>
  )
}
