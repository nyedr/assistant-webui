/**
 * Message Branching Utilities
 *
 * This module provides functions for managing message branches (alternative responses)
 * and retry functionality.
 */

import { ExtendedMessage, findLastUserMessageId } from "../utils/messages";

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
 * Traces the active path from a given message ID to the root, respecting branch selections
 * @param messages - Array of all messages
 * @param currentId - The ID of the current active message (tip of the branch)
 * @param branchState - Object mapping parent message IDs to selected branch indices
 * @returns Array of messages forming the active path, in chronological order
 */
export function getActivePathWithBranchState(
  messages: ExtendedMessage[],
  currentId: string | null,
  branchState: BranchState
): ExtendedMessage[] {
  if (!currentId || messages.length === 0) {
    return messages;
  }

  // Check if currentId exists in messages
  const currentIdExists = messages.some((msg) => msg.id === currentId);
  if (!currentIdExists) {
    console.warn(
      `[branching] currentId ${currentId} not found in messages array, returning all messages`
    );
    return messages;
  }

  // Create a map for quick message lookup
  const messagesMap = new Map(messages.map((m) => [m.id, m]));

  // Start with the target message (current leaf node)
  const activePath: ExtendedMessage[] = [];
  let cursor: string | null = currentId;
  let iterations = 0;

  // Build path from leaf to root
  while (cursor && iterations < 100) {
    iterations++;
    const message = messagesMap.get(cursor);
    if (!message) break;

    activePath.unshift(message); // Add to beginning for chronological order
    cursor = message.parent_id || null;

    // If this message is a parent with multiple children (branches)
    // make sure we're following the correct branch according to branch state
    if (cursor && messagesMap.has(cursor)) {
      const parentMessage = messagesMap.get(cursor)!;
      if (parentMessage.children_ids && parentMessage.children_ids.length > 1) {
        // Check if we have a branch selection for this parent
        const selectedBranchIndex = branchState[parentMessage.id];
        if (selectedBranchIndex !== undefined) {
          // If the current path doesn't match the selected branch, adjust
          const currentChildIndex = parentMessage.children_ids.indexOf(
            message.id
          );
          if (
            currentChildIndex !== selectedBranchIndex &&
            selectedBranchIndex < parentMessage.children_ids.length
          ) {
            // This is important: we're enforcing the branch selection here
            const selectedChildId =
              parentMessage.children_ids[selectedBranchIndex];
            console.log(
              `[branching] Branch enforcement: Switching from child ${currentChildIndex} to ${selectedBranchIndex} for parent ${parentMessage.id}`
            );

            // Replace the current message with the one from the selected branch
            activePath.shift(); // Remove the current message
            const selectedChild = messagesMap.get(selectedChildId);
            if (selectedChild) {
              activePath.unshift(selectedChild);
            }
          }
        }
      }
    }
  }

  console.log(
    `[branching] Computed active path with ${
      activePath.length
    } messages using branch state with ${
      Object.keys(branchState).length
    } entries`
  );

  return activePath;
}

/**
 * Utility to drill down from a chosen child to the "bottom-most" descendant
 * Ensures we show the last leaf in that branch when switching branches
 */
export function drillDownToLeaf(
  startMessageId: string,
  messagesMap: Map<string, ExtendedMessage>
): string {
  let current = messagesMap.get(startMessageId);
  if (!current) return startMessageId;

  // Keep going if there's exactly one child or if user wants to pick the first child on multi-branch.
  while (current.children_ids && current.children_ids.length > 0) {
    // pick the first child
    const nextId = current.children_ids[0];
    const nextMsg = messagesMap.get(nextId);
    if (!nextMsg) break;
    current = nextMsg;
  }
  return current.id;
}

/**
 * Utility to drill down from a chosen child to the "bottom-most" descendant
 * Ensures we show the last leaf in that branch when switching branches
 * Takes into account branch state to follow the correct branch at each level
 */
