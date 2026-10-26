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
  RECORD_MASTER_KEY: "3f7a91c0d2e4b5a6f8091a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d",
  STITCH_CLIENT_ID: "fake-stitch-client-id-7f3a91",
  STITCH_CLIENT_SECRET: "fake-stitch-client-secret-c04e55",
  SIMULATED_WEBHOOK_SECRET: "5b1e0c9d7a3f48e26d01c4b9a7e2f30d8c6b15a94e7d2f0a3c8b6e1d9f4a7c52",
  LEDFRA_API_TOKEN: "fake-ledfra-api-token-b81d27",
  COMMUNITY_SECRET: "fake-community-secret-hex-9c2e71d4",
  STABLECOIN_SIGNING_KEY: "fake-stablecoin-signing-key-93aa10",
  LLM_API_KEY: "fake-llm-api-key-5e2c68",
} as const;
