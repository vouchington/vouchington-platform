import * as React from 'react'
import { OTPInput, OTPInputContext, type RenderProps } from 'input-otp'
import { Minus } from 'lucide-react'

import { cn } from './cn.js'

function InputOTP({
  className,
  containerClassName,
  ref,
  ...props
}: Omit<React.ComponentPropsWithoutRef<typeof OTPInput>, 'pattern'> & {
  pattern?: string | RegExp
  ref?: React.Ref<React.ComponentRef<typeof OTPInput>>
}) {
  return (
    <OTPInput
      ref={ref}
      containerClassName={cn(
        'flex items-center gap-2 has-[:disabled]:opacity-50',
        containerClassName,
      )}
      className={cn('disabled:cursor-not-allowed', className)}
      {...(props as React.ComponentPropsWithoutRef<typeof OTPInput>)}
    />
  )
}
InputOTP.displayName = 'InputOTP'

function InputOTPGroup({
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { ref?: React.Ref<HTMLDivElement> }) {
  return <div ref={ref} className={cn('flex items-center', className)} {...props} />
}
InputOTPGroup.displayName = 'InputOTPGroup'

function InputOTPSlot({
  index,
  className,
  ref,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { index: number; ref?: React.Ref<HTMLDivElement> }) {
  const inputOTPContext = React.use(OTPInputContext)
  const slots = (inputOTPContext as { slots: RenderProps['slots'] }).slots
  const { char, placeholderChar, hasFakeCaret, isActive } = slots[index]!

  return (
    <div
      ref={ref}
      className={cn(
        'relative flex h-9 w-9 items-center justify-center border-y border-r border-input text-sm shadow-sm transition-all first:rounded-l-md first:border-l last:rounded-r-md',
        isActive && 'z-10 ring-1 ring-ring',
        className,
      )}
      {...props}
    >
      {char ?? placeholderChar}
      {hasFakeCaret && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="animate-caret-blink h-4 w-px bg-foreground duration-1000" />
        </div>
      )}
    </div>
  )
}
InputOTPSlot.displayName = 'InputOTPSlot'

function InputOTPSeparator({
  ref,
  ...props
}: React.ComponentPropsWithoutRef<'div'> & { ref?: React.Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} {...props} aria-hidden="true">
      <Minus />
    </div>
  )
}
InputOTPSeparator.displayName = 'InputOTPSeparator'

export { InputOTP, InputOTPGroup, InputOTPSlot, InputOTPSeparator }
