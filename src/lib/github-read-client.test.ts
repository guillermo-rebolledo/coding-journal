// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { JsonValue } from "@/lib/json-payload";
import {
  GitHubRequestError,
  createGitHubHttpReadClient,
} from "@/lib/github-read-client";

function response(body: JsonValue, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(body), { status, headers });
}

describe("GitHub HTTP read adapter", () => {
  it("lists every GitHub App installation accessible to the signed-in user", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
      app_slug: "coding-journal",
    }));
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response({ total_count: 101, installations: firstPage }),
      )
      .mockResolvedValueOnce(
        response({
          total_count: 101,
          installations: [{ id: 101, app_slug: "coding-journal" }],
        }),
      );

    const installations = await createGitHubHttpReadClient(
      "secret-token",
      request,
    ).userInstallations();

    expect(installations).toHaveLength(101);
    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/user/installations?per_page=100&page=1",
      expect.objectContaining({
        cache: "no-store",
        headers: expect.objectContaining({
          Authorization: "Bearer secret-token",
        }),
      }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://api.github.com/user/installations?per_page=100&page=2",
      expect.any(Object),
    );
  });

  it("owns headers and stops event pagination on the first short page", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response(Array.from({ length: 100 }, (_, id) => ({ id }))),
      )
      .mockResolvedValueOnce(response([{ id: 100 }]));
    const client = createGitHubHttpReadClient("secret-token", request);

    const result = await client.eventPages("ada");

    expect(result).toEqual({ items: expect.any(Array), degraded: false });
    expect(result.items).toHaveLength(101);
    expect(request).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/users/ada/events?per_page=100&page=1",
      expect.objectContaining({
        cache: "no-store",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: "Bearer secret-token",
          "X-GitHub-Api-Version": "2026-03-10",
        },
      }),
    );
  });

  it("caps the public event feed and reports that older events are withheld", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockImplementation(async () =>
        response(Array.from({ length: 100 }, (_, id) => ({ id }))),
      );

    const result = await createGitHubHttpReadClient(
      "token",
      request,
    ).eventPages("ada");

    expect(request).toHaveBeenCalledTimes(3);
    expect(result.degraded).toBe(true);
  });

  it("turns provider rate-limit headers into a retry instant", async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(
      response({ message: "limited" }, 429, {
        "x-ratelimit-reset": "1788350700",
      }),
    );
    const client = createGitHubHttpReadClient("token", request);

    await expect(client.authenticatedUser()).rejects.toMatchObject({
      name: "GitHubRequestError",
      status: 429,
      rateLimitResetAt: new Date(1788350700 * 1000),
    } satisfies Partial<GitHubRequestError>);
  });
});
