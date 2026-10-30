// Follow / unfollow an organization. Shared by the public org profile and the
// event detail screen's host row so both hit the same idempotent endpoints
// (POST / DELETE /orgs/:orgId/follow) and drop the same caches afterwards.
//
// Callers pass `onSuccess` / `onError` for what is specific to their screen — a
// banner on the profile, a cache patch on the event page — and own the
// "pending" UI by reading `isPending` off the returned mutation.

import { api } from '@/app/lib/api';
import { org as orgKeys } from '@/app/lib/queryKeys';
import { useMutation, useQueryClient } from '@tanstack/react-query';

interface FollowResponse {
  following: boolean;
}

interface UseOrgFollowOptions {
  onSuccess?: (result: FollowResponse) => void;
  onError?: () => void;
}

/** `mutate(true)` follows, `mutate(false)` unfollows. */
export function useOrgFollow(
  orgId: number,
  token: string | null,
  { onSuccess, onError }: UseOrgFollowOptions = {},
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (next: boolean) =>
      next
        ? api.post<FollowResponse>(`/orgs/${orgId}/follow`, { token })
        : api.delete<FollowResponse>(`/orgs/${orgId}/follow`, { token }),
    onSuccess: (result) => {
      // The follower count on the header moves with this, and the console's
      // own header reads the same underlying table, so drop both.
      queryClient.invalidateQueries({ queryKey: orgKeys.publicProfile(orgId) });
      queryClient.invalidateQueries({ queryKey: orgKeys.detail(orgId) });
      onSuccess?.(result);
    },
    onError: () => onError?.(),
  });
}
