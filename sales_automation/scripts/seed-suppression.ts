import { config } from "dotenv";
config();

import { db } from "../src/db";
import { suppressionList } from "../src/db/schema";

/** Seed a couple of internal-suppression numbers so the DNC block path is testable. */
async function main() {
  const numbers = [
    { phone: "+14045551000", reason: "opt-out (test seed)" },
    { phone: "+12125559999", reason: "internal suppression (test seed)" },
  ];
  await db.insert(suppressionList).values(numbers).onConflictDoNothing();
  console.log(`Seeded ${numbers.length} suppression numbers.`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
