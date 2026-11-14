/**
 * Action-Driven First-Time User Onboarding Flow Modal for Margin.
 * Takes the user through the application with live action triggers:
 * - Direct "Start Interactive Tour" launching the real DOM spotlight walkthrough
 * - Slide 2: Ingest Documents with direct "+ Upload Document" trigger
 * - Slide 3: SQL Studio with direct "+ Add Connection" trigger
 */

import { useEffect, useState } from "react";
import { Link, useInRouterContext } from "react-router-dom";
import { MarginBrandLogo } from "../../components/ui/margin_brand_logo";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";

interface SlideData {
  badge: string;
  title: string;
  description: string;
  icon: string;
  actionType: "tour" | "document" | "sql";
  actionLabel: string;
  actionIcon: string;
  points: Array<{
    title: string;
    detail: string;
    icon: string;
  }>;
}

const GUIDE_SLIDES: SlideData[] = [
  {
    badge: "Dual-Mode Intelligence",
    title: "Welcome to Margin",
    description:
      "A unified intelligence workspace bridging unstructured documents and relational databases. Choose how you want to explore the platform below.",
    icon: "auto_awesome",
    actionType: "tour",
    actionLabel: "Start Interactive Live Tour",
    actionIcon: "explore",
    points: [
      {
        icon: "menu_book",
        title: "Document Intelligence",
        detail:
          "Ingest PDF, DOCX, and TXT files. Read with interactive margin notes and navigate verified page citations.",
      },
      {
        icon: "database",
        title: "Structured SQL Studio",
        detail:
          "Connect PostgreSQL database replicas. Discover schemas, generate safe read-only queries from plain English, and view automated charts.",
      },
      {
        icon: "compare_arrows",
        title: "Multi-Document Scope in Reader",
        detail:
          "Add multiple indexed documents directly inside Active Reader's Scope bar to cross-reference insights in one thread.",
      },
    ],
  },
  {
    badge: "Document Intelligence",
    title: "Interactive Margin Reading & Citations",
    description:
      "Experience active reading where every insight is anchored directly to source text with zero hallucinations.",
    icon: "menu_book",
    actionType: "document",
    actionLabel: "Upload Document",
    actionIcon: "upload_file",
    points: [
      {
        icon: "format_quote",
        title: "Contextual Margin Toolbar",
        detail:
          "Highlight any passage in the reader to trigger Ask AI, Explain, or Summarise directly above the selected text.",
      },
      {
        icon: "verified",
        title: "Clickable Page Citations",
        detail:
          "Every claim includes a verified page citation. Click any citation to smoothly jump to the exact page and highlight the cited passage.",
      },
      {
        icon: "shield",
        title: "Honest Context Guard",
        detail:
          "If your documents lack sufficient evidence to answer a question, Margin alerts you directly rather than inventing facts.",
      },
    ],
  },
  {
    badge: "SQL Studio",
    title: "Natural Language PostgreSQL Querying",
    description:
      "Query transactional databases without writing SQL by hand, protected by strict read-only execution guards.",
    icon: "database",
    actionType: "sql",
    actionLabel: "Add Connection",
    actionIcon: "add",
    points: [
      {
        icon: "schema",
        title: "Automatic Schema Discovery",
        detail:
          "Margin indexes table columns, types, primary keys, and relationships without sending private row data to the AI model.",
      },
      {
        icon: "query_stats",
        title: "Instant Results & Charts",
        detail:
          "Questions are translated to safe SQL and executed immediately, returning plain-English answers and automated charts.",
      },
      {
        icon: "lock",
        title: "Read-Only Security Guard",
        detail:
          "Strict lexical enforcement permits single SELECT queries only, with a 5-second statement timeout.",
      },
    ],
  },
];

