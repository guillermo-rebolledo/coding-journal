import { getRequiredEnv } from "@/lib/env";
import { isJsonObject, type JsonObject } from "@/lib/json-payload";
import { deliveryFamilyForEvent } from "@/lib/github-delivery-family";
import {
  webhookDeliveryTopic,
  validDeliveryId,
  verifyGitHubSignature,
} from "@/lib/github-webhook";
import type { GitHubWebhookRepository } from "@/lib/github-webhook-repository";
import type { QueuePublisher } from "@/lib/queue";
import {
  extractGitHubAccessChange,
  extractGitHubAccessRestoration,
} from "@/lib/github-privacy";

function acknowledge(status: string, httpStatus = 200) {
  return Response.json({ status }, { status: httpStatus });
}

/**
 * The two boundaries this route reaches. They are parameters rather than
 * module imports so a test can supply real stand-ins and still exercise the
 * signature check, extraction and delivery bookkeeping the route owns. The
 * store is narrowed to the five members the route actually calls.
 */
export type WebhookRouteDependencies = {
  store: Pick<
    GitHubWebhookRepository,
    | "applyAccessChange"
    | "restoreAccess"
    | "claimDelivery"
    | "markDeliveryEnqueued"
    | "markDeliveryEnqueueFailed"
  >;
  queue: QueuePublisher;
};

export function createGitHubWebhookRoute({
  store,
  queue,
}: WebhookRouteDependencies) {
  return async function POST(request: Request) {
    const secret = getRequiredEnv("GITHUB_WEBHOOK_SECRET");
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");
    if (!verifyGitHubSignature(rawBody, signature, secret)) {
      return acknowledge("invalid-signature", 401);
    }

    const deliveryId = request.headers.get("x-github-delivery");
    const eventType = request.headers.get("x-github-event");
    if (!validDeliveryId(deliveryId) || !eventType) {
      return acknowledge("malformed", 400);
    }
    const receivedAt = new Date();

    // The one place the raw body becomes a decoded payload. Every extractor
    // below navigates the result rather than re-checking representations.
    let payload: JsonObject | null = null;
    try {
      const parsed: unknown = JSON.parse(rawBody);
      if (isJsonObject(parsed)) payload = parsed;
    } catch {
      payload = null;
    }
    const accessChange = extractGitHubAccessChange({
      eventType,
      payload,
      deliveryId,
      occurredAt: receivedAt,
    });
    if (accessChange) {
      await store.applyAccessChange(accessChange);
      return acknowledge("redacted");
    }
    const accessRestoration = extractGitHubAccessRestoration({
      eventType,
      payload,
    });
    if (accessRestoration) {
      await store.restoreAccess(accessRestoration);
      return acknowledge("restored");
    }

    const family = deliveryFamilyForEvent(eventType);
    if (!family) {
      await store.claimDelivery({
        deliveryId,
        eventType,
        installationId: null,
        status: "ignored",
        receivedAt,
      });
      return acknowledge("ignored");
    }

    const extraction = family.extract({
      eventType,
      payload,
      deliveryId,
      receivedAt,
    });

    if (!extraction.ok) {
      await store.claimDelivery({
        deliveryId,
        eventType,
        installationId: null,
        status: "ignored",
        receivedAt,
      });
      return extraction.reason === "malformed"
        ? acknowledge("malformed", 400)
        : acknowledge(extraction.reason);
    }

    const claim = await store.claimDelivery({
      deliveryId,
      eventType,
      installationId: extraction.message.installationId,
      status: "received",
      receivedAt,
    });
    if (claim === "duplicate") return acknowledge("duplicate");

    try {
      await queue.publish(webhookDeliveryTopic, extraction.message, deliveryId);
    } catch {
      await store.markDeliveryEnqueueFailed(deliveryId, crypto.randomUUID());
      return acknowledge("enqueue-failed", 500);
    }

    await store.markDeliveryEnqueued(deliveryId);
    return acknowledge("accepted", 202);
  };
}
