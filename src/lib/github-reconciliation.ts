import {
  activityIdentity,
  commitDeduplicationKey,
  createActivityRecord,
  pushDeduplicationKey,
  validRepositoryName,
  validSha,
  type ActivityMetrics,
  type ActivityRecord,
} from "@/lib/github-activity";
import {
  GitHubRequestError,
  type GitHubReadClient,
} from "@/lib/github-read-client";
import { readActorStage } from "@/lib/github-reconciliation-actor-stage";
import {
  readEventsStage,
  suppressAppModeRefObservation,
} from "@/lib/github-reconciliation-events-stage";
import { readGistsStage } from "@/lib/github-reconciliation-gists-stage";
import { readInstallationStage } from "@/lib/github-reconciliation-installation-stage";
import {
  collaborationEventForApiType,
  deriveCollaborationSubject,
} from "@/lib/github-collaboration";
import {
  normalizeGistActivity,
  normalizeGistStarActivity,
  normalizeSocialEvent,
  secondarySourceFreshness,
  type SecondarySourceFreshness,
} from "@/lib/github-secondary";
import {
  readBoolean,
  readNonEmptyString,
  readNumber,
  readObject,
  readObjectArray,
  readPositiveInteger,
  readString,
  type JsonObject,
} from "@/lib/json-payload";
import {
  getLocalDayWindow,
  getLocalDayWindowForDate,
  parseDate,
} from "@/lib/time-zone";
import { journalReconciliationCooldownMs } from "@/lib/today-journal-policy";

export type TodayJournal = {
  localDate: string;
  timeZone: string;
  status: "loading" | "complete" | "partial" | "error";
  refreshedAt: Date | null;
  /** Last persisted mutation of this day's journal. */
  storedAt?: Date;
  /** Last time a GitHub reconciliation claimed the cooldown window. */
  lastAttemptAt?: Date;
  /** Transient provider limit returned by an attempted reconciliation. */
  rateLimitedUntil?: Date;
  /** True only for an empty stored view before the first manual reconciliation. */
  awaitingReconciliation?: boolean;
  metrics: ActivityMetrics;
  activities: ActivityRecord[];
  sourceFreshness?: SecondarySourceFreshness[];
};

export type ReconciliationStore = {
  tryStart(
    userId: string,
    localDate: string,
    now: Date,
    cutoff: Date,
    timeZone: string,
  ): Promise<boolean>;
  finish(
    userId: string,
    journal: Omit<TodayJournal, "activities" | "metrics">,
    records: ActivityRecord[],
  ): Promise<void>;
  read(userId: string, localDate: string): Promise<TodayJournal>;
};

// Reconciliation swallows provider failures by design; this reports what
// failed without exposing request bodies, payloads, or credentials.
export type ReconciliationDiagnostic = {
  stage:
    | "user-access-token"
    | "actor"
    | "events"
    | "gists"
    | "gist-metadata"
    | "push-commits"
    | "installation-repositories"
    | "repository-commits";
  errorName: string;
  errorMessage: string;
  rateLimitResetAt?: Date;
};

export type DiagnosticReporter = (diagnostic: ReconciliationDiagnostic) => void;

/** What a failed reconciliation stage reports about the error that stopped it. */
type ErrorDescription = Pick<
  ReconciliationDiagnostic,
  "errorName" | "errorMessage" | "rateLimitResetAt"
>;

export function describeError(cause: unknown): ErrorDescription {
  if (cause instanceof GitHubRequestError) {
    const described: ErrorDescription = {
      errorName: cause.name,
      errorMessage: cause.message,
    };
    // Only rate-limit failures carry a reset instant; the others must not
    // report one at all.
    if (cause.rateLimitResetAt) {
      described.rateLimitResetAt = cause.rateLimitResetAt;
    }
    return described;
  }
  if (cause instanceof Error) {
    return { errorName: cause.name, errorMessage: cause.message };
  }
  return {
    errorName: "UnknownError",
    errorMessage: "A non-error value was thrown",
  };
}

/** The actor whose activity this pass reconciles. */
type GitHubActor = { id: number; login: string };

