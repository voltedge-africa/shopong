import type { LogSink } from "../logger.ts";

/** A log sink that keeps every line, for assertions. */
export function captureSink(): LogSink & { lines: string[]; text(): string } {
  const lines: string[] = [];
  return {
    lines,
    write: (line) => void lines.push(line),
    text: () => lines.join(""),
  };
}

/** Distinctive fake secret values that are easy to grep for in output. */
export const FAKE_SECRETS = {
  STITCH_CLIENT_ID: "fake-stitch-client-id-7f3a91",
  STITCH_CLIENT_SECRET: "fake-stitch-client-secret-c04e55",
  LEDFRA_API_TOKEN: "fake-ledfra-api-token-b81d27",
  STABLECOIN_SIGNING_KEY: "fake-stablecoin-signing-key-93aa10",
  LLM_API_KEY: "fake-llm-api-key-5e2c68",
} as const;
