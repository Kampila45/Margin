/**
 * Interactive Step-by-Step Product Tour for Margin.
 * Takes the user directly through the real application UI using an SVG spotlight cutout,
 * targeted element bounding highlights, and smart floating popover guidance.
 */

import { useEffect, useLayoutEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { MarginBrandLogo } from "../../components/ui/margin_brand_logo";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";

export interface TourStepConfig {
  id: string;
  targetSelector: string;
  title: string;
  content: string;
  badge: string;
  placement: "bottom" | "top" | "left" | "right" | "center";
  onEnter?: (navigate: ReturnType<typeof useNavigate>, setSearchParams: ReturnType<typeof useSearchParams>[1]) => void;
}

export const TOUR_STEPS: TourStepConfig[] = [
  {
    id: "sidebar-nav",
    targetSelector: '[data-tour="sidebar-nav"]',
    title: "Intelligence Navigation Rail",
    badge: "Step 1 of 5",
    placement: "right",
    content:
      "This is your primary rail. Margin unifies two intelligence engines: Document Intelligence (Library and Active Reader) and Structured SQL Assistant. You can switch between them anytime.",
    onEnter: (navigate) => {
      navigate("/");
    },
  },
  {
    id: "mode-switcher",
    targetSelector: '[data-tour="mode-switcher"]',
    title: "Dual-Engine Switcher",
    badge: "Step 2 of 5",
    placement: "bottom",
    content:
      "Toggle between Documents and SQL Studio right here. The workspace metrics, quick actions, and history immediately adapt to the active mode.",
    onEnter: (_nav, setSearchParams) => {
      setSearchParams({});
    },
  },
  {
    id: "action-button",
    targetSelector: '[data-tour="action-button"]',
    title: "Ingest Unstructured Documents",
    badge: "Step 3 of 5",
    placement: "bottom",
    content:
      "Click the highlighted Upload Document button to upload research papers, financial reports, or manuals (PDF, DOCX, TXT). Margin parses text and extracts semantic vectors while preserving exact page coordinates for verified citations.",
  },
  {
    id: "active-reader-nav",
    targetSelector: '[data-tour="active-reader-nav"]',
    title: "Active Reader & Margin Annotations",
    badge: "Step 4 of 5",
    placement: "right",
    content:
      "Inside the reader, select any sentence to trigger Ask AI, Explain, or Summarise directly above your selection. Answers include clickable citations that jump straight to the source passage with zero hallucination.",
  },
  {
    id: "sql-studio",
    targetSelector: '[data-tour="sql-add-connection-btn"], [data-tour="action-button"], [data-tour="sql-tab-btn"]',
    title: "Structured PostgreSQL Assistant",
    badge: "Step 5 of 5",
    placement: "bottom",
    content:
      "Connect read-only PostgreSQL replicas. Margin automatically discovers table schemas so you can query data in plain English and view automated charts.",
    onEnter: (_nav, setSearchParams) => {
      setSearchParams({ tab: "sql" });
    },
  },
];

export function InteractiveProductTour() {
  const isTourActive = useReaderSelectionStore((s) => s.isTourActive);
  const isGuideModalOpen = useReaderSelectionStore((s) => s.isGuideModalOpen);
  const tourStepIndex = useReaderSelectionStore((s) => s.tourStepIndex);
  const nextTourStep = useReaderSelectionStore((s) => s.nextTourStep);
  const prevTourStep = useReaderSelectionStore((s) => s.prevTourStep);
  const endTour = useReaderSelectionStore((s) => s.endTour);
  const startTour = useReaderSelectionStore((s) => s.startTour);

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [showWelcomeToast, setShowWelcomeToast] = useState(false);

  // Check if first-time user should see the welcome toast
  useEffect(() => {
    try {
      const hasCompleted = localStorage.getItem("margin_tour_completed");
      if (!hasCompleted && !isTourActive && !isGuideModalOpen) {
        // Show subtle invitation toast after short delay
        const timer = setTimeout(() => {
          setShowWelcomeToast(true);
        }, 1200);
        return () => clearTimeout(timer);
      }
    } catch {
      // Ignore
    }
  }, [isTourActive, isGuideModalOpen]);

  const currentStep = TOUR_STEPS[tourStepIndex] ?? TOUR_STEPS[0]!;

  // Execute step action on enter
  useEffect(() => {
    if (!isTourActive) {
      return;
    }
    if (currentStep.onEnter) {
      currentStep.onEnter(navigate, setSearchParams);
    }
  }, [isTourActive, tourStepIndex, currentStep, navigate, setSearchParams]);

  // Track target bounding rect
  useLayoutEffect(() => {
    if (!isTourActive) {
      setTargetRect(null);
      return;
    }

    const updateRect = () => {
      const el = document.querySelector(currentStep.targetSelector);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
        const rect = el.getBoundingClientRect();
        setTargetRect(rect);
      } else {
        setTargetRect(null);
      }
    };

    // Allow DOM to settle after tab/route changes
    const timeout = setTimeout(updateRect, 100);
    window.addEventListener("resize", updateRect);
    window.addEventListener("scroll", updateRect, true);

    return () => {
      clearTimeout(timeout);
      window.removeEventListener("resize", updateRect);
      window.removeEventListener("scroll", updateRect, true);
    };
  }, [isTourActive, tourStepIndex, currentStep.targetSelector, searchParams]);

  // Keyboard navigation
  useEffect(() => {
    if (!isTourActive) {
      return;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleEndTour();
      } else if (e.key === "ArrowRight" || e.key === "Enter") {
        handleNext();
      } else if (e.key === "ArrowLeft") {
        if (tourStepIndex > 0) {
          prevTourStep();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isTourActive, tourStepIndex]);

  const handleNext = () => {
    if (tourStepIndex < TOUR_STEPS.length - 1) {
      nextTourStep();
    } else {
      handleEndTour();
    }
  };

  const handleEndTour = () => {
    try {
      localStorage.setItem("margin_tour_completed", "true");
    } catch {
      // Ignore
    }
    endTour();
    // Return to documents tab on end
    setSearchParams({});
  };

  const handleStartFromToast = () => {
    setShowWelcomeToast(false);
    startTour();
  };

  const handleDismissToast = () => {
    try {
      localStorage.setItem("margin_tour_completed", "true");
    } catch {
      // Ignore
    }
    setShowWelcomeToast(false);
  };

  // Compute popover position relative to targetRect
  const computePopoverStyle = (): React.CSSProperties => {
    if (!targetRect) {
      return {
        position: "fixed",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        zIndex: 60,
      };
    }

    const margin = 16;
    const popoverWidth = 360;
    const placement = currentStep.placement;

    let top = 0;
    let left = 0;

    if (placement === "right") {
      top = Math.max(20, Math.min(window.innerHeight - 300, targetRect.top));
      left = Math.min(window.innerWidth - popoverWidth - 20, targetRect.right + margin);
    } else if (placement === "bottom") {
      top = Math.min(window.innerHeight - 300, targetRect.bottom + margin);
      left = Math.max(20, Math.min(window.innerWidth - popoverWidth - 20, targetRect.left));
    } else if (placement === "top") {
      top = Math.max(20, targetRect.top - 260 - margin);
      left = Math.max(20, Math.min(window.innerWidth - popoverWidth - 20, targetRect.left));
    } else {
      top = Math.max(20, targetRect.top);
      left = Math.max(20, targetRect.left - popoverWidth - margin);
    }

    return {
      position: "fixed",
      top: `${top}px`,
      left: `${left}px`,
      width: `${popoverWidth}px`,
      zIndex: 60,
    };
  };

  return (
    <>
      {/* First-Visit Subtle Welcome Toast */}
      {showWelcomeToast && !isTourActive && !isGuideModalOpen && (
        <aside
          role="region"
          aria-label="Welcome guide invitation"
          className="fixed bottom-6 right-6 z-40 max-w-sm p-4 rounded-2xl bg-surface-container-lowest border border-primary/30 shadow-xl flex items-start gap-3.5 animate-in slide-in-from-bottom-4 duration-300 select-none"
        >
          <div className="w-9 h-9 rounded-xl bg-primary/10 text-primary flex items-center justify-center shrink-0 mt-0.5">
            <MarginBrandLogo variant="icon" className="w-5 h-5" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <h4 className="font-label-md text-xs font-bold text-on-surface">
                Welcome to Margin
              </h4>
              <button
                type="button"
                onClick={handleDismissToast}
                aria-label="Dismiss welcome invitation"
                className="text-outline hover:text-on-surface p-0.5 rounded"
              >
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
            <p className="font-body-dense text-[11px] text-on-surface-variant leading-relaxed">
              Take an interactive 60-second walkthrough across Document Intelligence and SQL Studio.
            </p>
            <div className="flex items-center gap-2 pt-1.5">
              <button
                type="button"
                onClick={handleStartFromToast}
                className="px-3 py-1.5 rounded-lg bg-primary text-on-primary text-xs font-label-md font-semibold hover:bg-primary-container transition-colors shadow-2xs flex items-center gap-1 active:scale-[0.98]"
              >
                <span>Start Interactive Tour</span>
                <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
              </button>
              <button
                type="button"
                onClick={handleDismissToast}
                className="px-2.5 py-1.5 rounded-lg text-xs font-label-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
              >
                Skip
              </button>
            </div>
          </div>
        </aside>
      )}

      {/* Full-Screen Spotlight Overlay & Cutout */}
      {isTourActive && (
        <>
          <svg
            className="fixed inset-0 w-full h-full pointer-events-none z-50 transition-all duration-300"
            aria-hidden="true"
          >
            <defs>
              <mask id="tour-spotlight-mask">
                <rect x="0" y="0" width="100%" height="100%" fill="white" />
                {targetRect && (
                  <rect
                    x={targetRect.left - 6}
                    y={targetRect.top - 6}
                    width={targetRect.width + 12}
                    height={targetRect.height + 12}
                    rx="12"
                    fill="black"
                  />
                )}
              </mask>
            </defs>
            <rect
              x="0"
              y="0"
              width="100%"
              height="100%"
              fill="rgba(27, 27, 30, 0.58)"
              mask="url(#tour-spotlight-mask)"
            />
          </svg>

          {/* Target Element Glow Border */}
          {targetRect && (
            <div
              style={{
                position: "fixed",
                left: `${targetRect.left - 6}px`,
                top: `${targetRect.top - 6}px`,
                width: `${targetRect.width + 12}px`,
                height: `${targetRect.height + 12}px`,
                pointerEvents: "none",
                zIndex: 51,
              }}
              className="rounded-xl border-2 border-primary ring-4 ring-primary/25 transition-all duration-300"
            />
          )}

          {/* Floating Tooltip Popover Card */}
          <div
            style={computePopoverStyle()}
            role="dialog"
            aria-modal="true"
            aria-labelledby="tour-step-title"
            className="bg-surface-container-lowest rounded-2xl shadow-2xl border border-outline-variant/35 p-5 flex flex-col gap-3.5 transition-all duration-200 animate-in fade-in"
          >
            {/* Popover Header */}
            <div className="flex items-center justify-between pb-1 border-b border-outline-variant/15">
              <div className="flex items-center gap-2">
                <MarginBrandLogo variant="icon" className="w-5 h-5 shrink-0" />
                <span className="font-code-sm text-[10px] uppercase font-bold text-primary tracking-wider">
                  {currentStep.badge}
                </span>
              </div>
              <button
                type="button"
                onClick={handleEndTour}
                aria-label="Exit tour"
                title="Exit tour (Esc)"
                className="w-6 h-6 rounded-md flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            {/* Step Body */}
            <div className="space-y-1.5">
              <h3
                id="tour-step-title"
                className="font-headline-sm text-sm font-bold text-on-surface tracking-tight"
              >
                {currentStep.title}
              </h3>
              <p className="font-body-dense text-xs text-on-surface-variant leading-relaxed">
                {currentStep.content}
              </p>
            </div>

            {/* Navigation Controls */}
            <div className="flex items-center justify-between pt-2 border-t border-outline-variant/20">
              {/* Step Dots */}
              <div className="flex items-center gap-1.5">
                {TOUR_STEPS.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => useReaderSelectionStore.getState().setTourStep(i)}
                    aria-label={`Jump to step ${i + 1}`}
                    className={`rounded-full transition-all ${
                      i === tourStepIndex
                        ? "w-4 h-1.5 bg-primary"
                        : "w-1.5 h-1.5 bg-outline-variant hover:bg-outline"
                    }`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                {tourStepIndex > 0 && (
                  <button
                    type="button"
                    onClick={prevTourStep}
                    className="px-2.5 py-1 rounded-lg text-xs font-label-md text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
                  >
                    Back
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleNext}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary font-label-md text-xs font-semibold hover:bg-primary-container transition-colors shadow-2xs active:scale-[0.98]"
                >
                  <span>
                    {tourStepIndex === TOUR_STEPS.length - 1
                      ? "Finish Tour"
                      : "Next"}
                  </span>
                  <span className="material-symbols-outlined text-[15px]">
                    {tourStepIndex === TOUR_STEPS.length - 1
                      ? "check"
                      : "arrow_forward"}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
}

