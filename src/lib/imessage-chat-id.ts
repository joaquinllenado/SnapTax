type NormalizedChatId = {
  /** Incoming UI/API chat id (possibly prefixed or "any;..."). */
  original: string;
  /** Raw value that getMessages({ chatId }) can match against chat.chat_identifier. */
  queryChatId: string;
};

/**
 * Normalize listChats()/UI chat IDs for getMessages().
 *
 * The SDK's listChats may return values like:
 * - iMessage;+15551234567
 * - SMS;22000
 * - any;+;chat123...
 * while getMessages({ chatId }) filters by raw chat.chat_identifier:
 * - +15551234567
 * - 22000
 * - chat123...
 */
export function normalizeChatIdForMessageQuery(chatId: string): NormalizedChatId {
  const original = chatId.trim();

  // "any;<service>;<raw>" -> "<raw>" (group chat GUIDs and some self-chat IDs)
  const anyMatch = original.match(/^any;[^;]*;(.+)$/);
  if (anyMatch?.[1]) {
    return { original, queryChatId: anyMatch[1].trim() };
  }

  // "<service>;<raw>" -> "<raw>"
  const serviceMatch = original.match(/^(?:iMessage|SMS|RCS);(.+)$/i);
  if (serviceMatch?.[1]) {
    return { original, queryChatId: serviceMatch[1].trim() };
  }

  return { original, queryChatId: original };
}
