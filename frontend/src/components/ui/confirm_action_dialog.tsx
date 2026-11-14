/**
 * Accessible confirmation dialog for destructive actions (such as deleting a document or conversation).
 */

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";

interface ConfirmActionDialogProps {
  isOpen: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  isBusy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmActionDialog({
  isOpen,
  title,
  description,
  confirmLabel = "Delete",
  isBusy = false,
  onConfirm,
  onCancel,
}: ConfirmActionDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isBusy) {
        onCancel();
        return;
      }
      if (event.key === "Tab" && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        // If focus is currently outside the dialog, pull it immediately into the dialog
        if (!dialogRef.current.contains(document.activeElement)) {
          event.preventDefault();
          if (event.shiftKey) {
            last?.focus();
          } else {
            first?.focus();
          }
          return;
        }

        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isBusy, onCancel]);

  if (!isOpen) {
    return null;
  }

  const dialog = (
    <div
      className="fixed inset-0 z-50 !m-0 flex items-center justify-center bg-black/40 backdrop-blur-[2px] p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isBusy) {
          onCancel();
        }
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-md rounded-xl bg-surface-container-lowest border border-outline-variant/40 p-6 shadow-xl space-y-4 focus:outline-none"
      >
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-error-container text-on-error-container flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined">warning</span>
          </div>
          <div className="space-y-1">
            <h2 id="confirm-dialog-title" className="font-headline-sm text-headline-sm font-semibold text-on-surface">
              {title}
            </h2>
            <p className="font-body-default text-body-default text-on-surface-variant">
              {description}
            </p>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            disabled={isBusy}
            onClick={onCancel}
            className="px-3.5 py-2 rounded-lg border border-outline-variant/50 text-on-surface font-label-md text-label-md hover:bg-surface-container transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={isBusy}
            onClick={onConfirm}
            className="px-3.5 py-2 rounded-lg bg-error text-on-error font-label-md text-label-md hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {isBusy ? "Deleting…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(dialog, document.body) : dialog;
}

