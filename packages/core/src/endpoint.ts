export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

declare const EndpointResponseBrand: unique symbol;

export interface EndpointRef<TResponse> {
  readonly method: HttpMethod;
  readonly path: string;
  readonly operationId?: string;
  readonly [EndpointResponseBrand]?: TResponse;
}

export interface EndpointDescriptor {
  readonly method: HttpMethod;
  readonly path: string;
  readonly baseUrl?: string;
}

export type Endpoint<TResponse = unknown> = EndpointRef<TResponse> | EndpointDescriptor;

export type ResponseOf<E> = E extends EndpointRef<infer R> ? R : unknown;

export function isEndpointRef(e: Endpoint): e is EndpointRef<unknown> {
  return typeof (e as { operationId?: unknown }).operationId === "string";
}
