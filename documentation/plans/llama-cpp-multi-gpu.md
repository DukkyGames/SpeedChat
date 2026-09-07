# llama.cpp multi-GPU hosting

## Agreed context

- **Goal:** Split one GGUF across selected GPUs from Models, emitting `--device CUDA1,CUDA0 --split-mode layer --tensor-split 5,5`.
- **Users:** Local GGUF hosting in the Models inspector Load tab.
- **MVP:** Inspector opt-in. One GPU remains the default until the user checks more cards. Check order is `--device` order. Per-GPU ratios appear only after two or more cards are checked; until a slider is edited, omit `--tensor-split`.
- **Non-goals:** RPC GPUs, `GGML_CUDA_P2P`, auto-using every visible card, Discover ranking, MLX.

## Todos

- [x] Plan document
- [x] Parse `llama-server --list-devices`; fall back to hardware.gpus; fix Windows per-GPU names
- [x] Persist `device` / `split_mode` / `tensor_split` / `main_gpu`; emit `--device`; pin first GPU when 2+ exist
- [x] Load-tab GPUs advanced section + Loaded with rows
- [x] Tests (args, launch-prefs, parser, inspector-launch)
- [x] Update `documentation/context.md` and `documentation/manual/apps/models.md`

## Design brief (confirmed)

Collapsed **GPUs** section in the Load advanced stack. Checklist of GGML devices. First checked is first in `--device`. Split mode and ratios only after two checks. Probe failure falls back to nvidia-smi / hardware.gpus. No dashboard bars, no LM Studio clone, no reorder handles.

## Open questions for build

- Capture real CUDA and Vulkan `--list-devices` fixtures.
- `main_gpu` stays in argv/prefs for Extra-args parity; no dedicated inspector control (check-order covers single-GPU pick).
