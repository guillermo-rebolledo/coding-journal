# Accessibility

Coding Journal targets **WCAG 2.2 AA** across every primary flow. Frame 1p of
the [design reference](design/README.md) is the specification; this document
records how conformance is checked and what the last manual review found.

## Automated coverage

`e2e/accessibility.spec.ts` runs axe-core against every primary route in both
the light and the dark theme, with the tags `wcag2a`, `wcag2aa`, `wcag21a`,
`wcag21aa` and `wcag22aa`. Any violation fails the suite — there is no
allowlist of accepted violations, and adding one should be treated as a
decision rather than a fix.

```sh
pnpm test:e2e accessibility
```

Routes covered: landing, sign-in, Privacy, Terms, Data access, onboarding steps
1 and 2, Today (with activity and in best-effort mode), History, a finalized
day, a missing journal day, a journal-day render failure, and Settings.

The axe scan expands every closed disclosure before analysis. A separate
category-table matrix checks all four palettes in both themes, and compact-form
coverage protects the 16px input floor that prevents iOS Safari zoom. This
expansion matters: the previous 27 passing route scans never exposed the closed
category tables, so a 4.06:1 text pair inside them escaped the suite.

Automation catches roughly half of the standard — contrast, accessible names,
roles, landmarks, labels, and heading order. Direct browser assertions cover
the focus and keyboard behaviours listed below. Real target size, screen-reader
announcement order, and whether status wording remains clear without colour
still require the manual release gate.

The keyboard behaviours worth locking down are asserted directly in the same
spec: the skip link is the first tab stop on Today and on the trust pages, the
trust-page section index reaches its section at both size classes, and the
theme menu opens from the keyboard, moves between items with the arrow keys,
dismisses with Escape and returns focus to its trigger.

In-flight journal actions have their own regression assertions: Refresh keeps
its accessible name and focus while busy, and destructive confirmation actions
remain named and focusable while refusing duplicate activation.

## Manual keyboard review

### Review: 2 September 2026

Reviewed on the implementation branch in Chromium at desktop and mobile size
classes. The thirteen findings recorded in issue #38 were resolved as follows:

| Severity | Finding                                                                | Resolution                                                                                                                                                       |
| -------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| High     | Narrative redaction was a single-click destructive action.             | Redaction now requires an exact, labelled typed confirmation, with an actionable error bound through `aria-describedby`; cancel restores focus to the trigger.   |
| High     | Category-table text fell below AA contrast in one palette/theme pair.  | Category values now use `on-surface-variant`, active values receive a non-colour emphasis, and every palette/theme pair is suite-enforced.                       |
| High     | Missing and failed journal-day routes had no accessible boundaries.    | The route now has dedicated not-found and error views with an expressive `h1`, neutral data-integrity language, retry where applicable, and History/Today exits. |
| Medium   | In-flight actions replaced their names and lost useful focus state.    | Refresh, finalization retry, and narrative redaction keep stable accessible names, native focus, `aria-busy`, and duplicate-activation protection.               |
| Medium   | Landing footer trust links lacked a clear link affordance.             | Trust links are underlined in addition to their colour treatment.                                                                                                |
| Medium   | Compact form controls used 14px text, triggering iOS zoom.             | Text-entry controls use a 16px role at compact widths, protected by a browser regression check.                                                                  |
| Medium   | Destructive typed confirmations lacked actionable validation guidance. | The shared confirmation field explains the exact phrase required and binds that message to the input.                                                            |
| Medium   | The history view switcher exposed no group name.                       | Each switcher is now a named `group`, scoped to its explorer title.                                                                                              |
| Low      | Finalized-day filters reused duplicate accessible names.               | Repository and activity filters derive distinct names from their section title.                                                                                  |
| Low      | Per-repository content introduced redundant region landmarks.          | The visual section remains, while the unnecessary labelled `region` role was removed.                                                                            |
| Low      | Copy mixed spelling and apostrophe conventions.                        | Interface and trust copy now consistently use British spelling and straight apostrophes.                                                                         |
| Low      | Root text rendering omitted the reference's font smoothing.            | The root body now applies the shared antialiasing treatment.                                                                                                     |
| Low      | The Settings time-zone row did not explain why it is fixed.            | The row now says that the time zone is fixed to keep historical journal days stable.                                                                             |

