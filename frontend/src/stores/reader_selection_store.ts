/**
 * Zustand store managing transient client UI state for the document reader, text selection, and active chat context.
 * Server state (documents, pages, conversations, messages) lives exclusively in TanStack Query.
 */

import { create } from "zustand";
import {
  CHAT_MODE,
  type ChatMode,
  type CitationResponse,
  type SelectionInput,
} from "../types/api_contract_types";

export interface HighlightedPassageSelection extends SelectionInput {
  document_id: string;
  selected_text: string;
  page_number: number;
}

interface ReaderSelectionState {
  activeDocumentId: string | null;
  currentPageNumber: number;
  zoomPercentage: number;
  activeConversationId: string | null;
  activeChatMode: ChatMode;
  activeSelection: HighlightedPassageSelection | null;
  activeCitationHighlight: CitationResponse | null;
  pendingQuickPrompt: string | null;
  isUploadModalOpen: boolean;
  isConnectDbModalOpen: boolean;
  isGuideModalOpen: boolean;
  isTourActive: boolean;
  tourStepIndex: number;

  setActiveDocument: (documentId: string | null, initialPage?: number) => void;
  setCurrentPageNumber: (pageNumber: number) => void;
  setZoomPercentage: (zoom: number) => void;
  setActiveConversationId: (conversationId: string | null) => void;
  capturePassageSelection: (
    selection: HighlightedPassageSelection,
    quickPrompt?: string | null,
  ) => void;
  clearPassageSelection: () => void;
  highlightCitation: (citation: CitationResponse) => void;
  clearCitationHighlight: () => void;
  consumePendingQuickPrompt: () => void;
  setUploadModalOpen: (open: boolean) => void;
  setConnectDbModalOpen: (open: boolean) => void;
  setGuideModalOpen: (open: boolean) => void;
  startTour: () => void;
  setTourStep: (step: number) => void;
  nextTourStep: () => void;
  prevTourStep: () => void;
  endTour: () => void;
}

export const useReaderSelectionStore = create<ReaderSelectionState>((set) => ({
  activeDocumentId: null,
  currentPageNumber: 1,
  zoomPercentage: 100,
  activeConversationId: null,
  activeChatMode: CHAT_MODE.DOCUMENT_QA,
  activeSelection: null,
  activeCitationHighlight: null,
  pendingQuickPrompt: null,
  isUploadModalOpen: false,
  isConnectDbModalOpen: false,
  isGuideModalOpen: false,
  isTourActive: false,
  tourStepIndex: 0,

  setGuideModalOpen: (open) => set({ isGuideModalOpen: open }),
  startTour: () => set({ isTourActive: true, tourStepIndex: 0, isGuideModalOpen: false }),
  setTourStep: (step) => set({ tourStepIndex: step }),
  nextTourStep: () => set((s) => ({ tourStepIndex: s.tourStepIndex + 1 })),
  prevTourStep: () => set((s) => ({ tourStepIndex: Math.max(0, s.tourStepIndex - 1) })),
  endTour: () => set({ isTourActive: false, tourStepIndex: 0 }),

  setActiveDocument: (documentId, initialPage = 1) =>
    set((state) => ({
      activeDocumentId: documentId,
      currentPageNumber: Math.max(1, initialPage),
      activeConversationId:
        state.activeDocumentId === documentId ? state.activeConversationId : null,
      activeSelection:
        state.activeSelection?.document_id === documentId ? state.activeSelection : null,
      activeCitationHighlight:
        state.activeCitationHighlight?.document_id === documentId
          ? state.activeCitationHighlight
          : null,
      activeChatMode:
        state.activeSelection?.document_id === documentId
          ? state.activeChatMode
          : CHAT_MODE.DOCUMENT_QA,
    })),

  setCurrentPageNumber: (pageNumber) =>
    set({
      currentPageNumber: Math.max(1, pageNumber),
    }),

  setZoomPercentage: (zoom) =>
    set({
      zoomPercentage: Math.min(200, Math.max(50, zoom)),
    }),

  setActiveConversationId: (conversationId) =>
    set({
      activeConversationId: conversationId,
    }),

  capturePassageSelection: (selection, quickPrompt = null) =>
    set({
      activeSelection: selection,
      activeCitationHighlight: null,
      activeChatMode: CHAT_MODE.SELECTION_QA,
      pendingQuickPrompt: quickPrompt,
    }),

  clearPassageSelection: () =>
    set({
      activeSelection: null,
      activeChatMode: CHAT_MODE.DOCUMENT_QA,
      pendingQuickPrompt: null,
    }),

  highlightCitation: (citation) =>
    set({
      activeDocumentId: citation.document_id,
      currentPageNumber: Math.max(1, citation.page_number ?? 1),
      activeCitationHighlight: citation,
    }),

  clearCitationHighlight: () =>
    set({
      activeCitationHighlight: null,
    }),

  consumePendingQuickPrompt: () =>
    set({
      pendingQuickPrompt: null,
    }),

  setUploadModalOpen: (open) =>
    set({
      isUploadModalOpen: open,
    }),

  setConnectDbModalOpen: (open) =>
    set({
      isConnectDbModalOpen: open,
    }),
}));

