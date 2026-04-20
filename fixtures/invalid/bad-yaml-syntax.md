---
id: TC-PAYMENTS-BADYAML-0001
title: Test with broken YAML
  this line has bad indentation that breaks YAML parsing
component: payments
owner: qa-platform
steps:
  - number: 1
    action: "unclosed string value
    expected: Something
---

This fixture is intentionally malformed YAML. The frontmatter parser should
raise a YAML parse error (not a validation error) when reading this file.
