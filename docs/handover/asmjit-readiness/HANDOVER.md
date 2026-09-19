# Handover — open_browser_porter AsmJit Readiness

State: PREPARED_ONLY
Priority: HIGH
Branch: `prep/asmjit-readiness-2026-09-19`

## What is prepared
A branch-local architecture plan for a second CPU execution backend: existing v86/WASM remains authoritative for browser execution; native desktop execution may later use x86 decode -> OBP IR -> AsmJit -> x64/AArch64.

## Invariants for the next agent
- Do not replace v86.
- Do not couple PE/HLE/Win32/graphics/storage semantics to AsmJit.
- Do not expose AsmJit C++ types across the host ABI.
- Do not implement AArch64 before x64 differential correctness.
- Do not merge this branch without explicit approval.

## Next safe action
Implement only the backend abstraction and isolated native smoke harness, then stop for review.

## Evidence required before further expansion
- browser regression pass
- JIT arithmetic/basic-block tests
- cache invalidation tests
- differential CPU-state comparison against v86
- measured performance data
