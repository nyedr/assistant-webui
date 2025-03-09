/**
 * Message Branching Utilities
 *
 * This module provides functions for managing message branches (alternative responses)
 * and retry functionality.
 */

import { ExtendedMessage } from "../utils/messages";
import { isMessageDescendantOf } from "./queries";

/**
 * Interface for branch state management
 */
export interface BranchState {
  [messageId: string]: number; // parentMessageId -> currentBranchIndex
}

/**
 * Interface for branch info returned by getBranchInfo
 */
export interface BranchInfo {
  currentIndex: number;
  totalBranches: number;
}

/**
 * Get information about branches for a parent message
 * @param messages Array of all messages
 * @param parentMessageId ID of the parent message to get branch info for
 * @param branchState Current branch state object
 * @returns Information about the branches for this parent
 */
export function getBranchInfo(
  messages: ExtendedMessage[],
  parentMessageId: string,
  branchState: BranchState
): BranchInfo {
  // Find the parent message
  const parent = messages.find((msg) => msg.id === parentMessageId) as
    | ExtendedMessage
    | undefined;

  if (!parent || !parent.children_ids) {
    return { currentIndex: 0, totalBranches: 0 };
  }

  const totalBranches = parent.children_ids.length;
  const currentIndex = branchState[parentMessageId] || 0;

  return { currentIndex, totalBranches };
}

/**
 * Create a new messages array with the selected branch active
 * @param messages Current messages array
 * @param parentMessageId ID of the parent message
 * @param branchIndex Index of the branch to select
 * @returns Updated messages array with only the selected branch and its descendants
 */
export function selectBranch(
  messages: ExtendedMessage[],
  parentMessageId: string,
  branchIndex: number
): ExtendedMessage[] {
  // Get all child message IDs for this parent
  const parent = messages.find((m) => m.id === parentMessageId);
  if (!parent || !parent.children_ids || parent.children_ids.length === 0) {
    return messages;
  }

  // Select the child message at the specified branch index (or the last one if out of bounds)
  const childId =
    parent.children_ids[Math.min(branchIndex, parent.children_ids.length - 1)];

  if (!childId) return messages;

  // We will preserve this message ID when updating messages
  const preserveMessageId = childId;

  // Find all other children (branches) that need to be removed
  const otherChildren = parent.children_ids.filter(
    (id) => id !== preserveMessageId
  );

  // Remove all descendants of the other branches to clean up the view
  return messages
    .map((msg) => {
      if (msg.id === parentMessageId) {
        // Add the preserved message ID to children_ids if it doesn't exist
        const children = msg.children_ids || [];
        if (!children.includes(preserveMessageId)) {
          children.push(preserveMessageId);
        }
        // Remove other children from this parent
        return {
          ...msg,
          children_ids: [preserveMessageId],
        };
      }
      return msg;
    })
    .filter((msg) => {
      // Keep this message if it's not a removed branch
      return !(
        otherChildren.includes(msg.id) ||
        // Also remove descendants of removed branches
        otherChildren.some((childId) => {
          const isDescendant = isMessageDescendantOf(msg, childId, messages);
          return isDescendant;
        })
      );
    });
}

/**
 * Prepare message state for retry by preserving message content
 * @param messages Current messages array
 * @param messageId ID of the message being retried
 * @param modelId Optional model ID to use
 * @returns Messages array with preserved content
 */
export function prepareRetryState(
  messages: ExtendedMessage[],
  messageId: string,
  modelId?: string
): {
  messages: ExtendedMessage[];
  messageToRetry: ExtendedMessage | undefined;
  parentMessageId: string | null;
} {
  // Find the message to retry
  const messageToRetry = messages.find((msg) => msg.id === messageId) as
    | ExtendedMessage
    | undefined;

  if (!messageToRetry || messageToRetry.role !== "assistant") {
    return { messages, messageToRetry: undefined, parentMessageId: null };
  }

  // Get the parent message ID
  let parentMessageId = messageToRetry.parent_id;

  // If parent_id is null, try to find the appropriate parent message
  if (!parentMessageId) {
    // Find the most recent user message before this assistant message
    const messageIndex = messages.findIndex((msg) => msg.id === messageId);

    if (messageIndex > 0) {
      for (let i = messageIndex - 1; i >= 0; i--) {
        if (messages[i].role === "user") {
          parentMessageId = messages[i].id;
          break;
        }
      }
    }
  }

  if (!parentMessageId) {
    return { messages, messageToRetry, parentMessageId: null };
  }

  // Create a map of original message content keyed by message ID
  const contentMap = new Map<string, any>();

  // Find all messages that share this parent
  const childMessages = messages.filter(
    (msg) => msg.parent_id === parentMessageId
  );

  // Store content for all messages that we want to preserve
  childMessages.forEach((msg) => {
    contentMap.set(msg.id, {
      content: msg.content,
      parts: msg.parts || [],
      data: msg.data || {},
      model: msg.model || modelId || "unknown",
    });
  });

  // Update the messages, preserving content for existing messages
  const updatedMessages = messages.map((msg) => {
    // If this is a message we should preserve content for
    if (contentMap.has(msg.id)) {
      const savedContent = contentMap.get(msg.id);
      return {
        ...msg,
        content: savedContent.content || msg.content,
        parts: savedContent.parts || msg.parts || [],
        data: savedContent.data || msg.data || {},
        model: savedContent.model || msg.model || modelId || "unknown",
      };
    }
    return msg;
  });

  return {
    messages: updatedMessages,
    messageToRetry,
    parentMessageId,
  };
}

/**
 * Preserve message content after a retry operation
 * @param messages Current messages array
 * @param messageId ID of the message to preserve
 * @param originalContent Original content to preserve
 * @param originalParts Original parts array to preserve
 * @param originalData Original data object to preserve
 * @param modelId Optional model ID
 * @returns Updated messages array with preserved content
 */
export function preserveMessageContent(
  messages: ExtendedMessage[],
  messageId: string,
  originalContent: string,
  originalParts: any[] = [],
  originalData: Record<string, any> = {},
  modelId?: string
): ExtendedMessage[] {
  return messages.map((msg) => {
    if (msg.id === messageId) {
      return {
        ...msg,
        content: originalContent || msg.content,
        parts: originalParts.length ? originalParts : msg.parts || [],
        data: Object.keys(originalData).length ? originalData : msg.data || {},
        model: msg.model || modelId || "unknown",
      };
    }
    return msg;
  });
}
