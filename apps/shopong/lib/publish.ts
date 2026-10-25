import type { MiniAppCategory } from "@shopong/miniapp";

import type { AppIcon, Build } from "./builder";
import type { Artifact } from "./ci";

/** Everything the person decides when they publish: what the app is called and how it looks. */
export type PublishForm = {
  name: string;
  description: string;
  icon: AppIcon;
  category: MiniAppCategory;
  /** What is new in this version. Only asked for when updating an app that is already published. */
  notes: string;
};

/**
 * An app as the platform records it: what it is called and looks like, which version it is, how it
 * runs, what it may do and the file it came from. This is all the platform needs to install it as one
 * of its mini apps.
 */
export type PublishedApp = {
  id: string;
  name: string;
  description: string;
  icon: AppIcon;
  category: MiniAppCategory;
  version: string;
  /** What is new in this version. */
  notes: string;
  runtime: {
    /** Where it runs. */
    runsIn: "Shopong";
    /** The oldest Shopong that can run it. */
    minShopong: string;
    /** Whether it works without internet once it is installed. */
    offline: boolean;
  };
  /** What it may do, one thing per entry, in plain words. */
  permissions: readonly string[];
  /** True when something it does moves money, so it asks for the person's OK first. */
  needsApproval: boolean;
  screens: readonly { id: string; title: string }[];
  size: string;
  file: string;
  /** When it was built, in milliseconds since the epoch. */
  builtAt: number;
  publisher: string;
  build: Build;
};

export const NAME_MAX = 24;
export const DESCRIPTION_MAX = 100;
export const MIN_SHOPONG = "1.0";

/** A name as compared with others: no case, no extra spaces. */
export const normalise = (name: string): string => name.trim().replace(/\s+/g, " ").toLowerCase();

/** A name cut to fit, at a word and not in the middle of one. */
export function fitName(name: string, max = NAME_MAX): string {
  const tidy = name.trim().replace(/\s+/g, " ");
  if (tidy.length <= max) return tidy;
  const words = tidy.split(" ");
  while (words.length > 1 && words.join(" ").length > max) words.pop();
  return words.join(" ").slice(0, max);
}

/** What the form starts with: the build's own name and look, or the published app's when updating. */
export function defaultForm(build: Build, published?: PublishedApp): PublishForm {
  return published
    ? {
        name: published.name,
        description: published.description,
        icon: published.icon,
        category: published.category,
        notes: "",
      }
    : {
        name: fitName(build.title),
        description: build.blurb,
        icon: build.icon,
        category: build.category,
        notes: "",
      };
}

export type PublishErrors = { name?: string; description?: string };

/** Checks the form in plain words. `taken` are the names of the other apps. */
export function validatePublish(
  form: PublishForm,
  taken: readonly string[],
): { ok: boolean; errors: PublishErrors } {
  const errors: PublishErrors = {};
  const name = form.name.trim().replace(/\s+/g, " ");
  if (name === "") errors.name = "Give your app a name.";
  else if (name.length > NAME_MAX) errors.name = `Keep the name to ${NAME_MAX} letters or fewer.`;
  else if (taken.some((other) => normalise(other) === normalise(name)))
    errors.name = `There is already an app called ${name}. Choose a different name.`;
  if (form.description.trim().length > DESCRIPTION_MAX)
    errors.description = `Keep this to ${DESCRIPTION_MAX} letters or fewer.`;
  return { ok: Object.keys(errors).length === 0, errors };
}

/** The record the platform keeps for an app that has been published. */
export function appRecord(input: {
  id: string;
  build: Build;
  artifact: Artifact;
  form: PublishForm;
  now: number;
}): PublishedApp {
  const { id, build, artifact, form, now } = input;
  return {
    id,
    name: form.name.trim().replace(/\s+/g, " "),
    description: form.description.trim() || build.blurb,
    icon: form.icon,
    category: form.category,
    version: artifact.version,
    notes: form.notes.trim(),
    runtime: { runsIn: "Shopong", minShopong: MIN_SHOPONG, offline: true },
    permissions: build.permissions,
    needsApproval: build.needsApproval,
    screens: build.screens.map((screen) => ({ id: screen.id, title: screen.title })),
    size: artifact.size,
    file: artifact.file,
    builtAt: now,
    publisher: "You",
    build,
  };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "25 Oct 2026, 14:30", in the person's own time. */
export function builtOn(ms: number): string {
  const date = new Date(ms);
  const two = (value: number) => String(value).padStart(2, "0");
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${two(date.getHours())}:${two(date.getMinutes())}`;
}

/** The first letter capitalised: "look at your records" becomes "Look at your records". */
export const sentence = (text: string): string => text.charAt(0).toUpperCase() + text.slice(1);

/** What the details section of the publish screen lists, in the order it lists them. */
export function detailRows(app: PublishedApp): { label: string; value: string }[] {
  return [
    { label: "Version", value: app.version },
    { label: "Runs inside", value: `${app.runtime.runsIn} on your phone` },
    { label: "Needs", value: `${app.runtime.runsIn} ${app.runtime.minShopong} or later` },
    { label: "Works without internet", value: app.runtime.offline ? "Yes" : "No" },
    { label: "Screens", value: String(app.screens.length) },
    { label: "Size", value: app.size },
    { label: "File", value: app.file },
    { label: "Built", value: builtOn(app.builtAt) },
    { label: "Made by", value: app.publisher },
    {
      label: "Money",
      value: app.needsApproval ? "Asks for your OK first" : "Never moves money",
    },
  ];
}
