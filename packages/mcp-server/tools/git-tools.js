/**
 * Git tools – operate only inside workspace repos.
 *
 * Tools:
 *   git.status(repoPath)                        LOW
 *   git.diff(repoPath, args?)                   LOW
 *   git.log(repoPath, limit?)                   LOW
 *   git.branch(repoPath)                        LOW   (list)
 *   git.branch(repoPath, action='create', name) MEDIUM
 *   git.commit(repoPath, message)               MEDIUM
 */

const { execFile } = require('child_process');
const path = require('path');
const { resolveSafe } = require('./filesystem');

const GIT_TIMEOUT_MS = 15_000;

/**
 * Run a git sub-command inside a validated workspace path.
 * @param {string} repoPath  – path inside workspace
 * @param {string[]} args    – git arguments (excluding 'git')
 * @returns {Promise<string>}
 */
function runGit(repoPath, args) {
  const cwd = resolveSafe(repoPath);

  return new Promise((resolve, reject) => {
    const child = execFile('git', args, { cwd, timeout: GIT_TIMEOUT_MS, encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`git ${args.join(' ')} failed: ${stderr || err.message}`));
      } else {
        resolve(stdout);
      }
    });
    child.on('error', reject);
  });
}

/**
 * git status
 * @param {{ repoPath?: string }} args
 */
async function gitStatus({ repoPath = '.' } = {}) {
  const output = await runGit(repoPath, ['status', '--short', '--branch']);
  return { repoPath, output: output.trim() };
}

/**
 * git diff
 * @param {{ repoPath?: string, staged?: boolean, file?: string }} args
 */
async function gitDiff({ repoPath = '.', staged = false, file } = {}) {
  const extraArgs = [];
  if (staged) extraArgs.push('--staged');
  if (file) extraArgs.push('--', file);
  const output = await runGit(repoPath, ['diff', ...extraArgs]);
  return { repoPath, output: output.trim() || '(no changes)' };
}

/**
 * git log
 * @param {{ repoPath?: string, limit?: number }} args
 */
async function gitLog({ repoPath = '.', limit = 10 } = {}) {
  const n = Math.min(Number(limit) || 10, 50);
  const output = await runGit(repoPath, ['log', `--oneline`, `-${n}`]);
  return { repoPath, output: output.trim() };
}

/**
 * git branch – list or create
 * @param {{ repoPath?: string, action?: 'list'|'create', name?: string }} args
 */
async function gitBranch({ repoPath = '.', action = 'list', name } = {}) {
  if (action === 'create') {
    if (!name) throw new Error('git.branch create requires a branch name.');
    const output = await runGit(repoPath, ['checkout', '-b', name]);
    return { repoPath, action, name, output: output.trim() };
  }
  // Default: list
  const output = await runGit(repoPath, ['branch', '--list']);
  return { repoPath, action: 'list', output: output.trim() };
}

/**
 * git commit (stages all tracked changes and commits with message)
 * @param {{ repoPath?: string, message: string, addAll?: boolean }} args
 */
async function gitCommit({ repoPath = '.', message, addAll = false } = {}) {
  if (!message) throw new Error('git.commit requires a message.');
  if (addAll) {
    await runGit(repoPath, ['add', '-A']);
  }
  const output = await runGit(repoPath, ['commit', '-m', message]);
  return { repoPath, message, output: output.trim() };
}

module.exports = { gitStatus, gitDiff, gitLog, gitBranch, gitCommit };
