// Minimal GitHub REST client for a single data repo.
export interface TreeEntry { path: string; sha: string }

export class GitHubError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export function b64decode(b64: string): string {
  const bin = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function encodePath(p: string) { return p.split('/').map(encodeURIComponent).join('/'); }

export class GitHub {
  constructor(public token: string, public owner: string, public repo: string, public branch = 'main') {}
  private get base() { return `https://api.github.com/repos/${this.owner}/${this.repo}`; }

  private async req(method: string, url: string, body?: unknown): Promise<any> {
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = { message: text }; }
    if (!res.ok) throw new GitHubError(res.status, json?.message ?? `${res.status} ${res.statusText}`);
    return json;
  }

  async headSha(): Promise<string> {
    const j = await this.req('GET', `${this.base}/branches/${encodeURIComponent(this.branch)}`);
    return j.commit.sha;
  }
  async tree(commitSha: string): Promise<TreeEntry[]> {
    const j = await this.req('GET', `${this.base}/git/trees/${commitSha}?recursive=1`);
    return (j.tree as any[]).filter(e => e.type === 'blob').map(e => ({ path: e.path, sha: e.sha }));
  }
  async blob(sha: string): Promise<string> {
    const j = await this.req('GET', `${this.base}/git/blobs/${sha}`);
    return b64decode(j.content);
  }
  async fileSha(path: string): Promise<string | null> {
    try {
      const j = await this.req('GET', `${this.base}/contents/${encodePath(path)}?ref=${encodeURIComponent(this.branch)}`);
      return j.sha ?? null;
    } catch (e) {
      if (e instanceof GitHubError && e.status === 404) return null;
      throw e;
    }
  }
  async put(path: string, content: string, sha: string | null, message: string): Promise<string> {
    const body: any = { message, content: b64encode(content), branch: this.branch };
    if (sha) body.sha = sha;
    const j = await this.req('PUT', `${this.base}/contents/${encodePath(path)}`, body);
    return j.content.sha as string;
  }
  async delete(path: string, sha: string, message: string): Promise<void> {
    await this.req('DELETE', `${this.base}/contents/${encodePath(path)}`, { message, sha, branch: this.branch });
  }
  async whoami(): Promise<string> {
    const j = await this.req('GET', 'https://api.github.com/user');
    return j.login;
  }
  async dispatchWorkflow(file: string, inputs: Record<string, string> = {}): Promise<void> {
    await this.req('POST', `${this.base}/actions/workflows/${encodeURIComponent(file)}/dispatches`, { ref: this.branch, inputs });
  }
}
