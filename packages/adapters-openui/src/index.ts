// The OpenUI adapter for the GenUi port. See README.md.
export {
  OpenUiGenUi,
  generateSpec,
  generateSystemPrompt,
  inspectScreen,
  openUiLibraryOf,
} from "./gen-ui.js";
export {
  ACTION,
  CHILDREN,
  openUiDefinitions,
  signaturesOf,
  type ComponentDefinition,
  type OpenUiDefinitions,
} from "./definitions.js";
export { actionNameOf } from "./names.js";
export { disableOpenUiTelemetry } from "./telemetry.js";
