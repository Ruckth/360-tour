import type { ComponentPropsWithRef } from "react";

// Outside a router a link is an ordinary anchor: clicking performs a real document
// navigation, which specs observe through the page URL (as the Next Link did here).
export default function Link({ href, ...props }: Omit<ComponentPropsWithRef<"a">, "href"> & { href: string }) {
  return <a {...props} href={href} />;
}
