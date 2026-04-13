export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head" | "options";

export const HTTP_METHODS: readonly HttpMethod[] = [
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
] as const;

export interface Operation {
  readonly method: HttpMethod;
  readonly path: string;
  readonly operationId: string;
}

export interface OpenApiDocument {
  readonly openapi?: string;
  readonly swagger?: string;
  readonly paths?: Record<string, Record<string, { operationId?: string } | unknown> | undefined>;
}
