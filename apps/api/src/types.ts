export type ImgBedBindings = Partial<
  Pick<Env, "CFBED_BASE_URL" | "CFBED_API_TOKEN">
>;

export type AppBindings = Env;

export type AppEnv = {
  Bindings: AppBindings;
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

export type ImageDeleter = (
  images: string[],
  env: ImgBedBindings,
) => Promise<void>;
