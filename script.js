/* ============================================================
   GIT VISUALIZER — script.js  (v2)
   Improvements over v1:
     1. Graph: newest commits at TOP, proper upward growth
     2. Edges: bezier curves, branch lane guides
     3. Click-on-node commit detail panel
     4. git rebase + git cherry-pick commands
     5. Sandbox scenarios panel (preloaded workflows)
     6. Terminal: visual separator between command groups
   ============================================================ */

'use strict';

/* ============================================================
   SECTION 1 — GIT STATE ENGINE
   ============================================================ */

const GitState = (() => {

  let _initialized = false;
  let _commits     = {};
  let _branches    = {};
  let _HEAD        = null;
  let _detached    = false;
  let _stash       = [];
  let _tags        = {};

  function _sha() { return Math.random().toString(16).slice(2, 9); }

  function _currentSha() {
    return _detached ? _HEAD : (_branches[_HEAD] || null);
  }

  function _branchColor(name) {
    const palette = ['--branch-0','--branch-1','--branch-2','--branch-3','--branch-4','--branch-5'];
    if (name === 'main' || name === 'master') return palette[0];
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
    return palette[Math.abs(hash) % (palette.length - 1) + 1];
  }

  function isInitialized() { return _initialized; }

  function init() {
    _initialized = true;
    _commits = {}; _branches = { main: null };
    _HEAD = 'main'; _detached = false; _stash = []; _tags = {};
  }

  function commit(message) {
    if (!_initialized) throw new Error('not a git repository');
    const sha = _sha(), parent = _currentSha();
    _commits[sha] = { sha, message, parents: parent ? [parent] : [], timestamp: Date.now(), branch: _detached ? null : _HEAD };
    if (_detached) _HEAD = sha; else _branches[_HEAD] = sha;
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
    if (_branches[target] !== undefined) { _HEAD = target; _detached = false; return { type: 'branch', name: target }; }
    if (_commits[target]) { _HEAD = target; _detached = true; return { type: 'detached', sha: target }; }
    throw new Error(`pathspec '${target}' did not match any known branch or commit`);
  }

  function checkoutNewBranch(name) {
    if (!_initialized) throw new Error('not a git repository');
    if (_branches[name] !== undefined) throw new Error(`branch '${name}' already exists`);
    _branches[name] = _currentSha(); _HEAD = name; _detached = false;
    return name;
  }

  function merge(sourceBranch) {
    if (!_initialized) throw new Error('not a git repository');
    if (_detached) throw new Error('cannot merge in detached HEAD state');
    if (sourceBranch === _HEAD) throw new Error('cannot merge a branch into itself');
    if (_branches[sourceBranch] === undefined) throw new Error(`branch '${sourceBranch}' not found`);
    const sourceSha = _branches[sourceBranch], currentSha = _currentSha();
    if (!sourceSha) throw new Error(`branch '${sourceBranch}' has no commits`);
    if (!currentSha) throw new Error('current branch has no commits');
    if (sourceSha === currentSha || _isAncestor(sourceSha, currentSha)) return { type: 'already-up-to-date' };
    if (_isAncestor(currentSha, sourceSha)) { _branches[_HEAD] = sourceSha; return { type: 'fast-forward', sha: sourceSha }; }
    const sha = _sha();
    _commits[sha] = { sha, message: `Merge branch '${sourceBranch}' into ${_HEAD}`, parents: [currentSha, sourceSha], timestamp: Date.now(), branch: _HEAD, isMerge: true };
    _branches[_HEAD] = sha;
    return { type: 'merge', sha };
  }

  function rebase(targetBranch) {
    if (!_initialized) throw new Error('not a git repository');
    if (_detached) throw new Error('cannot rebase in detached HEAD state');
    if (targetBranch === _HEAD) throw new Error('cannot rebase a branch onto itself');
    if (_branches[targetBranch] === undefined) throw new Error(`branch '${targetBranch}' not found`);
    const targetSha = _branches[targetBranch], currentSha = _currentSha();
    if (!targetSha) throw new Error(`branch '${targetBranch}' has no commits`);
    if (!currentSha) throw new Error('current branch has no commits to rebase');
    const targetAncestors = _getAllAncestors(targetSha);
    const toReplay = _getCommitsSince(currentSha, targetAncestors);
    if (toReplay.length === 0) return { type: 'already-up-to-date' };
    let base = targetSha;
    toReplay.forEach(oldCommit => {
      const newSha = _sha();
      _commits[newSha] = { sha: newSha, message: oldCommit.message, parents: [base], timestamp: Date.now(), branch: _HEAD, rebased: true, originalSha: oldCommit.sha };
      base = newSha;
    });
    _branches[_HEAD] = base;
    return { type: 'rebase', count: toReplay.length, tip: base };
  }

  function cherryPick(sha) {
    if (!_initialized) throw new Error('not a git repository');
    let match = _commits[sha] ? sha : Object.keys(_commits).find(s => s.startsWith(sha));
    if (!match) throw new Error(`bad revision '${sha}'`);
    const source = _commits[match], currentSha = _currentSha();
    if (!currentSha) throw new Error('cannot cherry-pick: no commits on current branch');
    const newSha = _sha();
    _commits[newSha] = { sha: newSha, message: source.message, parents: [currentSha], timestamp: Date.now(), branch: _detached ? null : _HEAD, cherryPicked: true, originalSha: match };
    if (_detached) _HEAD = newSha; else _branches[_HEAD] = newSha;
    return { sha: newSha, original: match, message: source.message };
  }

  function resetHard(target) {
    if (!_initialized) throw new Error('not a git repository');
    if (_detached) throw new Error('cannot reset in detached HEAD state');
    let sha = target;
    if (/^HEAD~(\d+)$/.test(target)) {
      const steps = parseInt(target.match(/^HEAD~(\d+)$/)[1], 10);
      sha = _walkBack(_currentSha(), steps);
      if (!sha) throw new Error(`HEAD~${steps} is not a valid commit`);
    } else if (target === 'HEAD') {
      sha = _currentSha();
    } else {
      const m = Object.keys(_commits).find(s => s.startsWith(sha));
      if (m) sha = m; else if (!_commits[sha]) throw new Error(`'${target}' is not a valid commit SHA`);
    }
    _branches[_HEAD] = sha; return sha;
  }

  function stash() {
    if (!_initialized) throw new Error('not a git repository');
    const c = _currentSha(); if (!c) throw new Error('nothing to stash');
    _stash.push(c); return _stash.length - 1;
  }

  function stashPop() {
    if (!_initialized) throw new Error('not a git repository');
    if (!_stash.length) throw new Error('no stash entries found');
    return _stash.pop();
  }

  function tag(name, target) {
    if (!_initialized) throw new Error('not a git repository');
    if (_tags[name]) throw new Error(`tag '${name}' already exists`);
    let sha = target || _currentSha(); if (!sha) throw new Error('no commits to tag');
    const m = Object.keys(_commits).find(s => s.startsWith(sha)); if (m) sha = m;
    if (!_commits[sha]) throw new Error(`'${target}' is not a valid SHA`);
    _tags[name] = sha; return sha;
  }

  function log(limit = 10) {
    if (!_initialized) throw new Error('not a git repository');
    const current = _currentSha(); if (!current) return [];
    const result = [], visited = new Set(), queue = [current];
    while (queue.length && result.length < limit) {
      const sha = queue.shift(); if (!sha || visited.has(sha)) continue;
      visited.add(sha); const c = _commits[sha]; if (!c) continue;
      result.push(c); c.parents.forEach(p => queue.push(p));
    }
    return result;
  }

  function status() {
    if (!_initialized) throw new Error('not a git repository');
    return { head: _HEAD, detached: _detached, branch: _detached ? null : _HEAD, sha: _currentSha(), branches: Object.keys(_branches), stashCount: _stash.length };
  }

  function getBranchList() {
    if (!_initialized) throw new Error('not a git repository');
    return Object.entries(_branches).map(([name, sha]) => ({ name, sha, current: !_detached && name === _HEAD, color: _branchColor(name) }));
  }

  function getCommit(sha) {
    if (_commits[sha]) return _commits[sha];
    const m = Object.keys(_commits).find(s => s.startsWith(sha)); return m ? _commits[m] : null;
  }

  function snapshot() {
    return { initialized: _initialized, commits: JSON.parse(JSON.stringify(_commits)), branches: JSON.parse(JSON.stringify(_branches)), tags: JSON.parse(JSON.stringify(_tags)), HEAD: _HEAD, detached: _detached, branchColor: _branchColor };
  }

  function _isAncestor(ancestor, descendant) {
    const visited = new Set(), queue = [descendant];
    while (queue.length) { const sha = queue.shift(); if (!sha || visited.has(sha)) continue; visited.add(sha); if (sha === ancestor) return true; const c = _commits[sha]; if (c) c.parents.forEach(p => queue.push(p)); }
    return false;
  }

  function _getAllAncestors(sha) {
    const set = new Set(), queue = [sha];
    while (queue.length) { const s = queue.shift(); if (!s || set.has(s)) continue; set.add(s); const c = _commits[s]; if (c) c.parents.forEach(p => queue.push(p)); }
    return set;
  }

  function _getCommitsSince(tipSha, excludeSet) {
    const result = [], visited = new Set(), queue = [tipSha];
    while (queue.length) {
      const sha = queue.shift(); if (!sha || visited.has(sha) || excludeSet.has(sha)) continue;
      visited.add(sha); const c = _commits[sha]; if (!c) continue;
      result.unshift(c); c.parents.forEach(p => { if (!excludeSet.has(p)) queue.push(p); });
    }
    return result;
  }

  function _walkBack(sha, steps) {
    let current = sha;
    for (let i = 0; i < steps; i++) { const c = _commits[current]; if (!c || !c.parents.length) return null; current = c.parents[0]; }
    return current;
  }

  return { isInitialized, init, commit, branch, checkout, checkoutNewBranch, merge, rebase, cherryPick, resetHard, stash, stashPop, tag, log, status, getBranchList, getCommit, snapshot };

})();