export function drillDownToLeafWithBranchState(
  startMessageId: string,
  messagesMap: Map<string, ExtendedMessage>,
  branchState: BranchState
): string {
  console.log(
    `[branching] Beginning drillDownToLeafWithBranchState from message ${startMessageId} with branch state:`,
    branchState
  );

  let current = messagesMap.get(startMessageId);
  if (!current) {
    console.log(
      `[branching] Message ${startMessageId} not found in map, returning as is`
    );
    return startMessageId;
  }

  let depth = 0;
  while (current.children_ids && current.children_ids.length > 0) {
    depth++;
    console.log(
      `[branching] Level ${depth}: Message ${current.id} has ${current.children_ids.length} children`
    );

    // Check if there's a branch selection for this message
    const selectedBranchIndex = branchState[current.id];

    // Determine which child to follow
    let nextId: string;
    if (
      selectedBranchIndex !== undefined &&
      selectedBranchIndex < current.children_ids.length
    ) {
      // Follow the selected branch if specified in branch state
      nextId = current.children_ids[selectedBranchIndex];
      console.log(
        `[branching] Following selected branch ${selectedBranchIndex} for message ${current.id} -> child ${nextId}`
      );
    } else {
      // Default to first child if no branch selection
      nextId = current.children_ids[0];
      console.log(
        `[branching] No branch selection for message ${current.id}, defaulting to first child ${nextId}`
      );
    }

    const nextMsg = messagesMap.get(nextId);
    if (!nextMsg) {
      console.log(
        `[branching] Child message ${nextId} not found in map, stopping traversal`
      );
      break;
    }
    current = nextMsg;
  }

  console.log(
    `[branching] Reached leaf node: ${current.id} after traversing ${depth} levels`
  );
  return current.id;
}

/**
 * Get information about branches for a specific message
 * @param messages - Array of all messages
 * @param parentMessageId - ID of the parent message to get branch info for
 * @returns Object containing currentIndex (selected branch) and totalBranches
 */
export function getBranchInfo(
  messages: ExtendedMessage[],
  parentMessageId: string,
  branchState: BranchState
): BranchInfo {
  // Find the parent message
  const parentMessage = messages.find((msg) => msg.id === parentMessageId);

  // If parent message not found or has no children, return default info
  if (
    !parentMessage ||
    !parentMessage.children_ids ||
    parentMessage.children_ids.length <= 1
  ) {
    return { currentIndex: 0, totalBranches: 0 };
  }

  // Get the total number of branches
  const totalBranches = parentMessage.children_ids.length;

  // Get the current branch index from branch state, or default to 0
  const currentIndex = branchState[parentMessageId] ?? 0;

  return { currentIndex, totalBranches };
}

/**
 * Get information about branches for a parent message, using the current ID to determine active branch
 * @deprecated Use getBranchInfo instead which doesn't rely on currentId
 */
export function getBranchInfoWithCurrentId(
  messages: ExtendedMessage[],
  parentMessageId: string,
  currentId: string
): BranchInfo {
  const parentMessage = messages.find((msg) => msg.id === parentMessageId);

  const activeChildIndex =
    parentMessage?.children_ids?.findIndex((childId) => {
      return childId === currentId;
    }) ?? -1;

  if (!parentMessage || activeChildIndex === -1) {
    console.error(
      "[useAIChat] Could not find parent message with ID:",
      parentMessageId,
      "currentId:",
      currentId,
      "activeChildIndex:",
      activeChildIndex
    );

    return {
      currentIndex: 0,
      totalBranches: parentMessage?.children_ids?.length || 0,
    };
  }

  // Check if currentId exists in messages
  const currentIdExists = messages.some((msg) => msg.id === currentId);
  if (!currentIdExists) {
    console.warn(
      `[branching] currentId ${currentId} not found in messages array in getBranchInfoWithCurrentId`
    );

    return {
      currentIndex: 0,
      totalBranches: parentMessage.children_ids!.length,
    };
  }

  return {
    currentIndex: activeChildIndex,
    totalBranches: parentMessage.children_ids!.length,
  };
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
    console.error(
      "[branching] Could not find message to retry with ID:",
      messageId
    );
    return { messages, messageToRetry: undefined, parentMessageId: null };
  }

  const parentMessageId =
    messageToRetry.parent_id ?? findLastUserMessageId(messages);

  if (!parentMessageId) {
    console.error(
      "[branching] Could not find parent message for message:",
      messageId
    );
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
