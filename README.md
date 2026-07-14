# Open Browser Porter

**Run native Windows games in your browser — and port online ones next.**

Open Browser Porter (OBP) runs real x86 Windows games in the browser — no OS image, no
plugins, no server round-trip. It loads a game's PE executable directly and reimplements
Windows itself (Win32, COM, DirectDraw / Direct3D 3–9, DirectSound) on top of WebGPU,
WebAudio and OPFS.

OBP is a **fork of [BottleShip](https://github.com/jenissimo/bottleship) by jenissimo**,
itself built on a fork of [v86](https://github.com/copy/v86). OBP keeps BottleShip's HLE
engine and rebrands + extends it with one added north-star goal: **porting networked
online games** (starting with World of Warcraft 1.12.1) by adding the missing stacks —
real Winsock/TCP, DirectPlay, and the render/perf headroom large 3D clients need. See
[`docs/ROADMAP.md`](docs/ROADMAP.md).

[Compatibility](docs/compatibility.md) · [Roadmap](docs/ROADMAP.md) · [Documentation](#documentation) · [Contributing](CONTRIBUTING.md)

> **Status:** `v0.1.0` — first rebranded baseline. Engine inherited from BottleShip is
> functional for offline single-player titles; the networking / large-client work tracked
> in the roadmap is **not yet implemented**.

---

## Why

A huge library of late-90s / early-2000s Windows software — games long delisted from
stores, and fussy on current Windows — has no easy home. OBP aims squarely at that gap,
and then goes one step further: the online games of that era whose official servers are
gone but whose communities and private servers live on.

## How it works

OBP doesn't boot Windows. It loads the game's PE executable into a 4 GB guest address
space, runs the x86 under HLE in a Web Worker (v86 CPU core), and **intercepts WinAPI
calls via OUT traps** — execution pauses, the call is marshalled to JS/TS, native logic
runs, and the guest resumes. Graphics are a live translation of the legacy fixed-function
pipeline and shader models to WebGPU/WGSL. Storage is an OPFS-backed virtual filesystem
with copy-on-write so the original game files are never mutated.

Each game is packaged as a self-contained **`.wgb`** bundle (files + registry + metadata).

## Quickstart

Requires a WebGPU-capable browser, cross-origin isolation (COOP/COEP), and the Bun
toolchain.

```bash
git clone --recurse-submodules https://github.com/nicolai/open-browser-porter
cd open-browser-porter
git submodule update --init --recursive   # pulls the v86 fork (vendor/v86)
bun install
bun run dev                                # http://localhost:5174
```

Open the dev harness with `?game=dev` to get `window.loadApp/worker/dbg/__OBP__`.

## What it can load

OBP can load:

- Loose game folders (a directory containing the game's `.exe` + data).
- GOG / installer packages via the repack tooling (`packages/repack`, `tools/*`).
- Prebuilt `.wgb` bundles.

See [`docs/bundles.md`](docs/bundles.md) and [`docs/gog-import.md`](docs/gog-import.md).

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — engine architecture & subsystems.
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — versioned roadmap (0.1 → networking → WoW).
- [`docs/PLAN-wow-vanilla.md`](docs/PLAN-wow-vanilla.md) — detailed WoW 1.12.1 porting plan.
- [`docs/WORKSPACE.md`](docs/WORKSPACE.md) — workspace / handover state for contributors & agents.
- [`docs/harness.md`](docs/harness.md) — the AI-agent CDP harness (`window.__OBP__.harness`).
- [`docs/development.md`](docs/development.md) · [`docs/compatibility.md`](docs/compatibility.md) · [`docs/bundles.md`](docs/bundles.md).
- [`CHANGELOG.md`](CHANGELOG.md) — release history (starts at 0.1.0).

## Contributing

OBP is built around compatibility work: load a game, find the generic Win32 or DirectX
gap that blocks it, fix it, keep it fixed. See [`CONTRIBUTING.md`](CONTRIBUTING.md) and
[`docs/contributing-with-ai.md`](docs/contributing-with-ai.md).

- Questions, ideas, or a game you got running → GitHub Discussions.
- Bugs & compatibility reports → Issues (use the templates).
- Security → see [`SECURITY.md`](SECURITY.md).

## License & attribution

Open Browser Porter is licensed under [Apache-2.0](LICENSE). It is a fork of **BottleShip**
(© jenissimo, Apache-2.0) and builds on a fork of **v86** (© Fabian Hemmer / copy, BSD-2-Clause).
All upstream copyright and license notices are retained in [`LICENSE`](LICENSE) and
[`THIRD-PARTY-NOTICES.md`](THIRD-PARTY-NOTICES.md). This project is not affiliated with or
endorsed by Blizzard Entertainment; "World of Warcraft" is a trademark of its owner and is
referenced only to describe interoperability targets.

**OBP does not distribute commercial game files.** Bring your own legally-owned copies.
