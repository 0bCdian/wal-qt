/**
 * Allow context menu / devtools shortcuts when running the Vite dev server (`http://localhost:…`).
 * Do **not** key off `hostname === "localhost"` alone — production may use `tauri://localhost`.
 */
const RELAX_WALLPAPER_INPUT_GUARDS =
  import.meta.env.DEV ||
  (typeof window !== "undefined" &&
    window.location.protocol === "http:" &&
    (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"));

export function installInteractionGuards() {
  const suppress = (event: Event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  if (!RELAX_WALLPAPER_INPUT_GUARDS) {
    window.addEventListener("contextmenu", suppress, { capture: true });
  }
  window.addEventListener("selectstart", suppress, { capture: true });
  window.addEventListener("dragstart", suppress, { capture: true });
  window.addEventListener("drop", suppress, { capture: true });
  if (!RELAX_WALLPAPER_INPUT_GUARDS) {
    window.addEventListener("auxclick", suppress, { capture: true });
    window.addEventListener(
      "mousedown",
      (event) => {
        if (event.button === 2) {
          suppress(event);
        }
      },
      { capture: true },
    );
  }
  if (!RELAX_WALLPAPER_INPUT_GUARDS) {
    window.addEventListener(
      "keydown",
      (event) => {
        const key = event.key.toLowerCase();
        const isDevtoolsCombo =
          key === "f12" ||
          ((event.ctrlKey || event.metaKey) &&
            event.shiftKey &&
            (key === "i" || key === "j" || key === "c"));
        if (isDevtoolsCombo) {
          suppress(event);
        }
      },
      { capture: true },
    );
  }
}
