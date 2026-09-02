import { readString, type JsonObject } from "@/lib/json-payload";
import { randomUUID } from "node:crypto";

import { deliveryFamilyForMessage } from "@/lib/github-delivery-family";
import type { GitHubWebhookRepository } from "@/lib/github-webhook-repository";

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
  rawMessage: JsonObject | null,
  metadata: { deliveryCount: number },
  store: WebhookDeliveryStore,
  now: Date = new Date(),
): Promise<void> {
  const delivery = deliveryFamilyForMessage(rawMessage);
  if (!delivery) {
    // A message this deployment cannot read (older or newer producer) will
    // never succeed; acknowledge it without any activity effect.
    const deliveryId = readString(rawMessage, "deliveryId");
    if (deliveryId !== null) {
      await store.markDeliveryFailed(
        deliveryId,
        "poisoned",
        randomUUID(),
        metadata.deliveryCount,
      );
    }
    return;
  }
  const { family, message } = delivery;

  try {
    const users = await store.findActiveInstallationUsers(
      message.installationId,
    );
    let recorded = false;
    for (const user of users) {
      const records = family.normalize(message, user);
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
