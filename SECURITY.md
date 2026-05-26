# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| 1.0.x | Yes |

## Reporting a Vulnerability

If you find a security issue, please **do not** open a public GitHub issue with sensitive details.

Instead, report it privately using one of these options:

1. Open a [GitHub Security Advisory](https://github.com/tomaziu/transferencia-qr/security/advisories/new) for this repository.
2. Contact the maintainer through GitHub: [@tomaziu](https://github.com/tomaziu).

Please include:

- A clear description of the issue
- Steps to reproduce
- Possible impact
- Suggested fix, if you have one

You should receive a response within **7 days**. If the report is accepted, we will work on a fix and coordinate disclosure when appropriate.

## Scope Notes

This app is intended for **local network use**. When running locally:

- Keep your firewall rules restrictive when possible.
- Do not expose the server directly to the public internet without additional hardening.
- The upload link is protected by a session token generated when the server starts.

Thank you for helping keep this project safe.
