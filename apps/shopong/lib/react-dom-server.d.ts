// The tests draw screens to HTML with React's server renderer. Only this one function is used, so it is
// declared here rather than adding the whole type package for it.
declare module "react-dom/server" {
  export function renderToStaticMarkup(element: unknown): string;
}
