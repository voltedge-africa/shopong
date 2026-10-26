// Node runs these TypeScript sources directly. The workspace packages import each other with `.js`
// specifiers, as the TypeScript compiler requires, and Node does not map `.js` to `.ts` on its own.
// This hook resolves a relative `.js` that has no file to its `.ts` sibling. Register it before the
// first import of a workspace package (see main.ts).
import { registerHooks } from "node:module";

export function registerWorkspaceResolution(): void {
  registerHooks({
    resolve(specifier, context, nextResolve) {
      try {
        return nextResolve(specifier, context);
      } catch (error) {
        if (!specifier.startsWith(".") || !specifier.endsWith(".js")) throw error;
        return nextResolve(`${specifier.slice(0, -3)}.ts`, context);
      }
    },
  });
}
