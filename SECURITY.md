# Security Policy

## Reporting a Vulnerability

**Do NOT open a public issue for security vulnerabilities.**

Report privately through GitHub's **Private Vulnerability Reporting**: open the
repository's **Security** tab and click **"Report a vulnerability"**
([direct link](https://github.com/michaelinghilterra-creator/trajecktory/security/advisories/new)).
Include:

1. Description of the vulnerability
2. Steps to reproduce
3. Potential impact
4. Suggested fix (if any)

You will receive a response within 72 hours, and we will coordinate a fix before
public disclosure. (Private vulnerability reporting is available once the
repository is public.)

## Scope

Security issues in the following are in scope:

- **Scripts** (`*.mjs`) — command injection, path traversal, SSRF
- **Dashboard** (`dashboard-web/`) — XSS, auth/CSRF bypass, or SSRF in the local Express/React app
- **Templates** (`templates/`) — XSS in generated HTML/PDF
- **Configuration** — secrets exposure, unsafe defaults

## Out of Scope

- Issues in third-party dependencies (report upstream)
- Issues requiring physical access to the user's machine
- Social engineering attacks
- trajecktory is a local tool — there is no hosted service to attack

## Disclosure Policy

We follow coordinated disclosure. Once a fix is released, we will credit the reporter (unless they prefer anonymity) in the release notes.
