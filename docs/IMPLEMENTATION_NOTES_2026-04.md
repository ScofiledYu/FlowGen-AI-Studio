# Implementation Notes (2026-04)

This document records the implemented behavior and decisions for recent fixes, so future changes can follow the same design.

## Scope

Covered modules:

- `components/FlowEditor.tsx`
- `types.ts`
- runtime proxies (`server.js`, `vite.config.ts`) as used by playback/download

---

## A) Node Details model/tab display rules

### A1. Seedance 1.5 should not show "生成模式"

- `seedance1.5-pro` has no tab-style generation mode in Node Details.
- Model resolution in details prioritizes `generationParams.model` snapshot, then fallback fields.
- `model` strings are normalized with `trim()` to avoid mismatch by whitespace.

Key outcome:

- Seedance 1.5 hides "生成模式" row and summary line.
- Seedance 2.0 still shows mode summary and parameter row.

### A2. Jimeng 3.0 Pro mode text hidden in Details

- Node Details summary and parameter display excludes Jimeng mode label per requirement.

---

## B) Node Details reference image/video behavior

### B1. Frame-slot semantics (first/last) preserved

Problem addressed:

- first/last frames could collapse into one when URLs are equal or deduped too early.

Current design:

- Keep slot semantics for frame slots (`first`, `last`) even if URL equals.
- Avoid early dedupe for frame-pair fallback source.
- Use ordered fallback from `referenceImages[0/1]` when explicit first/last fields are missing.

### B2. Model-specific frame handling

- Jimeng 3.0 Pro:
  - single first-frame behavior is valid when only first exists.
- Kling 2.5 / Vidu / Seedance:
  - preserve two slot entries when both frames exist.
- Kling 3.0 Omni `frames`:
  - uses first/last plus ordered fallback from snapshot refs.
  - no forced collapse in frames tab pipeline.

### B3. Reference video list must not include generated result video (Omni)

For `可灵3.0 Omni` in `instruction/video` tab:

- Reference Videos should show only input reference video(s).
- Generated output video is explicitly excluded from:
  - preferred slot candidate
  - fallback inferred candidate

Identity check uses same-asset matching (`isSameReferenceVideoAsset`).

---

## C) Video URL stability and playback

### C1. Vidu/AWS signed URLs mirror policy

`stabilizeVideoResourceUrl` treats URLs as mirror candidates when matching:

- `amazonaws.com` / `amazonaws.com.cn`
- `X-Amz-*` signature patterns
- plus existing unstable-host patterns (`aigc-cloud`, `kechuangai`, `volces`, `tos` etc.)

Goal:

- mirror short-lived/cross-domain video URLs to stable AiTop COS URL for long-term usability.

### C2. Node Details playback path

Node Details video playback uses:

- proxy source first: `resolveUrlForVideoCapture(...)` (`/proxy-file?url=...`)
- auto fallback to direct URL on `<video onError>`

Applied to:

- left preview video in Details
- Reference Videos inline player in Details

Reason:

- some URLs fail in proxy timing/state; fallback keeps immediate playback usable without refresh.

---

## D) Thumbnails/posters for generated MOV nodes

### D1. Poster must come from generated video for Omni instruction/video

Problem:

- output node poster could inherit from reference video poster.

Current behavior:

- For `可灵3.0 Omni` in `instruction/video`:
  - do not prefill output `videoPosterDataUrl` from reference poster fallback.
  - let async capture pipeline generate poster from output video URL.

### D2. Async poster pipeline

After node generation:

- capture poster from each generated MOV URL with retries.
- write to MOV node `videoPosterDataUrl`.
- sync related thumbnail list items by `nodeId`.
- persist to local storage shortly after update.

---

## E) Clipboard paste behavior

### E1. Pasted nodes should not carry generation history

When pasting copied nodes:

- remove generated history payload (`generatedThumbnails`)
- reset runtime execution state:
  - `status`, `progress`, `errorMessage`, `taskId`
- for MOV/OUTPUT also clear generated result artifacts:
  - `imagePreview`, `videoPosterDataUrl`, `generatedAt`, `imageName`
- keep editable generation config (prompt/reference/model params)

---

## F) Generated time in Details

- `generatedAt` is stored and shown in Details (`Generated At`) in used parameters.
- Included in generation snapshot and output node data merge flow.

---

## G) Practical modification guidance

When editing Node Details behavior in the future, follow this order:

1. `previewParams` construction and snapshot source priority
2. model/tab branching (`isOmniModel`, `isSeedance`, etc.)
3. frame-slot handling before generic dedupe
4. reference video exclusion of output result
5. Details rendering layer (`Reference Images`, `Reference Videos`, `Used Parameters`)

If changing video playback rules, test all of:

- immediate open after generation (no refresh)
- after refresh
- proxy success
- proxy fail with direct fallback

