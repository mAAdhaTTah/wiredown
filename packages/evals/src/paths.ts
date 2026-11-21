import { fileURLToPath } from "node:url";

/** The repository root. */
export const REPO = fileURLToPath(new URL("../../../", import.meta.url));

/** This package's directory. */
export const PACKAGE = fileURLToPath(new URL("../", import.meta.url));
