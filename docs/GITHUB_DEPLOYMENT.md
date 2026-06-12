# GitHub Deployment

How to put this project on your personal GitHub and use the CI pipeline.

## 1. Create the repository and push

On github.com: **New repository** (private or public), **without** a README/
.gitignore (the repo already has them). Then from the project folder on
Windows (Git is one of the four allowed host tools):

```bash
git remote add origin https://github.com/<you>/<repo>.git
git branch -M main
git push -u origin main
```

> Before the first push, set your real identity if you haven't:
> `git config user.name "Your Name"` and
> `git config user.email "you@example.com"`
> (the repo was initialized with a placeholder identity — see ASSUMPTIONS.md #14).

## 2. What CI does (`.github/workflows/ci.yml`)

Runs automatically on every push to `main` and on every pull request:

| Job | Steps |
|-----|-------|
| **validate** | The exact local Docker workflow on an ubuntu runner: `cp .env.example .env` → compose build → up db+app → `pnpm install --frozen-lockfile` → lint → typecheck → unit tests → migrate → integration tests → seed → build → up bot+admin → wait for health → Playwright e2e → logs + teardown. Playwright HTML report is uploaded as an artifact on failure. |
| **docker-prod** | Builds both production image targets (`bot`, `admin`). |
| **secret-scan** | gitleaks over the full git history; fails on committed secrets. |

CI needs **no Discord secrets** — the platform runs and is fully testable
with the Discord adapter disabled (that's a design feature, not a gap).

### Required repository secrets

None for the pipeline as shipped. (`GITHUB_TOKEN` is provided automatically;
`GITLEAKS_LICENSE` is only needed for organization-owned repos.) If you later
add deployment jobs (registry push, SSH deploy), add those credentials as
**Settings → Secrets and variables → Actions** secrets — never in the repo.

## 3. Branch protection (recommended)

Settings → Branches → Add rule for `main`:

- ✅ Require a pull request before merging
- ✅ Require status checks to pass: `validate`, `docker-prod`, `secret-scan`
- ✅ Require branches to be up to date before merging

With this, broken code cannot reach `main`, and `main` is always deployable.

## 4. CI/CD flow

```
feature branch → PR → CI (validate + docker-prod + secret-scan) → review →
merge to main → CI again on main → deploy manually (next section)
```

Deployment is deliberately manual in v1 — no production action happens
without you running it.

## 5. Manual deployment from GitHub

On the server (Linux with Docker, or any machine with Docker Desktop):

```bash
git clone https://github.com/<you>/<repo>.git bot-platform   # first time
cd bot-platform && git pull                                  # updates
docker compose -f docker-compose.prod.yml up -d --build
```

See [DOCKER_DEPLOYMENT.md](DOCKER_DEPLOYMENT.md) for secrets, seeding,
backups and the reverse-proxy option.

### Optional next step: registry-based deploys

When you want servers to pull prebuilt images instead of building locally,
add a job that pushes to GHCR on tagged releases
(`docker/login-action` + `docker/build-push-action`, tags
`ghcr.io/<you>/botplatform-bot:<version>`), and switch the prod compose
`image:` fields to those tags. Not shipped by default to keep v1 simple.

## 6. Release checklist

- [ ] CI green on `main` (all three jobs)
- [ ] `docs/` updated for any behavior change
- [ ] Database migrations committed (`packages/database/migrations/`)
- [ ] Version bumped where you track it (`BUILD_VERSION` env / tags)
- [ ] `git tag vX.Y.Z && git push --tags`
- [ ] Deploy: `git pull && docker compose -f docker-compose.prod.yml up -d --build`
- [ ] Post-deploy smoke check: panel `/healthz`, dashboard shows Discord `connected`
