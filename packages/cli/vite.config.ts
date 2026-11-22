import { cpSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { nodeLibrary } from "../../vite.node.ts";

const config = nodeLibrary();

export default {
  ...config,
  plugins: [
    ...config.plugins,
    {
      // The agent skill ships in the package: `wiredown skill` installs it and
      // `npx skills experimental_sync` finds it at dist/skills/wiredown.
      name: "wiredown-skill",
      writeBundle() {
        cpSync(
          fileURLToPath(new URL("../../skills/wiredown", import.meta.url)),
          fileURLToPath(new URL("dist/skills/wiredown", import.meta.url)),
          { recursive: true },
        );
      },
    },
  ],
};
