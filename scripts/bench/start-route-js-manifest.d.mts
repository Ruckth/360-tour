import type { Plugin } from "vite";

export function clientGraphPath(project: string, entry: string): string;
export function isRendererModule(moduleId: string): boolean;
export function startRouteJsManifest(): Plugin;
