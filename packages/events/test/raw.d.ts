// Vite's `?raw` imports, used by single-source.test.ts to read test sources without Node APIs.
declare module "*?raw" {
  const source: string;
  export default source;
}
