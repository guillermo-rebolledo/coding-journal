import {
  extractCollaborationDelivery,
  isCollaborationWebhookEvent,
  normalizeCollaborationMessage,
  parseCollaborationDeliveryMessage,
  type CollaborationDeliveryMessage,
} from "@/lib/github-collaboration";
import {
  extractOperationsDelivery,
  isOperationsWebhookEvent,
  normalizeOperationsMessage,
  parseOperationsDeliveryMessage,
  type OperationsMessage,
} from "@/lib/github-operations";
import {
  extractProjectsDelivery,
  isProjectsWebhookEvent,
  normalizeProjectsMessage,
  parseProjectsDeliveryMessage,
  type ProjectsDeliveryMessage,
} from "@/lib/github-projects";
import {
  extractPushDelivery,
  normalizePushMessage,
  parsePushDeliveryMessage,
  type PushDeliveryMessage,
} from "@/lib/github-webhook";
import type { ActivityRecord } from "@/lib/github-activity";
import type { JsonObject } from "@/lib/json-payload";

export type DeliveryMessage = {
  version: 1;
  deliveryId: string;
  installationId: string;
  receivedAt: string;
};

export type DeliveryExtraction =
  | { ok: true; message: DeliveryMessage }
  | { ok: false; reason: "malformed" | "stale" | "no-activity" };

export type DeliveryFamily = {
  name: string;
  envelopeKey: string;
  accepts(eventType: string): boolean;
  extract(input: {
    eventType: string;
    payload: JsonObject | null;
    deliveryId: string;
    receivedAt: Date;
  }): DeliveryExtraction;
  parse(value: JsonObject | null): DeliveryMessage | null;
  normalize(
    message: DeliveryMessage,
    user: { githubAccountId: string; timeZone: string },
  ): ActivityRecord[];
};

function typedFamily<TMessage extends DeliveryMessage>({
  name,
  envelopeKey,
  accepts,
  extract,
  parse,
  normalize,
}: Omit<DeliveryFamily, "extract" | "parse" | "normalize"> & {
  extract: DeliveryFamily["extract"];
  parse(value: JsonObject | null): TMessage | null;
  normalize(
    message: TMessage,
    user: { githubAccountId: string; timeZone: string },
  ): ActivityRecord[];
}): DeliveryFamily {
  return {
    name,
    envelopeKey,
    accepts,
    extract,
    parse,
    normalize: (message, user) => normalize(message as TMessage, user),
  };
}

const pushFamily = typedFamily<PushDeliveryMessage>({
  name: "push",
  envelopeKey: "push",
  accepts: (eventType) => eventType === "push",
  extract: ({ payload, deliveryId, receivedAt }) =>
    extractPushDelivery({ payload, deliveryId, receivedAt }),
  parse: parsePushDeliveryMessage,
  normalize: normalizePushMessage,
});

const collaborationFamily = typedFamily<CollaborationDeliveryMessage>({
  name: "collaboration",
  envelopeKey: "collaboration",
  accepts: isCollaborationWebhookEvent,
  extract: ({ eventType, payload, deliveryId, receivedAt }) => {
    if (!isCollaborationWebhookEvent(eventType)) {
      return { ok: false, reason: "malformed" };
    }
    return extractCollaborationDelivery({
      eventType,
      payload,
      deliveryId,
      receivedAt,
    });
  },
  parse: parseCollaborationDeliveryMessage,
  normalize: normalizeCollaborationMessage,
});

const operationsFamily = typedFamily<OperationsMessage>({
  name: "operations",
  envelopeKey: "operation",
  accepts: isOperationsWebhookEvent,
  extract: ({ eventType, payload, deliveryId, receivedAt }) => {
    if (!isOperationsWebhookEvent(eventType)) {
      return { ok: false, reason: "malformed" };
    }
    return extractOperationsDelivery({
      eventType,
      payload,
      deliveryId,
      receivedAt,
    });
  },
  parse: parseOperationsDeliveryMessage,
  normalize: normalizeOperationsMessage,
});

const projectsFamily = typedFamily<ProjectsDeliveryMessage>({
  name: "projects",
  envelopeKey: "project",
  accepts: isProjectsWebhookEvent,
  extract: ({ eventType, payload, deliveryId, receivedAt }) => {
    if (!isProjectsWebhookEvent(eventType)) {
      return { ok: false, reason: "malformed" };
    }
    return extractProjectsDelivery({
      eventType,
      payload,
      deliveryId,
      receivedAt,
    });
  },
  parse: parseProjectsDeliveryMessage,
  normalize: normalizeProjectsMessage,
});

export const githubDeliveryFamilies: readonly DeliveryFamily[] = [
  pushFamily,
  collaborationFamily,
  operationsFamily,
  projectsFamily,
];

export function deliveryFamilyForEvent(
  eventType: string,
  registry: readonly DeliveryFamily[] = githubDeliveryFamilies,
) {
  return registry.find((family) => family.accepts(eventType)) ?? null;
}

export function deliveryFamilyForMessage(
  value: JsonObject | null,
  registry: readonly DeliveryFamily[] = githubDeliveryFamilies,
) {
  for (const family of registry) {
    const message = family.parse(value);
    if (message) return { family, message };
  }
  return null;
}
