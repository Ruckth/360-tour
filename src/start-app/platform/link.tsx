import type { ComponentPropsWithRef, MouseEvent } from "react";
import { useRouter } from "./navigation";

type LinkProps = Omit<ComponentPropsWithRef<"a">, "href"> & {
  href: string;
};

export default function Link({ href, target, onClick, ...props }: LinkProps) {
  const router = useRouter();

  function navigate(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey ||
        event.shiftKey || event.altKey || (target && target !== "_self") ||
        event.currentTarget.hasAttribute("download") ||
        !href.startsWith("/") || /^\/[/\\]/.test(href)) return;
    event.preventDefault();
    router.push(href);
  }

  return <a {...props} href={href} target={target} onClick={navigate} />;
}
