/**
 * Official Margin gradient brand mark and wordmark lockup from `pages/margin-logo.html`.
 */

import { useId } from "react";

interface MarginBrandLogoProps {
  /** Render only the folded-pages M icon mark or the full icon + wordmark SVG. */
  variant?: "icon" | "full";
  className?: string;
}

export function MarginBrandLogo({
  variant = "icon",
  className = "w-8 h-8",
}: MarginBrandLogoProps) {
  const gradientId = useId();

  if (variant === "full") {
    return (
      <svg
        viewBox="0 0 240 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-label="Margin logo"
      >
        <defs>
          <linearGradient
            id={gradientId}
            x1="4"
            y1="4"
            x2="52"
            y2="58"
            gradientUnits="userSpaceOnUse"
          >
            <stop stopColor="#7657F6" />
            <stop offset="1" stopColor="#3569F5" />
          </linearGradient>
        </defs>
        <path
          d="M5 13C5 8 10 5 15 8L29 17L29 51L9 39C6 37 5 34 5 30V13Z"
          fill={`url(#${gradientId})`}
        />
        <path
          d="M57 13C57 8 52 5 47 8L33 17V51L53 39C56 37 57 34 57 30V13Z"
          fill={`url(#${gradientId})`}
        />
        <path d="M29 17L33 17V51L29 54V17Z" fill="#A99AFF" />
        <text
          x="73"
          y="45"
          fontFamily="Geist, Inter, Arial, sans-serif"
          fontSize="37"
          fontWeight="700"
          letterSpacing="-1.8"
          fill="currentColor"
        >
          Margin
        </text>
      </svg>
    );
  }

  return (
    <svg
      viewBox="0 0 62 60"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient
          id={gradientId}
          x1="4"
          y1="4"
          x2="52"
          y2="58"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#7657F6" />
          <stop offset="1" stopColor="#3569F5" />
        </linearGradient>
      </defs>
      <path
        d="M5 13C5 8 10 5 15 8L29 17L29 51L9 39C6 37 5 34 5 30V13Z"
        fill={`url(#${gradientId})`}
      />
      <path
        d="M57 13C57 8 52 5 47 8L33 17V51L53 39C56 37 57 34 57 30V13Z"
        fill={`url(#${gradientId})`}
      />
      <path d="M29 17L33 17V51L29 54V17Z" fill="#A99AFF" />
    </svg>
  );
}

