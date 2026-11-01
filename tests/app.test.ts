import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as recapHelpers from "../src/recap.ts";

// Exercise the production hook's async RPC flow without requiring a BB host or DOM.
// Hook stubs keep state between renders and expose the realtime subscription.
function mountRecapHook(call: (method: string, input?: unknown) => Promise<unknown>) {
  const source = readFileSync(new URL("../src/app.tsx", import.meta.url), "utf8");
  const hook = source.slice(source.indexOf("function useThreadRecap"), source.indexOf("\nfunction RecapPanel"));
  const messageStart = source.indexOf("function generationErrorMessage");
  const messages = messageStart < 0 ? "" : source.slice(messageStart, source.indexOf("\nfunction isRecord", messageStart));
  const states: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const threadIdBox = { id: "t1" };
  let index = 0;
  let refIndex = 0;
  let realtime: (payload: unknown) => void = () => {};
  const rpc = { call };
  const environment = {
    ...recapHelpers,
    threadIdBox,
    useRpc: () => rpc,
    useState: (initial: unknown) => {
      const slot = index++;
      if (!(slot in states)) states[slot] = initial;
      return [states[slot], (value: unknown) => {
        states[slot] = typeof value === "function" ? value(states[slot]) : value;
      }];
    },
    useRef: (initial: unknown) => {
      const slot = refIndex++;
      if (!refs[slot]) refs[slot] = { current: initial };
      return refs[slot];
    },
    useCallback: (callback: unknown) => callback,
    useEffect: () => {},
    useRealtime: (_event: string, callback: typeof realtime) => { realtime = callback; },
    isRecord: (value: unknown) => value !== null && typeof value === "object",
    RECAP_CHANGED: "recap-changed",
  };
  const compiled = ts.transpileModule(`${messages}\n${hook}\nreturn useThreadRecap(threadIdBox.id);`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const run = new Function(...Object.keys(environment), compiled) as (...args: unknown[]) => {
    generate: () => Promise<void>;
    dismiss: (recapId: string) => Promise<void>;
    dismissed: boolean;
    error: string | null;
    recap: { id?: string; summary?: string } | null;
    generating: boolean;
  };
  return {
    render: () => { index = 0; refIndex = 0; return run(...Object.values(environment)); },
    signal: (extra: Record<string, unknown> = {}) => realtime({ threadId: threadIdBox.id, ...extra }),
    setThreadId: (id: string) => { threadIdBox.id = id; },
  };
}

for (const failure of ["empty_model_response", "provider failure"]) {
  test(`keeps generation failure visible after successful reads: ${failure}`, async () => {
    let fail = true;
    const hook = mountRecapHook(async (method) => {
      if (method === "recap_get") return { recap: null, generating: false };
      if (fail && failure === "provider failure") throw new Error(failure);
      return fail ? { recap: null, reason: failure } : { recap: { summary: "Done" }, reason: null };
    });
    await hook.render().generate();
    await Promise.resolve();
    const error = hook.render().error;
    assert.equal(error, failure === "provider failure" ? failure : "The recap model returned no usable summary.");
    hook.signal();
    await Promise.resolve();
    assert.equal(hook.render().error, error);
    fail = false;
    await hook.render().generate();
    await Promise.resolve();
    assert.equal(hook.render().error, null);
  });
}

test("hides the previous thread's recap as soon as the thread changes", async () => {
  const hook = mountRecapHook(async (method) => {
    if (method === "recap_get") return { recap: { id: "got", summary: "Loaded" }, generating: false };
    return { recap: { id: "made", summary: "Made" }, reason: null };
  });
  await hook.render().generate();
  const before = hook.render().recap;
  assert.ok(before?.summary === "Made" || before?.summary === "Loaded");
  hook.setThreadId("t2");
  const switched = hook.render();
  assert.equal(switched.recap, null);
  assert.equal(switched.generating, false);
  assert.equal(switched.error, null);
});

test("shows a generation failure on the thread that requested it", async () => {
  let fail = false;
  const hook = mountRecapHook(async () => {
    if (fail) throw new Error("offline");
    return { recap: { id: "a", summary: "Alpha" }, generating: false, reason: null };
  });
  await hook.render().generate();
  hook.setThreadId("t2");
  fail = true;
  await hook.render().generate();
  await Promise.resolve();
  const view = hook.render();
  assert.equal(view.error, "offline");
  assert.equal(view.recap, null);
  assert.equal(view.generating, false);
});

test("keeps a generation failure when a refresh arrives while it is in flight", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hook = mountRecapHook(async (method) => {
    if (method === "recap_generate") {
      await gate;
      throw new Error("provider failure");
    }
    return { recap: { id: "old", summary: "Old" }, generating: false };
  });
  const pending = hook.render().generate();
  hook.signal();
  await Promise.resolve();
  release();
  await pending;
  await Promise.resolve();
  const view = hook.render();
  assert.equal(view.error, "provider failure");
  assert.equal(view.recap?.summary, "Old");
});

