# @shopong/component-library

The approved OCN component library for generated interfaces (story 11.4, AD-11). It is the allow-list of
parts a generated screen may be made of, and of which capability each part may read or trigger.

- **`OCN_COMPONENT_LIBRARY`**: the library itself. Eleven parts: Stack, Metric, PledgeProgress, Table, Form,
  Timeline, Map, Chart, ActionButton, MemberList, QuoteCompare. Root is `Stack`.
- **`createLibrary(definition)`**: checks a library definition and returns the port's `ComponentLibrary`.
  Every component must declare `reads` and `actions` (an empty list means none). It refuses, and lists
  together, any name or child that does not resolve, a reserved prop name, an enum on a non-string prop, and
  any capability that is unknown or used the wrong way (a read bound as an action, or an action bound as a
  read).
- **`CAPABILITY_KINDS`**: the catalogue. `read` tools (`ledger.read`, `members.list`, `pledges.query`,
  `quote.compare`, `route.plan`), `write` tools (`order.propose`, `message.send`, `delivery.confirm`) and the
  `money` tool (`payment.request`, which the capability holds until the member approves).

The spec and the system prompt are built from this library by `@shopong/adapters-openui`:
`generateSpec(library)` (the JSON Schema) and `generateSystemPrompt(library)`. All of it runs locally; the
tests stub `fetch` and assert it is never called.

Changing a part, its props or their order needs a new `version`: a saved solution is pinned to the version
it was written against.

## Dependencies

None outside the workspace. It depends on `@shopong/ports` for the `ComponentLibrary` type.
