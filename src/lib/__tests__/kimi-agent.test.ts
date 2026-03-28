import assert from "node:assert/strict";
import { test } from "node:test";

import { createKimiImageExtractionAgent } from "../../app/api/agents/kimi-agent";

test("createKimiImageExtractionAgent throws when both KIMI_API_KEY and GMI_API_KEY are missing", () => {
  const originalKimiKey = process.env.KIMI_API_KEY;
  const originalGmiKey = process.env.GMI_API_KEY;

  delete process.env.KIMI_API_KEY;
  delete process.env.GMI_API_KEY;

  try {
    assert.throws(
      () => createKimiImageExtractionAgent(),
      /KIMI_API_KEY \(or fallback GMI_API_KEY\) is not set/,
    );
  } finally {
    process.env.KIMI_API_KEY = originalKimiKey;
    process.env.GMI_API_KEY = originalGmiKey;
  }
});
