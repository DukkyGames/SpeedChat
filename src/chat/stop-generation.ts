import { getChatAbort, setChatStopReason } from '../app-state';
import type { ChatStopReason } from '../types';
import { clearPendingSteer } from './steer-message';
import { cancelGeneration } from '../api/generations';
import { flushStoppedChatPresentation } from './flush-stopped-chat-presentation';
import { findChatById, getActiveChat } from '../state/sessions';
import { forceCloseAskQuestionModal } from '../ui/question-cards-modal';

/**
 * Stop a chat turn: cancel the backend generation (if any) and abort the local SSE reader.
 * @param reason Recorded on the turn run when the stream ends with status `stopped`.
 */
export function stopGeneration(chatId?: string, reason: ChatStopReason = 'user'): void {
  forceCloseAskQuestionModal();

  const requestedId = chatId?.trim();
  const chat = requestedId ? findChatById(requestedId) : getActiveChat();
  if (!chat) return;
  const id = chat.id;
  setChatStopReason(id, reason);
  const generationId = chat.currentGenerationId?.trim();
  if (generationId) {
    void cancelGeneration(generationId).catch(() => {
    });
  }

  clearPendingSteer(chat);

  const abort = getChatAbort(chat.id);
  if (abort) {
    abort.abort();
    return;
  }

  flushStoppedChatPresentation([chat.id]);
}
