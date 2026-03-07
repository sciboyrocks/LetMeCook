import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import type { ChildProcess } from 'node:child_process';
import { existsSync, unlinkSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import { join } from 'node:path';

const requireAuth = (req: FastifyRequest, reply: FastifyReply) =>
  (req.server as FastifyInstance).requireAuth(req, reply);

let ghLoginProcess: ChildProcess | null = null;
let ghLoginUrl: string | null = null;
let ghLoginCode: string | null = null;

function parseGitHubRepoFromUrl(repoUrl: string): { owner: string; repo: string } | null {
  const value = repoUrl.trim();
  if (!value) return null;

  if (value.startsWith('git@github.com:')) {
    const path = value.slice('git@github.com:'.length).replace(/\.git$/, '');
    const [owner, repo] = path.split('/');
    if (!owner || !repo) return null;
    return { owner, repo };
  }

  try {
    const url = new URL(value);
    if (url.hostname !== 'github.com') return null;
    const cleanedPath = url.pathname.replace(/^\//, '').replace(/\.git$/, '');
    const parts = cleanedPath.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    return { owner: parts[0], repo: parts[1] };
  } catch {
    return null;
  }
}

function run(command: string, args: string[]) {
  return spawnSync(command, args, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  });
}

function commandExists(command: string): boolean {
  const result = run(command, ['--version']);
  return result.status === 0;
}

function installWithSystemPackageManager(packages: string[]): boolean {
  const isRoot = typeof process.getuid === 'function' ? process.getuid() === 0 : false;
  if (!isRoot) return false;

  if (commandExists('apt-get')) {
    const cmd = `apt-get update && DEBIAN_FRONTEND=noninteractive apt-get install -y ${packages.join(' ')}`;
    return run('sh', ['-lc', cmd]).status === 0;
  }
  if (commandExists('apk')) {
    const mapped = packages.map((p) => (p === 'gh' ? 'github-cli' : p));
    const cmd = `apk add --no-cache ${mapped.join(' ')}`;
    return run('sh', ['-lc', cmd]).status === 0;
  }
  if (commandExists('dnf')) {
    const cmd = `dnf install -y ${packages.join(' ')}`;
    return run('sh', ['-lc', cmd]).status === 0;
  }
  if (commandExists('yum')) {
    const cmd = `yum install -y ${packages.join(' ')}`;
    return run('sh', ['-lc', cmd]).status === 0;
  }

  return false;
}

function ensureGitAndGhInstalled(): { ok: boolean; message?: string } {
  let gitInstalled = commandExists('git');
  if (!gitInstalled) {
    gitInstalled = installWithSystemPackageManager(['git']);
  }

  let ghInstalled = commandExists('gh');
  if (!ghInstalled) {
    ghInstalled = installWithSystemPackageManager(['gh']);
  }

  if (!gitInstalled) {
    return { ok: false, message: 'git is not installed on the API server' };
  }
  if (!ghInstalled) {
    return { ok: false, message: 'GitHub CLI (gh) is not installed on the API server' };
  }

  return { ok: true };
}

function ghAuthStatus(): { authenticated: boolean; username: string | null } {
  if (!commandExists('gh')) {
    return { authenticated: false, username: null };
  }

  const statusResult = run('gh', ['auth', 'status', '--hostname', 'github.com']);
  if (statusResult.status !== 0) {
    return { authenticated: false, username: null };
  }

  const userResult = run('gh', ['api', 'user', '--jq', '.login']);
  const username = userResult.status === 0 ? userResult.stdout.trim() : null;

  return { authenticated: true, username: username || null };
}

function ghAuthToken(): string | null {
  const tokenResult = run('gh', ['auth', 'token', '--hostname', 'github.com']);
  if (tokenResult.status !== 0) return null;
  const token = tokenResult.stdout.trim();
  return token || null;
}

function runGhApi(args: string[]): string {
  const result = run('gh', ['api', ...args]);
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || result.stdout.trim() || 'gh api command failed');
  }
  return result.stdout;
}

async function readBranchesViaGitRemote(owner: string, repo: string, token: string | null): Promise<string[]> {
  const baseUrl = `https://github.com/${owner}/${repo}.git`;
  const authUrl = token
    ? `https://x-access-token:${encodeURIComponent(token)}@github.com/${owner}/${repo}.git`
    : baseUrl;

  const result = run('git', ['ls-remote', '--heads', authUrl]);
  if (result.status !== 0) return [];

  const prefix = 'refs/heads/';
  return result.stdout
    .split('\n')
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      const ref = parts[1] ?? '';
      if (!ref.startsWith(prefix)) return null;
      const branch = ref.slice(prefix.length);
      return branch || null;
    })
    .filter((branch): branch is string => !!branch);
}

