import { useState } from "react";
import { register } from "./api.js";
import { ChatApp } from "./components/chat-app.js";

// Per tab, so two tabs can be two users side by side.
const SESSION_KEY = "wa.username";

export function App() {
  const [username, setUsername] = useState(() => sessionStorage.getItem(SESSION_KEY));

  if (!username) {
    return (
      <Login
        onDone={(name) => {
          sessionStorage.setItem(SESSION_KEY, name);
          setUsername(name);
        }}
      />
    );
  }
  return (
    <ChatApp
      key={username}
      username={username}
      onLogout={() => {
        sessionStorage.removeItem(SESSION_KEY);
        setUsername(null);
      }}
    />
  );
}

function Login({ onDone }: { onDone: (username: string) => void }) {
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#eae6df]">
      <form
        className="w-80 rounded-lg bg-white p-6 shadow"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError(null);
          try {
            onDone((await register(name.trim().toLowerCase())).username);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <h1 className="text-xl font-semibold text-[#008069]">Mini WhatsApp</h1>
        <p className="mt-1 text-sm text-gray-600">
          Pick a username. There is no password: anyone typing the same name is you.
        </p>
        <label className="mt-4 block text-sm font-medium" htmlFor="username">
          Username
        </label>
        <input
          id="username"
          autoFocus
          className="mt-1 w-full rounded border px-3 py-2"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="alice"
          pattern="[a-zA-Z0-9_]{3,20}"
          required
        />
        {error && <p className="mt-2 text-sm text-red-700">{error}</p>}
        <button
          className="mt-4 w-full rounded bg-[#008069] py-2 font-medium text-white disabled:opacity-60"
          disabled={busy}
        >
          Continue
        </button>
      </form>
    </main>
  );
}
