import React from "react";

type ProjectSelectionContextValue = {
  selectedProjectId: string | null;
  setSelectedProjectId: (projectId: string | null) => void;
};

const ProjectSelectionContext = React.createContext<ProjectSelectionContextValue | null>(null);

export function ProjectSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedProjectId, setSelectedProjectId] = React.useState<string | null>(null);

  const value = React.useMemo(
    () => ({ selectedProjectId, setSelectedProjectId }),
    [selectedProjectId],
  );

  return (
    <ProjectSelectionContext.Provider value={value}>{children}</ProjectSelectionContext.Provider>
  );
}

export function useProjectSelection() {
  const context = React.useContext(ProjectSelectionContext);
  if (!context) {
    throw new Error("useProjectSelection must be used within ProjectSelectionProvider");
  }
  return context;
}
