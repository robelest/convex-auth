export interface BrowserNavigationService {
  readonly get: () => URL | null;
  readonly replace: (url: string) => void;
  readonly redirect: (url: URL) => void;
}

export const BrowserNavigationLive: BrowserNavigationService = {
  get: () =>
    typeof window === "undefined" ? null : new URL(window.location.href),
  replace: (url: string) => {
    if (typeof window !== "undefined") {
      window.history.replaceState({}, "", url);
    }
  },
  redirect: (url: URL) => {
    if (typeof window !== "undefined") {
      window.location.href = url.toString();
    }
  },
};
