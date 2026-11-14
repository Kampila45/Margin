/**
 * Dismissible Quickstart Checklist Card rendered on the Overview dashboard.
 * Tracks user progress through the 3 core Margin onboarding milestones.
 */

import { useState } from "react";
import { Link } from "react-router-dom";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";

interface GettingStartedChecklistCardProps {
  documentCount: number;
  conversationCount: number;
  databaseCount: number;
  firstReadyDocumentId: string | null;
}

export function GettingStartedChecklistCard({
  documentCount,
  conversationCount,
  databaseCount,
  firstReadyDocumentId,
}: GettingStartedChecklistCardProps) {
  const setUploadModalOpen = useReaderSelectionStore((s) => s.setUploadModalOpen);
  const setConnectDbModalOpen = useReaderSelectionStore((s) => s.setConnectDbModalOpen);
  const startTour = useReaderSelectionStore((s) => s.startTour);

  const [isDismissed, setIsDismissed] = useState(() => {
    try {
      return localStorage.getItem("margin_checklist_dismissed") === "true";
    } catch {
      return false;
    }
  });

  const handleDismiss = () => {
    try {
      localStorage.setItem("margin_checklist_dismissed", "true");
    } catch {
      // Ignore
    }
    setIsDismissed(true);
  };

  if (isDismissed) {
    return null;
  }

  const tasks = [
    {
      id: "document",
      title: "Index your first document",
      detail: "Upload a PDF, DOCX, or TXT file for passage-grounded AI reading.",
      isComplete: documentCount > 0,
      action: (
        <button
          type="button"
          onClick={() => setUploadModalOpen(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary text-on-primary font-label-md text-xs font-semibold hover:bg-primary-container transition-colors"
        >
          <span className="material-symbols-outlined text-sm">upload_file</span>
          <span>Upload</span>
        </button>
      ),
    },
    {
      id: "reader",
      title: "Ask a grounded margin question",
      detail: "Highlight any passage in the reader to trigger contextual margin notes.",
      isComplete: conversationCount > 0,
      action: firstReadyDocumentId ? (
        <Link
          to={`/reader/${firstReadyDocumentId}`}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant/40 hover:bg-surface-container font-label-md text-xs font-semibold text-on-surface transition-colors"
        >
          <span>Open Reader</span>
          <span className="material-symbols-outlined text-sm">arrow_forward</span>
        </Link>
      ) : null,
    },
    {
      id: "database",
      title: "Connect a PostgreSQL replica",
      detail: "Query tables in plain English and view automated visual charts.",
      isComplete: databaseCount > 0,
      action: (
        <button
          type="button"
          onClick={() => setConnectDbModalOpen(true)}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-outline-variant/40 hover:bg-surface-container font-label-md text-xs font-semibold text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined text-sm">add</span>
          <span>Add Connection</span>
        </button>
      ),
    },
  ];

  const completedCount = tasks.filter((t) => t.isComplete).length;
  const progressPercent = Math.round((completedCount / tasks.length) * 100);

  // If all tasks are completed, automatically hide the card
  if (completedCount === tasks.length) {
    return null;
  }

  return (
    <div className="rounded-2xl bg-surface-container-lowest border border-outline-variant/35 p-5 shadow-2xs space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
            <span className="material-symbols-outlined text-[18px]">checklist</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="font-headline-sm text-sm font-bold text-on-surface">
                Getting Started with Margin
              </h3>
              <span className="font-code-sm text-[10px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                {completedCount} of {tasks.length} completed
              </span>
            </div>
            <p className="font-body-dense text-[11px] text-on-surface-variant">
              Complete these steps to explore both unstructured documents and structured SQL analysis.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={startTour}
            className="px-2.5 py-1 rounded-lg text-xs font-label-md text-primary hover:bg-primary/5 transition-colors font-medium flex items-center gap-1"
          >
            <span className="material-symbols-outlined text-sm">explore</span>
            <span>Take Tour</span>
          </button>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label="Dismiss checklist"
            title="Dismiss checklist"
            className="w-7 h-7 rounded-lg flex items-center justify-center text-outline hover:text-on-surface hover:bg-surface-container transition-colors"
          >
            <span className="material-symbols-outlined text-base">close</span>
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="w-full bg-surface-container-high rounded-full h-1 overflow-hidden">
        <div
          className="bg-primary h-1 rounded-full transition-all duration-300"
          style={{ width: `${progressPercent}%` }}
        />
      </div>

      {/* Tasks Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {tasks.map((task) => (
          <div
            key={task.id}
            className={`p-3 rounded-xl border transition-all flex flex-col justify-between gap-2.5 ${
              task.isComplete
                ? "bg-surface-container-low/40 border-outline-variant/20 opacity-80"
                : "bg-surface-container-lowest border-outline-variant/35 shadow-2xs"
            }`}
          >
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span
                  className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 text-[10px] ${
                    task.isComplete
                      ? "bg-primary text-on-primary"
                      : "border border-outline text-transparent"
                  }`}
                >
                  <span className="material-symbols-outlined text-[12px] font-bold">check</span>
                </span>
                <span
                  className={`font-label-md text-xs font-semibold ${
                    task.isComplete ? "line-through text-outline" : "text-on-surface"
                  }`}
                >
                  {task.title}
                </span>
              </div>
              <p className="font-body-dense text-[11px] text-on-surface-variant pl-6 leading-relaxed">
                {task.detail}
              </p>
            </div>

            {!task.isComplete && task.action && (
              <div className="pl-6 pt-1 flex justify-start">{task.action}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

