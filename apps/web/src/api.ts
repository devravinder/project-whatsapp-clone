import {
  type ConversationDetail,
  type ConversationSummary,
  type MessagePage,
  type SendAck,
  USERNAME_HEADER,
} from "@wa/protocol";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  username: string | null,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(username ? { [USERNAME_HEADER]: username } : {}),
      ...init.headers,
    },
  });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(", ") : body?.message;
    throw new ApiError(response.status, message ?? response.statusText);
  }
  return body as T;
}

const json = (value: unknown) => JSON.stringify(value);

export function register(username: string) {
  return request<{ username: string; created: boolean }>(null, "/users", {
    method: "POST",
    body: json({ username }),
  });
}

export function api(username: string) {
  return {
    conversations: () => request<ConversationSummary[]>(username, "/conversations"),
    startDirect: (other: string) =>
      request<ConversationSummary>(username, "/conversations/direct", {
        method: "POST",
        body: json({ with: other }),
      }),
    detail: (id: string) =>
      request<ConversationDetail>(username, `/conversations/${encodeURIComponent(id)}`),
    history: (id: string, query: { before?: string; after?: string; limit?: number } = {}) => {
      const params = new URLSearchParams(
        Object.entries(query).filter(([, v]) => v !== undefined) as [string, string][],
      );
      return request<MessagePage>(
        username,
        `/conversations/${encodeURIComponent(id)}/messages?${params}`,
      );
    },
    createGroup: (title: string, members: string[]) =>
      request<ConversationSummary>(username, "/groups", {
        method: "POST",
        body: json({ title, members }),
      }),
    addMember: (id: string, member: string) =>
      request<null>(username, `/groups/${encodeURIComponent(id)}/members`, {
        method: "POST",
        body: json({ username: member }),
      }),
    removeMember: (id: string, member: string) =>
      request<null>(
        username,
        `/groups/${encodeURIComponent(id)}/members/${encodeURIComponent(member)}`,
        { method: "DELETE" },
      ),
    send: (id: string, clientMsgId: string, body: string) =>
      request<SendAck>(username, `/conversations/${encodeURIComponent(id)}/messages`, {
        method: "POST",
        body: json({ clientMsgId, body }),
      }),
  };
}

export type Api = ReturnType<typeof api>;
