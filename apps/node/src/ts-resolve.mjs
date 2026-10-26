// A Node resolve hook for running the TypeScript sources of this repo's workspace packages. Those packages
// import their siblings with `.js` names (for TypeScript's NodeNext rules), but the file on disk is `.ts`.
// When a `.js` specifier from a `.ts` file is not found, this tries the `.ts` file instead. Nothing else changes.
export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    const fromTs = context.parentURL?.endsWith(".ts") === true;
    if (error?.code === "ERR_MODULE_NOT_FOUND" && fromTs && specifier.endsWith(".js")) {
      return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}
