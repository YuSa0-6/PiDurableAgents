import { WorkerEntrypoint } from "cloudflare:workers";
import { Refusal } from "../domain/errors";
import { registryUpstream } from "../domain/registry-egress";

const FORWARDED_HEADERS = ["accept", "accept-encoding", "user-agent", "npm-command"];

export class RegistryEgress extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    let upstream: string;
    try {
      upstream = registryUpstream(request.method, request.url);
    } catch (error) {
      if (error instanceof Refusal) return new Response(`${error.message}\n`, { status: 403 });
      throw error;
    }
    const headers = new Headers();
    for (const name of FORWARDED_HEADERS) {
      const value = request.headers.get(name);
      if (value !== null) headers.set(name, value);
    }
    return fetch(upstream, { method: request.method, headers, redirect: "manual" });
  }
}
