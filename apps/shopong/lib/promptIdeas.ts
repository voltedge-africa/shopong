/**
 * Things a person might ask for, in the way they would say it. The compose box cycles through them
 * as its placeholder so people see what the builder can do. Every one of them can be built.
 */
export const PROMPT_IDEAS: readonly string[] = [
  "I need a way to track who owes me and have a way of reminding them",
  "I keep running out of stock and want to know what to reorder",
  "My driver needs a list of stops for the day and a way to prove each delivery",
  "Help me keep track of who has paid into our stokvel this month",
  "I need a price list I can compare between my suppliers",
  "I want a simple dashboard of my daily sales",
];

/** How long each idea shows before the next one. */
export const IDEA_MS = 3500;

/** The idea after `index`, wrapping round to the first. */
export const nextIdea = (index: number): number => (index + 1) % PROMPT_IDEAS.length;
