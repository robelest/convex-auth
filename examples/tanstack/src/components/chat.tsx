import { api } from '@convex/_generated/api'
import { useMutation, useQuery } from 'convex/react'
import { useMemo, useState } from 'react'
import type { FormEvent } from 'react'

import { Message } from '@/components/message'
import { MessageList } from '@/components/message-list'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
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
    if (!body || sending) {
      return
    }

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
    <Card className="mx-auto flex h-[calc(100vh-10rem)] w-full max-w-5xl flex-col">
      <CardHeader className="border-b">
        <CardTitle className="text-base">Team Chat</CardTitle>
      </CardHeader>
      <CardContent className="min-h-0 flex-1 p-0">
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
      </CardContent>
      <CardFooter className="flex-col items-stretch gap-2 border-t p-4">
        <form onSubmit={handleSubmit} className="flex w-full flex-col gap-2 sm:flex-row">
          <Input
            placeholder="Write a message"
            value={newMessage}
            onChange={(event) => setNewMessage(event.target.value)}
            aria-label="Message"
          />
          <Button type="submit" disabled={sending || !newMessage.trim()}>
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </form>
        {error ? <p className="text-destructive text-xs">{error}</p> : null}
      </CardFooter>
    </Card>
  )
}
