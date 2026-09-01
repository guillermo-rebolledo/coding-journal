import { getRequiredEnv } from "@/lib/env";
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
import { githubWebhookRepository } from "@/lib/github-webhook-repository";
import { queuePublisher } from "@/lib/queue";

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

  const collaborationEvent = isCollaborationWebhookEvent(eventType)
    ? eventType
    : null;
  if (eventType !== "push" && !collaborationEvent) {
    await githubWebhookRepository.claimDelivery({
      deliveryId,
      eventType,
      installationId: null,
      status: "ignored",
      receivedAt,
    });
    return acknowledge("ignored");
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    payload = null;
  }
  const extraction = collaborationEvent
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
