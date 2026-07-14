# Security Policy

## Reporting a vulnerability

Please report security issues **privately** — do not open a public issue for anything
exploitable. Use GitHub's [private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
("Report a vulnerability" under the repository's **Security** tab), or email
**security@open-browser-porter.dev**.

Please include a description, affected version/commit, and a minimal reproduction if you have
one. We'll acknowledge and work with you on a fix and coordinated disclosure.

## Threat model

Open Browser Porter executes **untrusted x86 guest code** (the games you load) entirely inside the
browser. The relevant boundaries:

- **The browser sandbox is the outer boundary.** Guest code runs in a Web Worker via the v86
  WASM CPU; it has no direct access to the host machine, filesystem, or network beyond what
  the page itself is granted.
- **The emulator's memory model** (paged 4 GB address space, region permissions, copy-on-write
  overlays) isolates guests from Open Browser Porter's own JS/WASM state, and games from one another.
- **Persistence** is scoped per game to an OPFS container; a game cannot read another game's
  save data or escape its overlay.

Security-relevant bugs we care about include: a guest escaping its address-space/permission
model to corrupt engine state, one game reading or writing another's container, or the
COOP/COEP isolation being weakened such that SharedArrayBuffer-backed state leaks
cross-origin.

Because games are inherently untrusted binaries, **only load software you trust or own.**
Open Browser Porter does not, and cannot, vet the behavior of arbitrary executables you supply.

## Supported versions

Open Browser Porter is pre-1.0 and moves fast; security fixes land on the default branch. There are no
long-term support branches yet.
