/**
 * User-friendly error state view for not-found and temporary unavailability states.
 */

import { Link } from "react-router-dom";
import { MarginBrandLogo } from "../ui/margin_brand_logo";

interface HttpErrorStateViewProps {
  statusCode?: 404 | 500 | 503;
  title?: string;
  message?: string;
  errorCode?: string;
  requestId?: string;
  onRetry?: () => void;
}

export function HttpErrorStateView({
  statusCode = 404,
  title,
  message,
  onRetry,
}: HttpErrorStateViewProps) {
  const defaultTitle =
    statusCode === 404
      ? "Document or Page Not Found"
      : statusCode === 503
        ? "Temporarily Unavailable"
        : "Something Went Wrong";

  const defaultMessage =
    statusCode === 404
      ? "We couldn't find the document or page you're looking for. It may have been removed from your library."
      : statusCode === 503
        ? "We're having trouble connecting right now. Please try again in a moment."
        : "We ran into an unexpected hiccup while loading this view. Please try again.";

  return (
    <div className="flex-1 flex items-center justify-center p-8 bg-background">
      <div className="max-w-lg w-full rounded-xl bg-surface-container-lowest border border-outline-variant/40 p-8 shadow-sm space-y-5">
        <div className="flex items-center gap-3">
          <MarginBrandLogo variant="icon" className="w-8 h-8" />
          <span className="font-label-md text-label-md text-on-surface-variant">
            Margin Reader
          </span>
        </div>

        <div className="space-y-2">
          <h1 className="font-headline-md text-headline-md font-semibold text-on-surface">
            {title ?? defaultTitle}
          </h1>
          <p className="font-body-default text-body-default text-on-surface-variant">
            {message ?? defaultMessage}
          </p>
        </div>

        <div className="flex items-center gap-3 pt-2">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container transition-colors"
            >
              Try Again
            </button>
          )}
          <Link
            to="/library"
            className="px-4 py-2 rounded-lg border border-outline-variant/50 text-on-surface font-label-md text-label-md hover:bg-surface-container transition-colors"
          >
            Back to Library
          </Link>
        </div>
      </div>
    </div>
  );
}
