import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "lt:group/button lt:inline-flex lt:shrink-0 lt:items-center lt:justify-center lt:rounded-lg lt:border lt:border-transparent lt:bg-clip-padding lt:text-sm lt:font-medium lt:whitespace-nowrap lt:transition-all lt:outline-none lt:select-none lt:focus-visible:border-ring lt:focus-visible:ring-3 lt:focus-visible:ring-ring/50 lt:active:not-aria-[haspopup]:translate-y-px lt:disabled:pointer-events-none lt:disabled:opacity-50 lt:aria-invalid:border-destructive lt:aria-invalid:ring-3 lt:aria-invalid:ring-destructive/20 lt:dark:aria-invalid:border-destructive/50 lt:dark:aria-invalid:ring-destructive/40 lt:[&_svg]:pointer-events-none lt:[&_svg]:shrink-0 lt:[&_svg:not([class*=size-])]:size-4",
  {
    variants: {
      variant: {
        default: "lt:bg-primary lt:text-primary-foreground lt:hover:bg-primary/80",
        outline:
          "lt:border-border lt:bg-background lt:hover:bg-muted lt:hover:text-foreground lt:aria-expanded:bg-muted lt:aria-expanded:text-foreground lt:dark:border-input lt:dark:bg-input/30 lt:dark:hover:bg-input/50",
        secondary:
          "lt:bg-secondary lt:text-secondary-foreground lt:hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] lt:aria-expanded:bg-secondary lt:aria-expanded:text-secondary-foreground",
        ghost:
          "lt:hover:bg-muted lt:hover:text-foreground lt:aria-expanded:bg-muted lt:aria-expanded:text-foreground lt:dark:hover:bg-muted/50",
        destructive:
          "lt:bg-destructive/10 lt:text-destructive lt:hover:bg-destructive/20 lt:focus-visible:border-destructive/40 lt:focus-visible:ring-destructive/20 lt:dark:bg-destructive/20 lt:dark:hover:bg-destructive/30 lt:dark:focus-visible:ring-destructive/40",
        link: "lt:text-primary lt:underline-offset-4 lt:hover:underline",
      },
      size: {
        default:
          "lt:h-8 lt:gap-1.5 lt:px-2.5 lt:has-data-[icon=inline-end]:pr-2 lt:has-data-[icon=inline-start]:pl-2",
        xs: "lt:h-6 lt:gap-1 lt:rounded-[min(var(--radius-md),10px)] lt:px-2 lt:text-xs lt:in-data-[slot=button-group]:rounded-lg lt:has-data-[icon=inline-end]:pr-1.5 lt:has-data-[icon=inline-start]:pl-1.5 lt:[&_svg:not([class*=size-])]:size-3",
        sm: "lt:h-7 lt:gap-1 lt:rounded-[min(var(--radius-md),12px)] lt:px-2.5 lt:text-[0.8rem] lt:in-data-[slot=button-group]:rounded-lg lt:has-data-[icon=inline-end]:pr-1.5 lt:has-data-[icon=inline-start]:pl-1.5 lt:[&_svg:not([class*=size-])]:size-3.5",
        lg: "lt:h-9 lt:gap-1.5 lt:px-2.5 lt:has-data-[icon=inline-end]:pr-2 lt:has-data-[icon=inline-start]:pl-2",
        icon: "lt:size-8",
        "icon-xs":
          "lt:size-6 lt:rounded-[min(var(--radius-md),10px)] lt:in-data-[slot=button-group]:rounded-lg lt:[&_svg:not([class*=size-])]:size-3",
        "icon-sm":
          "lt:size-7 lt:rounded-[min(var(--radius-md),12px)] lt:in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "lt:size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
