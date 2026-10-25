// The GenUi contract suite, pointed at the OpenUI adapter. The in-memory adapter passes the same suite.
import { contractLibrary, runGenUiContract } from "@shopong/ports-contract";

import { OpenUiGenUi } from "./index.js";

runGenUiContract(() => new OpenUiGenUi([contractLibrary]));
