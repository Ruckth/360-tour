import { useSelectedLayoutSegment as useNextSelectedLayoutSegment } from "next/navigation";

export { usePathname, useRouter, useSearchParams } from "next/navigation";

export const useSelectedLayoutSegment: (parentPath: string) => string | null =
  () => useNextSelectedLayoutSegment();
