/**
 * @journey/core — runtime primitives that `.journey.ts` files import.
 *
 * This file ships stub signatures only. Real behavior lands across the M1
 * issues (runtime primitives, HTTP execution, assertions, env loader).
 */

const NOT_IMPLEMENTED = "not implemented";

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

type ResponseOf<E> = E extends EndpointRef<infer R> ? R : unknown;

type Lazy<T> = T | (() => T);

export interface StepOptions<E extends Endpoint> {
  endpoint: E;
  params?: Record<string, string | number>;
  query?: Lazy<Record<string, string | number | boolean | undefined>>;
  headers?: Lazy<Record<string, string>>;
  body?: Lazy<unknown>;
  timeoutMs?: number;
  assert?: (res: ResponseOf<E>) => void | Promise<void>;
  after?: (res: ResponseOf<E>) => void | Promise<void>;
}

export function journey(_name: string, _body: () => void): void {
  throw new Error(NOT_IMPLEMENTED);
}

export function step<E extends Endpoint>(_name: string, _options: StepOptions<E>): void {
  throw new Error(NOT_IMPLEMENTED);
}

export function env(_key: string): string {
  throw new Error(NOT_IMPLEMENTED);
}

export interface Expectation<T> {
  toBe(expected: T): void;
  toEqual(expected: T): void;
  toBeDefined(): void;
  toContain(expected: unknown): void;
  toMatch(expected: RegExp | string): void;
}

export function expect<T>(_value: T): Expectation<T> {
  throw new Error(NOT_IMPLEMENTED);
}
