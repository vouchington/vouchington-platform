import * as React from 'react'
import { Command as CommandPrimitive } from 'cmdk'
import { Search } from 'lucide-react'

import { cn } from './cn.js'
import { watchStaleAriaReferences } from './stale-aria.js'

type CommandInputProps = React.ComponentPropsWithoutRef<typeof CommandPrimitive.Input> & {
  ref?: React.Ref<HTMLInputElement>
}

export function CommandInput({ className, ref, ...props }: CommandInputProps) {
  const setInputRef = React.useCallback(
    (node: HTMLInputElement) => {
      let cleanupRef: void | (() => void)
      if (typeof ref === 'function') cleanupRef = ref(node)
      else if (ref) ref.current = node
      const stopWatching = watchStaleAriaReferences(node)
      return () => {
        stopWatching()
        if (cleanupRef) cleanupRef()
        else if (typeof ref === 'function') ref(null)
        else if (ref) ref.current = null
      }
    },
    [ref],
  )

  return (
    <div className="flex items-center border-b px-3" data-cmdk-input-wrapper="">
      <Search className="mr-2 h-4 w-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        ref={setInputRef}
        className={cn(
          'flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50',
          className,
        )}
        {...props}
      />
    </div>
  )
}
