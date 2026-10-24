/** Where a fixture came from. Only `recorded` fixtures prove the vendor really behaves this way. */
export type FixtureSource = "recorded" | "synthetic-from-docs";

/** `outbound`: the OCN Node calls the vendor. `inbound`: the vendor calls the OCN Node (webhooks). */
export type FixtureDirection = "outbound" | "inbound";

export interface FixtureMeta {
  service: string;
  scenario: string;
  description: string;
  direction: FixtureDirection;
  source: FixtureSource;
  /** Documentation pages the shape was taken from (synthetic fixtures) or the sandbox used (recorded). */
  references: string[];
  /** ISO date the fixture was written (synthetic) or captured (recorded). */
  capturedAt: string;
  /** Mandatory while `source` is `synthetic-from-docs`: what must happen to replace it with a recording. */
  todo?: string;
}

export interface FixtureRequest {
  method: string;
  url: string;
  headers?: Record<string, string>;
  /** Parsed JSON body. Omitted for requests without a body. */
  body?: unknown;
}

export interface FixtureResponse {
  status: number;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface Fixture {
  service: string;
  scenario: string;
  meta: FixtureMeta;
  request: FixtureRequest;
  response: FixtureResponse;
}
