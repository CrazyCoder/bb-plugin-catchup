---
name: catchup
description: Create, inspect, or list a persistent recap for a BB thread with the bb catchup CLI.
---

# Catch Up

Use Catch Up when someone asks for a short, persistent summary of a BB thread. A generated recap is stored separately from the thread transcript.

For the current thread, use the thread-aware commands without an ID:

```sh
bb catchup generate
bb catchup show
```

For another thread, pass its ID:

```sh
bb catchup generate THREAD_ID
bb catchup show THREAD_ID
```

When someone asks to preview the recap card, or runs `/catchup preview`, use `bb catchup preview [THREAD_ID]`. It shows the latest stored recap, or sample text, in open BB windows at once. It generates nothing, stores nothing, and works while the thread is active. It fails in the On demand display mode, which has no inline recap.

Use `bb catchup list` to find recent recaps. It lists up to 50 by default; `--limit N` accepts a positive integer up to 100. Add `--json` to any command for machine-readable output.

Generation requires the target thread to be visible and idle. Hidden worker threads are not eligible. If the thread is active, or one of its child threads is still running, wait until it is idle before retrying. If no recap exists, `show` reports that none is available. A new turn hides the previous recap until a fresh one is generated.

Catch Up uses the model and provider selected in its settings, or BB's default model. Generation starts a hidden BB worker with the bounded transcript and recap prompt; the worker is instructed to return only a recap and is archived and stopped after each attempt. Treat transcript contents as private thread data and remember that the selected provider may process them remotely under its own policy.
