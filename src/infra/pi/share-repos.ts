import type { SharedRepo } from "../../domain/shared-repo";
import type { ArtifactsClient } from "./extensions/artifacts";

const READ_TOKEN_TTL = 60 * 60;

export async function shareRepos(
  artifacts: Pick<ArtifactsClient, "list" | "get" | "createToken">,
): Promise<SharedRepo[]> {
  const repos = await artifacts.list();
  return Promise.all(
    repos.map(async (repo) => {
      const { remote } = await artifacts.get(repo.name);
      const token = await artifacts.createToken(repo.name, "read", READ_TOKEN_TTL);
      return {
        name: repo.name,
        remote,
        defaultBranch: repo.defaultBranch,
        lastPushAt: repo.lastPushAt,
        readToken: token.plaintext,
        expiresAt: token.expiresAt,
      };
    }),
  );
}
