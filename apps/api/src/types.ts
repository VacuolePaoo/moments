export interface ImgBedBindings {
  CFBED_BASE_URL?: string;
  CFBED_API_TOKEN?: string;
}

export type AppBindings = Env & ImgBedBindings;

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
