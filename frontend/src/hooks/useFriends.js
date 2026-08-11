import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api.js";

/** Friends list + pending requests (server state via react-query) + mutations. */
export function useFriends() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["friends"] });
    qc.invalidateQueries({ queryKey: ["friend-requests"] });
    qc.invalidateQueries({ queryKey: ["blocked"] });
    // Blocking or unfriending changes who may be messaged, so the inbox can
    // change too — a thread with someone you just blocked must stop looking
    // writable.
    qc.invalidateQueries({ queryKey: ["conversations"] });
  };

  const friends = useQuery({
    queryKey: ["friends"],
    queryFn: async () => (await api.get("/friends")).data.data.friends,
  });
  const requests = useQuery({
    queryKey: ["friend-requests"],
    queryFn: async () => (await api.get("/friends/requests")).data.data,
  });

  const sendRequest = useMutation({ mutationFn: (userId) => api.post("/friends/request", { userId }), onSuccess: invalidate });
  const accept = useMutation({ mutationFn: (id) => api.post(`/friends/requests/${id}/accept`), onSuccess: invalidate });
  const decline = useMutation({ mutationFn: (id) => api.delete(`/friends/requests/${id}`), onSuccess: invalidate });
  const unfriend = useMutation({ mutationFn: (userId) => api.delete(`/friends/${userId}`), onSuccess: invalidate });

  /**
   * Blocking is not a louder unfriend, and the UI should not present it as one.
   * Unfriend deletes the link and they can re-add you in one click; block keeps
   * a row that refuses future requests and stops messages.
   */
  const blocked = useQuery({
    queryKey: ["blocked"],
    queryFn: async () => (await api.get("/friends/blocked")).data.data.blocked,
  });
  const block = useMutation({
    mutationFn: (userId) => api.post(`/friends/${userId}/block`),
    onSuccess: invalidate,
  });
  const unblock = useMutation({
    mutationFn: (userId) => api.delete(`/friends/${userId}/block`),
    onSuccess: invalidate,
  });

  return { friends, requests, blocked, sendRequest, accept, decline, unfriend, block, unblock };
}

export async function searchUsers(q) {
  if (q.trim().length < 2) return [];
  return (await api.get("/friends/search", { params: { q } })).data.data.users;
}
