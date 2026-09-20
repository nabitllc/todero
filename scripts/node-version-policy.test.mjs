import { strict as assert } from "node:assert";
import { test } from "node:test";
import { isAllowedTypesNodeSpecifier } from "./node-version-policy.mjs";

test("accepts any caret range on the Node 24 major", () => {
  // The regression: a Dependabot group of 46 updates was blocked because it
  // raised ^24.0.0 to ^24.13.4. Both are Node 24; only the text differed.
  for (const specifier of ["^24.0.0", "^24.13.4", "^24.1.0", "^24.99.999"]) {
    assert.equal(isAllowedTypesNodeSpecifier(specifier), true, specifier);
  }
});

test("still refuses anything that leaves the Node 24 major", () => {
  for (const specifier of [
    "^23.0.0",
    "^25.0.0",
    "*",
    "latest",
    ">=24.0.0", // also allows 25 and up
    "~24.13.4", // not the caret range the policy asks for
    "24.13.4", // an exact pin, which the policy does not use
    "^24.13", // not a full version
    "^24.13.4-beta.1",
  ]) {
    assert.equal(isAllowedTypesNodeSpecifier(specifier), false, specifier);
  }
});

test("refuses anything that is not a string", () => {
  for (const specifier of [undefined, null, 24, {}, []]) {
    assert.equal(isAllowedTypesNodeSpecifier(specifier), false, String(specifier));
  }
});