/* ============================================================
   SECTION 2 — COMMAND PARSER
   ============================================================ */

const CommandParser = (() => {

  const out = {
    line:    (text, cls = '') => ({ text, cls }),
    success: t => ({ text: t, cls: 'success' }),
    error:   t => ({ text: t, cls: 'error' }),
    info:    t => ({ text: t, cls: 'info' }),
    warn:    t => ({ text: t, cls: 'warning' }),
    muted:   t => ({ text: t, cls: 'muted' }),
    code:    t => ({ text: t, cls: 'code' }),
    spacer:  () => ({ spacer: true }),
  };

  const handlers = {

    help: () => [
      out.line('Supported commands:'),
      out.spacer(),
      out.code('  git init'),                     out.muted('    Initialize a new repository'),
      out.code('  git commit -m "<msg>"'),         out.muted('    Record changes'),
      out.code('  git branch <n>'),               out.muted('    Create a branch'),
      out.code('  git branch -a'),                out.muted('    List all branches'),
      out.code('  git checkout <branch|sha>'),    out.muted('    Switch branches or detach HEAD'),
      out.code('  git checkout -b <branch>'),     out.muted('    Create + switch to new branch'),
      out.code('  git merge <branch>'),           out.muted('    Merge a branch into HEAD'),
      out.code('  git rebase <branch>'),          out.muted('    Replay commits on another branch'),
      out.code('  git cherry-pick <sha>'),        out.muted('    Copy a commit onto current branch'),
      out.code('  git reset --hard <SHA|HEAD~N>'),out.muted('    Reset current branch'),
      out.code('  git stash / git stash pop'),    out.muted('    Save and restore working state'),
      out.code('  git tag <n> [sha]'),            out.muted('    Create a lightweight tag'),
      out.code('  git log'),                      out.muted('    Show commit history'),
      out.code('  git status'),                   out.muted('    Show HEAD info'),
      out.code('  clear'),                        out.muted('    Clear terminal output'),
    ],

    git: (args) => {
      const sub = args[0];
      if (!sub) return [out.error('git: command required. Try `help`.')];

      const subs = {

        init: () => {
          if (GitState.isInitialized()) return [out.warn('Reinitialized existing Git repository')];
          GitState.init();
          return [out.success('Initialized empty Git repository'), out.muted('Branch: main')];
        },

        commit: (rest) => {
          _req();
          const mIdx = rest.indexOf('-m');
          if (mIdx === -1) return [out.error('error: `-m` required — git commit -m "message"')];
          const message = rest.slice(mIdx + 1).join(' ').replace(/^["']|["']$/g, '').trim();
          if (!message) return [out.error('error: commit message cannot be empty')];
          const sha = GitState.commit(message), s = GitState.status();
          return [out.success(`[${s.branch || 'HEAD'} ${sha}] ${message}`)];
        },

        branch: (rest) => {
          _req();
          if (!rest.length || rest[0] === '-a' || rest[0] === '--all') {
            const bs = GitState.getBranchList();
            if (!bs.length) return [out.muted('  (no branches)')];
            return bs.map(b => out.line(`${b.current ? '* ' : '  '}${b.name}${b.sha ? ' ' + b.sha.slice(0,7) : ' (no commits)'}`, b.current ? 'success' : ''));
          }
          if (rest[0] === '-d' || rest[0] === '--delete') return [out.error('branch deletion not supported in this visualizer')];
          const name = rest[0];
          if (!_vref(name)) return [out.error(`error: '${name}' is not a valid branch name`)];
          try { GitState.branch(name); return [out.success(`Branch '${name}' created`)]; }
          catch (e) { return [out.error(`error: ${e.message}`)]; }
        },

        checkout: (rest) => {
          _req();
          if (rest[0] === '-b') {
            const name = rest[1];
            if (!name) return [out.error('error: branch name required after -b')];
            if (!_vref(name)) return [out.error(`error: '${name}' is not a valid branch name`)];
            try { GitState.checkoutNewBranch(name); return [out.success(`Switched to a new branch '${name}'`)]; }
            catch (e) { return [out.error(`error: ${e.message}`)]; }
          }
          const target = rest[0];
          if (!target) return [out.error('error: branch or commit required')];
          try {
            const r = GitState.checkout(target);
            if (r.type === 'branch') return [out.success(`Switched to branch '${r.name}'`)];
            return [out.warn(`HEAD is now at ${r.sha.slice(0,7)}`), out.warn('You are in detached HEAD state.')];
          } catch (e) { return [out.error(`error: ${e.message}`)]; }
        },

        merge: (rest) => {
          _req();
          const source = rest[0];
          if (!source) return [out.error('error: branch name required — git merge <branch>')];
          try {
            const r = GitState.merge(source);
            if (r.type === 'already-up-to-date') return [out.info('Already up to date.')];
            if (r.type === 'fast-forward') return [out.success('Fast-forward'), out.muted(`HEAD -> ${r.sha.slice(0,7)}`)];
            const s = GitState.status();
            return [out.success(`Merge made by the 'ort' strategy.`), out.muted(`[${s.branch} ${r.sha.slice(0,7)}] Merge branch '${source}'`)];
          } catch (e) { return [out.error(`error: ${e.message}`)]; }
        },

        rebase: (rest) => {
          _req();
          const target = rest[0];
          if (!target) return [out.error('error: branch name required — git rebase <branch>')];
          try {
            const r = GitState.rebase(target);
            if (r.type === 'already-up-to-date') return [out.info('Current branch is up to date.')];
            return [out.success(`Successfully rebased and updated refs/heads/${GitState.status().branch}`), out.muted(`${r.count} commit(s) replayed on top of ${target}`)];
          } catch (e) { return [out.error(`error: ${e.message}`)]; }
        },

        'cherry-pick': (rest) => {
          _req();
          const sha = rest[0];
          if (!sha) return [out.error('error: SHA required — git cherry-pick <sha>')];
          try {
            const r = GitState.cherryPick(sha);
            return [out.success(`[${GitState.status().branch || 'HEAD'} ${r.sha}] ${r.message}`), out.muted(`cherry picked from commit ${r.original}`)];
          } catch (e) { return [out.error(`error: ${e.message}`)]; }
        },

        reset: (rest) => {
          _req();
          if (rest[0] !== '--hard') return [out.error('error: only --hard is supported')];
          const target = rest[1];
          if (!target) return [out.error('error: commit reference required after --hard')];
          try { const sha = GitState.resetHard(target); return [out.warn(`HEAD is now at ${sha.slice(0,7)}`)]; }
          catch (e) { return [out.error(`error: ${e.message}`)]; }
        },

        stash: (rest) => {
          _req();
          const sub = rest[0];
          if (!sub || sub === 'push') {
            try { const idx = GitState.stash(); return [out.success(`Saved working directory state WIP@{${idx}}`)]; }
            catch (e) { return [out.error(`error: ${e.message}`)]; }
          }
          if (sub === 'pop') {
            try { const sha = GitState.stashPop(); return [out.success(`Restored stash: ${sha.slice(0,7)}`)]; }
            catch (e) { return [out.error(`error: ${e.message}`)]; }
          }
          return [out.error(`error: unknown stash subcommand '${sub}'`)];
        },

        tag: (rest) => {
          _req();
          const name = rest[0];
          if (!name) return [out.error('error: tag name required — git tag <n> [sha]')];
          if (!_vref(name)) return [out.error(`error: '${name}' is not a valid tag name`)];
          try { const sha = GitState.tag(name, rest[1] || null); return [out.success(`Tag '${name}' created at ${sha.slice(0,7)}`)]; }
          catch (e) { return [out.error(`error: ${e.message}`)]; }
        },

        log: (rest) => {
          _req();
          const limit = parseInt(rest[0]) || 10;
          try {
            const entries = GitState.log(limit);
            if (!entries.length) return [out.muted('No commits yet.')];
            return entries.flatMap(c => {
              const d = new Date(c.timestamp).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
              return [out.code(`commit ${c.sha}`), out.line(`    ${c.message}`), out.muted(`    ${d}`), out.spacer()];
            });
          } catch (e) { return [out.error(`error: ${e.message}`)]; }
        },

        status: () => {
          _req();
          try {
            const s = GitState.status(); const lines = [];
            if (s.detached) lines.push(out.warn(`HEAD detached at ${s.sha ? s.sha.slice(0,7) : 'unknown'}`));
            else lines.push(out.info(`On branch ${s.branch}`));
            if (!s.sha) lines.push(out.muted('No commits yet'));
            if (s.stashCount > 0) lines.push(out.muted(`Stash entries: ${s.stashCount}`));
            return lines;
          } catch (e) { return [out.error(`error: ${e.message}`)]; }
        },
      };

      const handler = subs[sub];
      if (!handler) return [out.error(`git: '${sub}' is not a git command. See 'help'.`)];
      return handler(args.slice(1));
    },

    clear: () => [{ special: 'clear' }],
  };

  function _req() { if (!GitState.isInitialized()) throw new Error('not a git repository: .git not found'); }
  function _vref(n) { return /^[a-zA-Z0-9_\-./]+$/.test(n) && !n.startsWith('.') && !n.endsWith('.'); }

  function parse(raw) {
    const trimmed = raw.trim(); if (!trimmed) return [];
    const tokens = _tokenize(trimmed), cmd = tokens[0], args = tokens.slice(1);
    const handler = handlers[cmd];
    if (!handler) return [{ text: `'${cmd}': command not found. Type 'help'`, cls: 'error' }];
    try { return handler(args); }
    catch (e) { return [{ text: `fatal: ${e.message}`, cls: 'error' }]; }
  }

  function _tokenize(str) {
    const tokens = []; let current = '', inQuote = false, qChar = '';
    for (const ch of str) {
      if ((ch === '"' || ch === "'") && !inQuote) { inQuote = true; qChar = ch; }
      else if (ch === qChar && inQuote) { inQuote = false; }
      else if (ch === ' ' && !inQuote) { if (current) { tokens.push(current); current = ''; } }
      else { current += ch; }
    }
    if (current) tokens.push(current);
    return tokens;
  }

  return { parse };

})();


/* ============================================================
   SECTION 3 — GRAPH RENDERER
   FIX 1: newest commits at TOP
   FIX 2: bezier edges + lane guides
   ============================================================ */

const GraphRenderer = (() => {

  const NODE_R     = 10;
  const COL_W      = 150;
  const ROW_H      = 82;
  const PAD_X      = 80;
  const PAD_TOP    = 72;
  const PAD_BOTTOM = 40;
  const LABEL_GAP  = 16;

  let _scale       = 1;
  let _onNodeClick = null;

  function setScale(s)     { _scale = Math.max(0.4, Math.min(2.5, s)); }
  function getScale()      { return _scale; }
  function onNodeClick(cb) { _onNodeClick = cb; }

  function render(snapshot, svgEl, emptyEl, legendEl) {
    const { initialized, commits, branches, tags, HEAD, detached, branchColor } = snapshot;
    const hasCommits = Object.keys(commits).length > 0;

    emptyEl.style.display = (initialized && hasCommits) ? 'none' : 'flex';
    legendEl.hidden = !hasCommits;

    if (!initialized || !hasCommits) {
      svgEl.innerHTML = ''; svgEl.style.width = svgEl.style.height = '100%'; return;
    }

    const layout = _buildLayout(commits, branches, HEAD, detached, branchColor);
    const maxRow = Math.max(...Object.values(layout.nodes).map(n => n.row), 0);
    const maxCol = Math.max(...Object.values(layout.nodes).map(n => n.col), 0);

    const svgW = (PAD_X * 2 + (maxCol + 1) * COL_W) * _scale;
    const svgH = (PAD_TOP + (maxRow + 1) * ROW_H + PAD_BOTTOM) * _scale;

    svgEl.setAttribute('width',  Math.max(svgW, 200));
    svgEl.setAttribute('height', Math.max(svgH, 200));
    svgEl.innerHTML = '';

    const g = _svgEl('g', { transform: `scale(${_scale})` });
    svgEl.appendChild(g);

    const rowToY = row => PAD_TOP + row * ROW_H;
    const colToX = col => PAD_X  + col * COL_W;

    // Position nodes
    Object.values(layout.nodes).forEach(n => { n.px = colToX(n.col); n.py = rowToY(n.row); });

    // Lane guides
    _drawLanes(g, layout.nodes, maxRow, rowToY);
    // Edges
    layout.edges.forEach(e => _drawEdge(g, e, layout.nodes));
    // Nodes
    Object.values(layout.nodes).forEach(n => _drawNode(g, n, commits[n.sha], branches, tags, HEAD, detached, branchColor));
  }

  function _drawLanes(g, nodes, maxRow, rowToY) {
    const byCol = {};
    Object.values(nodes).forEach(n => { (byCol[n.col] = byCol[n.col] || []).push(n); });
    Object.entries(byCol).forEach(([col, ns]) => {
      if (ns.length < 2) return;
      const x  = PAD_X + parseInt(col) * COL_W;
      const y1 = rowToY(Math.min(...ns.map(n => n.row)));
      const y2 = rowToY(Math.max(...ns.map(n => n.row)));
      g.appendChild(_svgEl('line', { x1: x, y1, x2: x, y2, stroke: ns[0].color, 'stroke-width': '1', opacity: '0.15', 'stroke-dasharray': '3 5' }));
    });
  }

  function _buildLayout(commits, branches, HEAD, detached, branchColor) {
    const sorted = _topoSort(commits);
    const depth  = {};
    sorted.forEach(sha => {
      const c = commits[sha];
      depth[sha] = c.parents.length === 0 ? 0 : Math.max(...c.parents.map(p => (depth[p] ?? 0) + 1));
    });
    const maxDepth = Math.max(...Object.values(depth), 0);
    const colMap   = _assignColumns(commits, branches, sorted);

    const nodes = {};
    sorted.forEach(sha => {
      nodes[sha] = {
        sha,
        col:     colMap[sha] ?? 0,
        row:     maxDepth - depth[sha],    // FIX 1: flipped — newest = row 0 = top
        color:   _resolveColor(sha, commits, branches, branchColor),
        isHead:  detached ? HEAD === sha : branches[HEAD] === sha,
        isMerge: commits[sha].parents.length > 1,
        px: 0, py: 0,
      };
    });

    const edges = [];
    sorted.forEach(sha => commits[sha].parents.forEach((p, i) => edges.push({ from: p, to: sha, isMerge: i > 0 })));
    return { nodes, edges };
  }

  function _topoSort(commits) {
    const inDeg = {}; Object.keys(commits).forEach(s => { inDeg[s] = 0; });
    Object.values(commits).forEach(c => c.parents.forEach(p => { if (inDeg[p] !== undefined) inDeg[p]++; }));
    const queue = Object.keys(commits).filter(s => inDeg[s] === 0), result = [];
    while (queue.length) {
      const sha = queue.shift(); result.push(sha);
      commits[sha].parents.forEach(p => { if (--inDeg[p] === 0) queue.push(p); });
    }
    return result.reverse();
  }

  function _assignColumns(commits, branches, sorted) {
    const colMap = {}; let next = 0;
    Object.entries(branches).filter(([,s]) => s)
      .sort(([a],[b]) => (a==='main'||a==='master') ? -1 : (b==='main'||b==='master') ? 1 : 0)
      .forEach(([,sha]) => { if (sha && colMap[sha] === undefined) colMap[sha] = next++; });
    sorted.forEach(sha => {
      if (colMap[sha] !== undefined) return;
      const c = commits[sha];
      colMap[sha] = (c.parents.length && colMap[c.parents[0]] !== undefined) ? colMap[c.parents[0]] : next++;
    });
    return colMap;
  }

  function _resolveColor(sha, commits, branches, branchColor) {
    for (const [n, s] of Object.entries(branches)) { if (s === sha) return `var(${branchColor(n)})`; }
    const c = commits[sha];
    if (c.isMerge)       return 'var(--merged)';
    if (c.rebased)       return 'var(--branch-2)';
    if (c.cherryPicked)  return 'var(--branch-3)';
    return 'var(--branch-0)';
  }

  function _svgEl(tag, attrs = {}, text = '') {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([k,v]) => el.setAttribute(k, v));
    if (text) el.textContent = text;
    return el;
  }

  function _drawEdge(g, edge, nodes) {
    const from = nodes[edge.from], to = nodes[edge.to];
    if (!from || !to) return;
    const x1 = from.px, y1 = from.py, x2 = to.px, y2 = to.py;
    // FIX 2: S-curve bezier for cross-lane edges
    const d = Math.abs(x1 - x2) < 2
      ? `M ${x1} ${y1} L ${x2} ${y2}`
      : `M ${x1} ${y1} C ${x1} ${y1 + (y2-y1)*0.45}, ${x2} ${y1 + (y2-y1)*0.55}, ${x2} ${y2}`;
    g.appendChild(_svgEl('path', {
      d, fill: 'none',
      stroke:             edge.isMerge ? 'var(--merged)' : 'rgba(139,148,158,0.45)',
      'stroke-width':     '2',
      'stroke-dasharray': edge.isMerge ? '5 3' : 'none',
      'stroke-linecap':   'round',
    }));
  }

  function _drawNode(g, node, commit, branches, tags, HEAD, detached, branchColor) {
    const { px: x, py: y, sha, color, isHead, isMerge } = node;

    // Shadow
    g.appendChild(_svgEl('circle', { cx: x+1, cy: y+1, r: NODE_R+1, fill: 'rgba(0,0,0,0.5)' }));

    // Circle
    const circle = _svgEl('circle', {
      cx: x, cy: y, r: NODE_R,
      fill: color,
      stroke: isHead ? '#ffffff' : 'rgba(0,0,0,0.4)',
      'stroke-width': isHead ? '2.5' : '1.5',
      style: 'cursor:pointer; transition: r 0.1s;',
    });
    circle.dataset.sha = sha;
    circle.addEventListener('click', e => { e.stopPropagation(); if (_onNodeClick) _onNodeClick(sha, commit, branches, tags); });
    circle.addEventListener('mouseenter', () => circle.setAttribute('r', NODE_R + 2));
    circle.addEventListener('mouseleave', () => circle.setAttribute('r', NODE_R));
    g.appendChild(circle);

    // Merge ring
    if (isMerge) g.appendChild(_svgEl('circle', { cx: x, cy: y, r: NODE_R-4, fill: 'none', stroke: 'rgba(255,255,255,0.3)', 'stroke-width': '1.2' }));

    // Cherry-pick / rebase dot
    if (commit.cherryPicked || commit.rebased) {
      g.appendChild(_svgEl('circle', { cx: x+NODE_R-2, cy: y-NODE_R+2, r: 4, fill: commit.cherryPicked ? 'var(--branch-3)' : 'var(--branch-2)', stroke: 'var(--bg-base)', 'stroke-width': '1.5' }));
    }

    // Labels above
    let labelY = y - NODE_R - LABEL_GAP;
    const branchesHere = Object.entries(branches).filter(([,s]) => s === sha).map(([n]) => n);
    const tagsHere     = Object.entries(tags).filter(([,s]) => s === sha).map(([n]) => n);

    if (detached && HEAD === sha) { _badge(g, x, labelY, 'HEAD', '#fff', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.3)'); labelY -= 20; }

    branchesHere.forEach(name => {
      const isCurrent = !detached && name === HEAD;
      const bc = `var(${branchColor(name)})`;
      if (isCurrent) { _badge(g, x, labelY, 'HEAD →', '#fff', 'rgba(255,255,255,0.12)', 'rgba(255,255,255,0.25)'); labelY -= 20; }
      _badge(g, x, labelY, name, isCurrent ? '#0d1117' : bc, isCurrent ? bc : 'var(--bg-elevated)', bc);
      labelY -= 20;
    });

    tagsHere.forEach(name => { _badge(g, x, labelY, `🏷 ${name}`, 'var(--warning)', 'var(--bg-elevated)', 'var(--warning)'); labelY -= 20; });

    // SHA + message below
    g.appendChild(_svgEl('text', { x, y: y+NODE_R+14, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono,monospace', 'font-size': '9.5', fill: 'var(--text-muted)' }, sha.slice(0,7)));
    const msg = commit.message.length > 22 ? commit.message.slice(0,21)+'…' : commit.message;
    g.appendChild(_svgEl('text', { x, y: y+NODE_R+27, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono,monospace', 'font-size': '9.5', fill: 'var(--text-secondary)' }, msg));
  }

  function _badge(g, cx, cy, text, fg, bg, border) {
    const w = text.length * 6.2 + 12, h = 15;
    g.appendChild(_svgEl('rect', { x: cx-w/2, y: cy-h/2, width: w, height: h, rx: 3, ry: 3, fill: bg, stroke: border, 'stroke-width': '1' }));
    g.appendChild(_svgEl('text', { x: cx, y: cy+4.5, 'text-anchor': 'middle', 'font-family': 'JetBrains Mono,monospace', 'font-size': '9', 'font-weight': '600', fill: fg }, text));
  }

  return { render, setScale, getScale, onNodeClick };

})();


/* ============================================================
   SECTION 4 — TERMINAL UI
   ============================================================ */

const Terminal = (() => {

  const MAX_HISTORY = 100;
  let _out = null, _in = null, _history = [], _hi = -1, _cb = null;

  function init(outputEl, inputEl, onCommand) {
    _out = outputEl; _in = inputEl; _cb = onCommand;
    _in.addEventListener('keydown', _key);
    _out.addEventListener('click', () => _in.focus());
    _in.focus();
  }

  function _key(e) {
    if (e.key === 'Enter') {
      const raw = _in.value; _in.value = ''; _hi = -1;
      if (raw.trim()) { _history.unshift(raw); if (_history.length > MAX_HISTORY) _history.pop(); _cb(raw); }
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (_hi < _history.length-1) { _hi++; _in.value = _history[_hi] || ''; setTimeout(() => _in.setSelectionRange(_in.value.length, _in.value.length), 0); }
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (_hi > 0) { _hi--; _in.value = _history[_hi] || ''; } else { _hi = -1; _in.value = ''; }
      return;
    }
    if (e.key === 'Tab')             { e.preventDefault(); _autocomplete(); return; }
    if (e.key === 'l' && e.ctrlKey)  { e.preventDefault(); clear(); return; }
  }

  function _autocomplete() {
    const val = _in.value;
    const completions = ['git init','git commit -m ""','git branch','git branch -a','git checkout','git checkout -b','git merge','git rebase','git cherry-pick','git reset --hard HEAD~1','git stash','git stash pop','git log','git status','git tag','help','clear'];
    const matches = completions.filter(c => c.startsWith(val));
    if (matches.length === 1) _in.value = matches[0];
    else if (matches.length > 1) printLines([{ text: matches.join('   '), cls: 'muted' }]);
  }

  function printCommand(raw) {
    // Visual separator between command groups
    const div = document.createElement('div');
    div.className = 'output-divider';
    _out.appendChild(div);

    const entry = document.createElement('div');
    entry.className = 'output-entry';
    const line = document.createElement('div');
    line.className = 'output-cmd';
    line.textContent = raw;
    entry.appendChild(line);
    _out.appendChild(entry);
    _scroll();
  }

  function printLines(lines) {
    if (!lines || !lines.length) return;
    const entry = document.createElement('div');
    entry.className = 'output-entry';
    lines.forEach(l => {
      if (l.spacer) { const sp = document.createElement('div'); sp.className = 'output-spacer'; entry.appendChild(sp); return; }
      const d = document.createElement('div');
      d.className = `output-line${l.cls ? ' '+l.cls : ''}`;
      d.textContent = l.text;
      entry.appendChild(d);
    });
    _out.appendChild(entry);
    _scroll();
  }

  function clear() {
    const w = _out.querySelector('.terminal-welcome');
    _out.innerHTML = '';
    if (w) _out.appendChild(w);
  }

  function _scroll() { _out.scrollTop = _out.scrollHeight; }
  function focus()   { _in.focus(); }

  return { init, printCommand, printLines, clear, focus };

})();


/* ============================================================
   SECTION 5 — DETAIL PANEL (click-on-node)
   ============================================================ */

const DetailPanel = (() => {

  let _el = null;

  function init() {
    _el = document.getElementById('detail-panel');
    document.getElementById('detail-close').addEventListener('click', hide);
    document.getElementById('graph-viewport').addEventListener('click', e => {
      if (e.target.tagName !== 'circle') hide();
    });
  }

  function show(sha, commit, branches, tags) {
    if (!_el) return;
    const branchesHere = Object.entries(branches).filter(([,s]) => s === sha).map(([n]) => n);
    const tagsHere     = Object.entries(tags).filter(([,s]) => s === sha).map(([n]) => n);
    const date = new Date(commit.timestamp).toLocaleString('en-US', { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });

    document.getElementById('detail-sha').textContent      = sha;
    document.getElementById('detail-message').textContent  = commit.message;
    document.getElementById('detail-date').textContent     = date;
    document.getElementById('detail-parents').textContent  = commit.parents.length ? commit.parents.map(p => p.slice(0,7)).join(', ') : '(root commit)';
    document.getElementById('detail-branches').textContent = branchesHere.length ? branchesHere.join(', ') : '—';
    document.getElementById('detail-tags').textContent     = tagsHere.length ? tagsHere.join(', ') : '—';

    const typeEl = document.getElementById('detail-type');
    if      (commit.isMerge)      { typeEl.textContent = 'merge commit';   typeEl.className = 'detail-type detail-type--merge'; }
    else if (commit.rebased)      { typeEl.textContent = 'rebased';        typeEl.className = 'detail-type detail-type--rebase'; }
    else if (commit.cherryPicked) { typeEl.textContent = 'cherry-picked';  typeEl.className = 'detail-type detail-type--cherry'; }
    else                          { typeEl.textContent = 'commit';         typeEl.className = 'detail-type'; }

    _el.classList.remove('hidden');
  }

  function hide() { if (_el) _el.classList.add('hidden'); }

  return { init, show, hide };

})();


/* ============================================================
   SECTION 6 — SCENARIOS
   ============================================================ */

const Scenarios = (() => {

  const LIST = [
    {
      label: 'Feature Branch Workflow',
      desc:  'Branch off main, commit, merge back',
      commands: [
        'git init',
        'git commit -m "initial commit"',
        'git commit -m "add readme"',
        'git checkout -b feature/login',
        'git commit -m "add login form"',
        'git commit -m "add auth logic"',
        'git checkout main',
        'git merge feature/login',
      ],
    },
    {
      label: 'Rebase onto Main',
      desc:  'Branch diverges, rebase it on top of main',
      commands: [
        'git init',
        'git commit -m "initial commit"',
        'git checkout -b feature',
        'git commit -m "feature work A"',
        'git commit -m "feature work B"',
        'git checkout main',
        'git commit -m "hotfix on main"',
        'git checkout feature',
        'git rebase main',
      ],
    },
    {
      label: 'Cherry-Pick Demo',
      desc:  'Pick one commit from a bugfix branch',
      commands: [
        'git init',
        'git commit -m "initial commit"',
        'git checkout -b bugfix',
        'git commit -m "fix critical bug"',
        'git checkout main',
        'git commit -m "new feature"',
      ],
    },
    {
      label: 'Diverged Branches + Merge',
      desc:  'Two branches diverge from a common ancestor',
      commands: [
        'git init',
        'git commit -m "initial commit"',
        'git commit -m "shared work"',
        'git checkout -b feature-a',
        'git commit -m "feature A part 1"',
        'git commit -m "feature A done"',
        'git checkout main',
        'git commit -m "main hotfix"',
        'git merge feature-a',
      ],
    },
  ];

  let _onRun = null;

  function init(onRun) {
    _onRun = onRun;
    const listEl   = document.getElementById('scenarios-list');
    const toggleEl = document.getElementById('scenarios-toggle');
    const panelEl  = document.getElementById('scenarios-panel');
    if (!listEl) return;

    LIST.forEach(s => {
      const btn = document.createElement('button');
      btn.className = 'scenario-btn';
      btn.innerHTML = `<span class="scenario-label">${s.label}</span><span class="scenario-desc">${s.desc}</span>`;
      btn.addEventListener('click', () => _run(s));
      listEl.appendChild(btn);
    });

    toggleEl.addEventListener('click', () => panelEl.classList.toggle('open'));
  }

  function _run(scenario) {
    if (!_onRun) return;
    GitState.init();
    Terminal.clear();
    Terminal.printLines([{ text: `▶  ${scenario.label}`, cls: 'info' }, { text: scenario.desc, cls: 'muted' }, { spacer: true }]);
    let delay = 0;
    scenario.commands.forEach(cmd => { setTimeout(() => _onRun(cmd), delay); delay += 200; });
    setTimeout(() => document.getElementById('scenarios-panel').classList.remove('open'), delay + 100);
  }

  return { init };

})();


/* ============================================================
   SECTION 7 — APP
   ============================================================ */

const App = (() => {

  let _svgEl, _emptyEl, _legendEl, _statusEl, _viewportEl;

  function init() {
    _svgEl      = document.getElementById('graph-svg');
    _emptyEl    = document.getElementById('graph-empty');
    _legendEl   = document.getElementById('graph-legend');
    _statusEl   = document.getElementById('repo-status');
    _viewportEl = document.getElementById('graph-viewport');

    Terminal.init(document.getElementById('terminal-output'), document.getElementById('terminal-input'), _handleCommand);
    DetailPanel.init();
    Scenarios.init(cmd => _handleCommand(cmd));

    GraphRenderer.onNodeClick((sha, commit, branches, tags) => DetailPanel.show(sha, commit, branches, tags));

    document.getElementById('zoom-in-btn').addEventListener('click',  () => { GraphRenderer.setScale(GraphRenderer.getScale() + 0.15); _rerender(); });
    document.getElementById('zoom-out-btn').addEventListener('click', () => { GraphRenderer.setScale(GraphRenderer.getScale() - 0.15); _rerender(); });
    document.getElementById('fit-btn').addEventListener('click',      () => { GraphRenderer.setScale(1); _rerender(); _viewportEl.scrollTop = _viewportEl.scrollLeft = 0; });
    document.getElementById('clear-btn').addEventListener('click',    () => { Terminal.clear(); Terminal.focus(); });

    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      if (e.key === '=' || e.key === '+') { GraphRenderer.setScale(GraphRenderer.getScale() + 0.1); _rerender(); }
      if (e.key === '-')                  { GraphRenderer.setScale(GraphRenderer.getScale() - 0.1); _rerender(); }
      if (e.key === 'Escape')             { DetailPanel.hide(); }
    });

    _rerender();
  }

  function _handleCommand(raw) {
    Terminal.printCommand(raw);
    const lines = CommandParser.parse(raw);
    if (lines.some(l => l.special === 'clear')) Terminal.clear();
    else Terminal.printLines(lines);
    _rerender();
    Terminal.focus();
  }

  function _rerender() {
    const snap = GitState.snapshot();
    GraphRenderer.render(snap, _svgEl, _emptyEl, _legendEl);
    _updateStatus(snap);
    if (snap.initialized && Object.keys(snap.commits).length > 0) {
      setTimeout(() => { _viewportEl.scrollTop = 0; }, 60); // newest at top
    }
  }

  function _updateStatus(snap) {
    if (!snap.initialized) { _statusEl.textContent = 'no repository'; _statusEl.className = 'topbar-badge'; return; }
    _statusEl.textContent = snap.detached ? `detached @ ${snap.HEAD.slice(0,7)}` : snap.HEAD;
    _statusEl.className   = 'topbar-badge active';
  }

  return { init };

})();

document.addEventListener('DOMContentLoaded', () => App.init());