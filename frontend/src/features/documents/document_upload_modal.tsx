/**
 * Drag-and-drop document upload modal enforcing client-side PDF/DOCX/TXT extension and size validation.
 */

import { type ChangeEvent, type DragEvent, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LoadingSpinner } from "../../components/ui/loading_spinner";
import { formatFileSize } from "../../components/ui/status_pill_badge";
import { getUserFriendlyErrorMessage } from "../../services/margin_http_client";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";
import { useUploadDocumentMutation } from "./use_document_queries";

const ALLOWED_EXTENSIONS = [".pdf", ".docx", ".txt"];
const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

export function DocumentUploadModal() {
  const isOpen = useReaderSelectionStore((s) => s.isUploadModalOpen);
  const setUploadModalOpen = useReaderSelectionStore((s) => s.setUploadModalOpen);
  const setActiveDocument = useReaderSelectionStore((s) => s.setActiveDocument);
  const uploadMutation = useUploadDocumentMutation();
  const navigate = useNavigate();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  if (!isOpen) {
    return null;
  }

  const validateAndSelectFile = (file: File | undefined) => {
    setValidationError(null);
    if (!file) {
      return;
    }
    const lowerName = file.name.toLowerCase();
    const hasAllowedExt = ALLOWED_EXTENSIONS.some((ext) => lowerName.endsWith(ext));
    if (!hasAllowedExt) {
      setValidationError("Unsupported format. Please select a PDF, DOCX, or TXT document.");
      setSelectedFile(null);
      return;
    }
    if (file.size === 0) {
      setValidationError("The selected file is empty (0 bytes).");
      setSelectedFile(null);
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setValidationError("File exceeds the 20 MB maximum upload limit.");
      setSelectedFile(null);
      return;
    }
    setSelectedFile(file);
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    validateAndSelectFile(event.target.files?.[0]);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setIsDragging(false);
    validateAndSelectFile(event.dataTransfer.files?.[0]);
  };

  const handleUploadSubmit = async () => {
    if (!selectedFile) {
      return;
    }
    setValidationError(null);
    try {
      const uploaded = await uploadMutation.mutateAsync(selectedFile);
      setSelectedFile(null);
      setUploadModalOpen(false);
      setActiveDocument(uploaded.id, 1);
      navigate(`/reader/${uploaded.id}`);
    } catch (error: unknown) {
      setValidationError(
        getUserFriendlyErrorMessage(
          error,
          "We couldn't upload this document right now. Please try again in a moment.",
        ),
      );
    }
  };

  const handleClose = () => {
    if (uploadMutation.isPending) {
      return;
    }
    setSelectedFile(null);
    setValidationError(null);
    setUploadModalOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 backdrop-blur-xs p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="upload-modal-title"
    >
      <div className="w-full max-w-lg rounded-xl bg-surface-container-lowest border border-outline-variant/40 p-6 shadow-xl space-y-5">
        <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-primary-fixed text-primary flex items-center justify-center">
              <span className="material-symbols-outlined">upload_file</span>
            </div>
            <div>
              <h2
                id="upload-modal-title"
                className="font-headline-sm text-headline-sm font-semibold text-on-surface"
              >
                Add Document to Library
              </h2>
              <p className="font-body-dense text-xs text-on-surface-variant">
                Prepares your document for reading, highlighting, and source-cited Q&amp;A.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close upload dialog"
            className="p-1.5 rounded-lg text-on-surface-variant hover:bg-surface-container hover:text-on-surface"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        {/* Dropzone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`cursor-pointer rounded-xl border-2 border-dashed p-8 text-center transition-colors ${
            isDragging
              ? "border-primary bg-primary-fixed/20"
              : "border-outline-variant/50 bg-surface-container-low hover:border-primary/60"
          }`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,text/plain,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="mx-auto w-12 h-12 rounded-full bg-surface-container-lowest border border-outline-variant/30 flex items-center justify-center text-primary mb-3 shadow-xs">
            <span className="material-symbols-outlined">cloud_upload</span>
          </div>
          <p className="font-label-md text-label-md text-on-surface">
            Click to choose a file or drag and drop here
          </p>
          <p className="font-code-sm text-code-sm text-on-surface-variant mt-1">
            Supported: PDF, DOCX, TXT • Max 20 MB • Up to 150 pages
          </p>
        </div>

        {selectedFile && (
          <div className="flex items-center justify-between px-3.5 py-2.5 rounded-lg bg-surface-container border border-outline-variant/30">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="material-symbols-outlined text-primary">description</span>
              <div className="min-w-0">
                <p className="font-label-md text-label-md text-on-surface truncate">
                  {selectedFile.name}
                </p>
                <p className="font-code-sm text-code-sm text-on-surface-variant">
                  {formatFileSize(selectedFile.size)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedFile(null)}
              aria-label="Remove selected file"
              className="p-1 rounded text-on-surface-variant hover:text-error"
            >
              <span className="material-symbols-outlined text-base">delete</span>
            </button>
          </div>
        )}

        {validationError && (
          <div
            role="alert"
            className="p-3 rounded-lg bg-error-container text-on-error-container font-body-dense text-body-dense flex items-start gap-2"
          >
            <span className="material-symbols-outlined text-base shrink-0 mt-0.5">error</span>
            <span>{validationError}</span>
          </div>
        )}

        <div className="flex items-center justify-end gap-2.5 pt-2">
          <button
            type="button"
            disabled={uploadMutation.isPending}
            onClick={handleClose}
            className="px-4 py-2 rounded-lg border border-outline-variant/50 text-on-surface font-label-md text-label-md hover:bg-surface-container disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!selectedFile || uploadMutation.isPending}
            onClick={() => void handleUploadSubmit()}
            className="px-4 py-2 rounded-lg bg-primary text-on-primary font-label-md text-label-md hover:bg-primary-container transition-colors disabled:opacity-50 flex items-center gap-2"
          >
            {uploadMutation.isPending ? (
              <>
                <LoadingSpinner size="xs" variant="onPrimary" ariaLabel="Indexing Document" />
                <span>Indexing Document…</span>
              </>
            ) : (
              <>
                <span className="material-symbols-outlined text-base">auto_awesome</span>
                <span>Upload &amp; Open Reader</span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

