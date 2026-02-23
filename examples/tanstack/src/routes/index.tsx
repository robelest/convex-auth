import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
  beforeLoad: ({ context }) => {
    throw redirect({
      to: context.token ? '/chat' : '/login',
      replace: true,
    })
  },
  component: IndexPage,
})

function IndexPage() {
  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-muted-foreground font-mono text-xs animate-pulse">
        Redirecting...
      </p>
    </div>
  )
}
