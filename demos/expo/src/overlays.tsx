import React from "react";

type OverlayGuardContextValue = {
  requestOverlay: (key: string, open: () => void) => void;
  markMounted: (key: string) => void;
  clear: (key: string) => void;
};

const OverlayGuardContext =
  React.createContext<OverlayGuardContextValue | null>(null);

export function OverlayGuardProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const activeKey = React.useRef<string | null>(null);
  const pendingKey = React.useRef<string | null>(null);

  const requestOverlay = React.useCallback((key: string, open: () => void) => {
    if (activeKey.current || pendingKey.current) {
      return;
    }
    pendingKey.current = key;
    open();
  }, []);

  const markMounted = React.useCallback((key: string) => {
    if (pendingKey.current === key || activeKey.current === key) {
      activeKey.current = key;
      pendingKey.current = null;
    }
  }, []);

  const clear = React.useCallback((key: string) => {
    if (activeKey.current === key) {
      activeKey.current = null;
    }
    if (pendingKey.current === key) {
      pendingKey.current = null;
    }
  }, []);

  const value = React.useMemo(
    () => ({ requestOverlay, markMounted, clear }),
    [clear, markMounted, requestOverlay],
  );

  return (
    <OverlayGuardContext.Provider value={value}>
      {children}
    </OverlayGuardContext.Provider>
  );
}

export function useOverlayGuard() {
  const context = React.useContext(OverlayGuardContext);
  if (!context) {
    throw new Error("useOverlayGuard must be used within OverlayGuardProvider");
  }
  return context;
}

export function useOverlayRegistration(key: string) {
  const { markMounted, clear } = useOverlayGuard();

  React.useEffect(() => {
    markMounted(key);
    return () => clear(key);
  }, [clear, key, markMounted]);
}
