import { createFileRoute } from '@tanstack/react-router'
import { server } from '@robelest/convex-auth/server'

export const Route = createFileRoute('/api/auth')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        return server().proxy(request)
      },
    },
  },
})
