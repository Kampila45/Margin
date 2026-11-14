/**
 * Encapsulated document page stage rendering PDF pages directly on a high-DPI PDF.js canvas
 * with an interactive selectable text layer overlay and floating AI toolbar.
 * Falls back to a page sheet for non-PDF documents (DOCX / TXT).
 */

import type {
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport,
  TextLayer,
} from "pdfjs-dist";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import {
  type CSSProperties,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { LoadingSpinner } from "../../components/ui/loading_spinner";
import { getDocumentRawFileStreamUrl } from "../../services/document_api_client";
import { getOrCreateClientSessionId } from "../../services/margin_http_client";
import { useReaderSelectionStore } from "../../stores/reader_selection_store";
import {
  DOCUMENT_FORMAT,
  type DocumentResponse,
} from "../../types/api_contract_types";
import { useDocumentPageQuery } from "../documents/use_document_queries";
import { FloatingSelectionToolbar } from "./floating_selection_toolbar";

interface PdfDocumentStageProps {
  document: DocumentResponse;
  pageNumber: number;
  zoomPercentage: number;
}

const PDF_ZOOM_RENDER_DEBOUNCE_MS = 120;
const PDF_PREFETCH_IDLE_DELAY_MS = 250;
const MAX_CACHED_PDF_PAGES = 8;
const MAX_PDF_DEVICE_PIXEL_RATIO = 2;

type PdfJsModule = typeof import("pdfjs-dist");
type PdfTextContent = Awaited<ReturnType<PDFPageProxy["getTextContent"]>>;

interface CachedPdfPageEntry {
  page: PDFPageProxy;
  unscaledWidth: number;
  unscaledHeight: number;
  fitScale: number;
  scale: number;
  width: number;
  height: number;
  viewport: PageViewport;
  pdfjs: PdfJsModule;
  canvas: HTMLCanvasElement;
  textContent: PdfTextContent | null;
}

function storeCachedPdfPage(
  cache: Map<string, CachedPdfPageEntry>,
  key: string,
  entry: CachedPdfPageEntry,
): void {
  if (cache.has(key)) {
    cache.delete(key);
  }
  cache.set(key, entry);
  while (cache.size > MAX_CACHED_PDF_PAGES) {
    const oldestKey = cache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    const oldest = cache.get(oldestKey);
    cache.delete(oldestKey);
    if (oldest && oldest.canvas !== entry.canvas) {
      oldest.canvas.width = 0;
      oldest.canvas.height = 0;
    }
  }
}

interface PageGeometry {
  docId: string;
  pageNumber: number;
  unscaledWidth: number;
  unscaledHeight: number;
  fitScale: number;
}

interface RenderedPageDims {
  docId: string;
  pageNumber: number;
  width: number;
  height: number;
  scale: number;
}

interface PendingCanvasSwap {
  docId: string;
  pageNumber: number;
  scale: number;
  viewport: PageViewport;
  pdfjs: PdfJsModule;
  scratchCanvas: HTMLCanvasElement;
}

function computePdfFitScale(containerWidth: number, unscaledWidth: number): number {
  const availableWidth =
    containerWidth > 160 ? containerWidth - 96 : unscaledWidth * 0.9;
  return Math.min(0.92, Math.max(0.55, availableWidth / unscaledWidth));
}

function getOrCreateScratchCanvas(
  scratchCanvasRef: { current: HTMLCanvasElement | null },
): HTMLCanvasElement {
  if (!scratchCanvasRef.current) {
    scratchCanvasRef.current = window.document.createElement("canvas");
  }
  return scratchCanvasRef.current;
}

function renderPdfPageToScratchCanvas(
  page: PDFPageProxy,
  viewport: PageViewport,
  scratchCanvas: HTMLCanvasElement,
): { cancel: () => void; promise: Promise<void> } | null {
  const context = scratchCanvas.getContext("2d");
  if (!context) {
    return null;
  }

  const outputScale = Math.min(window.devicePixelRatio || 1, MAX_PDF_DEVICE_PIXEL_RATIO);
  scratchCanvas.width = Math.max(1, Math.floor(viewport.width * outputScale));
  scratchCanvas.height = Math.max(1, Math.floor(viewport.height * outputScale));

  const transform =
    outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : undefined;

  return page.render({
    canvasContext: context,
    transform,
    viewport,
  });
}

function normalizeTextForHighlight(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function paragraphMatchesPassage(
  paragraph: string,
  passage: string | null | undefined,
): boolean {
  const normPara = normalizeTextForHighlight(paragraph);
  const normTarget = normalizeTextForHighlight(passage ?? "");
  if (normTarget.length < 6 || normPara.length < 6) {
    return false;
  }

  if (normPara.includes(normTarget) || normTarget.includes(normPara)) {
    return true;
  }

  const targetWords = normTarget.split(" ").filter(Boolean);
  const paraWords = normPara.split(" ").filter(Boolean);
  if (targetWords.length < 4 || paraWords.length < 4) {
    return false;
  }

  for (let n = Math.min(6, targetWords.length); n >= 4; n -= 1) {
    for (let i = 0; i <= targetWords.length - n; i += 1) {
      const ngram = targetWords.slice(i, i + n).join(" ");
      if (ngram.length < 18) {
        continue;
      }
      if (normPara.includes(ngram)) {
        return true;
      }
    }
  }

  return false;
}

export function highlightPassageInTextLayer(
  container: HTMLElement,
  passageText: string | null | undefined,
): HTMLSpanElement | null {
  const allSpans = Array.from(container.querySelectorAll<HTMLSpanElement>("span"));
  for (const span of allSpans) {
    span.classList.remove("margin-pdf-citation-highlight");
  }

  const targetNorm = normalizeTextForHighlight(passageText ?? "");
  if (!targetNorm || allSpans.length === 0) {
    return null;
  }

  const spanEntries: Array<{
    span: HTMLSpanElement;
    norm: string;
    start: number;
    end: number;
  }> = [];
  const normParts: string[] = [];
  let cursor = 0;

  for (const span of allSpans) {
    if (span.children.length > 0) {
      continue;
    }
    const norm = normalizeTextForHighlight(span.textContent ?? "");
    if (!norm) {
      continue;
    }
    const start = cursor;
    const end = start + norm.length;
    spanEntries.push({ span, norm, start, end });
    normParts.push(norm);
    cursor = end + 1;
  }

  if (spanEntries.length === 0) {
    return null;
  }

  const fullPageNorm = normParts.join(" ");

  function splitSentences(text: string): string[] {
    return text
      .split(/(?<=[.!?])\s+/)
      .map((s) => s.trim())
      .filter((s) => s.length >= 8);
  }

  const targetSentences = splitSentences(passageText ?? "");

  let matchStart = -1;
  let matchEnd = -1;

  // Tier 1: Sentence-level exact matching — highlight only the sentences that
  // appear verbatim on the page (avoids over-highlighting the whole chunk).
  for (const sentence of targetSentences) {
    const sentenceNorm = normalizeTextForHighlight(sentence);
    if (sentenceNorm.length < 12) {
      continue;
    }
    const idx = fullPageNorm.indexOf(sentenceNorm);
    if (idx !== -1) {
      if (matchStart === -1) {
        matchStart = idx;
        matchEnd = idx + sentenceNorm.length;
      } else {
        matchStart = Math.min(matchStart, idx);
        matchEnd = Math.max(matchEnd, idx + sentenceNorm.length);
      }
    }
  }

  // Tier 1b: If no individual sentence matched, try the full excerpt verbatim.
  if (matchStart === -1) {
    const fullIdx = fullPageNorm.indexOf(targetNorm);
    if (fullIdx !== -1) {
      matchStart = fullIdx;
      matchEnd = fullIdx + targetNorm.length;
    }
  }

  // Tier 2: If the claim has a `Label: Value` prefix, check the value portion.
  if (matchStart === -1 && passageText && passageText.includes(":")) {
    const colonIdx = passageText.indexOf(":");
    const afterColonNorm = normalizeTextForHighlight(passageText.slice(colonIdx + 1));
    if (afterColonNorm.length >= 4) {
      const valueIdx = fullPageNorm.indexOf(afterColonNorm);
      if (valueIdx !== -1) {
        matchStart = valueIdx;
        matchEnd = valueIdx + afterColonNorm.length;
      }
    }
  }

  // Tier 3: N-gram phrase cluster matching (tighter window to avoid over-highlighting).
  if (matchStart === -1) {
    const words = targetNorm.split(" ").filter(Boolean);
    if (words.length >= 3) {
      const ngramHits: Array<{ start: number; end: number }> = [];
      const ngramSize = words.length >= 5 ? 5 : 4;
      for (let i = 0; i <= words.length - ngramSize; i += 1) {
        const phrase = words.slice(i, i + ngramSize).join(" ");
        if (phrase.length < 14) {
          continue;
        }
        const idx = fullPageNorm.indexOf(phrase);
        if (idx !== -1) {
          ngramHits.push({ start: idx, end: idx + phrase.length });
        }
      }

      if (ngramHits.length === 0 && ngramSize > 4) {
        for (let i = 0; i <= words.length - 4; i += 1) {
          const phrase = words.slice(i, i + 4).join(" ");
          if (phrase.length < 14) {
            continue;
          }
          const idx = fullPageNorm.indexOf(phrase);
          if (idx !== -1) {
            ngramHits.push({ start: idx, end: idx + phrase.length });
          }
        }
      }

      if (ngramHits.length > 0 && ngramHits[0]) {
        const firstHit = ngramHits[0];
        matchStart = firstHit.start;
        matchEnd = firstHit.end;
        const maxWindow = Math.max(160, targetNorm.length * 0.6);
        for (const hit of ngramHits) {
          if (hit.start >= firstHit.start && hit.end - firstHit.start <= maxWindow) {
            matchEnd = Math.max(matchEnd, hit.end);
          }
        }
      }
    }
  }

  const matchedSpans: HTMLSpanElement[] = [];
  if (matchStart !== -1 && matchEnd > matchStart) {
    for (const entry of spanEntries) {
      if (entry.end > matchStart && entry.start < matchEnd) {
        matchedSpans.push(entry.span);
      }
    }
  } else {
    for (const entry of spanEntries) {
      if (entry.norm.length >= 20 && targetNorm.includes(entry.norm)) {
        matchedSpans.push(entry.span);
      }
    }
  }

  for (const span of matchedSpans) {
    span.classList.add("margin-pdf-citation-highlight");
  }

  return matchedSpans[0] ?? null;
}

export function PdfDocumentStage({
  document,
  pageNumber,
  zoomPercentage,
}: PdfDocumentStageProps) {
  const stageContainerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const pdfjsRef = useRef<PdfJsModule | null>(null);
  const loadedPdfCacheRef = useRef<{ docId: string; pdfDoc: PDFDocumentProxy } | null>(
    null,
  );
  const loadedPageRef = useRef<{
    docId: string;
    pageNumber: number;
    page: PDFPageProxy;
    fitScale: number;
  } | null>(null);
  const textLayerInstanceRef = useRef<{
    docId: string;
    pageNumber: number;
    instance: TextLayer;
    renderedScale: number;
  } | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const renderedPageCacheRef = useRef<Map<string, CachedPdfPageEntry>>(new Map());
  const pendingCanvasSwapRef = useRef<PendingCanvasSwap | null>(null);
  const latestZoomRef = useRef(zoomPercentage);
  latestZoomRef.current = zoomPercentage;
  const lastScrollPosRef = useRef({ left: 0, top: 0 });
  const prevZoomScrollRef = useRef<{
    docId: string;
    pageNumber: number;
    scrollWidth: number;
    scrollHeight: number;
  } | null>(null);

  const capturePassageSelection = useReaderSelectionStore((s) => s.capturePassageSelection);
  const activeSelection = useReaderSelectionStore((s) => s.activeSelection);
  const activeCitationHighlight = useReaderSelectionStore(
    (s) => s.activeCitationHighlight,
  );
  const clearCitationHighlight = useReaderSelectionStore(
    (s) => s.clearCitationHighlight,
  );

  const [hoveredSelectionText, setHoveredSelectionText] = useState("");
  const [toolbarCoords, setToolbarCoords] = useState<{ top: number; left: number } | null>(
    null,
  );
  const [isPdfRendering, setIsPdfRendering] = useState(false);
  const [pdfRenderError, setPdfRenderError] = useState<string | null>(null);
  const [textLayerRenderTick, setTextLayerRenderTick] = useState(0);
  const [pageGeometry, setPageGeometry] = useState<PageGeometry | null>(null);
  const [renderedDims, setRenderedDims] = useState<RenderedPageDims | null>(null);

  const isPdfDocument = document.doc_format === DOCUMENT_FORMAT.PDF;
  const pageQuery = useDocumentPageQuery(
    document.id,
    pageNumber,
    !isPdfDocument || Boolean(pdfRenderError),
  );

  // Release cached PDF.js document worker/memory and scratch bitmap when switching documents or unmounting.
  useEffect(() => {
    return () => {
      if (loadedPdfCacheRef.current?.docId === document.id) {
        const cachedProxy = loadedPdfCacheRef.current.pdfDoc;
        loadedPdfCacheRef.current = null;
        void cachedProxy.destroy();
      }
      loadedPageRef.current = null;
      for (const entry of renderedPageCacheRef.current.values()) {
        entry.canvas.width = 0;
        entry.canvas.height = 0;
      }
      renderedPageCacheRef.current.clear();
      if (scratchCanvasRef.current) {
        scratchCanvasRef.current.width = 0;
        scratchCanvasRef.current.height = 0;
        scratchCanvasRef.current = null;
      }
    };
  }, [document.id]);

  // Effect 1: Load PDF page, render initial crisp canvas, and build the selectable TextLayer once per page.
  useEffect(() => {
    if (!isPdfDocument) {
      setPdfRenderError(null);
      setPageGeometry(null);
      setRenderedDims(null);
      return;
    }

    let isCancelled = false;
    let prefetchTimerId: number | null = null;
    let activeLoadingTask: { destroy: () => Promise<void> } | null = null;
    let activeRenderTask: { cancel: () => void } | null = null;
    let activePrefetchTask: { cancel: () => void } | null = null;
    let activeTextLayer: { cancel: () => void } | null = null;

    pendingCanvasSwapRef.current = null;
    setRenderedDims(null);
    if (textLayerRef.current) {
      textLayerRef.current.innerHTML = "";
    }
    textLayerInstanceRef.current = null;

    async function mountTextLayer(
      pdfjs: PdfJsModule,
      page: PDFPageProxy,
      viewport: PageViewport,
      textContent: PdfTextContent | null,
      fitScale: number,
      initialScale: number,
    ) {
      const textLayerContainer = textLayerRef.current;
      if (!textLayerContainer || !textContent) {
        return;
      }
      try {
        textLayerContainer.innerHTML = "";
        pdfjs.setLayerDimensions(textLayerContainer, viewport);
        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerContainer,
          viewport,
        });
        activeTextLayer = textLayer;
        textLayerInstanceRef.current = {
          docId: document.id,
          pageNumber,
          instance: textLayer,
          renderedScale: initialScale,
        };
        await textLayer.render();
        if (!isCancelled) {
          const settledScale = (latestZoomRef.current / 100) * fitScale;
          if (Math.abs(settledScale - initialScale) > 0.0001) {
            const settledViewport = page.getViewport({ scale: settledScale });
            pdfjs.setLayerDimensions(textLayerContainer, settledViewport);
            textLayer.update({ viewport: settledViewport });
            textLayerInstanceRef.current.renderedScale = settledScale;
          }
          setTextLayerRenderTick((prev) => prev + 1);
        }
      } catch {
        // Non-fatal: canvas is already rendered even if text layer is cancelled.
      }
    }

    function scheduleAdjacentPrefetch(
      pdfjs: PdfJsModule,
      pdfDoc: PDFDocumentProxy,
      currentSafePage: number,
    ) {
      if (isCancelled || pdfDoc.numPages <= 1) {
        return;
      }
      prefetchTimerId = window.setTimeout(() => {
        void (async () => {
          const candidates = [currentSafePage + 1, currentSafePage - 1, currentSafePage + 2]
            .filter((p) => p >= 1 && p <= pdfDoc.numPages && p !== currentSafePage);

          for (const candidatePage of candidates) {
            if (isCancelled) return;
            const candidateKey = `${document.id}:${candidatePage}`;
            if (renderedPageCacheRef.current.has(candidateKey)) {
              continue;
            }
            try {
              const adjPage = await pdfDoc.getPage(candidatePage);
              if (isCancelled) return;
              const adjUnscaled = adjPage.getViewport({ scale: 1 });
              const adjFitScale = computePdfFitScale(
                stageContainerRef.current?.clientWidth ?? 0,
                adjUnscaled.width,
              );
              const adjScale = (latestZoomRef.current / 100) * adjFitScale;
              const adjViewport = adjPage.getViewport({ scale: adjScale });
              const adjCanvas = window.document.createElement("canvas");
              const adjRenderTask = renderPdfPageToScratchCanvas(adjPage, adjViewport, adjCanvas);
              if (!adjRenderTask) {
                continue;
              }
              activePrefetchTask = adjRenderTask;
              const [_, adjTextContent] = await Promise.all([
                adjRenderTask.promise,
                adjPage.getTextContent().catch(() => null),
              ]);
              if (isCancelled) {
                adjCanvas.width = 0;
                adjCanvas.height = 0;
                return;
              }
              storeCachedPdfPage(renderedPageCacheRef.current, candidateKey, {
                page: adjPage,
                unscaledWidth: adjUnscaled.width,
                unscaledHeight: adjUnscaled.height,
                fitScale: adjFitScale,
                scale: adjScale,
                width: Math.floor(adjViewport.width),
                height: Math.floor(adjViewport.height),
                viewport: adjViewport,
                pdfjs,
                canvas: adjCanvas,
                textContent: adjTextContent,
              });
            } catch {
              // Background prefetch errors are non-fatal.
            } finally {
              activePrefetchTask = null;
            }
          }
        })();
      }, PDF_PREFETCH_IDLE_DELAY_MS);
    }

    async function loadAndRenderInitialPage() {
      const cacheKey = `${document.id}:${pageNumber}`;
      const cached = renderedPageCacheRef.current.get(cacheKey);
      const cachedPdfDoc =
        loadedPdfCacheRef.current?.docId === document.id ? loadedPdfCacheRef.current.pdfDoc : null;

      if (cached && cached.canvas.width > 0 && cachedPdfDoc) {
        // Touch LRU and immediately swap the pre-rendered bitmap + TextLayer without a spinner.
        storeCachedPdfPage(renderedPageCacheRef.current, cacheKey, cached);
        loadedPageRef.current = {
          docId: document.id,
          pageNumber,
          page: cached.page,
          fitScale: cached.fitScale,
        };
        setPdfRenderError(null);
        setPageGeometry({
          docId: document.id,
          pageNumber,
          unscaledWidth: cached.unscaledWidth,
          unscaledHeight: cached.unscaledHeight,
          fitScale: cached.fitScale,
        });
        pendingCanvasSwapRef.current = {
          docId: document.id,
          pageNumber,
          scale: cached.scale,
          viewport: cached.viewport,
          pdfjs: cached.pdfjs,
          scratchCanvas: cached.canvas,
        };
        setRenderedDims({
          docId: document.id,
          pageNumber,
          width: cached.width,
          height: cached.height,
          scale: cached.scale,
        });
        setIsPdfRendering(false);

        const textContent =
          cached.textContent ?? (await cached.page.getTextContent().catch(() => null));
        if (isCancelled) return;
        if (!cached.textContent && textContent) {
          cached.textContent = textContent;
        }
        await mountTextLayer(
          cached.pdfjs,
          cached.page,
          cached.viewport,
          textContent,
          cached.fitScale,
          cached.scale,
        );
        scheduleAdjacentPrefetch(cached.pdfjs, cachedPdfDoc, pageNumber);
        return;
      }

      try {
        setIsPdfRendering(true);
        setPdfRenderError(null);

        let pdfjs = pdfjsRef.current;
        if (!pdfjs) {
          pdfjs = await import("pdfjs-dist");
          pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
          pdfjsRef.current = pdfjs;
        }
        if (isCancelled) return;

        let pdfDoc: PDFDocumentProxy;
        if (loadedPdfCacheRef.current?.docId === document.id) {
          pdfDoc = loadedPdfCacheRef.current.pdfDoc;
        } else {
          if (loadedPdfCacheRef.current) {
            const staleProxy = loadedPdfCacheRef.current.pdfDoc;
            loadedPdfCacheRef.current = null;
            void staleProxy.destroy();
          }
          const loadingTask = pdfjs.getDocument({
            url: getDocumentRawFileStreamUrl(document.id),
            httpHeaders: {
              "X-Session-ID": getOrCreateClientSessionId(),
            },
            withCredentials: true,
          });
          activeLoadingTask = loadingTask;
          pdfDoc = await loadingTask.promise;
          if (isCancelled) {
            void pdfDoc.destroy();
            return;
          }
          loadedPdfCacheRef.current = { docId: document.id, pdfDoc };
        }

        const safePage = Math.min(Math.max(1, pageNumber), pdfDoc.numPages);
        const page = await pdfDoc.getPage(safePage);
        if (isCancelled) return;

        const unscaledViewport = page.getViewport({ scale: 1 });
        const fitScale = computePdfFitScale(
          stageContainerRef.current?.clientWidth ?? 0,
          unscaledViewport.width,
        );
        loadedPageRef.current = {
          docId: document.id,
          pageNumber,
          page,
          fitScale,
        };
        setPageGeometry({
          docId: document.id,
          pageNumber,
          unscaledWidth: unscaledViewport.width,
          unscaledHeight: unscaledViewport.height,
          fitScale,
        });

        const initialScale = (latestZoomRef.current / 100) * fitScale;
        const viewport = page.getViewport({ scale: initialScale });
        const pageCanvas = window.document.createElement("canvas");
        const renderTask = renderPdfPageToScratchCanvas(page, viewport, pageCanvas);
        if (!renderTask) {
          return;
        }
        activeRenderTask = renderTask;
        const [, textContent] = await Promise.all([
          renderTask.promise,
          page.getTextContent().catch(() => null),
        ]);
        if (isCancelled) {
          pageCanvas.width = 0;
          pageCanvas.height = 0;
          return;
        }

        const initialWidth = Math.floor(viewport.width);
        const initialHeight = Math.floor(viewport.height);
        storeCachedPdfPage(renderedPageCacheRef.current, cacheKey, {
          page,
          unscaledWidth: unscaledViewport.width,
          unscaledHeight: unscaledViewport.height,
          fitScale,
          scale: initialScale,
          width: initialWidth,
          height: initialHeight,
          viewport,
          pdfjs,
          canvas: pageCanvas,
          textContent,
        });

        pendingCanvasSwapRef.current = {
          docId: document.id,
          pageNumber,
          scale: initialScale,
          viewport,
          pdfjs,
          scratchCanvas: pageCanvas,
        };
        setRenderedDims({
          docId: document.id,
          pageNumber,
          width: initialWidth,
          height: initialHeight,
          scale: initialScale,
        });
        setIsPdfRendering(false);

        await mountTextLayer(pdfjs, page, viewport, textContent, fitScale, initialScale);
        scheduleAdjacentPrefetch(pdfjs, pdfDoc, safePage);
      } catch (err: unknown) {
        const errName =
          typeof err === "object" && err !== null && "name" in err
            ? String((err as { name?: unknown }).name)
            : "";
        if (!isCancelled && errName !== "RenderingCancelledException") {
          setPdfRenderError("Could not render PDF canvas for this page.");
        }
      } finally {
        if (!isCancelled) {
          setIsPdfRendering(false);
        }
      }
    }

    void loadAndRenderInitialPage();
    return () => {
      isCancelled = true;
      if (prefetchTimerId !== null) {
        window.clearTimeout(prefetchTimerId);
      }
      activeLoadingTask?.destroy().catch(() => {});
      activeRenderTask?.cancel();
      activePrefetchTask?.cancel();
      activeTextLayer?.cancel();
    };
  }, [document.id, isPdfDocument, pageNumber]);

  // Effect 2: Debounced background re-rasterization when zooming an already-loaded page (no spinner or canvas blanking).
  useEffect(() => {
    if (!isPdfDocument || !pageGeometry || !renderedDims) {
      return;
    }
    if (
      pageGeometry.docId !== document.id ||
      pageGeometry.pageNumber !== pageNumber ||
      renderedDims.docId !== document.id ||
      renderedDims.pageNumber !== pageNumber
    ) {
      return;
    }

    const loaded = loadedPageRef.current;
    const pdfjs = pdfjsRef.current;
    if (!loaded || loaded.docId !== document.id || loaded.pageNumber !== pageNumber || !pdfjs) {
      return;
    }

    const targetScale = (zoomPercentage / 100) * pageGeometry.fitScale;
    if (Math.abs(targetScale - renderedDims.scale) < 0.0001) {
      return;
    }

    let isCancelled = false;
    let activeRenderTask: { cancel: () => void } | null = null;
    const cachedPage = loaded.page;
    const cachedPdfjs = pdfjs;

    const timerId = window.setTimeout(() => {
      async function rerenderAtTargetZoom() {
        try {
          const viewport = cachedPage.getViewport({ scale: targetScale });
          const scratchCanvas = getOrCreateScratchCanvas(scratchCanvasRef);
          const renderTask = renderPdfPageToScratchCanvas(cachedPage, viewport, scratchCanvas);
          if (!renderTask) {
            return;
          }
          activeRenderTask = renderTask;
          await renderTask.promise;
          if (isCancelled) return;

          const existingCached = renderedPageCacheRef.current.get(`${document.id}:${pageNumber}`);
          if (existingCached) {
            const zoomedCacheCanvas = window.document.createElement("canvas");
            zoomedCacheCanvas.width = scratchCanvas.width;
            zoomedCacheCanvas.height = scratchCanvas.height;
            const zoomedCtx = zoomedCacheCanvas.getContext("2d");
            zoomedCtx?.drawImage(scratchCanvas, 0, 0);
            existingCached.canvas.width = 0;
            existingCached.canvas.height = 0;
            storeCachedPdfPage(renderedPageCacheRef.current, `${document.id}:${pageNumber}`, {
              ...existingCached,
              scale: targetScale,
              width: Math.floor(viewport.width),
              height: Math.floor(viewport.height),
              viewport,
              canvas: zoomedCacheCanvas,
            });
          }

          pendingCanvasSwapRef.current = {
            docId: document.id,
            pageNumber,
            scale: targetScale,
            viewport,
            pdfjs: cachedPdfjs,
            scratchCanvas,
          };
          setRenderedDims({
            docId: document.id,
            pageNumber,
            width: Math.floor(viewport.width),
            height: Math.floor(viewport.height),
            scale: targetScale,
          });
        } catch (err: unknown) {
          const errName =
            typeof err === "object" && err !== null && "name" in err
              ? String((err as { name?: unknown }).name)
              : "";
          if (!isCancelled && errName !== "RenderingCancelledException") {
            setPdfRenderError("Could not render PDF canvas for this page.");
          }
        }
      }

      void rerenderAtTargetZoom();
    }, PDF_ZOOM_RENDER_DEBOUNCE_MS);

    return () => {
      isCancelled = true;
      window.clearTimeout(timerId);
      activeRenderTask?.cancel();
    };
  }, [document.id, isPdfDocument, pageGeometry, pageNumber, renderedDims, zoomPercentage]);

  // Atomically copy the finished offscreen bitmap and sync TextLayer scale right before browser paint.
  useLayoutEffect(() => {
    const swap = pendingCanvasSwapRef.current;
    const canvas = canvasRef.current;
    if (!swap || !canvas || !renderedDims) {
      return;
    }
    if (
      swap.docId !== renderedDims.docId ||
      swap.pageNumber !== renderedDims.pageNumber ||
      Math.abs(swap.scale - renderedDims.scale) > 0.0001
    ) {
      return;
    }

    pendingCanvasSwapRef.current = null;
    const context = canvas.getContext("2d");
    if (context && swap.scratchCanvas.width > 0 && swap.scratchCanvas.height > 0) {
      canvas.width = swap.scratchCanvas.width;
      canvas.height = swap.scratchCanvas.height;
      context.drawImage(swap.scratchCanvas, 0, 0);
    }

    const textLayerContainer = textLayerRef.current;
    const activeTextLayer = textLayerInstanceRef.current;
    if (
      textLayerContainer &&
      activeTextLayer &&
      activeTextLayer.docId === renderedDims.docId &&
      activeTextLayer.pageNumber === renderedDims.pageNumber &&
      Math.abs(activeTextLayer.renderedScale - renderedDims.scale) > 0.0001
    ) {
      swap.pdfjs.setLayerDimensions(textLayerContainer, swap.viewport);
      activeTextLayer.instance.update({ viewport: swap.viewport });
      activeTextLayer.renderedScale = renderedDims.scale;
    }
  }, [renderedDims]);

  // Apply text-layer highlight and scroll into view when a citation or selection is active on this page.
  const activeCitationOnPage =
    activeCitationHighlight &&
    activeCitationHighlight.document_id === document.id &&
    (activeCitationHighlight.page_number ?? 1) === pageNumber
      ? activeCitationHighlight
      : null;

  const activeSelectionOnPage =
    activeSelection &&
    activeSelection.document_id === document.id &&
    activeSelection.page_number === pageNumber
      ? activeSelection
      : null;

  const targetPassageToHighlight =
    activeCitationOnPage?.excerpt ?? activeSelectionOnPage?.selected_text ?? null;

  useEffect(() => {
    const container = textLayerRef.current;
    if (!container) {
      return;
    }
    const firstMatchedSpan = highlightPassageInTextLayer(
      container,
      targetPassageToHighlight,
    );
    if (firstMatchedSpan) {
      firstMatchedSpan.scrollIntoView?.({
        behavior: activeCitationOnPage ? "auto" : "smooth",
        block: "center",
      });
    }
  }, [
    textLayerRenderTick,
    targetPassageToHighlight,
    activeCitationOnPage?.citation_index,
     activeCitationOnPage?.chunk_id,
    pageNumber,
  ]);

  const handleMouseUpSelection = () => {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) {
      setHoveredSelectionText("");
      setToolbarCoords(null);
      return;
    }

    const rawSelected = selection.toString().trim();
    if (!rawSelected || rawSelected.length < 3) {
      setHoveredSelectionText("");
      setToolbarCoords(null);
      return;
    }

    const range = selection.getRangeAt(0);
    const container = stageContainerRef.current;
    if (container && !container.contains(range.commonAncestorContainer)) {
      return;
    }

    const rect = range.getBoundingClientRect();
    setHoveredSelectionText(rawSelected);
    setToolbarCoords({
      top: rect.top - 48,
      left: rect.left + rect.width / 2,
    });
  };

  const handleToolbarAction = (action: "ask" | "explain" | "summarise" | "simplify") => {
    if (!hoveredSelectionText) {
      return;
    }

    const promptMap: Record<typeof action, string | null> = {
      ask: null,
      explain:
        "Explain this highlighted passage in clear detail and connect it to the surrounding section.",
      summarise: "Summarise the key takeaway of this highlighted passage concisely.",
      simplify:
        "Simplify this passage in plain language without losing technical accuracy.",
    };

    capturePassageSelection(
      {
        document_id: document.id,
        selected_text: hoveredSelectionText,
        page_number: pageNumber,
      },
      promptMap[action],
    );

    setHoveredSelectionText("");
    setToolbarCoords(null);
    window.getSelection()?.removeAllRanges();
  };

  const activeGeometry =
    pageGeometry &&
    pageGeometry.docId === document.id &&
    pageGeometry.pageNumber === pageNumber
      ? pageGeometry
      : null;

  const activeRenderedDims =
    renderedDims &&
    renderedDims.docId === document.id &&
    renderedDims.pageNumber === pageNumber
      ? renderedDims
      : null;

  const targetScale = activeGeometry
    ? (zoomPercentage / 100) * activeGeometry.fitScale
    : null;
  const targetWidth =
    activeGeometry && targetScale !== null
      ? Math.floor(activeGeometry.unscaledWidth * targetScale)
      : (activeRenderedDims?.width ?? 540);
  const targetHeight =
    activeGeometry && targetScale !== null
      ? Math.floor(activeGeometry.unscaledHeight * targetScale)
      : (activeRenderedDims?.height ?? 760);

  const scaleRatioX =
    activeRenderedDims && activeRenderedDims.width > 0
      ? targetWidth / activeRenderedDims.width
      : 1;
  const scaleRatioY =
    activeRenderedDims && activeRenderedDims.height > 0
      ? targetHeight / activeRenderedDims.height
      : 1;
  const hasPendingZoomTransform =
    activeRenderedDims !== null &&
    (Math.abs(scaleRatioX - 1) > 0.001 || Math.abs(scaleRatioY - 1) > 0.001);

  const hasActiveGeometry = activeGeometry !== null;

  // Keep the visible viewport center anchored horizontally and vertically when zooming in or out.
  useLayoutEffect(() => {
    const container = stageContainerRef.current;
    if (!container || !isPdfDocument || !hasActiveGeometry) {
      return;
    }

    const nextScrollWidth = container.scrollWidth;
    const nextScrollHeight = container.scrollHeight;
    const prev = prevZoomScrollRef.current;

    if (!prev || prev.docId !== document.id || prev.pageNumber !== pageNumber) {
      if (nextScrollWidth > container.clientWidth) {
        const centeredLeft = Math.max(0, (nextScrollWidth - container.clientWidth) / 2);
        container.scrollLeft = centeredLeft;
        lastScrollPosRef.current.left = centeredLeft;
      } else {
        container.scrollLeft = 0;
        lastScrollPosRef.current.left = 0;
      }
      prevZoomScrollRef.current = {
        docId: document.id,
        pageNumber,
        scrollWidth: nextScrollWidth,
        scrollHeight: nextScrollHeight,
      };
      return;
    }

    if (prev.scrollWidth === nextScrollWidth && prev.scrollHeight === nextScrollHeight) {
      return;
    }

    if (nextScrollWidth > container.clientWidth) {
      const prevCenterRatioX =
        prev.scrollWidth > container.clientWidth
          ? (lastScrollPosRef.current.left + container.clientWidth / 2) / prev.scrollWidth
          : 0.5;
      const targetLeft = Math.max(
        0,
        Math.min(
          nextScrollWidth - container.clientWidth,
          prevCenterRatioX * nextScrollWidth - container.clientWidth / 2,
        ),
      );
      container.scrollLeft = targetLeft;
      lastScrollPosRef.current.left = targetLeft;
    } else {
      container.scrollLeft = 0;
      lastScrollPosRef.current.left = 0;
    }

    if (nextScrollHeight > container.clientHeight && prev.scrollHeight > 0) {
      const prevCenterRatioY =
        (lastScrollPosRef.current.top + container.clientHeight / 2) / prev.scrollHeight;
      const targetTop = Math.max(
        0,
        Math.min(
          nextScrollHeight - container.clientHeight,
          prevCenterRatioY * nextScrollHeight - container.clientHeight / 2,
        ),
      );
      container.scrollTop = targetTop;
      lastScrollPosRef.current.top = targetTop;
    }

    prevZoomScrollRef.current = {
      docId: document.id,
      pageNumber,
      scrollWidth: nextScrollWidth,
      scrollHeight: nextScrollHeight,
    };
  }, [document.id, hasActiveGeometry, isPdfDocument, pageNumber, targetHeight, targetWidth]);

  const paragraphs = (pageQuery.data?.text_content ?? "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  return (
    <div
      ref={stageContainerRef}
      onScroll={(e) => {
        lastScrollPosRef.current = {
          left: e.currentTarget.scrollLeft,
          top: e.currentTarget.scrollTop,
        };
      }}
      onMouseUp={handleMouseUpSelection}
      className="flex-1 overflow-auto bg-[#FBFBF9] relative"
    >
      <FloatingSelectionToolbar
        selectedText={hoveredSelectionText}
        position={toolbarCoords}
        onAction={handleToolbarAction}
        onDismiss={() => {
          setHoveredSelectionText("");
          setToolbarCoords(null);
          window.getSelection()?.removeAllRanges();
        }}
      />

      <div className="min-w-full w-fit p-6 lg:p-10 flex flex-col items-center">

      {/* Active Citation Highlight Banner on Current Page */}
      {activeCitationOnPage && (
        <div className="w-full max-w-[780px] mx-auto mb-4 p-3 rounded-lg bg-amber-50 border-l-4 border-amber-400 text-xs text-on-surface space-y-1 shadow-2xs">
          <div className="flex items-center justify-between gap-2">
            <span className="font-code-sm font-semibold text-amber-900 flex items-center gap-1.5">
              <span className="material-symbols-outlined text-sm text-amber-600">
                format_ink_highlighter
              </span>
              <span>
                Verified Source [{activeCitationOnPage.citation_index}] Highlighted on Page{" "}
                {pageNumber}
              </span>
            </span>
            <button
              type="button"
              onClick={clearCitationHighlight}
              className="font-code-sm text-[11px] text-amber-800 hover:text-amber-950 underline"
            >
              Clear highlight
            </button>
          </div>
          <p className="italic line-clamp-2 text-amber-950/90">
            &ldquo;{activeCitationOnPage.excerpt}&rdquo;
          </p>
        </div>
      )}

      {/* Active Selection Banner on Current Page */}
      {!activeCitationOnPage && activeSelectionOnPage && (
        <div className="w-full max-w-[780px] mx-auto mb-4 p-3 rounded-lg bg-primary-fixed/35 border-l-4 border-primary text-xs text-on-surface space-y-1 shadow-2xs">
          <span className="font-code-sm font-semibold text-primary block">
            Active Margin Highlight on Page {pageNumber}
          </span>
          <p className="italic line-clamp-2">&ldquo;{activeSelectionOnPage.selected_text}&rdquo;</p>
        </div>
      )}

      {isPdfDocument && !pdfRenderError ? (
        <div className="mx-auto mb-16 bg-white rounded-lg shadow-sm border border-black/[0.08] p-3 flex flex-col items-center relative shrink-0">
          {isPdfRendering && (
            <div className="absolute inset-0 bg-white/75 backdrop-blur-[1px] z-10 flex flex-col items-center justify-center gap-2.5 rounded-lg">
              <LoadingSpinner size="md" ariaLabel="Rendering page" />
              <span className="font-code-sm text-xs text-on-surface-variant">
                Rendering page {pageNumber}…
              </span>
            </div>
          )}
          <div
            style={{
              width: `${targetWidth}px`,
              height: `${targetHeight}px`,
            }}
            className="relative overflow-hidden"
          >
            <div
              style={
                {
                  width: `${activeRenderedDims?.width ?? targetWidth}px`,
                  height: `${activeRenderedDims?.height ?? targetHeight}px`,
                  "--scale-factor": String(
                    activeRenderedDims?.scale ?? targetScale ?? 1,
                  ),
                  transform: hasPendingZoomTransform
                    ? `scale(${scaleRatioX}, ${scaleRatioY})`
                    : undefined,
                  transformOrigin: "0 0",
                } as CSSProperties
              }
              className="relative will-change-transform"
            >
              <canvas ref={canvasRef} className="block w-full h-full rounded" />
              <div ref={textLayerRef} className="textLayer" />
            </div>
          </div>
        </div>
      ) : (
        /* Non-PDF (DOCX / TXT) or fallback page sheet */
        <article
          style={{
            fontSize: `${Math.round((zoomPercentage / 100) * 17)}px`,
          }}
          className="w-full max-w-[720px] mx-auto bg-white rounded-lg shadow-sm border border-black/[0.06] p-10 lg:p-14 mb-16 relative"
        >
          <div className="flex items-center justify-between border-b border-outline-variant/20 pb-3 mb-8 text-[11px] text-outline font-code-sm">
            <span className="truncate max-w-[420px] uppercase">
              {document.original_filename}
            </span>
            <span>
              PAGE {pageNumber} OF {document.page_count ?? 1}
            </span>
          </div>

          {pageQuery.isLoading ? (
            <div className="space-y-4 py-8">
              <div className="h-4 bg-surface-container rounded w-3/4 animate-pulse" />
              <div className="h-4 bg-surface-container rounded w-full animate-pulse" />
              <div className="h-4 bg-surface-container rounded w-5/6 animate-pulse" />
            </div>
          ) : paragraphs.length === 0 ? (
            <p className="font-body-reading text-on-surface-variant italic py-8">
              No extractable text was found on page {pageNumber}.
            </p>
          ) : (
            <div className="font-body-reading text-on-surface/90 space-y-6 leading-relaxed">
              {paragraphs.map((paragraph, idx) => {
                const isHighlighted = paragraphMatchesPassage(
                  paragraph,
                  targetPassageToHighlight,
                );

                return (
                  <p
                    key={`${pageNumber}-${idx}`}
                    className={
                      isHighlighted
                        ? "bg-amber-200/55 text-on-surface rounded p-2 -m-2 border-l-4 border-amber-400 transition-colors"
                        : undefined
                    }
                  >
                    {paragraph}
                  </p>
                );
              })}
            </div>
          )}
        </article>
      )}
      </div>
    </div>
  );
}

