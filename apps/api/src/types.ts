export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    authenticatedUserId: string;
  };
};

export interface VerifiedSession {
  userId: string;
}

export type TokenVerifier = (
  token: string,
  env: Env,
) => Promise<VerifiedSession>;
