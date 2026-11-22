import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { getLocale } from "next-intl/server";
import {
  VILLA_BENCH_REQUEST_HEADER,
  VILLA_BENCH_REQUEST_ID_HEADER,
  villaBenchmarkNamespace,
} from "@/lib/server/villa-cache-benchmark";
import { recordNextVillaBenchmark } from "@/lib/server/next-villa-benchmark";
import { getBenchmarkVilla } from "@/lib/server/villas";
import { loadRoomMetadata, renderRoom } from "../room-document";

type Props = { params: Promise<{ id: string }> };

const read = cache(async (slug: string, locale: string) => {
  const incoming = await headers();
  const namespace = villaBenchmarkNamespace(incoming.get(VILLA_BENCH_REQUEST_HEADER));
  const requestId = incoming.get(VILLA_BENCH_REQUEST_ID_HEADER);
  if (!namespace || !requestId || !/^[a-f0-9-]{36}$/.test(requestId)) notFound();

  try {
    const { page, state } = await getBenchmarkVilla(slug, locale, namespace);
    recordNextVillaBenchmark(requestId, namespace, state);
    return { page, witness: `${requestId}:${namespace}:${state}` };
  } catch (error) {
    recordNextVillaBenchmark(requestId, namespace, "bypass");
    throw error;
  }
});

async function readPage(slug: string, locale: string) {
  return (await read(slug, locale)).page;
}

export async function generateMetadata({ params }: Props) {
  return loadRoomMetadata((await params).id, readPage);
}

export default async function BenchmarkRoomPage({ params }: Props) {
  const { id } = await params;
  const room = await renderRoom(id, readPage);
  const { witness } = await read(id, await getLocale());
  return <><span hidden data-villa-cache-observation={witness} />{room}</>;
}
