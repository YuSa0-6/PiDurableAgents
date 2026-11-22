export type SharedRepo = {
  readonly name: string;
  readonly remote: string;
  readonly defaultBranch: string;
  readonly lastPushAt: string | null;
  readonly readToken: string;
  readonly expiresAt: string;
};
