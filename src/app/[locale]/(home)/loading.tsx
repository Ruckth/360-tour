import { HomeLoading } from "@/components/loading/RouteLoading";

// Scoped to the home page (route group) so no loading boundary wraps rooms/[id]:
// a boundary above it streams a 200 before notFound() can set a real 404.
export default function Loading() {
  return <HomeLoading />;
}
