import { createContext, useContext, ReactNode } from "react";
import { useGetSettings, getGetSettingsQueryKey, Settings } from "@workspace/api-client-react";

interface SettingsContextValue {
  settings: Settings | undefined;
  isLoading: boolean;
  isAutomationActive: boolean;
}

const SettingsContext = createContext<SettingsContextValue>({
  settings: undefined,
  isLoading: false,
  isAutomationActive: false,
});

export function SettingsProvider({ children }: { children: ReactNode }) {
  const { data: settings, isLoading } = useGetSettings({
    query: { queryKey: getGetSettingsQueryKey(), refetchInterval: 10000 }
  });

  return (
    <SettingsContext.Provider value={{
      settings,
      isLoading,
      isAutomationActive: settings?.automationEnabled ?? false,
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export function useSettingsContext() {
  return useContext(SettingsContext);
}
