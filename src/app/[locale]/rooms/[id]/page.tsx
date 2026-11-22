import { getVilla, getPrerenderVillaSlugs } from "@/lib/server/villas";
import { loadRoomMetadata, renderRoom } from "./room-document";

export async function generateStaticParams() {
  return (await getPrerenderVillaSlugs()).map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  return loadRoomMetadata((await params).id, getVilla);
}

export default async function RoomPage({ params }: { params: Promise<{ id: string }> }) {
  return renderRoom((await params).id, getVilla);
}