test("dismissing hides the recap at once and a stale read cannot bring it back", async () => {
  const dismissals: unknown[] = [];
  const hook = mountRecapHook(async (method) => {
    if (method === "recap_dismiss") { dismissals.push(method); return { dismissed: true }; }
    return { recap: { id: "a", summary: "Alpha", dismissedAt: null }, generating: false, reason: null };
  });
  await hook.render().generate();
  await Promise.resolve();
  assert.equal(hook.render().dismissed, false);
  const pending = hook.render().dismiss("a");
  assert.equal(hook.render().dismissed, true);
  await pending;
  hook.signal();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().dismissed, true);
  assert.equal(dismissals.length, 1);
});

test("a recap dismissed elsewhere stays hidden and a newer recap is shown", async () => {
  let recap = { id: "a", summary: "Alpha", dismissedAt: 123 as number | null };
  const hook = mountRecapHook(async () => ({ recap, generating: false, reason: null }));
  await hook.render().generate();
  await Promise.resolve();
  assert.equal(hook.render().dismissed, true);
  recap = { id: "b", summary: "Beta", dismissedAt: null };
  hook.signal();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().dismissed, false);
});

test("a failed dismissal restores the recap and reports the error", async () => {
  const hook = mountRecapHook(async (method) => {
    if (method === "recap_dismiss") throw new Error("offline");
    return { recap: { id: "a", summary: "Alpha", dismissedAt: null }, generating: false, reason: null };
  });
  await hook.render().generate();
  await Promise.resolve();
  await hook.render().dismiss("a");
  const view = hook.render();
  assert.equal(view.dismissed, false);
  assert.equal(view.error, "offline");
});

test("a dismissal that fails after a thread switch does not leave the recap hidden", async () => {
  let reject!: (cause: Error) => void;
  const hook = mountRecapHook(async (method) => {
    if (method === "recap_dismiss") return new Promise((_, fail) => { reject = fail; });
    return { recap: { id: "a", summary: "Alpha", dismissedAt: null }, generating: false, reason: null };
  });
  await hook.render().generate();
  await Promise.resolve();
  const pending = hook.render().dismiss("a");
  hook.setThreadId("t2");
  hook.render();
  reject(new Error("offline"));
  await pending;
  hook.setThreadId("t1");
  await hook.render().generate();
  await Promise.resolve();
  const view = hook.render();
  assert.equal(view.dismissed, false);
  assert.equal(view.recap?.id, "a");
});

test("an older failed dismissal does not undo a newer one", async () => {
  const rejects = new Map<string, (cause: Error) => void>();
  let recapId = "a";
  const hook = mountRecapHook(async (method, input) => {
    if (method === "recap_dismiss") {
      return new Promise((_, fail) => { rejects.set((input as { recapId: string }).recapId, fail); });
    }
    return { recap: { id: recapId, summary: recapId, dismissedAt: null }, generating: false, reason: null };
  });
  await hook.render().generate();
  await Promise.resolve();
  const first = hook.render().dismiss("a");
  recapId = "b";
  await hook.render().generate();
  await Promise.resolve();
  const second = hook.render().dismiss("b");
  await Promise.resolve();
  rejects.get("a")!(new Error("offline"));
  await first;
  assert.equal(hook.render().dismissed, true);
  assert.equal(hook.render().error, null);
  rejects.get("b")!(new Error("offline"));
  await second;
  assert.equal(hook.render().dismissed, false);
});

test("a preview shows while the thread has no visible recap and × clears it", async () => {
  let recap: { id: string; summary: string; generatedAt: number; dismissedAt: null } | null = null;
  const calls: string[] = [];
  const hook = mountRecapHook(async (method) => {
    calls.push(method);
    return { recap, generating: false, reason: null, dismissed: false };
  });
  hook.render();
  hook.signal({ preview: { id: "p", threadId: "t1", summary: "Sample", generatedAt: 100, dismissedAt: null } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap?.summary, "Sample");
  assert.equal(hook.render().dismissed, false);

  recap = { id: "old", summary: "Older", generatedAt: 50, dismissedAt: null };
  hook.signal();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap?.summary, "Sample");

  await hook.render().dismiss("p");
  assert.equal(hook.render().recap?.summary, "Older");
  assert.ok(calls.includes("recap_dismiss"));
});

