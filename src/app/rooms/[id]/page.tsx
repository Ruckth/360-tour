import Link from "next/link";
import { RoomDetailClient } from "@/components/rooms/RoomDetailClient";
import { getPropertyById, properties } from "@/lib/data/properties";
import { resort } from "@/lib/data/resort-config";
import { Suspense } from "react";

export function generateStaticParams() {
  return properties.map((property) => ({ id: property.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const property = getPropertyById(id);
  return {
    title: `${property?.name ?? "Villa"} — ${resort.name}`,
    description: property?.description ?? resort.description,
  };
}

export default async function RoomPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const property = getPropertyById(id);

  if (!property) {
    return (
      <div className="flex min-h-screen items-center justify-center pt-16">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground">Property not found</h1>
          <Link href="/" className="mt-4 inline-block text-primary hover:underline">
            Back to Home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <Suspense fallback={<div className="min-h-screen px-5 py-24">Loading villa...</div>}>
      <RoomDetailClient property={property} />
    </Suspense>
  );
}
