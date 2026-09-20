/**
 * What the Node version policy accepts for `@types/node`.
 *
 * Its own module so the check script and its test share one definition: a
 * second copy would let the two drift, and the check silently stopping is the
 * worst failure a gate can have.
 *
 * The policy is "stay on the Node 24 major", not "match one exact string".
 * Comparing the specifier as text failed on every ordinary patch bump — a
 * Dependabot group of 46 updates was blocked because it raised `^24.0.0` to
 * `^24.13.4`, which is still Node 24 and still correct.
 */
export const TYPES_NODE_POLICY = /^\^24\.\d+\.\d+$/;

/** True when this `@types/node` specifier keeps the repo on the Node 24 major. */
export function isAllowedTypesNodeSpecifier(specifier) {
  return typeof specifier === "string" && TYPES_NODE_POLICY.test(specifier);
}

/** Said in the failure message, so it names the rule rather than one value. */
export const TYPES_NODE_POLICY_DESCRIPTION = "a caret range on Node 24, e.g. ^24.13.4";
