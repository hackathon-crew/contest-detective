import type { ReactElement } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@huyanxius/ui'

export function PressedToggle({ pressed, children }: { pressed: boolean; children: ReactElement }) {
  return (
    <ToggleGroup type="multiple" unstyled asChild rovingFocus={false} value={pressed ? ['on'] : []}>
      <ToggleGroupItem value="on" asChild role="button">
        {children}
      </ToggleGroupItem>
    </ToggleGroup>
  )
}
