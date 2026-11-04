import { useQuery } from '@tanstack/react-query'
import { authApi } from '@/api'

export function useAuthConfig() {
  const { data, isLoading } = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => authApi.config().then(r => r.data.data),
    staleTime: Infinity,
  })
  return {
    ssoEnabled: data?.saml_enabled ?? false,
    ssoLoginUrl: data?.saml_login_url ?? null,
    isLoading,
  }
}