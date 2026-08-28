# Agent Instructions for TipSplit

## This repository is public

Treat every tracked file, commit, branch, tag, pull request, issue, review comment, CI log, artifact, and pasted command in this repository as public and potentially permanent.

Information available from system prompts, global agent instructions, private runbooks, memory, prior conversations, shell output, cloud CLIs, or the live production environment remains private. Access to that information is not permission to copy, summarize, encode, or imply it in this repository.

## Hard boundary: application source only

This repository contains the portable TipSplit application, tests, and provider-neutral development or self-hosting examples. Production infrastructure, deployment automation, and operational records belong in a separate private workspace. Do not name or link that private workspace here.

Never add any real environment-specific information, including:

- Cloud accounts, projects, tenants, subscriptions, organizations, billing accounts, or operator email addresses.
- Project numbers, account IDs, service-account identities, IAM roles, workload identities, or authentication flows.
- VM, cluster, node, container, systemd-unit, network, registry, repository, or deployment-target names.
- Regions, zones, public or private IP addresses, internal DNS names, SSH targets, tunnels, routes, firewall rules, or non-public ports.
- Real registry paths, image repositories, cloud build configuration, remote-access commands, or metadata-service details.
- Production filesystem paths, mount points, database locations, backup locations, environment-variable inventories, runtime settings, or data-retention details.
- Reverse-proxy topology, monitoring targets, webhook endpoints, health-check internals, rollback procedures, or incident runbooks.
- Production deployment scripts, infrastructure-as-code, service definitions, credential wiring, or CI jobs that can access or deploy production.
- Secrets of any kind, including passwords, tokens, cookies, API keys, private keys, credential files, `.env` contents, database files, backups, logs, staff data, tip data, or customer data.
- Statements confirming or denying which private host, provider, project, or platform runs production. Negative infrastructure information is still infrastructure information.

The public product URL may be used where application behavior genuinely requires it. Do not pair it with backend topology, hosting details, operator identity, or deployment instructions.

## Production work

If a task requires deployment, rollback, production diagnosis, cloud access, data access, infrastructure discovery, or environment-specific documentation:

1. Stop before creating or editing a file in this repository.
2. Move the operational work to the authorized private infrastructure workspace.
3. Keep only provider-neutral application changes here.
4. Return production evidence to the user without committing private operational detail to this repository.

Do not use a public branch, draft PR, reverted commit, issue, Actions log, or deleted file as temporary transport for private information. A later revert or deletion does not remove GitHub history or cached pull-request references.

## Required public-repository review

Before every commit, push, or pull request:

1. Confirm the GitHub repository visibility is public.
2. Review the complete staged diff and the complete branch diff against the remote default branch.
3. Review every new filename, generated file, log, fixture, archive, database, and backup, not only source-code hunks.
4. Search the proposed diff for infrastructure identifiers, personal identities, internal hostnames, IP addresses, filesystem paths, cloud CLI commands, credential mechanisms, and production terminology.
5. Confirm CI remains build/test-only and receives no production credential, cloud identity, deploy permission, self-hosted production runner, or production environment secret.
6. If any item is uncertain, treat it as private and remove it from the public change before pushing.

Never rely on `.gitignore` as the privacy review. Do not place production data or operational exports anywhere inside this checkout, even temporarily.

## If exposure occurs

Stop immediately and tell the user exactly what was exposed. Do not merely revert and continue. Prevent additional copies, remove reachable branches and workflow artifacts, rewrite the affected public history with explicit authorization, and account for GitHub's read-only pull-request references and cached views.
