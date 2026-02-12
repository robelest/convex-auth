import { RiSendPlaneLine } from '@remixicon/react'
import { api } from '@convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { Message } from '@/components/message'
import { MessageList } from '@/components/message-list'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function Chat({ viewer }: { viewer: string }) {
  const messages = useQuery(api.messages.list)
  const sendMessage = useMutation(api.messages.send)
  const [newMessage, setNewMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const messageCount = useMemo(() => messages?.length ?? 0, [messages])

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const body = newMessage.trim()
    if (!body || sending) return
    setSending(true)
    setError(null)
    try {
      await sendMessage({ body })
      setNewMessage('')
    } catch {
      setError('Could not send your message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="border-border bg-card flex h-[calc(100vh-11rem)] w-full flex-col border">
      {/* Header */}
      <div className="border-border flex items-center justify-between border-b px-5 py-3">
        <div className="flex items-center gap-3">
          <div className="bg-primary size-2" />
          <h2 className="font-mono text-xs font-bold tracking-wide uppercase">
            Team Chat
          </h2>
        </div>
        <span className="text-muted-foreground font-mono text-[10px] tabular-nums">
          {messageCount} message{messageCount !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Messages */}
      <div className="min-h-0 flex-1">
        <MessageList dependencyKey={messageCount}>
          {messages?.map((message) => (
            <Message
              key={message._id}
              author={message.userId}
              authorName={message.author}
              viewer={viewer}
            >
              {message.body}
            </Message>
          ))}
        </MessageList>
      </div>

      {/* Input */}
      <div className="border-border space-y-2 border-t p-4">
        <form onSubmit={handleSubmit} className="flex gap-2">
          <Input
            placeholder="Type a message..."
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            aria-label="Message"
            className="flex-1"
          />
          <Button
            type="submit"
            size="icon"
            disabled={sending || !newMessage.trim()}
          >
            <RiSendPlaneLine className="size-4" />
            <span className="sr-only">Send</span>
          </Button>
        </form>
        {error && (
          <p className="text-destructive font-mono text-[11px]">{error}</p>
        )}
      </div>
    </div>
  )
}