Still unverified in automation: real iOS Safari software-keyboard and zoom
behaviour, real Android Chrome system-inset behaviour, forced-colours rendering,
and screen-reader announcement order. These remain explicit release gates in
[The public release gate](release-gate.md); they must be recorded in the release
PR rather than inferred from an axe pass.

### Previous review: 1 September 2026

This earlier review ran against `main` in Chrome and Safari on macOS, at the
default and 200 % zoom levels.

Each primary flow was driven with the keyboard alone — no pointer — checking
the focus order the reference specifies: skip link → navigation → day masthead
→ primary action → narrative → filters → list → supporting pane.

| Flow                        | Result                                                                                                                                  |
| --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Landing → sign-in           | Pass. Trust links are reachable before the GitHub button in every tab order.                                                            |
| Trust pages                 | Pass. Skip link first; the section index is a disclosure on compact and a standing list from expanded, and both reach the same anchors. |
| Onboarding step 1           | Pass. The field keeps focus after a rejected time zone and the error is bound with `aria-describedby`.                                  |
| Onboarding step 2           | Pass. Install and skip are both reachable; skip is not visually or focus-order punished.                                                |
| Today                       | Pass. Refresh is reached before the activity list at every width; the refresh outcome lands in the existing polite live region.         |
| Today filters               | Pass. Changing a filter announces the new count politely; the view switcher preserves the filter.                                       |
| History and a finalized day | Pass. The day link is a real link, back and forward behave, and corrections are reachable in reading order.                             |
| Settings                    | Pass. Grouped lists, real labels, and the destructive zone last.                                                                        |
| Account deletion            | Pass. The typed confirmation is a labelled input, and the destructive action is never the resting focus.                                |

Findings from this review, both fixed in the same change:

- The development overlay was intercepting pointer events over the trust-page
  footer. It is dev-only chrome, now disabled under `E2E_AUTH_MODE`, but it was
  worth confirming the footer links are genuinely reachable.
- The trust-page section index was initially a single `<details>` forced open by
  CSS at expanded width, which cannot be done reliably. It is now a disclosure
  on compact and a standing list from expanded, with only one of the two ever
  displayed so the accessibility tree has a single copy.

## Known platform limitations

**Safari and Tab.** WebKit only moves focus to links and menu items when
"Press Tab to highlight each item" is enabled in Safari's Advanced settings. It
is off by default and a page cannot change it. Three keyboard assertions
therefore skip on the WebKit project; the same paths were walked by hand in
Safari with the preference enabled and behave as they do in Chrome. This is a
platform default, not a defect in the product — every one of those controls is
a real link or a real menu item.

**Reduced motion.** The global reduced-motion block neutralizes the spring
transitions. Under it, progress becomes determinate-static, selection changes
instantly, and disclosures open without a height animation — motion is never
the only cue for a state change.

## Rules that make the automated checks pass by construction

These come from the design reference and are the reason violations are rare
rather than fixed one at a time:

- **Never colour alone.** Every status carries a word in the same slot and the
  same type role; the dot and the tone only reinforce it.
- **One h1 per route** — the date on a journal page, the document title on a
  trust page.
- **Targets are 44×44**, kept there by padding rather than by growing the
  visible element.
- **Nothing is truncated without a reachable full value.** Repository names
  wrap rather than ellipsize.
- **`on-surface-variant` is the lightest text permitted**, and never below
  13px, so contrast holds in all four palettes in both themes.

The final rule is enforced by the category-table palette/theme matrix and by
opening every disclosure before each axe scan; it is no longer only a design
convention.

## Reporting a problem

Open a GitHub issue describing the assistive technology, browser and OS. An
accessibility defect is a bug like any other, not a feature request.
