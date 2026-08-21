export type ImgBedBindings = Partial<
  Pick<Env, "CFBED_BASE_URL" | "CFBED_API_TOKEN">
>;

export type AppEnv = {
  Bindings: Env;
  Variables: {
    requestId: string;
    authenticatedUserId: string;
  };
};

interface VerifiedSession {
  userId: string;
}

export type TokenVerifier = (
  token: string,
  env: Env,
) => Promise<VerifiedSession>;

export type ImageDeleter = (
  images: string[],
  env: ImgBedBindings,
) => Promise<void>;
