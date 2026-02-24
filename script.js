/* ============================================================
   GIT VISUALIZER — script.js
   Architecture:
     1. GitState      — internal git data model
     2. CommandParser — parses + validates input, mutates state
     3. GraphRenderer — pure SVG rendering from state snapshot
     4. Terminal      — UI layer: input, output, history
     5. App           — wires everything together
   ============================================================ */

'use strict';

/* ============================================================
   SECTION 1 — GIT STATE ENGINE
   Owns all repository data. Never touches the DOM.
   ============================================================ */

const GitState = (() => {

  /* ---- Internal state ---- */
  let _initialized = false;

  let _commits  = {};   // { sha: CommitObject }
  let _branches = {};   // { name: sha }
  let _HEAD     = null; // branch name OR sha (detached)
  let _detached = false;
  let _stash    = [];   // stack of stashed commit shas (simplified)
  let _tags     = {};   // { tagName: sha }

  /* ---- Helpers ---- */

  function _sha() {
    // Generate a short random hex SHA (7 chars like git)
    return Math.random().toString(16).slice(2, 9);
  }

  function _currentSha() {
    if (_detached) return _HEAD;
    return _branches[_HEAD] || null;
  }

  function _branchColor(name) {
    // Deterministically assign a color index to each branch name
    const palette = ['--branch-0','--branch-1','--branch-2','--branch-3','--branch-4','--branch-5'];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    if (name === 'main' || name === 'master') return palette[0];
    // Start from index 1 so main always gets index 0
    return palette[Math.abs(hash) % (palette.length - 1) + 1];
  }

  /* ---- Public API ---- */

  function isInitialized() { return _initialized; }

  function init() {
    _initialized = true;
    _commits  = {};
    _branches = { main: null };
    _HEAD     = 'main';
    _detached = false;
    _stash    = [];
    _tags     = {};
  }

  function commit(message) {
    if (!_initialized) throw new Error('not a git repository');
    const sha    = _sha();
    const parent = _currentSha();

    _commits[sha] = {
      sha,
      message,
      parents: parent ? [parent] : [],
      timestamp: Date.now(),
      branch: _detached ? null : _HEAD,
    };

    if (_detached) {
      _HEAD = sha;
    } else {
      _branches[_HEAD] = sha;
    }

    return sha;
  }

  function branch(name) {
    if (!_initialized) throw new Error('not a git repository');
    if (_branches[name] !== undefined) throw new Error(`branch '${name}' already exists`);
    const current = _currentSha();
    if (!current) throw new Error('cannot create branch: no commits yet');
    _branches[name] = current;
    return name;
  }

  function checkout(target) {
    if (!_initialized) throw new Error('not a git repository');

    // Checkout a branch
    if (_branches[target] !== undefined) {
      _HEAD     = target;
      _detached = false;
      return { type: 'branch', name: target };
    }

    // Checkout a SHA (detached HEAD)
    if (_commits[target]) {
      _HEAD     = target;
      _detached = true;
      return { type: 'detached', sha: target };
    }

    throw new Error(`pathspec '${target}' did not match any known branch or commit`);
  }

  function checkoutNewBranch(name) {
    if (!_initialized) throw new Error('not a git repository');
    if (_branches[name] !== undefined) throw new Error(`branch '${name}' already exists`);
    const current = _currentSha();
    _branches[name] = current; // may be null on first branch
    _HEAD     = name;
    _detached = false;
    return name;
  }

  function merge(sourceBranch) {
    if (!_initialized) throw new Error('not a git repository');
    if (_detached) throw new Error('cannot merge in detached HEAD state');
    if (sourceBranch === _HEAD) throw new Error('cannot merge a branch into itself');
    if (_branches[sourceBranch] === undefined) throw new Error(`branch '${sourceBranch}' not found`);

    const sourceSha  = _branches[sourceBranch];
    const currentSha = _currentSha();

    if (!sourceSha) throw new Error(`branch '${sourceBranch}' has no commits`);
    if (!currentSha) throw new Error('current branch has no commits — nothing to merge into');
    if (sourceSha === currentSha) return { type: 'already-up-to-date' };

    // Check fast-forward: source is ancestor of current
    if (_isAncestor(sourceSha, currentSha)) {
      return { type: 'already-up-to-date' };
    }

    // Check fast-forward: current is ancestor of source
    if (_isAncestor(currentSha, sourceSha)) {
      _branches[_HEAD] = sourceSha;
      return { type: 'fast-forward', sha: sourceSha };
    }

    // True merge commit
    const sha = _sha();
    _commits[sha] = {
      sha,
      message: `Merge branch '${sourceBranch}' into ${_HEAD}`,
      parents: [currentSha, sourceSha],
      timestamp: Date.now(),
      branch: _HEAD,
      isMerge: true,
    };
    _branches[_HEAD] = sha;
    return { type: 'merge', sha };
  }

  function resetHard(target) {
    if (!_initialized) throw new Error('not a git repository');
    if (_detached) throw new Error('cannot reset in detached HEAD state');

    let sha = target;

    // Support HEAD~N notation
    if (/^HEAD~(\d+)$/.test(target)) {
      const steps = parseInt(target.match(/^HEAD~(\d+)$/)[1], 10);
      sha = _walkBack(_currentSha(), steps);
      if (!sha) throw new Error(`HEAD~${steps} is not a valid commit`);
    } else if (target === 'HEAD') {
      sha = _currentSha();
    } else if (!_commits[sha]) {
      throw new Error(`'${target}' is not a valid commit SHA`);
    }

    _branches[_HEAD] = sha;
    return sha;
  }

  function stash() {
    if (!_initialized) throw new Error('not a git repository');
    const current = _currentSha();
    if (!current) throw new Error('nothing to stash');
    _stash.push(current);
    return _stash.length - 1;
  }

  function stashPop() {
    if (!_initialized) throw new Error('not a git repository');
    if (_stash.length === 0) throw new Error('no stash entries found');
    const sha = _stash.pop();
    return sha;
  }

  function tag(name, target) {
    if (!_initialized) throw new Error('not a git repository');
    if (_tags[name]) throw new Error(`tag '${name}' already exists`);
    let sha = target || _currentSha();
    if (!sha) throw new Error('no commits to tag');
    if (!_commits[sha]) throw new Error(`'${target}' is not a valid SHA`);
    _tags[name] = sha;
    return sha;
  }

  function log(limit = 10) {
    if (!_initialized) throw new Error('not a git repository');
    const current = _currentSha();
    if (!current) return [];

    const result = [];
    const visited = new Set();
    const queue = [current];

    while (queue.length && result.length < limit) {
      const sha = queue.shift();
      if (!sha || visited.has(sha)) continue;
      visited.add(sha);
      const c = _commits[sha];
      if (!c) continue;
      result.push(c);
      c.parents.forEach(p => queue.push(p));
    }

    return result;
  }

  function status() {
    if (!_initialized) throw new Error('not a git repository');
    return {
      head: _HEAD,
      detached: _detached,
      branch: _detached ? null : _HEAD,
      sha: _currentSha(),
      branches: Object.keys(_branches),
      stashCount: _stash.length,
    };
  }

  function getBranchList() {
    if (!_initialized) throw new Error('not a git repository');
    return Object.entries(_branches).map(([name, sha]) => ({
      name,
      sha,
      current: !_detached && name === _HEAD,
      color: _branchColor(name),
    }));
  }

  function snapshot() {
    // Return a deep-cloned snapshot for the renderer to consume
    return {
      initialized: _initialized,
      commits:     JSON.parse(JSON.stringify(_commits)),
      branches:    JSON.parse(JSON.stringify(_branches)),
      tags:        JSON.parse(JSON.stringify(_tags)),
      HEAD:        _HEAD,
      detached:    _detached,
      branchColor: _branchColor,
    };
  }

  /* ---- Private graph traversal helpers ---- */

  function _isAncestor(ancestor, descendant) {
    // BFS from descendant upward to see if ancestor is reachable
    const visited = new Set();
    const queue = [descendant];
    while (queue.length) {
      const sha = queue.shift();
      if (!sha || visited.has(sha)) continue;
      visited.add(sha);
      if (sha === ancestor) return true;
      const c = _commits[sha];
      if (c) c.parents.forEach(p => queue.push(p));
    }
    return false;
  }

  function _walkBack(sha, steps) {
    let current = sha;
    for (let i = 0; i < steps; i++) {
      const c = _commits[current];
      if (!c || c.parents.length === 0) return null;
      current = c.parents[0]; // follow first parent
    }
    return current;
  }

  return {
    isInitialized,
    init,
    commit,
    branch,
    checkout,
    checkoutNewBranch,
    merge,
    resetHard,
    stash,
    stashPop,
    tag,
    log,
    status,
    getBranchList,
    snapshot,
  };

})();


