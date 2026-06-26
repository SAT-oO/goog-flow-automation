# Flow Image Automator (Safari)

Safari Web Extension that automates bulk **image** generation on [Google Flow](https://labs.google/fx/tools/flow), inspired by tools like ZAPI FLOW.

## Features

- Verifies Google Flow is open and **Agent mode is off**
- Accepts prompts via pasted text or imported `.txt` file
- Parses **one prompt per line** or **one per paragraph** (blank-line separated)
- Live **prompt queue preview** before you start
- **Sequential** generation with a **2500 ms** delay between completed images
- **Auto-download** to `~/Downloads/[your folder name]/`
- **Start** and **Stop** controls

## Prerequisites

- macOS with **Xcode** installed
- Safari 17+ (side panel support)
- A signed-in Google Flow account

## Install (development)

1. Ensure Xcode is set up (run once if the converter fails):

```bash
xcodebuild -runFirstLaunch
```

2. Generate the Xcode wrapper:

```bash
./scripts/build-xcode.sh
```

If the converter still fails, you can create the project manually in Xcode: **File → New → Project → Safari Extension App**, then replace the generated `Resources` folder with the `extension/` directory from this repo.

3. Open the generated project in Xcode:

```bash
open "Flow Image Automator/Flow Image Automator.xcodeproj"
```

4. Select the **Flow Image Automator (macOS)** scheme and press **Run** (⌘R).

5. In Safari: **Settings → Extensions** → enable **Flow Image Automator**.

6. Open [Google Flow](https://labs.google/fx/tools/flow), create or open a project, and **turn Agent mode off**.

7. Click the extension icon to open the panel (side panel or popup).

## Usage

1. Paste prompts or import a `.txt` file.
2. Confirm the **Prompt queue** preview looks correct.
3. Set the download folder name (default: `flow-images`).
4. Click **Start generation**.
5. Use **Stop** to halt after the current step.

Images save under:

```
~/Downloads/[folder name]/flow_001_<timestamp>.png
```

## Prompt format

**One per line:**

```
A red sports car on a coastal highway
A misty forest with sunbeams
```

**One per paragraph:**

```
A red sports car on a coastal highway

A misty forest with sunbeams
```

## Project layout

```
extension/
  manifest.json
  background.js
  content/
    flow.js                 # message bridge entry point
    lib/
      dom.js                # Shadow DOM traversal utilities
      targeting.js          # prompt + submit button discovery
      input-sync.js         # reactive state synchronization
      submitter.js          # native .click() + Enter fallback
      ui-idle.js            # MutationObserver idle watcher
      lifecycle.js          # per-prompt state machine
      agent.js              # Agent mode guard
      images.js               # image collection + download helpers
  sidepanel/                # UI
  lib/parse-prompts.js
scripts/build-xcode.sh
```

## Notes

- Set Google Flow to **Create Image** mode and your preferred model before starting; the extension drives prompt entry and generation.
- If Google updates the Flow UI, selectors in `content/flow.js` may need adjustment.
- This extension runs locally; prompts are stored in `chrome.storage.local` only.

## Troubleshooting

| Issue | Fix |
|-------|-----|
| "Google Flow not detected" | Open `labs.google/fx/tools/flow` in the active Safari window |
| "Agent mode is ON" | Click **Agent** in the Flow prompt box to turn it off |
| "Could not find prompt box" | Open an active Flow **project** (not just the landing page) |
| Side panel doesn't open | Enable the extension in Safari Settings → Extensions |

## License

MIT
