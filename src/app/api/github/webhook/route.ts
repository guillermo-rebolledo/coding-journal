import { getRequiredEnv } from "@/lib/env";
import { isJsonObject, type JsonObject } from "@/lib/json-payload";
import {
  extractCollaborationDelivery,
  isCollaborationWebhookEvent,
} from "@/lib/github-collaboration";
import {
  extractPushDelivery,
  webhookDeliveryTopic,
  validDeliveryId,
  verifyGitHubSignature,
} from "@/lib/github-webhook";
import {
  extractOperationsDelivery,
  isOperationsWebhookEvent,
} from "@/lib/github-operations";
import {
  extractProjectsDelivery,
  isProjectsWebhookEvent,
} from "@/lib/github-projects";
import { githubWebhookRepository } from "@/lib/github-webhook-repository";
import { queuePublisher } from "@/lib/queue";
import {
  extractGitHubAccessChange,
  extractGitHubAccessRestoration,
} from "@/lib/github-privacy";

function acknowledge(status: string, httpStatus = 200) {
  return Response.json({ status }, { status: httpStatus });
}

export async function POST(request: Request) {
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
    await githubWebhookRepository.applyAccessChange(accessChange);
    return acknowledge("redacted");
  }
  const accessRestoration = extractGitHubAccessRestoration({
    eventType,
    payload,
  });
  if (accessRestoration) {
    await githubWebhookRepository.restoreAccess(accessRestoration);
    return acknowledge("restored");
  }

  const collaborationEvent = isCollaborationWebhookEvent(eventType)
    ? eventType
    : null;
  const operationsEvent = isOperationsWebhookEvent(eventType)
    ? eventType
    : null;
  const projectsEvent = isProjectsWebhookEvent(eventType) ? eventType : null;
  if (
    eventType !== "push" &&
    !collaborationEvent &&
    !operationsEvent &&
    !projectsEvent
  ) {
    await githubWebhookRepository.claimDelivery({
      deliveryId,
      eventType,
      installationId: null,
      status: "ignored",
      receivedAt,
    });
    return acknowledge("ignored");
  }

  const extraction = projectsEvent
    ? extractProjectsDelivery({
        eventType: projectsEvent,
        payload,
        deliveryId,
        receivedAt,
      })
    : operationsEvent
      ? extractOperationsDelivery({
          eventType: operationsEvent,
          payload,
          deliveryId,
          receivedAt,
        })
      : collaborationEvent
        ? extractCollaborationDelivery({
            eventType: collaborationEvent,
            payload,
            deliveryId,
            receivedAt,
          })
        : extractPushDelivery({ payload, deliveryId, receivedAt });

  if (!extraction.ok) {
    await githubWebhookRepository.claimDelivery({
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

  const claim = await githubWebhookRepository.claimDelivery({
    deliveryId,
    eventType,
    installationId: extraction.message.installationId,
    status: "received",
    receivedAt,
  });
  if (claim === "duplicate") return acknowledge("duplicate");

  try {
    await queuePublisher.publish(
      webhookDeliveryTopic,
      extraction.message,
      deliveryId,
    );
  } catch {
    await githubWebhookRepository.markDeliveryEnqueueFailed(
      deliveryId,
      crypto.randomUUID(),
    );
    return acknowledge("enqueue-failed", 500);
  }

  await githubWebhookRepository.markDeliveryEnqueued(deliveryId);
  return acknowledge("accepted", 202);
}
