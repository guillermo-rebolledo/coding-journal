# Design reference

## The source of truth

**`docs/design/Coding Journal look and feel.html`** is the approved visual and
interaction direction for Coding Journal. Every UI change should be checked
against it, and every UI issue should link to it.

It is a self-contained bundle: open it in a browser to read it. The frames are
numbered, and code comments and issues refer to them by number.

| Frame  | What it specifies                                                                 |
| ------ | --------------------------------------------------------------------------------- |
| 1a     | Evidence-based audit and the design thesis — "a page, not a dashboard"            |
| 1b     | Visual foundation: type roles, colour duty, shape ladder, elevation, motion       |
| 1c     | Information architecture and navigation per window size class                     |
| 1d–1f  | Three metric-overview directions (`1e` is the one that ships)                     |
| 1g, 1h | Today, expanded and compact                                                       |
| 1i     | History index and a finalized day, with corrections and redaction                 |
| 1j     | Landing                                                                           |
| 1k     | Settings, including the destructive zone                                          |
| 1l     | Sign-in, onboarding steps 1 and 2, and the reusable progress pattern              |
| 1m     | Trust pages (Privacy / Terms / Data access) — not built yet, issue #17            |
| 1n     | The twelve component patterns everything else is built from                       |
| 1o     | The state gallery: completeness, freshness, limits, narrative, empties, auth      |
| 1p     | Responsive and accessibility specification                                        |
| 1q     | Implementation handoff, sequencing against issues #12–#17, and the open decisions |

`docs/design/app-look-and-feel-agent-prompt.md` is the brief the direction was
produced from. It states the constraints; the HTML states the answer. Where the
two disagree, the HTML wins.

## The rules that decide most reviews

1. **Lists before cards.** Group with alignment, whitespace and typography
   first; then a shared surface with a section heading; then a divided list. A
   card needs a reason to be isolated, and "Material uses cards" is not one.
2. **Expression lives in hierarchy.** One display-scale element per screen — the
   date. Everything else is title, body and label.
3. **Machine text is a different material.** The AI narrative is the only
   tertiary-tinted, 28dp surface in the product. Recorded facts are never
   tinted.
4. **Honesty is typographic, not chromatic.** Every incomplete, delayed or
   failed state says so in words, in the same slot, in the same type role.
   Colour and icon only reinforce; nothing depends on them.
5. **Shape carries meaning.** 4dp chips and inputs · 8dp list surfaces · 12dp
   tonal bands · 28dp narrative, onboarding and expressive empty states · full
   round for nav pills and buttons.
6. **Elevation is structure first.** Level 0 plus a divider is the default.
   Elevation 3 is only for things that truly float: menus, dialogs, snackbar,
   the sign-in surface.
7. **All four palettes keep working**, in light and dark, because every value
   above is a semantic role rather than a hue. Never hard-code a colour.

## What is implemented

Shared pieces live in `src/components/journal/`: `AppShell`, `MetricOverview`,
`ListSurface` / `SettingsRow` / `SectionGroup`, `StatusChip`, `StateBlock`,
`EvidenceLink` and `ProgressSteps`. Activity rows live in
`src/app/journal/journal-explorer.tsx`.

Landing, sign-in, onboarding, Today, History and Settings follow the reference.
The trust pages (frame 1m) and the destructive account-deletion zone (frame 1k)
are still open work — see issues #15 and #17.
