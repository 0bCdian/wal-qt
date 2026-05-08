export {};

declare global {
  interface QWebChannelSignal<T> {
    connect: (fn: (arg: T) => void) => void;
    disconnect?: (fn: (arg: T) => void) => void;
  }

  interface WalBridge {
    loadWallpaper: QWebChannelSignal<string>;
    setParallax: QWebChannelSignal<string>;
    setParallaxMove: QWebChannelSignal<string>;
    setPlaybackPolicy: QWebChannelSignal<string>;
    pushWallpaperConfig: QWebChannelSignal<string>;
    pushCapabilities: QWebChannelSignal<string>;
    imagePresentation: QWebChannelSignal<string>;
    transitionResult: (json: string) => void;
    log: (level: string, msg: string) => void;
    rendererReady: () => void;
  }

  interface Window {
    _walBridge?: WalBridge;
    _walBridgeReady?: boolean;
  }
}
