# @vouchington/ui

Presentational React primitives styled with Tailwind CSS utilities. The package ships no brand
values and no copy: colors come from your Tailwind theme variables and every user-facing string is a
prop. It performs no data fetching, form submission, persistence, or side-effect coordination.

React 19 is a peer dependency.

## Setup

Tailwind 4 must scan the package for class names:

```css
@import 'tailwindcss';
@source '../node_modules/@vouchington/ui/dist';
```

Define these semantic color tokens in your `@theme` (each maps a `--color-*` variable to your brand
value; the package never sets them):

`background`, `foreground`, `card`, `card-foreground`, `popover`, `popover-foreground`, `primary`,
`primary-foreground`, `secondary`, `secondary-foreground`, `muted`, `muted-foreground`, `accent`,
`accent-foreground`, `destructive`, `destructive-foreground`, `border`, `input`, `ring`.

Floating surfaces and accordions use `animate-in`/`fade-in-0`/`zoom-in-95`/`slide-in-from-*` (the
`tw-animate-css` utilities) and `animate-accordion-down`/`animate-accordion-up`. Add `tw-animate-css` (install it and `@import 'tw-animate-css';` in your stylesheet) and
define `--animate-accordion-down`/`--animate-accordion-up` plus their keyframes (height from 0 to
`var(--radix-accordion-content-height)`) in your theme; the package ships no CSS.

## Components

`Button` (`loading`, `asChild`, `buttonVariants`), `Badge`, `Input`, `Textarea`, `Label`,
`Separator`, `Skeleton`, `Spinner`, `Kbd`, `KbdGroup`, `Checkbox`, `Switch`, `RadioGroup`, `Toggle`,
`ToggleGroup`, `Tabs`, `Accordion`, `Tooltip`, `Popover`, `HoverCard`, `ScrollArea`, `Avatar`, `Alert`,
`Card`, `Table`, `ButtonGroup`, and `cn`.

Copy is injected: `Spinner` takes `label`; the `Button` spinner is decorative. Links are rendered
through `asChild`, so any router `Link` can be supplied by the application.