/* ============================================================
   SECTION 2 — COMMAND PARSER
   Parses raw command strings, validates arguments,
   calls GitState methods, returns structured output lines.
   ============================================================ */

const CommandParser = (() => {

  // Output line builders
  const out = {
    line:    (text, cls = '')       => ({ text, cls }),
    success: (text)                 => ({ text, cls: 'success' }),
    error:   (text)                 => ({ text, cls: 'error' }),
    info:    (text)                 => ({ text, cls: 'info' }),
    warn:    (text)                 => ({ text, cls: 'warning' }),
    muted:   (text)                 => ({ text, cls: 'muted' }),
    code:    (text)                 => ({ text, cls: 'code' }),
    spacer:  ()                     => ({ spacer: true }),
  };

  /* ---- Command handlers ---- */

  const handlers = {

    'help': (_args) => [
      out.line('Supported commands:'),
      out.spacer(),
      out.code('  git init'),
      out.muted('    Initialize a new repository'),
      out.code('  git commit -m "<message>"'),
      out.muted('    Record changes to the repository'),
      out.code('  git branch <name>'),
      out.muted('    Create a new branch'),
      out.code('  git checkout <branch>'),
      out.muted('    Switch branches'),
      out.code('  git checkout -b <branch>'),
      out.muted('    Create and switch to a new branch'),
      out.code('  git merge <branch>'),
      out.muted('    Merge a branch into HEAD'),
      out.code('  git reset --hard <SHA|HEAD~N>'),
      out.muted('    Reset current branch to a commit'),
      out.code('  git stash'),
      out.muted('    Stash current position (simplified)'),
      out.code('  git stash pop'),
      out.muted('    Restore most recent stash'),
      out.code('  git tag <name> [sha]'),
      out.muted('    Create a tag at current or given commit'),
      out.code('  git log'),
      out.muted('    Show commit history'),
      out.code('  git status'),
      out.muted('    Show current branch and HEAD'),
      out.code('  git branch -a'),
      out.muted('    List all branches'),
      out.code('  clear'),
      out.muted('    Clear terminal output'),
    ],

    'git': (args) => {
      const sub = args[0];
      if (!sub) return [out.error('git: command required. Try `help`.')];

      const subHandlers = {

        init: (rest) => {
          if (GitState.isInitialized()) return [out.warn('Reinitialized existing Git repository')];
          GitState.init();
          return [
            out.success('Initialized empty Git repository'),
            out.muted('Branch: main'),
          ];
        },

        commit: (rest) => {
          _requireRepo();
          // Parse -m "message"
          const mIdx = rest.indexOf('-m');
          if (mIdx === -1) return [out.error('error: option `-m` required — git commit -m "message"')];

          let message = rest.slice(mIdx + 1).join(' ').replace(/^["']|["']$/g, '').trim();
          if (!message) return [out.error('error: commit message cannot be empty')];

          const sha = GitState.commit(message);
          const status = GitState.status();
          return [
            out.success(`[${status.branch || 'HEAD'} ${sha}] ${message}`),
          ];
        },

        branch: (rest) => {
          _requireRepo();

          // List branches
          if (rest.length === 0 || rest[0] === '-a' || rest[0] === '--all') {
            const branches = GitState.getBranchList();
            if (branches.length === 0) return [out.muted('  (no branches)')];
            return branches.map(b => {
              const prefix = b.current ? '* ' : '  ';
              const sha    = b.sha ? ` ${b.sha.slice(0,7)}` : ' (no commits)';
              return out.line(`${prefix}${b.name}${sha}`, b.current ? 'success' : '');
            });
          }

          // Delete branch
          if (rest[0] === '-d' || rest[0] === '--delete') {
            return [out.error('error: branch deletion not supported in this visualizer')];
          }

          const name = rest[0];
          if (!_validRef(name)) return [out.error(`error: '${name}' is not a valid branch name`)];

          try {
            GitState.branch(name);
            return [out.success(`Branch '${name}' created`)];
          } catch (e) {
            return [out.error(`error: ${e.message}`)];
          }
        },

        checkout: (rest) => {
          _requireRepo();

          // checkout -b <name>
          if (rest[0] === '-b') {
            const name = rest[1];
            if (!name) return [out.error('error: branch name required after -b')];
            if (!_validRef(name)) return [out.error(`error: '${name}' is not a valid branch name`)];
            try {
              GitState.checkoutNewBranch(name);
              return [out.success(`Switched to a new branch '${name}'`)];
            } catch (e) {
              return [out.error(`error: ${e.message}`)];
            }
          }

          const target = rest[0];
          if (!target) return [out.error('error: branch or commit required')];

          try {
            const result = GitState.checkout(target);
            if (result.type === 'branch') {
              return [out.success(`Switched to branch '${result.name}'`)];
            } else {
              return [
                out.warn(`HEAD is now at ${result.sha.slice(0, 7)}`),
                out.warn('You are in detached HEAD state.'),
              ];
            }
          } catch (e) {
            return [out.error(`error: ${e.message}`)];
          }
        },

        merge: (rest) => {
          _requireRepo();
          const source = rest[0];
          if (!source) return [out.error('error: branch name required — git merge <branch>')];

          try {
            const result = GitState.merge(source);
            if (result.type === 'already-up-to-date') {
              return [out.info('Already up to date.')];
            } else if (result.type === 'fast-forward') {
              return [
                out.success(`Fast-forward`),
                out.muted(`HEAD -> ${result.sha.slice(0,7)}`),
              ];
            } else {
              const status = GitState.status();
              return [
                out.success(`Merge made by the 'ort' strategy.`),
                out.muted(`[${status.branch} ${result.sha.slice(0,7)}] Merge branch '${source}'`),
              ];
            }
          } catch (e) {
            return [out.error(`error: ${e.message}`)];
          }
        },

        reset: (rest) => {
          _requireRepo();
          if (rest[0] !== '--hard') return [out.error('error: only --hard is supported — git reset --hard <SHA|HEAD~N>')];
          const target = rest[1];
          if (!target) return [out.error('error: commit reference required after --hard')];

          try {
            const sha = GitState.resetHard(target);
            return [
              out.warn(`HEAD is now at ${sha.slice(0,7)}`),
            ];
          } catch (e) {
            return [out.error(`error: ${e.message}`)];
          }
        },

        stash: (rest) => {
          _requireRepo();
          const sub = rest[0];

          if (!sub || sub === 'push') {
            try {
              const idx = GitState.stash();
              return [out.success(`Saved working directory state WIP@{${idx}}`)];
            } catch (e) {
              return [out.error(`error: ${e.message}`)];
            }
          }

          if (sub === 'pop') {
            try {
              const sha = GitState.stashPop();
              return [
                out.success(`Restored stash: ${sha.slice(0,7)}`),
              ];
            } catch (e) {
              return [out.error(`error: ${e.message}`)];
            }
          }

          return [out.error(`error: unknown stash subcommand '${sub}'`)];
        },

        tag: (rest) => {
          _requireRepo();
          const name = rest[0];
          if (!name) return [out.error('error: tag name required — git tag <name> [sha]')];
          if (!_validRef(name)) return [out.error(`error: '${name}' is not a valid tag name`)];
          const targetSha = rest[1] || null;
          try {
            const sha = GitState.tag(name, targetSha);
            return [out.success(`Tag '${name}' created at ${sha.slice(0,7)}`)];
          } catch (e) {
            return [out.error(`error: ${e.message}`)];
          }
        },

        log: (rest) => {
          _requireRepo();
          const limit = parseInt(rest[0]) || 10;
          try {
            const entries = GitState.log(limit);
            if (entries.length === 0) return [out.muted('No commits yet.')];
            return entries.flatMap(c => {
              const d = new Date(c.timestamp);
              const dateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              return [
                out.code(`commit ${c.sha}`),
                out.line(`    ${c.message}`),
                out.muted(`    ${dateStr}`),
                out.spacer(),
              ];
            });
          } catch (e) {
            return [out.error(`error: ${e.message}`)];
          }
        },

        status: (_rest) => {
          _requireRepo();
          try {
            const s = GitState.status();
            const lines = [];
            if (s.detached) {
              lines.push(out.warn(`HEAD detached at ${s.sha ? s.sha.slice(0,7) : 'unknown'}`));
            } else {
              lines.push(out.info(`On branch ${s.branch}`));
            }
            if (!s.sha) {
              lines.push(out.muted('No commits yet'));
            }
            if (s.stashCount > 0) {
              lines.push(out.muted(`Stash entries: ${s.stashCount}`));
            }
            return lines;
          } catch (e) {
            return [out.error(`error: ${e.message}`)];
          }
        },

      };

      const handler = subHandlers[sub];
      if (!handler) return [out.error(`git: '${sub}' is not a git command. See 'help'.`)];
      return handler(args.slice(1));
    },

    'clear': (_args) => {
      // Handled specially by Terminal
      return [{ special: 'clear' }];
    },

  };

  /* ---- Helpers ---- */

  function _requireRepo() {
    if (!GitState.isInitialized()) throw new Error('not a git repository (or any of the parent directories): .git');
  }

  function _validRef(name) {
    return /^[a-zA-Z0-9_\-./]+$/.test(name) && !name.startsWith('.') && !name.endsWith('.');
  }

  /* ---- Public parse entry point ---- */

  function parse(raw) {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    // Tokenize respecting quoted strings
    const tokens = _tokenize(trimmed);
    const cmd    = tokens[0];
    const args   = tokens.slice(1);

    const handler = handlers[cmd];
    if (!handler) {
      return [out.error(`'${cmd}': command not found. Type 'help' for available commands.`)];
    }

    try {
      return handler(args);
    } catch (e) {
      return [out.error(`fatal: ${e.message}`)];
    }
  }

  function _tokenize(str) {
    // Split by spaces but keep quoted strings together
    const tokens = [];
    let current  = '';
    let inQuote  = false;
    let quoteChar = '';

    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if ((ch === '"' || ch === "'") && !inQuote) {
        inQuote   = true;
        quoteChar = ch;
      } else if (ch === quoteChar && inQuote) {
        inQuote = false;
      } else if (ch === ' ' && !inQuote) {
        if (current) { tokens.push(current); current = ''; }
      } else {
        current += ch;
      }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  return { parse };

})();


/* ============================================================
   SECTION 3 — GRAPH RENDERER
   Pure SVG rendering from a state snapshot.
   No state mutation. No DOM reads outside its own SVG element.
   ============================================================ */

const GraphRenderer = (() => {

  /* ---- Layout constants ---- */
  const NODE_R        = 9;
  const COL_W         = 120;   // horizontal spacing between branch columns
  const ROW_H         = 72;    // vertical spacing between commit rows
  const PAD_LEFT      = 60;
  const PAD_TOP       = 48;
  const PAD_BOTTOM    = 48;
  const LABEL_OFFSET  = 14;    // gap between node and branch label

  let _scale = 1;

  function setScale(s) { _scale = Math.max(0.4, Math.min(2, s)); }
  function getScale()  { return _scale; }

  /* ---- Main render entry ---- */

  function render(snapshot, svgEl, emptyEl, legendEl) {
    const { initialized, commits, branches, tags, HEAD, detached, branchColor } = snapshot;

    const hasCommits = Object.keys(commits).length > 0;

    // Show/hide empty state
    emptyEl.style.display  = (initialized && hasCommits) ? 'none' : 'flex';
    legendEl.hidden        = !hasCommits;

    if (!initialized || !hasCommits) {
      svgEl.innerHTML = '';
      svgEl.style.width  = '100%';
      svgEl.style.height = '100%';
      return;
    }

    /* ---- 1. Build layout ---- */
    const layout = _buildLayout(commits, branches, HEAD, detached, branchColor);

    /* ---- 2. Calculate SVG dimensions ---- */
    const maxCol = Math.max(...Object.values(layout.nodes).map(n => n.col), 0);
    const maxRow = Math.max(...Object.values(layout.nodes).map(n => n.row), 0);

    const svgW = (PAD_LEFT + (maxCol + 1) * COL_W + PAD_LEFT) * _scale;
    const svgH = (PAD_TOP  + (maxRow + 1) * ROW_H + PAD_BOTTOM) * _scale;

    svgEl.setAttribute('width',  Math.max(svgW, 100));
    svgEl.setAttribute('height', Math.max(svgH, 100));
    svgEl.innerHTML = '';

    // Wrap in a scale group
    const g = _svgEl('g', { transform: `scale(${_scale})` });
    svgEl.appendChild(g);

    /* ---- 3. Draw edges first (behind nodes) ---- */
    layout.edges.forEach(edge => _drawEdge(g, edge, layout.nodes));

    /* ---- 4. Draw nodes ---- */
    Object.values(layout.nodes).forEach(node => {
      _drawNode(g, node, commits[node.sha], branches, tags, HEAD, detached, branchColor);
    });
  }

  /* ---- Layout builder ---- */

  function _buildLayout(commits, branches, HEAD, detached, branchColor) {
    // Topological sort (Kahn's algorithm, newest first)
    const sorted = _topoSort(commits);

    // Assign rows (depth from root)
    const depth = {};
    sorted.forEach((sha, i) => {
      const c = commits[sha];
      if (c.parents.length === 0) {
        depth[sha] = 0;
      } else {
        depth[sha] = Math.max(...c.parents.map(p => (depth[p] ?? 0) + 1));
      }
    });

    // Assign columns by branch affinity
    const branchOrder = _assignColumns(commits, branches, sorted, depth);

    // Build node map
    const nodes = {};
    sorted.forEach(sha => {
      const col = branchOrder[sha] ?? 0;
      const row = depth[sha];
      nodes[sha] = {
        sha,
        col,
        row,
        x: PAD_LEFT + col * COL_W,
        y: PAD_TOP  + row * ROW_H,
        color: _resolveNodeColor(sha, commits, branches, branchColor),
        isHead: detached ? HEAD === sha : branches[HEAD] === sha,
        isMerge: !!(commits[sha].parents.length > 1),
      };
    });

    // Build edges
    const edges = [];
    sorted.forEach(sha => {
      const c = commits[sha];
      c.parents.forEach((pSha, idx) => {
        edges.push({
          from:    pSha,
          to:      sha,
          isMerge: idx > 0,
        });
      });
    });

    return { nodes, edges };
  }

  function _topoSort(commits) {
    // BFS topological sort (newest first visually = highest row)
    const inDegree = {};
    Object.keys(commits).forEach(sha => { inDegree[sha] = 0; });
    Object.values(commits).forEach(c => {
      c.parents.forEach(p => { if (inDegree[p] !== undefined) inDegree[p]++; });
    });

    const queue  = Object.keys(commits).filter(sha => inDegree[sha] === 0);
    const result = [];

    while (queue.length) {
      const sha = queue.shift();
      result.push(sha);
      const c = commits[sha];
      c.parents.forEach(p => {
        inDegree[p]--;
        if (inDegree[p] === 0) queue.push(p);
      });
    }

    return result.reverse(); // root first
  }

  function _assignColumns(commits, branches, sorted, depth) {
    // Give each "branch tip" its own column, assign ancestors greedily
    const colMap  = {};
    const usedCol = {};

    // Find branch tips and order them: main/master first, then by first-commit time
    const tips = Object.entries(branches)
      .filter(([, sha]) => sha)
      .sort(([a], [b]) => {
        if (a === 'main' || a === 'master') return -1;
        if (b === 'main' || b === 'master') return  1;
        return 0;
      });

    let nextCol = 0;
    tips.forEach(([, sha]) => {
      if (sha && colMap[sha] === undefined) {
        colMap[sha] = nextCol++;
      }
    });

    // Walk sorted commits, assign column by first parent's column
    sorted.forEach(sha => {
      if (colMap[sha] !== undefined) return;
      const c = commits[sha];
      if (c.parents.length > 0) {
        const firstParentCol = colMap[c.parents[0]];
        if (firstParentCol !== undefined) {
          colMap[sha] = firstParentCol;
          return;
        }
      }
      colMap[sha] = nextCol++;
    });

    return colMap;
  }

  function _resolveNodeColor(sha, commits, branches, branchColor) {
    // Find which branch this commit belongs to
    for (const [name, bSha] of Object.entries(branches)) {
      if (bSha === sha) return `var(${branchColor(name)})`;
    }
    const c = commits[sha];
    if (c && c.isMerge) return 'var(--merged)';
    return 'var(--branch-0)';
  }

  /* ---- SVG drawing helpers ---- */

  function _svgEl(tag, attrs = {}, text = '') {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    if (text) el.textContent = text;
    return el;
  }

  function _drawEdge(g, edge, nodes) {
    const from = nodes[edge.from];
    const to   = nodes[edge.to];
    if (!from || !to) return;

    const x1 = from.x, y1 = from.y;
    const x2 = to.x,   y2 = to.y;

    let d;
    if (x1 === x2) {
      // Straight vertical line
      d = `M ${x1} ${y1} L ${x2} ${y2}`;
    } else {
      // Curved bezier for branch divergence
      const midY = (y1 + y2) / 2;
      d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
    }

    const path = _svgEl('path', {
      d,
      class: `graph-edge${edge.isMerge ? ' graph-edge--merge' : ''}`,
      'stroke-width': '1.5',
    });
    g.appendChild(path);
  }

  function _drawNode(g, node, commit, branches, tags, HEAD, detached, branchColor) {
    const { x, y, sha, color, isHead, isMerge } = node;

    // Shadow for depth
    const shadow = _svgEl('circle', {
      cx: x + 1, cy: y + 1, r: NODE_R + 1,
      fill: 'rgba(0,0,0,0.35)',
    });
    g.appendChild(shadow);

    // Node circle
    const circle = _svgEl('circle', {
      cx: x, cy: y, r: NODE_R,
      fill: color,
      stroke: isHead ? 'var(--text-primary)' : 'rgba(0,0,0,0.3)',
      'stroke-width': isHead ? '2.5' : '1.5',
      class: `graph-node-circle${isHead ? ' graph-node-circle--head' : ''}`,
    });
    circle.dataset.sha = sha;
    g.appendChild(circle);

    // Merge indicator (inner ring)
    if (isMerge) {
      const inner = _svgEl('circle', {
        cx: x, cy: y, r: NODE_R - 4,
        fill: 'none',
        stroke: 'rgba(255,255,255,0.35)',
        'stroke-width': '1.2',
      });
      g.appendChild(inner);
    }

    /* ---- Branch labels above the node ---- */
    const branchesAtNode = Object.entries(branches)
      .filter(([, bSha]) => bSha === sha)
      .map(([name]) => name);

    const tagsAtNode = Object.entries(tags)
      .filter(([, tSha]) => tSha === sha)
      .map(([name]) => name);

    let labelY = y - NODE_R - LABEL_OFFSET;

    // HEAD label (if detached)
    if (detached && HEAD === sha) {
      _drawBadge(g, x, labelY, 'HEAD', 'var(--text-primary)', 'var(--bg-elevated)', 'var(--border)');
      labelY -= 18;
    }

    // Branch labels
    branchesAtNode.forEach(name => {
      const isCurrentBranch = !detached && name === HEAD;
      const bgColor = isCurrentBranch ? `var(${branchColor(name)})` : 'var(--bg-elevated)';
      const fgColor = isCurrentBranch ? '#fff' : `var(${branchColor(name)})`;
      const bdColor = `var(${branchColor(name)})`;

      // HEAD → pointer for current branch
      if (isCurrentBranch) {
        _drawBadge(g, x, labelY, 'HEAD', 'var(--text-primary)', 'var(--bg-elevated)', 'var(--border)');
        labelY -= 18;
      }

      _drawBadge(g, x, labelY, name, fgColor, bgColor, bdColor);
      labelY -= 18;
    });

    // Tag labels
    tagsAtNode.forEach(name => {
      _drawBadge(g, x, labelY, `🏷 ${name}`, 'var(--warning)', 'var(--bg-elevated)', 'var(--warning)');
      labelY -= 18;
    });

    /* ---- SHA label below ---- */
    const shaLabel = _svgEl('text', {
      x, y: y + NODE_R + 14,
      'text-anchor': 'middle',
      class: 'graph-label graph-label--sha',
    }, sha.slice(0, 7));
    g.appendChild(shaLabel);

    /* ---- Commit message (truncated) ---- */
    const msg = commit.message.length > 18 ? commit.message.slice(0, 17) + '…' : commit.message;
    const msgLabel = _svgEl('text', {
      x, y: y + NODE_R + 26,
      'text-anchor': 'middle',
      class: 'graph-label graph-label--msg',
    }, msg);
    g.appendChild(msgLabel);
  }

  function _drawBadge(g, cx, cy, text, fgColor, bgColor, borderColor) {
    const padding = 5;
    const h       = 14;
    // Estimate text width (monospace ~6.5px per char)
    const w = text.length * 6.5 + padding * 2;

    const rect = _svgEl('rect', {
      x: cx - w / 2, y: cy - h / 2,
      width: w, height: h,
      rx: 3, ry: 3,
      fill: bgColor,
      stroke: borderColor,
      'stroke-width': '1',
    });
    g.appendChild(rect);

    const label = _svgEl('text', {
      x: cx, y: cy + 4,
      'text-anchor': 'middle',
      class: 'graph-label graph-label--branch',
      fill: fgColor,
      'font-size': '9',
    }, text);
    g.appendChild(label);
  }

  return { render, setScale, getScale };

})();


/* ============================================================
   SECTION 4 — TERMINAL UI
   Handles all DOM interaction: input, output, history.
   ============================================================ */

const Terminal = (() => {

  const MAX_HISTORY = 100;

  let _outputEl   = null;
  let _inputEl    = null;
  let _history    = [];
  let _historyIdx = -1;
  let _onCommand  = null;  // callback(rawCommand)

  function init(outputEl, inputEl, onCommand) {
    _outputEl  = outputEl;
    _inputEl   = inputEl;
    _onCommand = onCommand;

    _inputEl.addEventListener('keydown', _handleKey);
    // Click anywhere in output area → focus input
    _outputEl.addEventListener('click', () => _inputEl.focus());

    _inputEl.focus();
  }

  function _handleKey(e) {
    if (e.key === 'Enter') {
      const raw = _inputEl.value;
      _inputEl.value = '';
      _historyIdx = -1;
      if (raw.trim()) {
        _history.unshift(raw);
        if (_history.length > MAX_HISTORY) _history.pop();
        _onCommand(raw);
      }
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (_historyIdx < _history.length - 1) {
        _historyIdx++;
        _inputEl.value = _history[_historyIdx] || '';
        // Move cursor to end
        setTimeout(() => _inputEl.setSelectionRange(_inputEl.value.length, _inputEl.value.length), 0);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (_historyIdx > 0) {
        _historyIdx--;
        _inputEl.value = _history[_historyIdx] || '';
      } else {
        _historyIdx    = -1;
        _inputEl.value = '';
      }
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      _autocomplete();
      return;
    }

    if (e.key === 'l' && e.ctrlKey) {
      e.preventDefault();
      clear();
      return;
    }
  }

  function _autocomplete() {
    const val = _inputEl.value;
    const completions = [
      'git init', 'git commit -m ""', 'git branch',
      'git checkout', 'git checkout -b', 'git merge',
      'git reset --hard', 'git stash', 'git stash pop',
      'git log', 'git status', 'git tag', 'git branch -a',
      'help', 'clear',
    ];
    const matches = completions.filter(c => c.startsWith(val));
    if (matches.length === 1) {
      _inputEl.value = matches[0];
    } else if (matches.length > 1) {
      printLines([{ text: matches.join('    '), cls: 'muted' }]);
    }
  }

  function printCommand(raw) {
    const entry = document.createElement('div');
    entry.className = 'output-entry';
    const line = document.createElement('div');
    line.className = 'output-cmd';
    line.textContent = raw;
    entry.appendChild(line);
    _outputEl.appendChild(entry);
    _scrollToBottom();
  }

  function printLines(lines) {
    if (!lines || lines.length === 0) return;

    const entry = document.createElement('div');
    entry.className = 'output-entry';

    lines.forEach(l => {
      if (l.spacer) {
        const sp = document.createElement('div');
        sp.className = 'output-spacer';
        entry.appendChild(sp);
        return;
      }
      const div = document.createElement('div');
      div.className = `output-line${l.cls ? ' ' + l.cls : ''}`;
      div.textContent = l.text;
      entry.appendChild(div);
    });

    _outputEl.appendChild(entry);
    _scrollToBottom();
  }

  function clear() {
    // Keep the welcome block (first child), remove everything after
    const welcome = _outputEl.querySelector('.terminal-welcome');
    _outputEl.innerHTML = '';
    if (welcome) _outputEl.appendChild(welcome);
  }

  function _scrollToBottom() {
    _outputEl.scrollTop = _outputEl.scrollHeight;
  }

  function focus() { _inputEl.focus(); }

  return { init, printCommand, printLines, clear, focus };

})();


/* ============================================================
   SECTION 5 — APP
   Wires state, parser, renderer, terminal together.
   ============================================================ */

const App = (() => {

  let _svgEl      = null;
  let _emptyEl    = null;
  let _legendEl   = null;
  let _statusEl   = null;
  let _viewportEl = null;

  function init() {
    _svgEl      = document.getElementById('graph-svg');
    _emptyEl    = document.getElementById('graph-empty');
    _legendEl   = document.getElementById('graph-legend');
    _statusEl   = document.getElementById('repo-status');
    _viewportEl = document.getElementById('graph-viewport');

    const outputEl = document.getElementById('terminal-output');
    const inputEl  = document.getElementById('terminal-input');

    Terminal.init(outputEl, inputEl, _handleCommand);

    // Graph controls
    document.getElementById('zoom-in-btn').addEventListener('click', () => {
      GraphRenderer.setScale(GraphRenderer.getScale() + 0.15);
      _rerender();
    });
    document.getElementById('zoom-out-btn').addEventListener('click', () => {
      GraphRenderer.setScale(GraphRenderer.getScale() - 0.15);
      _rerender();
    });
    document.getElementById('fit-btn').addEventListener('click', () => {
      GraphRenderer.setScale(1);
      _rerender();
      _viewportEl.scrollTop  = 0;
      _viewportEl.scrollLeft = 0;
    });
    document.getElementById('clear-btn').addEventListener('click', () => {
      Terminal.clear();
      Terminal.focus();
    });

    // Keyboard zoom
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === '=' || e.key === '+') { GraphRenderer.setScale(GraphRenderer.getScale() + 0.1); _rerender(); }
      if (e.key === '-')                  { GraphRenderer.setScale(GraphRenderer.getScale() - 0.1); _rerender(); }
    });

    // Initial render
    _rerender();
  }

  function _handleCommand(raw) {
    Terminal.printCommand(raw);

    const lines = CommandParser.parse(raw);

    // Handle special commands
    if (lines.some(l => l.special === 'clear')) {
      Terminal.clear();
    } else {
      Terminal.printLines(lines);
    }

    _rerender();
    Terminal.focus();
  }

  function _rerender() {
    const snapshot = GitState.snapshot();
    GraphRenderer.render(snapshot, _svgEl, _emptyEl, _legendEl);
    _updateStatus(snapshot);
    // Auto-scroll graph to show latest commit (bottom)
    if (snapshot.initialized && Object.keys(snapshot.commits).length > 0) {
      setTimeout(() => {
        _viewportEl.scrollTop = _viewportEl.scrollHeight;
      }, 50);
    }
  }

  function _updateStatus(snapshot) {
    if (!snapshot.initialized) {
      _statusEl.textContent = 'no repository';
      _statusEl.className   = 'topbar-badge';
      return;
    }
    const branch = snapshot.detached
      ? `HEAD detached @ ${snapshot.HEAD.slice(0,7)}`
      : snapshot.HEAD;
    _statusEl.textContent = branch;
    _statusEl.className   = 'topbar-badge active';
  }

  return { init };

})();


/* ============================================================
   ENTRY POINT
   ============================================================ */

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});