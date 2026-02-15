import { RiMoonLine, RiSunLine } from '@remixicon/react'
import { useTheme } from '@/lib/theme'
import { Button } from '@/components/ui/button'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'

export function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme()

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="size-8 p-0"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          {resolvedTheme === 'dark' ? (
            <RiSunLine className="size-4" />
          ) : (
            <RiMoonLine className="size-4" />
          )}
          <span className="sr-only">Toggle theme</span>
        </Button>
      </TooltipTrigger>
      <TooltipContent>
        Switch to {resolvedTheme === 'dark' ? 'light' : 'dark'} mode
      </TooltipContent>
    </Tooltip>
  )
}
