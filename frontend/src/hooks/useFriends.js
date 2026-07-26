import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api.js";

/** Friends list + pending requests (server state via react-query) + mutations. */
export function useFriends() {
  const qc = useQueryClient();
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["friends"] });
    qc.invalidateQueries({ queryKey: ["friend-requests"] });
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

  return { friends, requests, sendRequest, accept, decline, unfriend };
}

export async function searchUsers(q) {
  if (q.trim().length < 2) return [];
  return (await api.get("/friends/search", { params: { q } })).data.data.users;
}
