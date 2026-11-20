import { useEffect, useState } from "react";

type Check = { ok: boolean; detail: string };
type Health = { server: string; cassandra: Check; redis: Check; kafka: Check };

export function App() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/health")
      .then(async (response) => {
        // 503 still carries the per-dependency body.
        setHealth(await response.json());
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="mx-auto max-w-xl p-8 font-sans">
      <h1 className="text-2xl font-semibold text-[#008069]">Mini WhatsApp</h1>
      <p className="mt-1 text-sm text-gray-600">Task 0: the stack is wired up.</p>
      {error && <p className="mt-6 text-red-700">Chat server unreachable: {error}</p>}
      {health && (
        <section className="mt-6">
          <h2 className="font-medium">{health.server}</h2>
          <ul className="mt-2 space-y-1">
            {(["cassandra", "redis", "kafka"] as const).map((name) => (
              <li key={name} className={health[name].ok ? "text-green-800" : "text-red-700"}>
                {health[name].ok ? "OK" : "DOWN"} - {name}: {health[name].detail}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
