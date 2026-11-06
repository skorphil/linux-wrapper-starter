import type React from 'react';
import { useState } from 'react';
import type { MemoryUsage, RootIdentity } from './bindings.d.ts';

type CellStatus = 'idle' | 'running' | 'done' | 'error';

interface CellState<T> {
  status: CellStatus;
  output: T | string | null;
}

const idleState = <T,>(): CellState<T> => ({ status: 'idle', output: null });

function formatOutput(value: unknown): string {
  if (typeof value === 'string') return value;
  return JSON.stringify(value, null, 2);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

interface Snippet {
  path: string;
  code: string;
}

interface CellProps {
  index: number;
  title: string;
  privileged: boolean;
  description: string;
  snippets: Snippet[];
  state: CellState<unknown>;
  onRun: () => void;
}

function Highlight({ code }: { code: string }): React.JSX.Element {
  const parts = code.split(/(\/\/.*)/g);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith('//') ? (
          <span key={i} className="comment">{part}</span>
        ) : (
          part
        )
      )}
    </>
  );
}

function Cell({ index, title, privileged, description, snippets, state, onRun }: CellProps): React.JSX.Element {
  const running = state.status === 'running';
  return (
    <section className="cell" aria-labelledby={`cell-${index}-title`}>
      <header className="cell-header">
        <span className="cell-index">[{index}]</span>
        <h2 id={`cell-${index}-title`} className="cell-title">{title}</h2>
        <span className={privileged ? 'badge badge-privileged' : 'badge badge-unprivileged'}>
          {privileged ? 'Privileged' : 'Unprivileged'}
        </span>
      </header>

      <p className="cell-description">{description}</p>

      <div className="code-container">
        {snippets.map((s, i) => (
          <div key={i} className="code-wrapper">
            <div className="code-path">{s.path}</div>
            <pre className="code-block">
              <code>
                <Highlight code={s.code} />
              </code>
            </pre>
          </div>
        ))}
      </div>

      <div className="cell-actions">
        <button type="button" className="run-button" onClick={onRun} disabled={running}>
          {running ? 'Running...' : 'Run'}
        </button>
        <span className={`status status-${state.status}`}>{state.status}</span>
      </div>

      <div className="output" aria-live="polite">
        {state.output === null ? (
          <span className="output-empty">No output yet.</span>
        ) : (
          <pre className={state.status === 'error' ? 'output-body output-error' : 'output-body'}>
            <code>{formatOutput(state.output)}</code>
          </pre>
        )}
      </div>
    </section>
  );
}

const MEMORY_SNIPPETS: Snippet[] = [
  {
    path: 'packages/frontend/src/App.tsx',
    code: '// React: calls the backend binding\nconst result = await globalThis.bindings.getMemoryUsage();'
  },
  {
    path: 'packages/backend/main.ts',
    code: '// Backend: exposes native Deno data to UI\nwin.bind("getMemoryUsage", () => Promise.resolve(Deno.memoryUsage()));'
  }
];

const ROOT_SNIPPETS: Snippet[] = [
  {
    path: 'packages/frontend/src/App.tsx',
    code: '// 1. UI: cross the privilege boundary\nconst identity = await globalThis.bindings.getRootIdentity();'
  },
  {
    path: 'packages/backend/main.ts',
    code: '// 2. Backend: receives call, forwards to D-Bus client\nwin.bind("getRootIdentity", () => getRootIdentity());'
  },
  {
    path: 'packages/backend/dbus-client.ts',
    code: '// 3. D-Bus Client: calls the system bus directly\nconst msg = new Message({ destination: "org.linux_wrapper_starter.Helper1", ... });\nconst reply = await bus.call(msg);'
  },
  {
    path: 'packages/helper/main.ts',
    code: '// 4. Helper (Root): checks Polkit, then runs command\nif (!await isAuthorized(sender, "get-root-identity")) throw "Denied";\nconst out = await new Deno.Command("id").output();'
  }
];

export function App(): React.JSX.Element {
  const [memory, setMemory] = useState<CellState<MemoryUsage>>(idleState<MemoryUsage>());
  const [identity, setIdentity] = useState<CellState<RootIdentity>>(idleState<RootIdentity>());

  const runMemory = async (): Promise<void> => {
    setMemory({ status: 'running', output: null });
    try {
      let result: MemoryUsage;
      const bridge = globalThis.bindings;
      if (bridge) {
        result = await bridge.getMemoryUsage();
      } else {
        // Fallback for standard browsers
        const res = await fetch('http://127.0.0.1:3000/api/memory');
        if (!res.ok) throw new Error('API server not responding');
        result = await res.json();
      }
      setMemory({ status: 'done', output: result });
    } catch (error) {
      setMemory({ status: 'error', output: errorMessage(error) });
    }
  };

  const runIdentity = async (): Promise<void> => {
    setIdentity({ status: 'running', output: null });
    try {
      let result: RootIdentity;
      const bridge = globalThis.bindings;
      if (bridge) {
        result = await bridge.getRootIdentity();
      } else {
        // Fallback for standard browsers
        const res = await fetch('http://127.0.0.1:3000/api/id');
        if (!res.ok) throw new Error('API server not responding');
        result = await res.json();
      }
      setIdentity({ status: result.exitCode === 0 ? 'done' : 'error', output: result });
    } catch (error) {
      setIdentity({ status: 'error', output: errorMessage(error) });
    }
  };

  return (
    <main className="notebook">
      <header className="notebook-header">
        <h1>Linux Wrapper Starter</h1>
        <p>
          A minimal blueprint for building secure Linux desktop apps with Deno. 
          This notebook demonstrates how to execute privileged (root) and unprivileged 
          operations from a WebView GUI using D-Bus and Polkit.
        </p>
      </header>

      <Cell
        index={1}
        title="Get Memory Consumption"
        privileged={false}
        description="Reads system memory statistics in the unprivileged backend. No authentication required."
        snippets={MEMORY_SNIPPETS}
        state={memory}
        onRun={() => void runMemory()}
      />

      <Cell
        index={2}
        title="Get Root Identity"
        privileged
        description="Runs `id` as root through the helper. Polkit will ask for authorization."
        snippets={ROOT_SNIPPETS}
        state={identity}
        onRun={() => void runIdentity()}
      />
    </main>
  );
}