function parseLoginDetails(text: string) {
  const urlMatch = text.match(/https:\/\/github\.com\/login\/device[^\s]*/);
  if (urlMatch?.[0]) ghLoginUrl = urlMatch[0];

  const codeMatch = text.match(/[A-Z0-9]{4}-[A-Z0-9]{4}/);
  if (codeMatch?.[0]) ghLoginCode = codeMatch[0];
}

async function startGhLoginAndGetUrl(): Promise<{ redirectUrl: string; userCode: string | null }> {
  if (ghLoginProcess && ghLoginUrl) {
    return { redirectUrl: ghLoginUrl, userCode: ghLoginCode };
  }

  ghLoginUrl = null;
  ghLoginCode = null;

  const child = spawn(
    'gh',
    ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--skip-ssh-key'],
    {
      env: {
        ...process.env,
        NO_COLOR: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  ghLoginProcess = child;

  const handleData = (chunk: Buffer | string) => {
    parseLoginDetails(chunk.toString());
  };

  child.stdout.on('data', handleData);
  child.stderr.on('data', handleData);

  child.on('close', () => {
    ghLoginProcess = null;
  });

  const startedAt = Date.now();
  while (!ghLoginUrl && Date.now() - startedAt < 8_000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!ghLoginUrl) {
    throw new Error('Failed to start GitHub CLI login flow');
  }

  return { redirectUrl: ghLoginUrl, userCode: ghLoginCode };
}

export async function githubRoutes(fastify: FastifyInstance) {
  fastify.get(
    '/api/github/status',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const gitInstalled = commandExists('git');
      const ghInstalled = commandExists('gh');
      const auth = ghInstalled ? ghAuthStatus() : { authenticated: false, username: null };

      return reply.send({
        ok: true,
        data: {
          configured: auth.authenticated,
          username: auth.username,
          gitInstalled,
          ghInstalled,
        },
      });
    }
  );

  fastify.get(
    '/api/github/repos',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const auth = ghAuthStatus();
      if (!auth.authenticated) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'GITHUB_NOT_CONNECTED', message: 'Login to GitHub CLI first' },
        });
      }

      try {
        const output = runGhApi(['user/repos?per_page=100&sort=updated&direction=desc&type=all']);
        const repos = JSON.parse(output) as Array<{
          id: number;
          name: string;
          full_name: string;
          private: boolean;
          clone_url: string;
          default_branch: string;
          updated_at: string;
        }>;

        return reply.send({
          ok: true,
          data: repos.map((repo) => ({
            id: repo.id,
            name: repo.name,
            fullName: repo.full_name,
            private: repo.private,
            cloneUrl: repo.clone_url,
            defaultBranch: repo.default_branch,
            updatedAt: repo.updated_at,
          })),
        });
      } catch (err) {
        fastify.log.error(err, 'GitHub repositories fetch error');
        return reply.status(500).send({
          ok: false,
          error: { code: 'GITHUB_ERROR', message: 'Failed to fetch GitHub repositories' },
        });
      }
    }
  );

  fastify.get(
    '/api/github/profile',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const auth = ghAuthStatus();
      if (!auth.authenticated) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'GITHUB_NOT_CONNECTED', message: 'Login to GitHub CLI first' },
        });
      }

      try {
        const output = runGhApi(['user']);
        const profile = JSON.parse(output) as {
          login: string;
          name: string | null;
          avatar_url: string;
          html_url: string;
          bio: string | null;
          public_repos: number;
          total_private_repos?: number;
          followers: number;
          following: number;
        };

        const privateRepos = profile.total_private_repos ?? 0;
        const publicRepos = profile.public_repos ?? 0;

        return reply.send({
          ok: true,
          data: {
            login: profile.login,
            name: profile.name,
            avatarUrl: profile.avatar_url,
            htmlUrl: profile.html_url,
            bio: profile.bio,
            publicRepos,
            privateRepos,
            totalRepos: publicRepos + privateRepos,
            followers: profile.followers ?? 0,
            following: profile.following ?? 0,
          },
        });
      } catch (err) {
        fastify.log.error(err, 'GitHub profile fetch error');
        return reply.status(500).send({
          ok: false,
          error: { code: 'GITHUB_ERROR', message: 'Failed to fetch GitHub profile' },
        });
      }
    }
  );

  fastify.get<{ Querystring: { repoUrl?: string } }>(
    '/api/github/branches',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (req, reply) => {
      const repoUrl = req.query.repoUrl ?? '';
      const parsed = parseGitHubRepoFromUrl(repoUrl);

      if (!parsed) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'INVALID_REPO_URL', message: 'Provide a valid GitHub repository URL' },
        });
      }

      const auth = ghAuthStatus();
      if (!auth.authenticated) {
        return reply.status(400).send({
          ok: false,
          error: { code: 'GITHUB_NOT_CONNECTED', message: 'Login to GitHub CLI first' },
        });
      }

      const token = ghAuthToken();

      try {
        const repoOutput = runGhApi([`repos/${parsed.owner}/${parsed.repo}`]);
        const repoData = JSON.parse(repoOutput) as { default_branch?: string };

        const branchesOutput = runGhApi([
          '--paginate',
          `repos/${parsed.owner}/${parsed.repo}/branches?per_page=100`,
          '--jq',
          '.[].name',
        ]);

        const branches = branchesOutput
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0);

        const refsOutput = runGhApi([
          `repos/${parsed.owner}/${parsed.repo}/git/matching-refs/heads/`,
          '--jq',
          '.[].ref',
        ]);

        for (const line of refsOutput.split('\n')) {
          const ref = line.trim();
          const prefix = 'refs/heads/';
          if (!ref.startsWith(prefix)) continue;
          const branchName = ref.slice(prefix.length);
          if (branchName) branches.push(branchName);
        }

        const remoteBranches = await readBranchesViaGitRemote(parsed.owner, parsed.repo, token);
        const uniqueBranches = Array.from(new Set([...branches, ...remoteBranches]));

        if (repoData.default_branch && !uniqueBranches.includes(repoData.default_branch)) {
          uniqueBranches.unshift(repoData.default_branch);
        }

        if (uniqueBranches.length === 0) {
          return reply.status(502).send({
            ok: false,
            error: { code: 'GITHUB_ERROR', message: 'Failed to fetch repository branches' },
          });
        }

        return reply.send({
          ok: true,
          data: {
            owner: parsed.owner,
            repo: parsed.repo,
            defaultBranch: repoData.default_branch ?? null,
            branches: uniqueBranches,
          },
        });
      } catch (err) {
        fastify.log.error(err, 'GitHub branches fetch error');
        return reply.status(500).send({
          ok: false,
          error: { code: 'GITHUB_ERROR', message: 'Failed to fetch repository branches' },
        });
      }
    }
  );

  fastify.post(
    '/api/github/login/start',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const install = ensureGitAndGhInstalled();
      if (!install.ok) {
        return reply.status(500).send({
          ok: false,
          error: { code: 'GIT_OR_GH_MISSING', message: install.message ?? 'git/gh missing on API server' },
        });
      }

      const auth = ghAuthStatus();
      if (auth.authenticated) {
        return reply.send({
          ok: true,
          data: {
            alreadyAuthenticated: true,
            redirectUrl: null,
            userCode: null,
            username: auth.username,
          },
        });
      }

      try {
        const login = await startGhLoginAndGetUrl();
        let redirectUrl = login.redirectUrl;
        if (login.userCode) {
          try {
            const url = new URL(login.redirectUrl);
            if (!url.searchParams.has('user_code')) {
              url.searchParams.set('user_code', login.userCode);
            }
            redirectUrl = url.toString();
          } catch {}
        }
        return reply.send({
          ok: true,
          data: {
            alreadyAuthenticated: false,
            redirectUrl,
            userCode: login.userCode,
            username: null,
          },
        });
      } catch (err) {
        fastify.log.error(err, 'GitHub CLI login start error');
        return reply.status(500).send({
          ok: false,
          error: { code: 'GITHUB_LOGIN_START_FAILED', message: 'Failed to initiate GitHub CLI login' },
        });
      }
    }
  );

  fastify.post(
    '/api/github/disconnect',
    { preHandler: [fastify.requireAuth as typeof requireAuth] },
    async (_req, reply) => {
      const currentAuth = ghAuthStatus();
      if (currentAuth.authenticated && currentAuth.username) {
        run('gh', ['auth', 'logout', '--hostname', 'github.com', '--user', currentAuth.username, '--yes']);
      } else {
        run('gh', ['auth', 'logout', '--hostname', 'github.com', '--yes']);
      }

      const ghHostsFile = join(homedir(), '.config', 'gh', 'hosts.yml');
      if (existsSync(ghHostsFile)) {
        try {
          unlinkSync(ghHostsFile);
        } catch {}
      }

      const afterAuth = ghAuthStatus();
      return reply.send({ ok: true, data: { success: !afterAuth.authenticated } });
    }
  );
}
