import { RiSendPlaneLine } from '@remixicon/react'
import { api } from '@convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { Message } from '@/components/message'
import { MessageList } from '@/components/message-list'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function Chat({
  viewer,
  groupId,
  channelName,
}: {
  viewer: string
  groupId: string | null
  channelName: string
}) {
  const messages = useQuery(api.messages.list, groupId ? { groupId } : {})
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
      await sendMessage({ body, ...(groupId ? { groupId } : {}) })
      setNewMessage('')
    } catch {
      setError('Could not send your message. Please try again.')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="border-border flex h-12 items-center justify-between border-b px-5">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground text-sm">#</span>
          <h2 className="text-sm font-semibold">{channelName}</h2>
        </div>
        <span className="text-muted-foreground text-xs tabular-nums">
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
      <div className="border-border flex h-14 shrink-0 items-center gap-2 border-t px-4">
        <form onSubmit={handleSubmit} className="flex flex-1 gap-2">
          <Input
            placeholder={`Message #${channelName}`}
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
          <p className="text-destructive text-xs">{error}</p>
        )}
      </div>
    </div>
  )
}
