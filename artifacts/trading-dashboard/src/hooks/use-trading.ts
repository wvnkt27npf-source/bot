import { useQueryClient } from "@tanstack/react-query";
import { 
  useCreateSymbol as useGeneratedCreateSymbol, 
  useDeleteSymbol as useGeneratedDeleteSymbol,
  useUpdateSettings as useGeneratedUpdateSettings,
  getListSymbolsQueryKey,
  getGetSettingsQueryKey
} from "@workspace/api-client-react";

export function useCreateSymbol() {
  const queryClient = useQueryClient();
  return useGeneratedCreateSymbol({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSymbolsQueryKey() });
      }
    }
  });
}

export function useDeleteSymbol() {
  const queryClient = useQueryClient();
  return useGeneratedDeleteSymbol({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListSymbolsQueryKey() });
      }
    }
  });
}

export function useUpdateSettings() {
  const queryClient = useQueryClient();
  return useGeneratedUpdateSettings({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
      }
    }
  });
}
