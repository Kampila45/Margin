/**
 * Conversation transcript adapter mapping persisted `ChatMessageResponse` turns
 * onto the shared `MarginChatStream` component.
 */

import {
  MarginChatStream,
  type MarginChatMessage,
} from "../../components/shared/margin_chat_panel";
import {
  CHAT_MODE,
  MESSAGE_ROLE,
  type ChatMessageResponse,
  type CitationResponse,
} from "../../types/api_contract_types";

export function mapConversationMessagesToChatMessages(
  messages: ChatMessageResponse[],
  _onNavigateToCitation?: (citation: CitationResponse) => void,
): MarginChatMessage[] {
  return messages.map((msg) => {
    if (msg.role === MESSAGE_ROLE.USER) {
      return {
        id: msg.id,
        role: "user",
        content: msg.content,
        quotedPassage:
          msg.mode === CHAT_MODE.SELECTION_QA && msg.selected_text
            ? {
                text: msg.selected_text,
                pageNumber: msg.selected_page_number,
              }
            : null,
      };
    }

    return {
      id: msg.id,
      role: "assistant",
      content: msg.content,
      citations: msg.citations,
    };
  });
}

interface ChatMessageTranscriptProps {
  messages: ChatMessageResponse[];
  isGenerating: boolean;
  onNavigateToCitation: (citation: CitationResponse) => void;
  errorMessage?: string | null;
  onRetry?: () => void;
  onDismissError?: () => void;
}

export function ChatMessageTranscript({
  messages,
  isGenerating,
  onNavigateToCitation,
  errorMessage,
  onRetry,
  onDismissError,
}: ChatMessageTranscriptProps) {
  return (
    <MarginChatStream
      messages={mapConversationMessagesToChatMessages(messages, onNavigateToCitation)}
      isGenerating={isGenerating}
      onNavigateToCitation={onNavigateToCitation}
      errorMessage={errorMessage}
      onRetry={onRetry}
      onDismissError={onDismissError}
      defaultEmptyTitle="Ask a Grounded Question"
      defaultEmptyDescription="Ask about the full document or highlight any passage in the reader to explain, summarise, or interrogate specific claims."
    />
  );
}
