import type { VillaQueryClient } from "@/lib/server/villa-reads";
import type { VillaRuntimeCache } from "@/lib/server/villa-runtime-cache";

// Identity hooks for the Start villa reader. Only the disposable Preview outage fixture
// (`START_VILLA_FAULT_FIXTURE=1` build) aliases this module to villa-read-fault.fixture.ts.

export const faultableVillaClient = (client: VillaQueryClient): VillaQueryClient => client;
export const faultableVillaCache = (cache: VillaRuntimeCache): VillaRuntimeCache => cache;
export const markVillaFaultResponse = (): void => {};
