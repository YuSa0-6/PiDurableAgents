import { Refusal } from "./errors";

export const REGISTRY_HOSTS: readonly string[] = ["registry.npmjs.org", "registry.yarnpkg.com"];

const READ_METHODS: readonly string[] = ["GET", "HEAD"];

export function registryUpstream(method: string, url: string): string {
  const parsed = URL.parse(url);
  const host = parsed?.hostname ?? url;
  if (!parsed || !REGISTRY_HOSTS.includes(parsed.hostname)) {
    throw new Refusal(
      `${host} is blocked: the sandbox can reach only ${REGISTRY_HOSTS.join(" and ")}.`,
    );
  }
  if (!READ_METHODS.includes(method)) {
    throw new Refusal(`${method} to ${host} is blocked: the sandbox may only read packages.`);
  }
  return `https://${parsed.hostname}${parsed.pathname}${parsed.search}`;
}
