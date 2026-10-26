// The proof chain of a token, and the one rule about who may pass an invitation on (story 2.4).
// Both are pure: they read tokens and a callback, never the clock or the network.

import type { CapabilityAuth, CapabilityPayload, CapabilityToken, Did } from "@shopong/ports";

/** A chain longer than this is refused, as the adapter does. */
const MAX_CHAIN = 16;

/**
 * The token and every token it was delegated from, leaf first. `undefined` when any link cannot be
 * decoded or the chain is too deep.
 */
export async function chainOf(
  auth: CapabilityAuth,
  token: CapabilityToken,
): Promise<readonly CapabilityPayload[] | undefined> {
  return (await chainLinks(auth, token))?.map((link) => link.payload);
}

/** One link of a chain: the token as it was given, and what it says. */
export interface ChainLink {
  readonly token: CapabilityToken;
  readonly payload: CapabilityPayload;
}

/** The token and every token it was delegated from, leaf first, each with its own token. */
export async function chainLinks(
  auth: CapabilityAuth,
  token: CapabilityToken,
): Promise<readonly ChainLink[] | undefined> {
  const out: ChainLink[] = [];
  const walk = async (current: CapabilityToken, depth: number): Promise<boolean> => {
    if (depth > MAX_CHAIN) return false;
    const decoded = await auth.decode(current);
    if (!decoded.ok) return false;
    out.push({ token: current, payload: decoded.value });
    for (const parent of decoded.value.proofs) {
      if (!(await walk(parent, depth + 1))) return false;
    }
    return true;
  };
  return (await walk(token, 0)) ? out : undefined;
}

/**
 * An invitation (`member/join`) is either signed by the creator, or passed on by one co-treasurer
 * from their own role: at most two links, and the link above must be the one `mayPassOn` names.
 * Anyone else passing an invitation on is refused (S-2.3-24).
 */
export async function invitePassOnAllowed(
  auth: CapabilityAuth,
  chain: readonly CapabilityPayload[],
  mayPassOn: (inviter: Did, parentId: string) => boolean | Promise<boolean>,
): Promise<boolean> {
  if (chain.length === 1) return true;
  const leaf = chain[0];
  const parent = leaf?.proofs[0];
  if (
    chain.length !== 2 ||
    leaf === undefined ||
    leaf.proofs.length !== 1 ||
    parent === undefined
  ) {
    return false;
  }
  return mayPassOn(leaf.issuer, await auth.tokenId(parent));
}
