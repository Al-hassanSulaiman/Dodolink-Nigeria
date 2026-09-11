type ApiErrorShape = {
  status?: unknown;
  data?: unknown;
  message?: unknown;
};

export function isStoreNameAlreadyExistsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;

  const candidate = error as ApiErrorShape;
  const data =
    candidate.data && typeof candidate.data === "object"
      ? candidate.data as Record<string, unknown>
      : null;

  return (
    candidate.status === 409 &&
    (
      data?.code === "STORE_NAME_ALREADY_EXISTS" ||
      (typeof candidate.message === "string" &&
        /verified store with this name already exists/i.test(candidate.message))
    )
  );
}