# Changelog

All notable changes to Recap are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[Semantic Versioning](https://semver.org/).

## Unreleased

### Added

- Add a × button to the compact banner, expanded banner, and recap card. It hides the current recap on every client until a newer recap replaces it, and the Recap panel still shows it.
- Add a Minimal display mode and make it the default: a card with no border that shows only the text and ×. Saved display modes stay as they are.
- Add a Recap language setting. Empty follows the user's latest messages; a value such as Russian names that language in the prompt.
- Add `bb recap preview`, which shows the recap card in open BB windows at once, without generating or storing anything.

### Fixed

- Write recaps in the language of the user's latest messages. The rule follows the transcript, outside the editable prompt, together with a sample of those messages. Settings that hold the former default prompt move to the new default.
- With the default prompt, check each recap against the writing system of the user's latest messages. On a mismatch, a second short worker rewrites the sentence, without the transcript. A previous recap in the wrong script is not passed to the next one, so it cannot carry that language forward. Languages that share a script, such as English and German, are not told apart.
- Raise the size limit for automatic recaps from 500 to 800 raw characters, so recaps in languages with longer words than English are not dropped without notice.

## 0.2.4 - 2026-10-09

### Added

- Add an Expanded banner display mode: the compact banner opens expanded and can still be collapsed.

### Fixed

- Move Refresh and Expand/Collapse into the compact banner's header line, so the recap text spans the full banner width below it. On phones that header's Refresh is a ↻ icon that spins while busy, and Expand/Collapse shows only its arrow. The Recap card keeps a text Refresh label.
- Keep the Refresh label at a fixed width, so the "Automatic · time" line beside it does not reflow while the button briefly reads "Loading…" or "Generating…".
- Treat a thread as still active while a child thread is starting, active, or stopping, so recaps wait until that work finishes.
- Hide the previous thread's recap while the next one loads, and reset whether the banner starts open from the display mode.
- Keep a stored summary on screen when a refresh or generation returns no new recap, and still show the error.

## 0.2.3 - 2026-10-01

### Fixed

- Keep incremental recaps correct when older timeline pages fall outside the bounded history window, and retain context from existing recaps after upgrading.
- Prevent queued automatic recaps from starting after automatic generation is disabled.
- Keep generation errors visible after refreshing the Recap panel.
- Preserve the last usable recap when cleanup removes a suppressed refresh attempt.

### Changed

- Share model-option normalization and typed generation reasons across their consumers.

## 0.2.2 - 2026-09-25

### Changed

- Prevent recap generation for hidden threads, including hidden workers.
- Abort generation when a thread becomes hidden and recheck visibility before
  submitting its transcript.

## 0.2.1 - 2026-09-14

### Changed

- Refresh recaps with the previous summary and only the new turns, reducing repeated transcript input.

## 0.2.0 - 2026-08-31

### Added

- Limit concurrent recap workers and retry transient automatic failures.
- Capture fictional-data screenshots of recap displays and settings.

### Changed

- Schedule automatic recaps from thread activity instead of scanning idle threads at startup.
- Hide the composer recap banner while editing an inline message.

## 0.1.0 - 2026-08-30

### Added

- Release Recap as a BB plugin for generating and displaying thread summaries.
