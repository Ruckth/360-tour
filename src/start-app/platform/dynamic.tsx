import { ClientOnly } from "@tanstack/react-router";
import { lazy, Suspense, type ComponentType } from "react";

export default function dynamic<Props extends object>(
  load: () => Promise<ComponentType<Props> | { default: ComponentType<Props> }>,
  { loading: Loading }: { ssr: false; loading?: ComponentType },
) {
  const Lazy = lazy(async () => {
    const component = await load();
    return typeof component === "object" && "default" in component ? component : { default: component };
  });

  return function DynamicComponent(props: Props) {
    const fallback = Loading ? <Loading /> : null;
    return (
      <ClientOnly fallback={fallback}>
        <Suspense fallback={fallback}><Lazy {...props} /></Suspense>
      </ClientOnly>
    );
  };
}
