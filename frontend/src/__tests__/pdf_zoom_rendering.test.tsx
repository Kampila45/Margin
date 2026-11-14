/**
 * Frontend unit tests verifying instant CSS-scaled PDF zoom without blocking spinners
 * and debounced single-pass background rasterization + TextLayer reuse.
 */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfDocumentStage } from "../features/reader/pdf_document_stage";
import {
  DOCUMENT_FORMAT,
  DOCUMENT_STATUS,
  type DocumentResponse,
} from "../types/api_contract_types";

const pdfMocks = vi.hoisted(() => ({
  getDocument: vi.fn(),
  getPage: vi.fn(),
  pageRender: vi.fn(),
  getTextContent: vi.fn(),
  textLayerRender: vi.fn(),
  textLayerUpdate: vi.fn(),
  setLayerDimensions: vi.fn(),
}));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: pdfMocks.getDocument,
  setLayerDimensions: pdfMocks.setLayerDimensions,
  TextLayer: class MockTextLayer {
    render = pdfMocks.textLayerRender;
    update = pdfMocks.textLayerUpdate;
    cancel = vi.fn();
  },
}));

const samplePdfDocument: DocumentResponse = {
  id: "doc-pdf-zoom-1",
  original_filename: "warma.pdf",
  doc_format: DOCUMENT_FORMAT.PDF,
  file_size_bytes: 12000,
  page_count: 3,
  chunk_count: 6,
  status: DOCUMENT_STATUS.READY,
  error_message: null,
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
};

describe("PdfDocumentStage zoom performance", () => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;

  beforeEach(() => {
    vi.clearAllMocks();

    HTMLCanvasElement.prototype.getContext = vi.fn(() => ({
      drawImage: vi.fn(),
    })) as unknown as typeof HTMLCanvasElement.prototype.getContext;

    const mockPage = {
      getViewport: ({ scale }: { scale: number }) => ({
        width: 600 * scale,
        height: 800 * scale,
        scale,
        rotation: 0,
        rawDims: { pageWidth: 600, pageHeight: 800, pageX: 0, pageY: 0 },
      }),
      render: pdfMocks.pageRender.mockImplementation(() => ({
        promise: Promise.resolve(),
        cancel: vi.fn(),
      })),
      getTextContent: pdfMocks.getTextContent.mockResolvedValue({ items: [], styles: {} }),
    };

    pdfMocks.getPage.mockResolvedValue(mockPage);
    pdfMocks.getDocument.mockReturnValue({
      promise: Promise.resolve({
        numPages: 3,
        getPage: pdfMocks.getPage,
        destroy: vi.fn().mockResolvedValue(undefined),
      }),
      destroy: vi.fn().mockResolvedValue(undefined),
    });
    pdfMocks.textLayerRender.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    HTMLCanvasElement.prototype.getContext = originalGetContext;
  });

  it("reuses page + textContent on zoom, avoids blocking spinner, and debounces rapid zoom steps", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PdfDocumentStage document={samplePdfDocument} pageNumber={1} zoomPercentage={100} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(pdfMocks.pageRender).toHaveBeenCalledTimes(1);
      expect(pdfMocks.textLayerRender).toHaveBeenCalledTimes(1);
    });
    expect(screen.queryByLabelText("Rendering page")).not.toBeInTheDocument();

    vi.useFakeTimers();

    rerender(
      <QueryClientProvider client={queryClient}>
        <PdfDocumentStage document={samplePdfDocument} pageNumber={1} zoomPercentage={110} />
      </QueryClientProvider>,
    );
    expect(screen.queryByLabelText("Rendering page")).not.toBeInTheDocument();

    rerender(
      <QueryClientProvider client={queryClient}>
        <PdfDocumentStage document={samplePdfDocument} pageNumber={1} zoomPercentage={120} />
      </QueryClientProvider>,
    );
    rerender(
      <QueryClientProvider client={queryClient}>
        <PdfDocumentStage document={samplePdfDocument} pageNumber={1} zoomPercentage={130} />
      </QueryClientProvider>,
    );

    // Rapid intermediate clicks should not trigger redundant renders yet.
    expect(pdfMocks.pageRender).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Rendering page")).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    expect(pdfMocks.pageRender).toHaveBeenCalledTimes(2);
    expect(pdfMocks.getPage).toHaveBeenCalledTimes(1);
    expect(pdfMocks.getTextContent).toHaveBeenCalledTimes(1);
    expect(pdfMocks.textLayerRender).toHaveBeenCalledTimes(1);
    expect(pdfMocks.textLayerUpdate).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText("Rendering page")).not.toBeInTheDocument();
  });

  it("anchors horizontal scroll to the center when zooming wider than the viewport", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const { container, rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PdfDocumentStage document={samplePdfDocument} pageNumber={1} zoomPercentage={100} />
      </QueryClientProvider>,
    );

    const stage = container.firstElementChild as HTMLDivElement;
    let currentScrollWidth = 600;
    Object.defineProperty(stage, "clientWidth", { configurable: true, get: () => 600 });
    Object.defineProperty(stage, "scrollWidth", {
      configurable: true,
      get: () => currentScrollWidth,
    });

    await waitFor(() => {
      expect(pdfMocks.pageRender).toHaveBeenCalledTimes(1);
    });
    expect(stage.scrollLeft).toBe(0);

    currentScrollWidth = 800;
    rerender(
      <QueryClientProvider client={queryClient}>
        <PdfDocumentStage document={samplePdfDocument} pageNumber={1} zoomPercentage={150} />
      </QueryClientProvider>,
    );

    expect(stage.scrollLeft).toBe(100);
  });

  it("prefetches adjacent pages on idle and switches to cached pages without a rendering spinner", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false, gcTime: 0 } },
    });

    const { rerender } = render(
      <QueryClientProvider client={queryClient}>
        <PdfDocumentStage document={samplePdfDocument} pageNumber={1} zoomPercentage={100} />
      </QueryClientProvider>,
    );

    await waitFor(() => {
      expect(pdfMocks.pageRender).toHaveBeenCalledTimes(1);
      expect(pdfMocks.textLayerRender).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(pdfMocks.pageRender.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    const rendersBeforeJump = pdfMocks.pageRender.mock.calls.length;
    const getPageCallsBeforeJump = pdfMocks.getPage.mock.calls.length;

    rerender(
      <QueryClientProvider client={queryClient}>
        <PdfDocumentStage document={samplePdfDocument} pageNumber={2} zoomPercentage={100} />
      </QueryClientProvider>,
    );

    expect(screen.queryByLabelText("Rendering page")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(pdfMocks.textLayerRender.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    expect(pdfMocks.getPage).toHaveBeenCalledTimes(getPageCallsBeforeJump);
    expect(pdfMocks.pageRender).toHaveBeenCalledTimes(rendersBeforeJump);
    expect(screen.queryByLabelText("Rendering page")).not.toBeInTheDocument();
  });
});
