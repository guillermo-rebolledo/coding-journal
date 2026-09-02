import type { SummaryProvider } from "@/lib/journal-summary";
import {
  isJsonObject,
  readNonEmptyString,
  readNumber,
  readObject,
  readObjectArray,
  readString,
  type JsonObject,
} from "@/lib/json-payload";
import { serviceCircuitRepository } from "@/lib/service-circuit-repository";
import { withProviderCircuit } from "@/lib/service-circuit";
import { logServiceEvent } from "@/lib/telemetry";

/**
 * The Responses API answers either with a flattened `output_text` or with the
 * structured `output` blocks it was assembled from, depending on the model.
 */
function outputText(envelope: JsonObject | null): string | null {
  const flattened = readNonEmptyString(envelope, "output_text");
  if (flattened !== null) return flattened;
  for (const item of readObjectArray(envelope, "output") ?? []) {
    for (const content of readObjectArray(item, "content") ?? []) {
      const text = readNonEmptyString(content, "text");
      if (readString(content, "type") === "output_text" && text !== null) {
        return text;
      }
    }
  }
  return null;
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Every call is gated by the shared summary circuit, so a provider outage
 * costs one failing request per cooldown instead of one per queued journal.
 */
export const openAiSummaryProvider: SummaryProvider = async (request) => {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("Summary provider is not configured");
  const startedAt = Date.now();
  const response = await withProviderCircuit(
    { service: "openai", store: serviceCircuitRepository },
    async () => {
      const result = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30_000),
      });
      if (!result.ok)
        throw new Error(`Summary provider returned ${result.status}`);
      return result;
    },
  );
  logServiceEvent({
    category: "provider",
    event: "summary-generated",
    outcome: "ok",
    service: "openai",
    durationMs: Date.now() - startedAt,
  });
  const body: unknown = await response.json();
  const envelope = isJsonObject(body) ? body : null;
  const text = outputText(envelope);
  if (!text) throw new Error("Summary provider returned no structured output");
  const usage = readObject(envelope, "usage");
  const inputTokens = readNumber(usage, "input_tokens") ?? 0;
  const outputTokens = readNumber(usage, "output_tokens") ?? 0;
  const inputRate = positiveNumber(
    process.env.OPENAI_INPUT_COST_PER_MILLION_USD,
    0,
  );
  const outputRate = positiveNumber(
    process.env.OPENAI_OUTPUT_COST_PER_MILLION_USD,
    0,
  );
  // The model was asked for a strict JSON object; anything else is refused by
  // the caller's output validation rather than trusted here.
  const parsed: unknown = JSON.parse(text);
  return {
    output: isJsonObject(parsed) ? parsed : null,
    inputTokens,
    outputTokens,
    estimatedCostUsd:
      (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000,
  };
};