export async function reconcileGitHubActivity({
  userId,
  timeZone,
  accessMode,
  installationIds,
  client,
  now,
  localDate,
  store,
  reportDiagnostic = () => {},
}: {
  userId: string;
  timeZone: string;
  accessMode: "best-effort" | "app";
  installationIds: string[];
  client: GitHubReadClient | null;
  now: Date;
  localDate?: string;
  store: ReconciliationStore;
  reportDiagnostic?: DiagnosticReporter;
}): Promise<TodayJournal> {
  const window = localDate
    ? getLocalDayWindowForDate(localDate, timeZone)
    : getLocalDayWindow(now, timeZone);
  const started = await store.tryStart(
    userId,
    window.localDate,
    now,
    new Date(now.getTime() - journalReconciliationCooldownMs),
    timeZone,
  );
  if (!started) return store.read(userId, window.localDate);

  if (!client) {
    const sourceFreshness = secondarySourceFreshness({
      refreshedAt: now,
      eventsSucceeded: false,
      gistsSucceeded: false,
    });
    await store.finish(
      userId,
      {
        localDate: window.localDate,
        timeZone,
        status: "error",
        refreshedAt: null,
        sourceFreshness,
      },
      [],
    );
    return store.read(userId, window.localDate);
  }

  const records = new Map<string, ActivityRecord>();
  let actor: GitHubActor | null = null;
  let eventsSucceeded = false;
  let gistsSucceeded = false;
  let repositoryCommitsSucceeded = false;
  let degraded = false;

  try {
    const rawActor = await readActorStage(client);
    const actorId = readPositiveInteger(rawActor, "id");
    const actorLogin = readString(rawActor, "login");
    if (actorId === null || actorLogin === null) {
      throw new Error("GitHub actor response was invalid");
    }
    actor = { id: actorId, login: actorLogin };
  } catch (error) {
    reportDiagnostic({ stage: "actor", ...describeError(error) });
    degraded = true;
  }

  if (actor) {
    try {
      const eventPages = await readEventsStage(client, actor.login);
      const rawEvents = eventPages.items;
      if (eventPages.degraded) degraded = true;
      if (eventPages.diagnosticError) {
        reportDiagnostic({
          stage: "events",
          ...describeError(eventPages.diagnosticError),
        });
      }

      for (const rawEvent of rawEvents) {
        const eventId = readString(rawEvent, "id");
        const repository = readObject(rawEvent, "repo");
        const repositoryId = readPositiveInteger(repository, "id");
        const repositoryName = readString(repository, "name");
        const eventActor = readObject(rawEvent, "actor");
        const eventActorId = readPositiveInteger(eventActor, "id");
        const eventActorLogin = readString(eventActor, "login");
        const isPublic = readBoolean(rawEvent, "public");
        const payload = readObject(rawEvent, "payload");
        if (
          eventId === null ||
          eventActorId === null ||
          eventActorId !== actor.id ||
          eventActorLogin === null ||
          repositoryId === null ||
          !validRepositoryName(repositoryName) ||
          isPublic === null
        ) {
          continue;
        }

        const eventOccurredAt = parseDate(readString(rawEvent, "created_at"));

        const socialRecord = normalizeSocialEvent({
          event: rawEvent,
          actor,
          window,
          observedAt: now,
        });
        if (socialRecord) {
          records.set(socialRecord.deduplicationKey, socialRecord);
          continue;
        }

        const eventType = readString(rawEvent, "type");
        const collaborationEvent = collaborationEventForApiType(eventType);
        if (collaborationEvent) {
          // Ref webhooks have no action timestamp, so there is no exact
          // content identity shared with the Events API. App mode uses its
          // durable webhook observation; best-effort mode uses the event id.
          // Keeping the sources disjoint avoids both double-counting and
          // collapsing a create-delete-recreate cycle.
          if (
            suppressAppModeRefObservation({
              accessMode,
              hasInstallation: installationIds.length > 0,
              event: collaborationEvent,
            })
          ) {
            continue;
          }
          const derivation = deriveCollaborationSubject(
            collaborationEvent,
            payload,
            { id: String(repositoryId), name: repositoryName },
            eventOccurredAt ?? undefined,
            eventId,
          );
          if (!derivation.ok) continue;
          const { subject } = derivation;
          // The feed timestamps events at delivery; the subject carries the
          // content instant shared with webhook copies of the same action.
          if (
            subject.occurredAt < window.startsAt ||
            subject.occurredAt >= window.endsAt ||
            records.has(subject.deduplicationKey)
          ) {
            continue;
          }
          const keyPrefix = `github:${subject.kind}:${repositoryId}:`;
          if (!subject.deduplicationKey.startsWith(keyPrefix)) continue;
          records.set(
            subject.deduplicationKey,
            createActivityRecord({
              kind: subject.kind,
              identity: activityIdentity.repository(
                subject.kind,
                String(repositoryId),
                subject.deduplicationKey.slice(keyPrefix.length),
              ),
              evidence: { shape: "absolute", url: subject.evidenceUrl },
              actor: { id: String(eventActorId), login: eventActorLogin },
              repository: {
                id: String(repositoryId),
                name: repositoryName,
                private: !isPublic,
              },
              subject: {
                id: subject.subjectId,
                number: subject.subjectNumber,
                title: subject.title,
              },
              source: "github-events",
              occurredAt: subject.occurredAt,
              observedAt: now,
              window,
              installationId: null,
            }),
          );
          continue;
        }

        const occurredAt = eventOccurredAt;
        const pushHead = readString(payload, "head");
        const pushBefore = readString(payload, "before");
        if (
          eventType !== "PushEvent" ||
          !occurredAt ||
          occurredAt < window.startsAt ||
          occurredAt >= window.endsAt ||
          !validSha(pushHead) ||
          !validSha(pushBefore)
        ) {
          continue;
        }
        // Keyed on content, not the events API id, so webhook-ingested copies
        // of the same push collapse into one canonical record.
        const pushKey = pushDeduplicationKey(
          String(repositoryId),
          pushBefore,
          pushHead,
        );
        if (records.has(pushKey)) continue;
        records.set(
          pushKey,
          createActivityRecord({
            kind: "push",
            identity: activityIdentity.push(
              String(repositoryId),
              pushBefore,
              pushHead,
            ),
            evidence: { shape: "push", before: pushBefore, head: pushHead },
            actor: { id: String(eventActorId), login: eventActorLogin },
            repository: {
              id: String(repositoryId),
              name: repositoryName,
              private: !isPublic,
            },
            subject: { id: eventId, number: null, title: null },
            source: "github-events",
            occurredAt,
            observedAt: now,
            window,
            installationId: null,
          }),
        );

        try {
          const pushedCommits: JsonObject[] = [];
          const announcedCommits = readObjectArray(payload, "commits") ?? [];
          if (!/^0+$/.test(pushBefore)) {
            const comparison = await client.compareRange(
              repositoryName,
              pushBefore,
              pushHead,
            );
            pushedCommits.push(...comparison.items);
            if (comparison.degraded) degraded = true;
          } else if (announcedCommits.length > 0) {
            for (const candidate of announcedCommits) {
              const candidateSha = readString(candidate, "sha");
              if (!validSha(candidateSha)) continue;
              pushedCommits.push(
                await client.commit(repositoryName, candidateSha),
              );
            }
            if (readNumber(payload, "size") !== pushedCommits.length) {
              degraded = true;
            }
          } else {
            pushedCommits.push(await client.commit(repositoryName, pushHead));
            degraded = true;
          }

          for (const commit of pushedCommits) {
            const commitSha = readString(commit, "sha");
            const authoredAt = parseDate(
              readString(
                readObject(readObject(commit, "commit"), "author"),
                "date",
              ),
            );
            if (
              !validSha(commitSha) ||
              !authoredAt ||
              readPositiveInteger(readObject(commit, "author"), "id") !==
                actor.id
            ) {
              continue;
            }
            const commitKey = commitDeduplicationKey(
              String(repositoryId),
              commitSha,
            );
            if (records.has(commitKey)) continue;
            records.set(
              commitKey,
              createActivityRecord({
                kind: "commit",
                identity: activityIdentity.commit(
                  String(repositoryId),
                  commitSha,
                ),
                evidence: { shape: "commit", sha: commitSha },
                actor: { id: String(actor.id), login: actor.login },
                repository: {
                  id: String(repositoryId),
                  name: repositoryName,
                  private: !isPublic,
                },
                subject: { id: commitSha, number: null, title: null },
                source: "github-events",
                occurredAt: authoredAt,
                observedAt: now,
                window,
                installationId: null,
              }),
            );
          }
        } catch (error) {
          reportDiagnostic({ stage: "push-commits", ...describeError(error) });
          degraded = true;
        }
      }
      eventsSucceeded = true;
    } catch (error) {
      reportDiagnostic({ stage: "events", ...describeError(error) });
      degraded = true;
    }
  }

  if (actor) {
    try {
      const { owned: gists, starred: starredGists } = await readGistsStage(
        client,
        window.startsAt,
      );

      for (const gist of gists) {
        const gistIdentifier = readNonEmptyString(gist, "id");
        if (gistIdentifier === null) {
          degraded = true;
          continue;
        }
        try {
          const { commits: gistCommits, comments: gistComments } =
            await client.gistMetadata(gistIdentifier);
          for (const record of normalizeGistActivity({
            gist,
            commits: gistCommits,
            comments: gistComments,
            actor,
            window,
            observedAt: now,
          })) {
            records.set(record.deduplicationKey, record);
          }
        } catch (error) {
          reportDiagnostic({ stage: "gist-metadata", ...describeError(error) });
          degraded = true;
        }
      }
      for (const gist of starredGists) {
        const record = normalizeGistStarActivity({
          gist,
          actor,
          window,
          observedAt: now,
        });
        if (record) records.set(record.deduplicationKey, record);
        else degraded = true;
      }
      gistsSucceeded = true;
    } catch (error) {
      reportDiagnostic({ stage: "gists", ...describeError(error) });
      degraded = true;
    }
  }

  if (accessMode === "app") {
    if (!actor || installationIds.length === 0) {
      degraded = true;
    } else {
      for (const installationId of installationIds) {
        try {
          const repositories = await readInstallationStage(
            client,
            installationId,
          );

          for (const repository of repositories) {
            const repositoryId = readPositiveInteger(repository, "id");
            const repositoryName = readString(repository, "full_name");
            const isPrivate = readBoolean(repository, "private");
            if (
              repositoryId === null ||
              !validRepositoryName(repositoryName) ||
              isPrivate === null
            ) {
              degraded = true;
              continue;
            }

            try {
              const commitsResult = await client.repositoryCommits({
                repositoryName,
                actorLogin: actor.login,
                startsAt: window.startsAt,
                endsAt: now,
              });
              const rawCommits = commitsResult.items;
              if (commitsResult.degraded) degraded = true;

              for (const commit of rawCommits) {
                const commitSha = readString(commit, "sha");
                const authoredAt = parseDate(
                  readString(
                    readObject(readObject(commit, "commit"), "author"),
                    "date",
                  ),
                );
                if (
                  !validSha(commitSha) ||
                  !authoredAt ||
                  authoredAt < window.startsAt ||
                  authoredAt >= window.endsAt ||
                  readPositiveInteger(readObject(commit, "author"), "id") !==
                    actor.id
                ) {
                  continue;
                }
                const commitKey = commitDeduplicationKey(
                  String(repositoryId),
                  commitSha,
                );
                records.set(
                  commitKey,
                  createActivityRecord({
                    kind: "commit",
                    identity: activityIdentity.commit(
                      String(repositoryId),
                      commitSha,
                    ),
                    evidence: { shape: "commit", sha: commitSha },
                    actor: { id: String(actor.id), login: actor.login },
                    repository: {
                      id: String(repositoryId),
                      name: repositoryName,
                      private: isPrivate,
                    },
                    subject: { id: commitSha, number: null, title: null },
                    source: "github-repository-commits",
                    occurredAt: authoredAt,
                    observedAt: now,
                    window,
                    installationId,
                  }),
                );
              }
            } catch (error) {
              reportDiagnostic({
                stage: "repository-commits",
                ...describeError(error),
              });
              degraded = true;
            }
          }

          repositoryCommitsSucceeded = true;
        } catch (error) {
          reportDiagnostic({
            stage: "installation-repositories",
            ...describeError(error),
          });
          degraded = true;
        }
      }
    }
  }

  const successfulSource =
    eventsSucceeded || gistsSucceeded || repositoryCommitsSucceeded;
  const status = !successfulSource
    ? "error"
    : degraded
      ? "partial"
      : "complete";
  const sourceFreshness = secondarySourceFreshness({
    refreshedAt: now,
    eventsSucceeded,
    gistsSucceeded,
  });

  await store.finish(
    userId,
    {
      localDate: window.localDate,
      timeZone,
      status,
      refreshedAt: successfulSource ? now : null,
      sourceFreshness,
    },
    [...records.values()],
  );

  return store.read(userId, window.localDate);
}
