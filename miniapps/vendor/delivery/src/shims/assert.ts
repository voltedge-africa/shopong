// Kepler imports Node's `assert`; the browser has none, and Vite's empty stand-in is not callable.
export default function assert(condition: unknown, message?: string): asserts condition {
  if (!condition) throw new Error(message ?? "Assertion failed");
}
