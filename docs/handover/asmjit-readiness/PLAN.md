# AsmJit Readiness Plan — open_browser_porter

Status: PREPARED_ONLY
Branch: `prep/asmjit-readiness-2026-09-19`
Base: `main`
Execution: NOT STARTED
Merge/PR: FORBIDDEN until explicit approval and completed gates.

## Goal
Prepare a native desktop execution backend without changing the existing browser/v86/WASM execution path.

## Planned architecture
1. Introduce a neutral ExecutionBackend boundary above CPU execution.
2. Keep v86/WASM as the browser implementation.
3. Add an isolated native C++ JIT core behind a stable C ABI.
4. Add a compact target-neutral IR between x86 decode and host codegen.
5. Use AsmJit for x86-64 first; add AArch64 only after differential correctness is proven.
6. Add basic-block cache, page-generation invalidation, HLE trap bridge, and deterministic telemetry.
7. Use v86 as the initial differential correctness authority.

## First execution tranche
- ExecutionBackend interface only.
- Wrap existing v86 path without semantic changes.
- Isolated native/jit test target.
- CpuState ABI.
- Tiny IR: MOV/ADD/SUB/CMP/Jcc/EXIT.
- x64 AsmJit backend.
- Block cache and invalidation skeleton.
- Differential harness.

## Gates
- Existing browser behavior unchanged.
- No native JIT code reachable from browser builds.
- Deterministic instruction/state differential tests pass.
- No persistent RWX policy; executable memory goes through AsmJit JitRuntime.
- HLE/Win32 semantics remain shared, not duplicated inside codegen.
- Benchmarks capture compile latency, cache-hit rate, blocks/s, instructions/s, HLE traps/s, and frame-time impact.

## Explicitly out of scope for this prepared branch
- No AsmJit dependency added.
- No decoder integrated.
- No native code execution.
- No production desktop runtime.
- No merge, release, or PR.
