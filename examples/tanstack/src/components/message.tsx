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
        'flex w-full flex-col gap-1',
        fromViewer ? 'items-end' : 'items-start',
      )}
    >
      <p className="text-muted-foreground/70 px-0.5 text-[11px] font-medium">
        {authorName}
      </p>
      <p
        className={cn(
          'max-w-[min(32rem,80vw)] rounded-lg px-3.5 py-2 text-sm leading-relaxed',
          fromViewer
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted',
        )}
      >
        {children}
      </p>
    </li>
  )
}
