import { logger } from "./logger";

let webglWorkerCapabilityLogged = false;

/**
 * When `WAYPAPER_WEBGL_WORKER=1`, log once whether OffscreenCanvas + WebGL in a Worker works.
 * Full transition rendering still runs on the main thread until a worker pipeline exists.
 */
export function logWebglWorkerCapabilityOnce(): void {
  if (webglWorkerCapabilityLogged) {
    return;
  }
  if ((globalThis as { __waypaperWebglWorker?: unknown }).__waypaperWebglWorker !== 1) {
    return;
  }
  webglWorkerCapabilityLogged = true;
  void probeOffscreenWebglAndLog();
}

async function probeOffscreenWebglAndLog(): Promise<void> {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const transfer = canvas.transferControlToOffscreen;
    if (typeof transfer !== "function") {
      logger.info(
        "waypaper: WAYPAPER_WEBGL_WORKER=1 but transferControlToOffscreen is missing; WebGL transitions stay on the main thread",
      );
      return;
    }
    const offscreen = transfer.call(canvas);
    const workerUrl = URL.createObjectURL(
      new Blob(
        [
          "self.onmessage=function(e){var c=e.data;var gl=c.getContext('webgl',{preserveDrawingBuffer:true,antialias:false,depth:false,stencil:false});self.postMessage({ok:!!gl});};",
        ],
        { type: "application/javascript" },
      ),
    );
    const ok = await new Promise<boolean>((resolve) => {
      const w = new Worker(workerUrl);
      const done = (v: boolean) => {
        w.terminate();
        URL.revokeObjectURL(workerUrl);
        resolve(v);
      };
      w.onmessage = (ev: MessageEvent<{ ok?: boolean }>) => {
        done(Boolean(ev.data?.ok));
      };
      w.onerror = () => done(false);
      w.postMessage(offscreen, [offscreen]);
    });
    if (ok) {
      logger.info(
        "waypaper: WAYPAPER_WEBGL_WORKER=1 — OffscreenCanvas WebGL worker probe succeeded; transitions still use the main thread until worker rendering is implemented",
      );
    } else {
      logger.info(
        "waypaper: WAYPAPER_WEBGL_WORKER=1 — OffscreenCanvas WebGL worker probe failed; transitions stay on the main thread",
      );
    }
  } catch (err) {
    logger.info("waypaper: WebGL worker capability probe error", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
