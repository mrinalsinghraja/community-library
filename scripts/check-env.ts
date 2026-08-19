import { existsSync } from "node:fs";

import {
  PRODUCTION_ONLY_ENV_FILES,
  SAFE_PULL_FILENAME,
  productionEnvFilesInPlay,
} from "../src/lib/env-files";

/**
 * Refuses a local production-mode command that would read a production `.env`
 * file. Wired to `prebuild` and `prestart`, so it runs automatically.
 *
 * On Vercel this is a no-op twice over: `VERCEL` is set, and the files it looks
 * for are gitignored and so never reach the deployment in the first place.
 */

const onVercel = process.env.VERCEL === "1";
const nodeEnv = process.env.NODE_ENV ?? "production"; // what `next build` will set
const present = PRODUCTION_ONLY_ENV_FILES.filter((file) => existsSync(file));

const inPlay = productionEnvFilesInPlay({ nodeEnv, onVercel, present });

if (inPlay.length > 0) {
  console.error(
    [
      "",
      "  Refusing to build: this working copy still holds production configuration.",
      "",
      `    ${inPlay.join("\n    ")}`,
      "",
      "  `next build` runs with NODE_ENV=production, so Next.js would load that file",
      "  and the build — including page data collection — would talk to the production",
      "  database from your laptop.",
      "",
      "  Do one of these:",
      "",
      `    mv ${inPlay[0]} ${SAFE_PULL_FILENAME}`,
      "        …keeps it, under a name Next.js never reads",
      `    rm ${inPlay[0]}`,
      "        …throws it away",
      "",
      "  To run a one-off command against production on purpose, pass the file",
      "  explicitly and leave the environment out of it:",
      "",
      `    npx dotenv -e ${SAFE_PULL_FILENAME} -- npx prisma migrate status`,
      "",
    ].join("\n"),
  );
  process.exit(1);
}
