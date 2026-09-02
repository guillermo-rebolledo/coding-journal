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
day, and Settings.

Automation catches roughly half of the standard — contrast, accessible names,
roles, landmarks, labels, heading order. It cannot judge focus order, whether a
target is genuinely 44×44, or whether a status is stated in words as well as in
colour. Those are the manual review below.

The keyboard behaviours worth locking down are asserted directly in the same
spec: the skip link is the first tab stop on Today and on the trust pages, the
trust-page section index reaches its section at both size classes, and the
theme menu opens from the keyboard, moves between items with the arrow keys,
dismisses with Escape and returns focus to its trigger.

## Manual keyboard review

**Last reviewed: 1 September 2026**, against `main`, in Chrome and Safari on
macOS, at the default and 200 % zoom levels.

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

## Reporting a problem

Open a GitHub issue describing the assistive technology, browser and OS. An
accessibility defect is a bug like any other, not a feature request.