test("a newer recap replaces a preview, and a preview for another thread is ignored", async () => {
  let recap: { id: string; summary: string; generatedAt: number; dismissedAt: null } | null = null;
  const hook = mountRecapHook(async () => ({ recap, generating: false, reason: null }));
  hook.render();
  hook.signal({ threadId: "other", preview: { id: "x", threadId: "other", summary: "Other", generatedAt: 1, dismissedAt: null } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap, null);

  hook.signal({ preview: { id: "p", threadId: "t1", summary: "Sample", generatedAt: 100, dismissedAt: null } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap?.summary, "Sample");
  recap = { id: "new", summary: "Newer", generatedAt: 200, dismissedAt: null };
  hook.signal();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap?.summary, "Newer");

  recap = null;
  hook.signal();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap, null);
});

test("closing a preview in another window closes it here", async () => {
  const hook = mountRecapHook(async () => ({ recap: null, generating: false, reason: null }));
  hook.render();
  hook.signal({ preview: { id: "p", threadId: "t1", summary: "Sample", generatedAt: 100, dismissedAt: null } });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap?.summary, "Sample");
  hook.signal({ closePreview: "older" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap?.summary, "Sample");
  hook.signal({ closePreview: "p" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap, null);
});

test("close signals compare with the newest preview even without a render between them", async () => {
  const hook = mountRecapHook(async () => ({ recap: null, generating: false, reason: null }));
  const sample = (id: string) => ({ id, threadId: "t1", summary: id, generatedAt: 100, dismissedAt: null });
  hook.render();
  hook.signal({ preview: sample("a") });
  hook.render();
  hook.signal({ preview: sample("b") });
  hook.signal({ closePreview: "a" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap?.id, "b");
  hook.signal({ preview: sample("c") });
  hook.signal({ closePreview: "c" });
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap, null);
});

test("a recap held from the previous thread does not end the next thread's preview", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const hook = mountRecapHook(async (_method, input) => {
    if ((input as { threadId: string }).threadId === "t2") {
      await gate;
      return { recap: null, generating: false, reason: null };
    }
    return { recap: { id: "a", summary: "Alpha", generatedAt: 500, dismissedAt: null }, generating: false, reason: null };
  });
  await hook.render().generate();
  await Promise.resolve();
  assert.equal(hook.render().recap?.id, "a");

  hook.setThreadId("t2");
  hook.render();
  hook.signal({ preview: { id: "p", threadId: "t2", summary: "Sample", generatedAt: 100, dismissedAt: null } });
  hook.render();
  hook.render();
  release();
  await gate;
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(hook.render().recap?.summary, "Sample");
});

test("a failed refresh keeps the recap already on screen", async () => {
  let failGet = false;
  const hook = mountRecapHook(async (method) => {
    if (method === "recap_get" && failGet) throw new Error("offline");
    return { recap: { id: "a", summary: "Alpha" }, generating: false, reason: null };
  });
  await hook.render().generate();
  await Promise.resolve();
  failGet = true;
  hook.signal();
  await Promise.resolve();
  await Promise.resolve();
  const view = hook.render();
  assert.equal(view.recap?.summary, "Alpha");
  assert.equal(view.error, "offline");
});

test("a null generation result keeps the recap already on screen", async () => {
  let fail = false;
  const hook = mountRecapHook(async (method) => {
    if (fail && method === "recap_generate") return { recap: null, reason: "empty_model_response" };
    return { recap: { id: "a", summary: "Alpha" }, generating: false, reason: null };
  });
  await hook.render().generate();
  await Promise.resolve();
  fail = true;
  await hook.render().generate();
  await Promise.resolve();
  const view = hook.render();
  assert.equal(view.recap?.summary, "Alpha");
  assert.equal(view.recap?.id, "a");
  assert.equal(view.error, "The recap model returned no usable summary.");
});

test("a null generation result keeps the recap when the follow-up read fails", async () => {
  let fail = false;
  const hook = mountRecapHook(async (method) => {
    if (fail && method === "recap_get") throw new Error("offline");
    if (fail && method === "recap_generate") return { recap: null, reason: "empty_model_response" };
    return { recap: { id: "a", summary: "Alpha" }, generating: false, reason: null };
  });
  await hook.render().generate();
  await Promise.resolve();
  fail = true;
  await hook.render().generate();
  await Promise.resolve();
  await Promise.resolve();
  const view = hook.render();
  assert.equal(view.recap?.summary, "Alpha");
  assert.equal(view.error, "The recap model returned no usable summary.");
});

test("a null generation result drops the recap after a read confirms it is gone", async () => {
  let fail = false;
  const hook = mountRecapHook(async (method) => {
    if (fail && method === "recap_generate") return { recap: null, reason: "stale" };
    if (fail) return { recap: null, generating: false };
    return { recap: { id: "a", summary: "Alpha" }, generating: false, reason: null };
  });
  await hook.render().generate();
  await Promise.resolve();
  fail = true;
  await hook.render().generate();
  await Promise.resolve();
  await Promise.resolve();
  const view = hook.render();
  assert.equal(view.recap, null);
  assert.equal(view.error, "The thread changed while the recap was generating. Try again.");
});
