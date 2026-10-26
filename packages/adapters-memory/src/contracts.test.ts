// Every port's contract suite, pointed at its in-memory adapter. A real adapter gets the
// same one-line call with its own factory; the suites themselves never change.
import {
  runAgentContract,
  runCapabilityAuthContract,
  runDecideContract,
  runGenUiContract,
  runGeoContract,
  runLedgerContract,
  runCommitmentsContract,
  runOcrContract,
  runPayInContract,
  runPayOutContract,
  runRoutingContract,
  runSharedRecordContract,
  runStableRailContract,
  type ContractEvent,
} from "@shopong/ports-contract";
import { asSha512Hex, type CapabilityToken, type Clock } from "@shopong/ports";
import { webCryptoHmac } from "./test-hmac.js";
import {
  MemoryAgent,
  MemoryCapabilityAuth,
  MemoryDecide,
  MemoryGenUi,
  MemoryGeo,
  MemoryLedger,
  MemoryCommitments,
  MemoryOcr,
  MemoryPayIn,
  MemoryPayOut,
  MemoryRouting,
  MemoryStableRail,
  createMemoryRecordNetwork,
} from "./index.js";

// Payment processors and chains run on their own (wall) clock; only `apply` needs log time.
const wallClock: Clock = { now: () => Date.now() };

runCapabilityAuthContract(() => new MemoryCapabilityAuth());

runSharedRecordContract(() => {
  const network = createMemoryRecordNetwork();
  let peers = 0;
  return {
    peer: async () => network.peer<ContractEvent>(`did:mem:peer-${String(++peers)}`),
    replicate: (a, b) => network.replicate(a, b),
  };
});

runLedgerContract(() => new MemoryLedger());

runPayInContract(() => {
  const payIn = new MemoryPayIn({ clock: wallClock });
  return { payIn, settle: async (id, outcome) => payIn.simulateWebhook(id, outcome) };
});

runPayOutContract(() => {
  const payOut = new MemoryPayOut({ clock: wallClock });
  return { payOut, settle: async (id, outcome) => payOut.simulateWebhook(id, outcome) };
});

runStableRailContract(() => {
  const rail = new MemoryStableRail({ clock: wallClock });
  return { rail, fund: (address, amount) => rail.mint(address, amount) };
});

runOcrContract(() => {
  const sha512 = asSha512Hex("ab".repeat(64));
  const ocr = new MemoryOcr({
    documents: [
      {
        uri: "hyperdrive://drive/price-list.png",
        sha512,
        pages: [
          {
            index: 0,
            blocks: [
              {
                type: "title",
                text: "Bulk Foods price list",
                box: { x0: 0.1, y0: 0.05, x1: 0.9, y1: 0.1 },
                confidence: 0.98,
              },
              {
                type: "table",
                text: "Maize meal 10kg | R89.99",
                box: { x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.6 },
                confidence: 0.91,
              },
            ],
          },
        ],
      },
    ],
  });
  return {
    ocr,
    document: { uri: "hyperdrive://drive/price-list.png", sha512, mime: "image/png" },
    expectedText: "Maize meal 10kg",
    missing: {
      uri: "hyperdrive://drive/missing.png",
      sha512: asSha512Hex("cd".repeat(64)),
      mime: "image/png",
    },
  };
});

runDecideContract(() => new MemoryDecide());

runRoutingContract(() => ({
  routing: new MemoryRouting(),
  origin: { lat: -26.2485, lng: 27.854 }, // Soweto
  destination: { lat: -26.1035, lng: 28.0972 }, // Alexandra
  outside: { lat: -1.2921, lng: 36.8219 }, // Nairobi
}));

runGeoContract(() => new MemoryGeo());

runAgentContract(async () => {
  const auth = new MemoryCapabilityAuth();
  const owner = await auth.createIdentity();
  const agentDid = await auth.createIdentity();
  const result = await auth.issue({
    issuer: owner,
    audience: agentDid,
    capabilities: [{ with: "ocn:space/demo", can: "agent/act" }],
    expiresAt: Date.now() + 600_000,
  });
  if (!result.ok) throw new Error(result.error.message);
  return { agent: new MemoryAgent(), owner, capability: result.value satisfies CapabilityToken };
});

runGenUiContract(() => new MemoryGenUi());

runCommitmentsContract(() => {
  const commitments = new MemoryCommitments({ hmac: webCryptoHmac });
  commitments.addCommunity("a".repeat(64), new Uint8Array(32).fill(1));
  commitments.addCommunity("b".repeat(64), new Uint8Array(32).fill(2));
  commitments.addCommunity("s".repeat(64), new Uint8Array(16).fill(3));
  return {
    commitments,
    a: "a".repeat(64),
    b: "b".repeat(64),
    short: "s".repeat(64),
    unknown: "u".repeat(64),
  };
});
