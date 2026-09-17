import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow hover:bg-primary/90",
        cta: "bg-terracotta text-creme shadow hover:bg-terracotta/90",
        gold: "bg-or text-marine shadow hover:bg-or/90",
        destructive: "bg-destructive text-destructive-foreground shadow-sm hover:bg-destructive/90",
        outline: "border border-input bg-transparent shadow-sm hover:bg-secondary hover:text-secondary-foreground",
        secondary: "bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80",
        ghost: "hover:bg-secondary hover:text-secondary-foreground",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
        icon: "h-9 w-9",
        // Tailles additives (audit UX-04 : cibles tactiles ≥ 44 px) — opt-in,
        // n'affectent aucun bouton existant qui ne les demande pas explicitement.
        touch: "h-11 px-5",
        "icon-touch": "h-11 w-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  /**
   * État de chargement Premium : spinner, `aria-busy` et désactivation
   * automatique. Sans effet si `asChild` (le bouton délègue alors son rendu
   * à un unique enfant, ex. un `<Link>`, dans lequel un spinner ne peut pas
   * s'insérer sans casser le contrat `Slot`).
   */
  loading?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, loading = false, disabled, children, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    const enChargement = loading && !asChild;
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        disabled={disabled || enChargement}
        aria-busy={enChargement || undefined}
        {...props}
      >
        {/* Slot (asChild) exige un unique enfant : le spinner ne peut donc être
            ajouté qu'en dehors de ce cas, où `enChargement` est déjà garanti faux. */}
        {enChargement ? (
          <>
            <Loader2 aria-hidden className="animate-spin motion-reduce:animate-none" />
            {children}
          </>
        ) : (
          children
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
