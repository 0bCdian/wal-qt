export function resolveAssetUrl(target: string): string {
    if (target.startsWith("file://") || target.startsWith("http://") ||
        target.startsWith("https://") || target.startsWith("data:") ||
        target.startsWith("blob:") || target.startsWith("waypaperhtml://"))
        return target;
    if (target.startsWith("/"))
        return "file://" + target;
    return target;
}
