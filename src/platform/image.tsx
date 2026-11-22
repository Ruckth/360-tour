import { preload } from "react-dom";
import { useState, type ComponentPropsWithoutRef } from "react";
import { allowedImageUrl } from "convex/shared/imageUrls";
import { canOptimizeImage, imageSources } from "./image-config";

type ImageProps = Omit<ComponentPropsWithoutRef<"img">, "src" | "srcSet" | "width" | "height" | "alt"> & {
  src: string;
  alt: string;
  width?: number;
  height?: number;
  fill?: boolean;
  priority?: boolean;
  quality?: 72 | 75 | 82;
};

const optimizer = import.meta.env.VITE_VERCEL_IMAGE_OPTIMIZATION === "1";

export default function Image({
  src,
  alt,
  width,
  height,
  fill,
  priority,
  quality = 75,
  sizes,
  style,
  onError,
  loading,
  fetchPriority,
  ...props
}: ImageProps) {
  const [optimizerFailure, setOptimizerFailure] = useState<string>();
  const optimize = optimizer && optimizerFailure !== src && canOptimizeImage(src);
  const safeSource = allowedImageUrl(src);
  const sources = optimize
    ? imageSources(src, fill ? undefined : width, sizes, quality)
    : { src: safeSource ? src : "data:image/gif;base64,", srcSet: undefined, sizes };
  if (priority && safeSource) {
    preload(sources.src, {
      as: "image",
      fetchPriority: "high",
      imageSrcSet: sources.srcSet,
      imageSizes: sources.sizes,
    });
  }
  return (
    // eslint-disable-next-line react-app/no-raw-img -- candidate sources use Vercel's image API or the local original.
    <img
      {...props}
      alt={alt}
      width={fill ? undefined : width}
      height={fill ? undefined : height}
      style={fill ? { position: "absolute", inset: 0, width: "100%", height: "100%", ...style } : style}
      loading={priority ? "eager" : loading ?? "lazy"}
      fetchPriority={priority ? "high" : fetchPriority}
      onError={optimize ? () => setOptimizerFailure(src) : onError}
      sizes={sources.sizes}
      srcSet={sources.srcSet}
      src={sources.src}
    />
  );
}
