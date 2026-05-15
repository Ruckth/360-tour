import { Html } from "@react-three/drei";
import { MoveRight } from "lucide-react";

export function Hotspot({
  position,
  label,
  onClick,
}: {
  position: [number, number, number];
  label: string;
  onClick: () => void;
}) {
  return (
    <Html position={position} center distanceFactor={18}>
      <button
        type="button"
        onClick={onClick}
        className="group flex items-center gap-2 rounded-full border border-white/20 bg-black/45 px-3 py-2 text-xs font-semibold text-white shadow-xl backdrop-blur-md transition hover:bg-white hover:text-black"
      >
        <span className="flex h-2.5 w-2.5 rounded-full bg-gold shadow-[0_0_18px_rgba(214,166,72,0.9)]" />
        {label}
        <MoveRight className="h-3.5 w-3.5 transition group-hover:translate-x-0.5" />
      </button>
    </Html>
  );
}
