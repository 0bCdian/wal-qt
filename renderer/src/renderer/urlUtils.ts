export function resolveAssetUrl(target: string): string {
  const useWal =
    typeof window !== "undefined" &&
    (window as unknown as { __walqtUseWalfileScheme?: boolean }).__walqtUseWalfileScheme === true;
  if (useWal) {
    if (target.startsWith("walfile://")) return target;
    if (target.startsWith("file://")) {
      const u = new URL(target);
      return "walfile://" + u.pathname + u.search + u.hash;
    }
    if (target.startsWith("/")) return "walfile://" + target;
  }
  if (
    target.startsWith("file://") ||
    target.startsWith("http://") ||
    target.startsWith("https://") ||
    target.startsWith("data:") ||
    target.startsWith("blob:") ||
    target.startsWith("waypaperhtml://")
  )
    return target;
  if (target.startsWith("/")) return "file://" + target;
  return target;
}