export function OnboardingGuideModal() {
  const isOpen = useReaderSelectionStore((s) => s.isGuideModalOpen);
  const setOpen = useReaderSelectionStore((s) => s.setGuideModalOpen);
  const setUploadModalOpen = useReaderSelectionStore((s) => s.setUploadModalOpen);
  const setConnectDbModalOpen = useReaderSelectionStore((s) => s.setConnectDbModalOpen);
  const startTour = useReaderSelectionStore((s) => s.startTour);

  const hasRouterContext = useInRouterContext();

  const [currentSlide, setCurrentSlide] = useState(0);

  // Trigger automatically on first visit if not previously seen
  useEffect(() => {
    try {
      const hasSeen = localStorage.getItem("margin_onboarding_seen");
      if (!hasSeen) {
        setOpen(true);
      }
    } catch {
      // Ignore if localStorage unavailable
    }
  }, [setOpen]);

  const handleClose = () => {
    try {
      localStorage.setItem("margin_onboarding_seen", "true");
    } catch {
      // Ignore
    }
    setOpen(false);
  };

  const handleNext = () => {
    if (currentSlide < GUIDE_SLIDES.length - 1) {
      setCurrentSlide((prev) => prev + 1);
    } else {
      handleClose();
    }
  };

  const handlePrev = () => {
    if (currentSlide > 0) {
      setCurrentSlide((prev) => prev - 1);
    }
  };

  const handleAction = (type: "tour" | "document" | "sql") => {
    handleClose();
    if (type === "tour") {
      startTour();
    } else if (type === "document") {
      setUploadModalOpen(true);
    } else if (type === "sql") {
      setConnectDbModalOpen(true);
    }
  };

  if (!isOpen) {
    return null;
  }

  const slide = GUIDE_SLIDES[currentSlide]!;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-guide-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-on-surface/40 backdrop-blur-xs animate-in fade-in duration-200"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-2xl bg-surface-container-lowest rounded-2xl shadow-xl border border-outline-variant/30 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header Bar */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/20 bg-surface-container-low/50">
          <div className="flex items-center gap-3">
            <MarginBrandLogo variant="icon" className="w-7 h-7" />
            <div>
              <div className="flex items-center gap-2">
                <span className="font-headline-sm text-sm font-bold text-on-surface">
                  Margin Onboarding
                </span>
                <span className="font-code-sm text-[10px] uppercase px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                  {slide.badge}
                </span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            aria-label="Close guide"
            className="w-8 h-8 rounded-full flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-[20px]">close</span>
          </button>
        </div>

        {/* Slide Content */}
        <div className="p-6 md:p-8 space-y-6">
          <div className="space-y-1.5">
            <h2
              id="onboarding-guide-title"
              className="font-headline-lg text-xl md:text-2xl font-bold text-on-surface tracking-tight"
            >
              {slide.title}
            </h2>
            <p className="font-body-default text-xs md:text-sm text-on-surface-variant leading-relaxed">
              {slide.description}
            </p>
          </div>

          {/* Interactive Action Callout Banner for Current Step */}
          {slide.actionType === "tour" ? (
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[20px]">explore</span>
                </div>
                <div>
                  <h3 className="font-label-md text-xs font-bold text-on-surface">
                    Walk Through the Live Application
                  </h3>
                  <p className="font-body-dense text-[11px] text-on-surface-variant">
                    Spotlight tour highlighting the real interface elements and actions.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => handleAction("tour")}
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary text-xs font-label-md font-semibold hover:bg-primary-container transition-colors shadow-2xs active:scale-[0.98] shrink-0"
              >
                <span className="material-symbols-outlined text-[16px]">play_arrow</span>
                <span>Start Interactive Tour</span>
              </button>
            </div>
          ) : slide.actionType === "document" ? (
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[20px]">upload_file</span>
                </div>
                <div>
                  <h3 className="font-label-md text-xs font-bold text-on-surface">
                    Ingest Your First Document
                  </h3>
                  <p className="font-body-dense text-[11px] text-on-surface-variant">
                    Upload PDF, DOCX, or TXT files to begin reading with verified page citations.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAction("document")}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary text-xs font-label-md font-semibold hover:bg-primary-container transition-colors shadow-2xs active:scale-[0.98] shrink-0"
                >
                  <span className="material-symbols-outlined text-[16px]">upload_file</span>
                  <span>Upload Document</span>
                </button>
                {hasRouterContext && (
                  <Link
                    to="/library"
                    onClick={handleClose}
                    className="px-3 py-2 rounded-xl border border-outline-variant/40 hover:bg-surface-container text-xs font-label-md text-on-surface transition-colors"
                  >
                    Open Library
                  </Link>
                )}
              </div>
            </div>
          ) : (
            <div className="p-4 rounded-xl bg-primary/5 border border-primary/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-primary text-on-primary flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[20px]">database</span>
                </div>
                <div>
                  <h3 className="font-label-md text-xs font-bold text-on-surface">
                    Connect a PostgreSQL Replica
                  </h3>
                  <p className="font-body-dense text-[11px] text-on-surface-variant">
                    Zero AI credential exposure. Discover schemas and query in plain English.
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAction("sql")}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-primary text-on-primary text-xs font-label-md font-semibold hover:bg-primary-container transition-colors shadow-2xs active:scale-[0.98] shrink-0"
                >
                  <span className="material-symbols-outlined text-[16px]">add</span>
                  <span>Add Connection</span>
                </button>
                {hasRouterContext && (
                  <Link
                    to="/sql"
                    onClick={handleClose}
                    className="px-3 py-2 rounded-xl border border-outline-variant/40 hover:bg-surface-container text-xs font-label-md text-on-surface transition-colors"
                  >
                    Open SQL Studio
                  </Link>
                )}
              </div>
            </div>
          )}

          {/* Feature Points Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5 pt-1">
            {slide.points.map((point) => (
              <div
                key={point.title}
                className="p-3.5 rounded-xl bg-surface-container-low/60 border border-outline-variant/25 flex flex-col justify-start gap-2 transition-all hover:bg-surface-container-low"
              >
                <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[18px]">
                    {point.icon}
                  </span>
                </div>
                <div>
                  <h3 className="font-label-md text-xs font-bold text-on-surface mb-1">
                    {point.title}
                  </h3>
                  <p className="font-body-dense text-[11px] text-on-surface-variant leading-relaxed">
                    {point.detail}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Footer Navigation */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-outline-variant/20 bg-surface-container-low/30">
          {/* Step Indicator Dots */}
          <div className="flex items-center gap-2">
            {GUIDE_SLIDES.map((_, index) => (
              <button
                key={index}
                type="button"
                onClick={() => setCurrentSlide(index)}
                aria-label={`Go to slide ${index + 1}`}
                className={`transition-all rounded-full ${
                  index === currentSlide
                    ? "w-6 h-2 bg-primary"
                    : "w-2 h-2 bg-outline-variant hover:bg-outline"
                }`}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {currentSlide > 0 && (
              <button
                type="button"
                onClick={handlePrev}
                className="px-4 py-2 rounded-xl text-xs font-label-md font-semibold text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors"
              >
                Back
              </button>
            )}

            {/* Direct Step Action in Footer for instant execution */}
            {slide.actionType === "sql" ? (
              <button
                type="button"
                onClick={() => handleAction("sql")}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-primary/30 text-primary hover:bg-primary/5 text-xs font-label-md font-semibold transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">add</span>
                <span>Add Connection</span>
              </button>
            ) : slide.actionType === "document" ? (
              <button
                type="button"
                onClick={() => handleAction("document")}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-primary/30 text-primary hover:bg-primary/5 text-xs font-label-md font-semibold transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">upload_file</span>
                <span>Upload Document</span>
              </button>
            ) : null}

            <button
              type="button"
              onClick={handleNext}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-on-primary text-xs font-label-md font-semibold hover:bg-primary-container transition-colors shadow-2xs active:scale-[0.98]"
            >
              <span>
                {currentSlide === GUIDE_SLIDES.length - 1
                  ? "Get Started"
                  : "Next"}
              </span>
              <span className="material-symbols-outlined text-[16px]">
                {currentSlide === GUIDE_SLIDES.length - 1
                  ? "check"
                  : "arrow_forward"}
              </span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
