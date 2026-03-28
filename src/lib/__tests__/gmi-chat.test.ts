import assert from "node:assert/strict";
import { test } from "node:test";

import { createGmiChatModel } from "../gmi-chat";

test("createGmiChatModel throws when GMI_API_KEY is missing", () => {
  const originalApiKey = process.env.GMI_API_KEY;
  delete process.env.GMI_API_KEY;

  try {
    assert.throws(
      () => createGmiChatModel(),
      /GMI_API_KEY is not set in the environment/,
    );
  } finally {
    process.env.GMI_API_KEY = originalApiKey;
  }
});
