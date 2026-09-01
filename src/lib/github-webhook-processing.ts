import { randomUUID } from "node:crypto";

import {
  normalizeCollaborationMessage,
  parseCollaborationDeliveryMessage,
} from "@/lib/github-collaboration";
import type { GitHubWebhookRepository } from "@/lib/github-webhook-repository";
import {
  normalizeOperationsMessage,
  parseOperationsDeliveryMessage,
} from "@/lib/github-operations";
import {
  normalizePushMessage,
  parsePushDeliveryMessage,
} from "@/lib/github-webhook";
import {
  normalizeProjectsMessage,
  parseProjectsDeliveryMessage,
} from "@/lib/github-projects";

const maxDeliveryAttempts = 5;

export type WebhookDeliveryStore = Pick<
  GitHubWebhookRepository,
  | "findActiveInstallationUsers"
  | "markDeliveryFailed"
  | "markDeliveryProcessed"
  | "recordActivity"
>;

// Consumes one queue message. Throwing signals the queue to retry; returning
// acknowledges the message.
export async function processWebhookDeliveryMessage(
  rawMessage: unknown,
  metadata: { deliveryCount: number },
  store: WebhookDeliveryStore,
  now: Date = new Date(),
): Promise<void> {
  const message =
    parsePushDeliveryMessage(rawMessage) ??
    parseCollaborationDeliveryMessage(rawMessage) ??
    parseOperationsDeliveryMessage(rawMessage) ??
    parseProjectsDeliveryMessage(rawMessage);
  if (!message) {
    // A message this deployment cannot read (older or newer producer) will
    // never succeed; acknowledge it without any activity effect.
    const deliveryId = (rawMessage as { deliveryId?: unknown } | null)
      ?.deliveryId;
    if (typeof deliveryId === "string") {
      await store.markDeliveryFailed(
        deliveryId,
        "poisoned",
        randomUUID(),
        metadata.deliveryCount,
      );
    }
    return;
  }

  try {
    const users = await store.findActiveInstallationUsers(
      message.installationId,
    );
    let recorded = false;
    for (const user of users) {
      const records =
        "push" in message
          ? normalizePushMessage(message, user)
          : "collaboration" in message
            ? normalizeCollaborationMessage(message, user)
            : "operation" in message
              ? normalizeOperationsMessage(message, user)
              : normalizeProjectsMessage(message, user);
      if (records.length === 0) continue;
      await store.recordActivity(user.userId, records);
      recorded = true;
    }
    await store.markDeliveryProcessed(
      message.deliveryId,
      recorded ? "processed" : "skipped",
      now,
      metadata.deliveryCount,
    );
  } catch (error) {
    const errorId = randomUUID();
    if (metadata.deliveryCount >= maxDeliveryAttempts) {
      await store.markDeliveryFailed(
        message.deliveryId,
        "poisoned",
        errorId,
        metadata.deliveryCount,
      );
      return;
    }
    try {
      await store.markDeliveryFailed(
        message.deliveryId,
        "failed",
        errorId,
        metadata.deliveryCount,
      );
    } catch {
      // Status is advisory; the rethrow below drives the retry either way.
    }
    throw error;
  }
}
