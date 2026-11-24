import { describe, expect, it } from "vite-plus/test";
import { Refusal } from "./errors";
import { registryUpstream } from "./registry-egress";

describe("registryUpstream", () => {
  it.each([
    ["GET", "https://registry.npmjs.org/react", "https://registry.npmjs.org/react"],
    ["HEAD", "http://registry.npmjs.org/-/a.tgz?x=1", "https://registry.npmjs.org/-/a.tgz?x=1"],
    ["GET", "https://registry.yarnpkg.com/lodash", "https://registry.yarnpkg.com/lodash"],
    ["GET", "https://user:pw@registry.npmjs.org:8443/a", "https://registry.npmjs.org/a"],
  ])("lets %s %s through to %s", (method, url, upstream) => {
    expect(registryUpstream(method, url)).toBe(upstream);
  });

  it.each([
    ["GET", "https://example.com/x", "example.com is blocked"],
    ["GET", "https://registry.npmjs.org.evil.test/x", "registry.npmjs.org.evil.test is blocked"],
    ["GET", "not a url", "not a url is blocked"],
    ["PUT", "https://registry.npmjs.org/pkg", "PUT to registry.npmjs.org is blocked"],
    ["POST", "https://registry.npmjs.org/-/npm/v1/security/audits", "POST to registry.npmjs.org"],
  ])("refuses %s %s", (method, url, message) => {
    expect(() => registryUpstream(method, url)).toThrow(Refusal);
    expect(() => registryUpstream(method, url)).toThrow(message);
  });
});
