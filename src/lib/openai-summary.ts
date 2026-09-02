import type { SummaryProvider } from "@/lib/journal-summary";
import { serviceCircuitRepository } from "@/lib/service-circuit-repository";
import { withProviderCircuit } from "@/lib/service-circuit";
import { logServiceEvent } from "@/lib/telemetry";

type ResponsesEnvelope = {
  output_text?: string;
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
  usage?: { input_tokens?: number; output_tokens?: number };
};

function outputText(response: ResponsesEnvelope): string | null {
  if (response.output_text) return response.output_text;
  for (const item of response.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text) return content.text;
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
  const envelope = (await response.json()) as ResponsesEnvelope;
  const text = outputText(envelope);
  if (!text) throw new Error("Summary provider returned no structured output");
  const inputTokens = envelope.usage?.input_tokens ?? 0;
  const outputTokens = envelope.usage?.output_tokens ?? 0;
  const inputRate = positiveNumber(
    process.env.OPENAI_INPUT_COST_PER_MILLION_USD,
    0,
  );
  const outputRate = positiveNumber(
    process.env.OPENAI_OUTPUT_COST_PER_MILLION_USD,
    0,
  );
  return {
    output: JSON.parse(text) as unknown,
    inputTokens,
    outputTokens,
    estimatedCostUsd:
      (inputTokens * inputRate + outputTokens * outputRate) / 1_000_000,
  };
};
