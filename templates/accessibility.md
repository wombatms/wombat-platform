---
id: TC-COMPONENT-A11Y-XXXX
title: "{{FEATURE}} meets WCAG 2.1 AA accessibility requirements"
summary: "Verify {{FEATURE}} is accessible to users with disabilities per WCAG 2.1 AA guidelines."
status: draft
priority: high
type: accessibility
component: "{{COMPONENT}}"
subcomponent: "{{SUBCOMPONENT}}"
owner: "{{OWNER}}"
tags:
  - accessibility
  - a11y
  - wcag
requirements:
  - "{{REQ_ID}}"
  - "REQ-A11Y-WCAG21-AA"
preconditions:
  - "Screen reader (NVDA/VoiceOver) is available for manual checks"
  - "axe-core or equivalent automated a11y scanner is configured"
  - "{{PRECONDITION}}"
steps:
  - number: 1
    action: "Run automated accessibility scan on {{URL_OR_COMPONENT}} using axe-core"
    expected: "Zero critical or serious violations reported by axe-core"
  - number: 2
    action: "Navigate through {{FEATURE}} using keyboard only (Tab, Shift+Tab, Enter, Space, Arrow keys)"
    expected: "All interactive elements are reachable; focus order is logical; focus indicator is visible"
  - number: 3
    action: "Navigate {{FEATURE}} with a screen reader enabled"
    expected: "All elements have meaningful labels; dynamic content changes are announced; no screen reader traps"
  - number: 4
    action: "Zoom the browser to 200%"
    expected: "Content reflows without horizontal scrolling; no text is clipped or overlapping"
  - number: 5
    action: "Check color contrast of all text elements using a contrast analyzer"
    expected: "Normal text meets 4.5:1 ratio; large text meets 3:1 ratio"
  - number: 6
    action: "Verify all images and icons in {{FEATURE}}"
    expected: "Decorative images have empty alt text; informational images have descriptive alt text"
automation:
  status: candidate
  framework: playwright
  source: "tests/a11y/{{COMPONENT}}/{{FEATURE}}.spec.ts"
review:
  state: draft
  reviewers: []
version: 1
---

## WCAG 2.1 AA Checklist

### Perceivable
- [ ] 1.1.1 Non-text Content — alt text for all meaningful images
- [ ] 1.3.1 Info and Relationships — semantic HTML (headings, lists, tables)
- [ ] 1.4.3 Contrast (Minimum) — 4.5:1 for normal text, 3:1 for large text
- [ ] 1.4.4 Resize Text — 200% zoom without loss of content

### Operable
- [ ] 2.1.1 Keyboard — all functionality accessible via keyboard
- [ ] 2.1.2 No Keyboard Trap — focus can always be moved away
- [ ] 2.4.3 Focus Order — meaningful, logical focus sequence
- [ ] 2.4.7 Focus Visible — visible keyboard focus indicator

### Understandable
- [ ] 3.3.1 Error Identification — errors described in text
- [ ] 3.3.2 Labels or Instructions — form inputs have labels

### Robust
- [ ] 4.1.2 Name, Role, Value — all UI components have accessible name and role

## Tools Used

- **Automated:** axe-core, Lighthouse accessibility audit
- **Manual:** {{SCREEN_READER}} on {{OS}}
- **Contrast:** {{CONTRAST_TOOL}}

## Notes

<!-- Document any known accessibility limitations or deferred items. -->
