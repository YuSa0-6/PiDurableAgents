export interface Authenticator {
  isAllowed(token: string): Promise<boolean>;
}
