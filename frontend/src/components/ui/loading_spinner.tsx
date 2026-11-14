/**
 * Reusable circular loading spinner matching the Margin Indigo visual theme.
 */

export interface LoadingSpinnerProps {
  size?: "xs" | "sm" | "md" | "lg";
  variant?: "primary" | "onPrimary";
  ariaLabel?: string;
  className?: string;
}

const SIZE_CLASSES: Record<NonNullable<LoadingSpinnerProps["size"]>, string> = {
  xs: "w-3.5 h-3.5",
  sm: "w-5 h-5",
  md: "w-7 h-7",
  lg: "w-7 h-7",
};

const VARIANT_CLASSES: Record<NonNullable<LoadingSpinnerProps["variant"]>, string> = {
  primary: "border-primary/30 border-t-primary",
  onPrimary: "border-on-primary/40 border-t-on-primary",
};

export function LoadingSpinner({
  size = "md",
  variant = "primary",
  ariaLabel = "Loading",
  className = "",
}: LoadingSpinnerProps) {
  return (
    <span
      role="status"
      aria-label={ariaLabel}
      className={`inline-block border-2 rounded-full animate-spin shrink-0 ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
    />
  );
}

