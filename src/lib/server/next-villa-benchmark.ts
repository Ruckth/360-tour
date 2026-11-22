import { ServerResponse, type OutgoingHttpHeader, type OutgoingHttpHeaders } from "node:http";
import {
  VILLA_BENCH_REQUEST_HEADER,
  VILLA_BENCH_REQUEST_ID_HEADER,
  villaBenchmarkEnabled,
  villaBenchmarkNamespace,
  villaBenchmarkResponse,
  type VillaCacheObservation,
} from "./villa-cache-benchmark";

type Observation = { namespace: string; state: VillaCacheObservation };
const runtime = globalThis as typeof globalThis & {
  villaBenchmarkResponses?: Map<string, Observation>;
  villaBenchmarkHookInstalled?: boolean;
};

export function recordNextVillaBenchmark(requestId: string, namespace: string, state: VillaCacheObservation) {
  const responses = runtime.villaBenchmarkResponses ??= new Map();
  responses.set(requestId, { namespace, state });
  if (responses.size > 256) responses.delete(responses.keys().next().value!);
}

/** Next App Router pages have no supported response-header setter. On the opt-in
 * Node Preview only, attach the request's rendered observation before native headers flush. */
export function installNextVillaBenchmarkHook() {
  if (!villaBenchmarkEnabled() || runtime.villaBenchmarkHookInstalled) return;
  runtime.villaBenchmarkHookInstalled = true;
  const writeHead = ServerResponse.prototype.writeHead;
  ServerResponse.prototype.writeHead = function (
    this: ServerResponse,
    status: number,
    statusMessageOrHeaders?: string | OutgoingHttpHeader[] | OutgoingHttpHeaders,
    headers?: OutgoingHttpHeader[] | OutgoingHttpHeaders,
  ) {
    const namespace = villaBenchmarkNamespace(this.req?.headers[VILLA_BENCH_REQUEST_HEADER]?.toString());
    const requestId = this.req?.headers[VILLA_BENCH_REQUEST_ID_HEADER];
    const observations = runtime.villaBenchmarkResponses;
    const observation = typeof requestId === "string" ? observations?.get(requestId) : undefined;
    if (observation && typeof requestId === "string") {
      observations?.delete(requestId);
      if (namespace === observation.namespace) {
        for (const [name, value] of Object.entries(villaBenchmarkResponse(namespace, observation.state))) {
          this.setHeader(name, value);
        }
      }
    }
    return Reflect.apply(writeHead, this, [status, statusMessageOrHeaders, headers]) as ServerResponse;
  };
}
