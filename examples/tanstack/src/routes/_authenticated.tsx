import { Outlet, createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated')({
  beforeLoad: ({ context, location }) => {
    if (context.token) {
      return
    }

    throw redirect({
      to: '/login',
      search: {
        redirectTo: `${location.pathname}${location.searchStr}${location.hash}`,
      },
      replace: true,
    })
  },
  component: AuthenticatedLayout,
})

function AuthenticatedLayout() {
  return <Outlet />
}
