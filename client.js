window.__ModuleLoader__.load({
  id: 'dsh-branch-flow',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useMemo, useRef, useState } = React

    //#region rules (browser copy of lib/rules.js)
    const PREFIXES = ['feature', 'bugfix', 'hotfix', 'release']
    const ENV_BRANCHES = ['production6', 'stage']
    const COMMIT_TYPES = ['feat', 'fix', 'refactor', 'perf', 'docs', 'style', 'test', 'build', 'ci', 'chore', 'revert']
    const MAX_BRANCH_LENGTH = 50
    const MAX_SUBJECT_LENGTH = 72
    const PREFIX_TYPE = { feature: 'feat', bugfix: 'fix', hotfix: 'fix', release: 'chore' }
    const TYPE_SYNONYMS = {
      feature: 'feat', features: 'feat', feat: 'feat', '新增': 'feat', '新功能': 'feat', '功能': 'feat',
      bug: 'fix', bugfix: 'fix', fix: 'fix', hotfix: 'fix', '修复': 'fix', '缺陷': 'fix',
      refactor: 'refactor', '重构': 'refactor',
      perf: 'perf', performance: 'perf', '优化': 'perf', '性能': 'perf', '性能优化': 'perf',
      docs: 'docs', doc: 'docs', '文档': 'docs',
      style: 'style', '格式': 'style', '样式': 'style',
      test: 'test', tests: 'test', '测试': 'test',
      build: 'build', '构建': 'build', '依赖': 'build',
      ci: 'ci', '流水线': 'ci',
      chore: 'chore', '杂项': 'chore',
      revert: 'revert', '回滚': 'revert',
    }
    const MEANINGLESS = new Set(['tmp', 'temp', 'test', 'testing', 'new', 'old', 'aaa', 'aaaa', 'abc', 'abcd', 'foo', 'bar', 'baz', 'asdf', 'demo', 'xx', 'xxx', 'dev', 'work', 'change', 'changes', 'update', 'updates', 'fix', 'fixes', 'code', 'stuff'])
    const ENV_WORDS = /^(prod|production|staging|stage|uat|qa|test|testing|dev|release|sandbox)\d*$/

    const issue = (code, level, field) => ({ code, level, field })

    function normalizeBranchName(raw) {
      return String(raw ?? '')
        .trim()
        .replace(/[\s_]+/g, '-')
        .replace(/[（）()[\]{}【】]/g, '')
        .replace(/\/+/g, '/')
        .replace(/-+/g, '-')
        .replace(/^[-/]+/, '')
        .replace(/[-/]+$/, '')
        .toLowerCase()
    }

    function validateBranchName(raw, options) {
      const allowEnv = !options || options.allowEnvBranches !== false
      const original = String(raw ?? '').trim()
      const name = normalizeBranchName(original)
      const issues = []
      if (original !== name && original !== '') issues.push(issue('normalized', 'warn', 'name'))
      if (name === '') {
        issues.push(issue('empty', 'error', 'name'))
        return { ok: false, name: name, issues: issues, prefix: '', description: '', type: 'feat' }
      }
      if (allowEnv && ENV_BRANCHES.indexOf(name) !== -1) {
        return { ok: true, name: name, issues: issues, prefix: '', description: name, type: 'chore' }
      }
      if (name.length > MAX_BRANCH_LENGTH) issues.push(issue('too-long', 'error', 'name'))
      if (!/^[a-z0-9\-/]+$/.test(name)) issues.push(issue('charset', 'error', 'name'))
      const segments = name.split('/').filter(Boolean)
      const prefix = segments[0] || ''
      const description = segments.slice(1).join('/')
      if (segments.length < 2) issues.push(issue('missing-prefix', 'error', 'name'))
      else if (PREFIXES.indexOf(prefix) === -1) issues.push(issue('bad-prefix', 'error', 'name'))
      if (segments.length > 2) issues.push(issue('nested', 'error', 'name'))
      if (description !== '') {
        if (description.length < 3) issues.push(issue('too-short', 'error', 'name'))
        const words = description.split('-').filter(Boolean)
        for (let i = 0; i < words.length; i += 1) {
          const word = words[i]
          if (/^\d+$/.test(word)) issues.push(issue('numeric-word', 'error', 'name'))
          else if (MEANINGLESS.has(word)) issues.push(issue('meaningless', 'error', 'name'))
          else if (ENV_WORDS.test(word)) issues.push(issue('env-semantic', 'error', 'name'))
          else if (word.length < 2) issues.push(issue('short-word', 'error', 'name'))
        }
      }
      const bad = issues.some(function (item) { return item.level === 'error' })
      return {
        ok: !bad,
        name: name,
        issues: issues,
        prefix: PREFIXES.indexOf(prefix) !== -1 ? prefix : '',
        description: description,
        type: PREFIX_TYPE[prefix] || 'feat',
      }
    }

    function toAsciiPunctuation(text) {
      return String(text).replace(/：/g, ':').replace(/（/g, '(').replace(/）/g, ')').replace(/，/g, ',').replace(/；/g, ';').replace(/[　\u00a0]/g, ' ')
    }

    function sanitizeScope(scope) {
      return String(scope ?? '').trim().replace(/[^A-Za-z0-9_.-]/g, '')
    }

    function normalizeCommitMessage(raw, hints) {
      const hint = hints || {}
      const hintType = COMMIT_TYPES.indexOf(hint.type) !== -1 ? hint.type : undefined
      const hintScope = sanitizeScope(hint.scope) || 'app'
      const issues = []
      const text = toAsciiPunctuation(String(raw ?? '')).trim()
      if (text !== String(raw ?? '').trim()) issues.push(issue('punctuation', 'warn', 'message'))

      let type = hintType || 'feat'
      let scope = ''
      let subject = ''
      const matched = /^([A-Za-z\u4e00-\u9fa5]+)\s*(?:\(([^)]*)\))?\s*:\s*([\s\S]+)$/.exec(text)
      if (matched !== null) {
        const rawType = matched[1].toLowerCase()
        const mapped = TYPE_SYNONYMS[rawType] || (COMMIT_TYPES.indexOf(rawType) !== -1 ? rawType : undefined)
        if (mapped !== undefined) type = mapped
        else {
          type = hintType || 'chore'
          issues.push(issue('unknown-type', 'warn', 'type'))
        }
        if (matched[1] !== type) issues.push(issue('type-case', 'warn', 'type'))
        scope = sanitizeScope(matched[2])
        if (scope !== String(matched[2] ?? '').trim()) issues.push(issue('scope-charset', 'warn', 'scope'))
        subject = matched[3]
      } else {
        subject = text
        type = hintType || 'feat'
        issues.push(issue('missing-type', 'warn', 'type'))
      }
      if (scope === '') scope = hintScope
      subject = subject.replace(/\s+/g, ' ').replace(/[。.]+$/g, '').trim()
      if (subject === '') {
        issues.push(issue('empty-subject', 'error', 'subject'))
        subject = 'update'
      }
      if (subject.length > MAX_SUBJECT_LENGTH) issues.push(issue('long-subject', 'warn', 'subject'))
      return {
        ok: !issues.some(function (item) { return item.level === 'error' }),
        message: type + '(' + scope + '): ' + subject,
        type: type,
        scope: scope,
        subject: subject,
        issues: issues,
      }
    }

    function deriveScope(paths) {
      const skip = ['src', 'app', 'lib', 'packages', 'source', 'main', 'java', 'com', 'test', 'tests']
      const directories = []
      for (let i = 0; i < paths.length; i += 1) {
        const parts = String(paths[i]).split('/').filter(Boolean)
        if (parts.length === 0) continue
        const slice = parts.length > 1 ? parts.slice(0, parts.length - 1) : parts
        let preferred = null
        for (let j = 0; j < slice.length; j += 1) {
          if (skip.indexOf(slice[j].toLowerCase()) === -1) { preferred = slice[j]; break }
        }
        directories.push(preferred || slice[slice.length - 1] || 'app')
      }
      if (directories.length === 0) return 'app'
      const counts = {}
      for (let i = 0; i < directories.length; i += 1) counts[directories[i]] = (counts[directories[i]] || 0) + 1
      const ranked = Object.keys(counts).sort(function (a, b) {
        return counts[b] - counts[a] || a.localeCompare(b)
      })
      return sanitizeScope(ranked[0] || 'app') || 'app'
    }

    function deriveType(branch) {
      return PREFIX_TYPE[String(branch ?? '').split('/')[0]] || 'feat'
    }

    function composeMessage(view, selectedPaths, visibleFiles) {
      const source = visibleFiles || view.files
      const paths = selectedPaths.length > 0 ? selectedPaths : source.map(function (file) { return file.path })
      const scope = deriveScope(paths)
      const type = deriveType(view.branch)
      const rest = String(view.branch).indexOf('/') !== -1 ? String(view.branch).split('/').slice(1).join(' ') : ''
      const allUntracked = source.length > 0 && source.every(function (file) { return file.untracked })
      const removing = source.some(function (file) { return file.index === 'D' })
      const action = allUntracked ? '新增' : removing ? '删除' : '调整'
      const what = rest !== '' ? rest.replace(/-/g, ' ') : scope
      return type + '(' + scope + '): ' + action + what + '相关改动'
    }
    //#endregion

    //#region copy
    const zh = {
      'bar.branch': '分支',
      'bar.dirty': '{count} 个改动',
      'bar.clean': '工作区干净',
      'bar.ahead': '领先 {count}',
      'bar.behind': '落后 {count}',
      'bar.detached': '分离 HEAD',
      'bar.conflict': '{count} 个冲突',
      'bar.open': '分支流程',
      'bar.refresh': '刷新',
      'bar.notRepo': '不是 Git 仓库',
      'panel.title': '分支流程',
      'panel.subtitle': '基线 {baseline} · 合并目标 {target}',
      'panel.close': '关闭',
      'panel.loading': '加载中…',
      'panel.refresh': '刷新',
      'panel.fetch': '拉取远端',
      'panel.fetch.title': '只更新远端跟踪引用，不改动本地代码',
      'panel.pull': '拉取并更新本地',
      'panel.pull.title': '先 fetch，再把本地分支快进到远端最新；已分叉时会拒绝',
      'panel.job.pull': '正在拉取并更新本地…',
      'ok.fetchBehind': '远端有新提交：{branch} 落后 {behind} 个、领先 {ahead} 个，点「拉取并更新本地」把代码更新下来',
      'ok.fetchUpToDate': '{branch} 已是最新',
      'ok.pullFastForward': '{branch} 已快进到 {upstream}',
      'ok.pullUpToDate': '{branch} 已是最新，无需更新',
      'error.diverged': '本地与远端已分叉，需要手动合并',
      'error.no-upstream': '当前分支在远端没有对应分支',
      'error.pull-failed': '拉取失败',
      'panel.section.commit': '提交改动',
      'panel.section.push': '推送分支',
      'panel.section.merge': '合并到指定分支',
      'panel.mergeInto': '目标分支',
      'panel.section.branches': '分支',
      'panel.branch.refresh': '刷新分支',
      'panel.branch.search': '搜索分支名…',
      'panel.branch.searchClear': '清空搜索',
      'panel.branch.noMatch': '没有匹配的分支',
      'panel.branch.refreshHint': '先拉取远端，再重新读取分支列表（同事新推的分支会出现在这里）',
      'panel.branch.refreshLocalOnly': '远端拉取失败，仅刷新了本地视图',
      'panel.branch.refreshed': '分支列表已刷新，共 {count} 个',
      'panel.branch.groupLocal': '本地分支',
      'panel.branch.groupRemote': '远端分支',
      'panel.branch.remoteEmpty': '远端没有其他分支',
      'panel.job.branches': '正在刷新分支…',
      'panel.section.create': '新建分支',
      'panel.section.conflict': '有冲突待处理',
      'panel.files': '改动文件（{count}）',
      'panel.files.all': '全选',
      'panel.files.none': '全不选',
      'panel.files.untracked': '未纳入 Git 的文件 {count} 个',
      'panel.files.untrackedHint': '默认隐藏未纳入 Git 的文件（缓存、产物、草稿等）；需要提交新文件时再展开',
      'panel.file.new': '新文件',
      'panel.onlyUntracked': '只有 {count} 个未纳入 Git 的文件，没有已跟踪文件的改动',
      'panel.noFiles': '没有已跟踪文件的改动',
      'panel.flow.title': '一键流程',
      'panel.message': '提交信息',
      'panel.message.placeholder': 'feat(scope): 说明改动',
      'panel.message.auto': '按改动生成',
      'panel.message.ai': 'AI 优化',
      'panel.message.aiBusy': '生成中…',
      'panel.message.valid': '符合规范',
      'panel.message.fixable': '已自动纠正',
      'panel.message.missingType': '缺少 type(scope): 前缀',
      'panel.message.emptySubject': '说明不能为空',
      'panel.message.longSubject': '说明偏长，建议不超过 72 字',
      'panel.commit': '提交',
      'panel.commitAll': '提交全部改动',
      'panel.push': '推送到远端',
      'panel.pushSetUpstream': '推送并设置上游',
      'panel.merge': '拉取并合并到 {target}',
      'panel.oneClick': '一键：提交 → 推送 → 合并到 {target}',
      'panel.oneClick.needMessage': '先写提交信息，或点「按改动生成」',
      'panel.job.commit': '正在提交…',
      'panel.job.push': '正在推送…',
      'panel.job.merge': '正在拉取并合并…',
      'panel.job.oneClick': '正在执行一键流程…',
      'panel.job.fetch': '正在拉取远端…',
      'panel.job.switch': '正在切换分支…',
      'panel.job.delete': '正在删除分支…',
      'panel.job.create': '正在创建分支…',
      'panel.stageProtected': '{branch} 是基线分支，不能直接合并',
      'panel.stageOnStage': '当前已经在 {target} 上',
      'panel.stageDetached': '分离 HEAD 状态下无法合并',
      'panel.branch.current': '当前',
      'panel.branch.environment': '环境',
      'panel.branch.protected': '受保护',
      'panel.branch.switch': '切换',
      'panel.branch.delete': '删除',
      'panel.branch.deleteConfirm': '删除本地分支 {branch}？',
      'panel.branch.deleteForce': '分支未合并，强制删除？',
      'panel.branch.empty': '没有本地分支',
      'panel.create.prefix': '前缀',
      'panel.create.description': '英文简述',
      'panel.create.placeholder': 'user-login',
      'panel.create.preview': '将创建',
      'panel.create.describePlaceholder': '用一句话描述需求，例如：给学员列表加导出功能',
      'panel.create.ai': 'AI 生成分支名',
      'panel.create.aiBusy': '生成中…',
      'panel.create.aiHint': '根据需求描述生成符合规范的分支名，生成后仍可手动修改',
      'panel.create.aiSuggested': '已生成分支名 {branch}，确认后点创建',
      'panel.create.aiRepaired': '前缀已按规范修正',
      'panel.create.aiRaw': '模型返回：{raw}',
      'panel.create.pushAfterCreate': '创建后推送到远端',
      'panel.create.created': '已创建并切换',
      'panel.create.baseline': '基线（固定）',
      'panel.create.confirm': '从 {baseline} 创建并切换',
      'panel.create.hint': '只能从最新 {baseline} 切出，禁止从 {target} 切出',
      'panel.create.missingBaseline': '当前仓库没有 {baseline} 分支',
      'panel.create.pickBaseline': '请选择这个仓库实际使用的基线分支',
      'panel.create.searchBaseline': '搜索分支…',
      'panel.create.baselineCount': '显示 {shown} / {total} 个分支',
      'panel.create.noBaselineMatch': '没有匹配的分支',
      'panel.create.fetchesFirst': '创建前会先 git fetch 拉取该基线的最新代码，再从 origin/{baseline} 切出新分支',
      'panel.conflict.message': '合并 {source} 到 {target} 时发生冲突，共 {count} 个文件',
      'panel.conflict.send': '把修复请求发进输入框',
      'panel.conflict.sendHint': '把冲突文件清单和修复要求写进输入框，回车后由模型修改；修完再回到这里继续合并',
      'panel.conflict.sent': '已写入输入框，回车让模型修复',
      'panel.conflict.continue': '冲突已解决，继续合并并推送',
      'panel.job.finishMerge': '正在完成合并并推送…',
      'ok.continuePushed': '合并已完成 {commit}，并已推送 {branch}',
      'ok.continueNoPush': '合并已完成 {commit}，但推送失败：{error}（可稍后在面板点「推送」重试）',
      'panel.conflict.abort': '放弃合并',
      'panel.conflict.manual': '你也可以手动编辑这些文件：',
      'panel.conflict.resolvedPending': '冲突已全部解决，但 {target} 上的合并还没提交；点下面按钮完成合并并推送。',
      'ok.commit': '已提交 {commit}',
      'ok.push': '已推送 {branch}',
      'ok.merge': '已合并到 {target}',
      'ok.mergeBack': '，并切回 {branch}',
      'ok.continue': '合并完成 {commit}',
      'ok.abort': '已放弃合并',
      'ok.fetch': '已拉取远端',
      'ok.switch': '已切换到 {branch}',
      'ok.delete': '已删除分支 {branch}',
      'ok.create': '已创建 {branch}',
      'error.dirty-worktree': '工作区有未提交改动，请先提交或撤销',
      'error.operation-in-progress': '有未完成的 Git 操作，请先继续或放弃',
      'error.production-protected': '基线分支禁止直接合并或推送',
      'error.stage-baseline': '统一基线：只能从 production6 切出，禁止从 stage 切出',
      'error.conflicts-present': '还有未解决的冲突',
      'error.branch-already-exists': '分支已存在',
      'error.base-ref-not-found': '基线分支不存在',
      'error.protected-branch': '环境分支受保护，不能删除',
      'error.current-branch': '不能删除当前所在的分支',
      'error.push-failed': '推送失败',
      'error.merge-failed': '合并失败',
      'error.commit-failed': '提交失败',
      'error.fetch-failed': '拉取远端失败',
      'error.nothing-to-commit': '没有可提交的改动',
      'error.no-paths-selected': '没有选择要提交的文件',
      'error.workspace-unknown': '该目录不是已注册的工作区',
      'error.not-a-repository': '当前目录不是 Git 仓库',
      'error.transport': '无法连接宿主服务',
      'error.internal': '操作失败',
      'error.no-merge-in-progress': '没有可中止的合并',
      'error.invalid-branch-name': '分支名不符合规则',
      'error.delete-failed': '删除分支失败',
      'error.create-failed': '创建分支失败',
      'error.switch-failed': '切换分支失败',
      'error.stage-failed': '暂存改动失败',
      'error.git-failed': 'Git 命令失败',
      'error.no-remote': '仓库没有配置远端',
      'error.detached-head': '当前处于分离 HEAD',
      'error.same-branch': '源分支与目标分支相同',
      'error.missing-source': '缺少源分支',
      'error.target-branch-not-found': '目标分支不存在',
      'error.bad-request': '请求不合法',
      'error.aborted': '操作已取消',
      'error.forbidden': '只允许本机访问',
    }

    const en = {
      'bar.branch': 'Branch',
      'bar.dirty': '{count} changes',
      'bar.clean': 'Clean',
      'bar.ahead': 'ahead {count}',
      'bar.behind': 'behind {count}',
      'bar.detached': 'Detached HEAD',
      'bar.conflict': '{count} conflicts',
      'bar.open': 'Branch flow',
      'bar.refresh': 'Refresh',
      'bar.notRepo': 'Not a Git repository',
      'panel.title': 'Branch flow',
      'panel.subtitle': 'Baseline {baseline} · Merge target {target}',
      'panel.close': 'Close',
      'panel.loading': 'Loading…',
      'panel.refresh': 'Refresh',
      'panel.fetch': 'Fetch',
      'panel.fetch.title': 'Updates remote-tracking refs only; local branches stay put',
      'panel.pull': 'Pull',
      'panel.pull.title': 'Fetch, then fast-forward the local branch; refuses when diverged',
      'panel.job.pull': 'Pulling…',
      'ok.fetchBehind': 'Remote has new commits: {branch} is {behind} behind and {ahead} ahead — use "Pull" to update local code',
      'ok.fetchUpToDate': '{branch} is up to date',
      'ok.pullFastForward': '{branch} fast-forwarded to {upstream}',
      'ok.pullUpToDate': '{branch} is already up to date',
      'error.diverged': 'Local and remote have diverged; merge manually',
      'error.no-upstream': 'The current branch has no remote counterpart',
      'error.pull-failed': 'Pull failed',
      'panel.section.commit': 'Commit',
      'panel.section.push': 'Push',
      'panel.section.merge': 'Merge into another branch',
      'panel.mergeInto': 'Target',
      'panel.section.branches': 'Branches',
      'panel.branch.refresh': 'Refresh',
      'panel.branch.search': 'Search branches…',
      'panel.branch.searchClear': 'Clear search',
      'panel.branch.noMatch': 'No matching branch',
      'panel.branch.refreshHint': 'Fetch the remote, then re-read the branch list (branches your colleagues pushed show up here)',
      'panel.branch.refreshLocalOnly': 'Fetch failed; only the local view was refreshed',
      'panel.branch.refreshed': 'Branch list refreshed: {count} branches',
      'panel.branch.groupLocal': 'Local',
      'panel.branch.groupRemote': 'Remote',
      'panel.branch.remoteEmpty': 'No other branches on the remote',
      'panel.job.branches': 'Refreshing branches…',
      'panel.section.create': 'New branch',
      'panel.section.conflict': 'Unresolved conflicts',
      'panel.files': 'Changed files ({count})',
      'panel.files.all': 'All',
      'panel.files.none': 'None',
      'panel.files.untracked': '{count} untracked files',
      'panel.files.untrackedHint': 'Untracked files are hidden by default (caches, build output, scratch files); expand to commit a new file',
      'panel.file.new': 'new',
      'panel.onlyUntracked': 'Only {count} untracked files; no tracked changes',
      'panel.noFiles': 'No tracked changes',
      'panel.flow.title': 'One-click flow',
      'panel.message': 'Commit message',
      'panel.message.placeholder': 'feat(scope): what changed',
      'panel.message.auto': 'From changes',
      'panel.message.ai': 'AI polish',
      'panel.message.missingType': 'Missing the type(scope): prefix',
      'panel.message.emptySubject': 'The subject cannot be empty',
      'panel.message.longSubject': 'The subject is long; keep it under 72 characters',
      'panel.message.valid': 'Matches the convention',
      'panel.message.fixable': 'Auto-corrected',
      'panel.commit': 'Commit',
      'panel.commitAll': 'Commit all changes',
      'panel.push': 'Push',
      'panel.pushSetUpstream': 'Push and set upstream',
      'panel.merge': 'Fetch and merge into {target}',
      'panel.oneClick': 'One click: commit → push → merge into {target}',
      'panel.oneClick.needMessage': 'Write a message first, or use "From changes"',
      'panel.job.commit': 'Committing…',
      'panel.job.push': 'Pushing…',
      'panel.job.merge': 'Fetching and merging…',
      'panel.job.oneClick': 'Running the one-click flow…',
      'panel.job.fetch': 'Fetching…',
      'panel.job.switch': 'Switching…',
      'panel.job.delete': 'Deleting…',
      'panel.message.aiBusy': 'Generating…',
      'panel.job.create': 'Creating…',
      'panel.stageProtected': '{branch} is the baseline branch and cannot be merged',
      'panel.stageOnStage': 'Already on {target}',
      'panel.stageDetached': 'Cannot merge from a detached HEAD',
      'panel.branch.current': 'current',
      'panel.branch.environment': 'environment',
      'panel.branch.protected': 'protected',
      'panel.branch.switch': 'Switch',
      'panel.branch.delete': 'Delete',
      'panel.branch.deleteConfirm': 'Delete local branch {branch}?',
      'panel.branch.deleteForce': 'The branch is not merged. Force delete?',
      'panel.branch.empty': 'No local branches',
      'panel.create.prefix': 'Prefix',
      'panel.create.description': 'Short description',
      'panel.create.placeholder': 'user-login',
      'panel.create.preview': 'Will create',
      'panel.create.describePlaceholder': 'Describe the work in one line, e.g. add export to the student list',
      'panel.create.ai': 'AI suggest name',
      'panel.create.aiBusy': 'Generating…',
      'panel.create.aiHint': 'Generate a rule-conforming branch name from the description; you can still edit it',
      'panel.create.aiSuggested': 'Suggested {branch}; confirm and create',
      'panel.create.aiRepaired': 'prefix corrected to the convention',
      'panel.create.aiRaw': 'model replied: {raw}',
      'panel.create.pushAfterCreate': 'Push to remote after creating',
      'panel.create.created': 'Created and switched',
      'panel.create.baseline': 'Baseline (fixed)',
      'panel.create.confirm': 'Create from {baseline} and switch',
      'panel.create.hint': 'Always from the latest {baseline}; creating from {target} is refused',
      'panel.create.missingBaseline': 'This repository has no {baseline} branch',
      'panel.create.pickBaseline': 'Pick the baseline this repository actually uses',
      'panel.create.searchBaseline': 'Search branches…',
      'panel.create.baselineCount': '{shown} of {total} branches',
      'panel.create.noBaselineMatch': 'No matching branch',
      'panel.create.fetchesFirst': 'The baseline is fetched before branching, so the new branch starts from the latest origin/{baseline}',
      'panel.conflict.message': 'Merging {source} into {target} conflicted in {count} files',
      'panel.conflict.send': 'Send the fix request to the composer',
      'panel.conflict.sent': 'Written to the composer — press Enter to let the model fix it',
      'panel.conflict.continue': 'Conflicts resolved, finish and push',
      'panel.job.finishMerge': 'Finishing the merge and pushing…',
      'ok.continuePushed': 'Merge completed at {commit} and pushed to {branch}',
      'ok.continueNoPush': 'Merge completed at {commit}, but the push failed: {error} (retry with Push in the panel)',
      'panel.conflict.abort': 'Abort merge',
      'panel.conflict.sendHint': 'Writes the conflict file list and fix instructions into the composer; press Enter to let the model edit, then come back and continue the merge',
      'panel.conflict.manual': 'You can also edit these files by hand:',
      'panel.conflict.resolvedPending': 'Every conflict is resolved, but the merge on {target} is not committed yet. Finish and push with the button below.',
      'ok.commit': 'Committed {commit}',
      'ok.push': 'Pushed {branch}',
      'ok.merge': 'Merged into {target}',
      'ok.mergeBack': ', switched back to {branch}',
      'ok.continue': 'Merge completed at {commit}',
      'ok.abort': 'Merge aborted',
      'ok.fetch': 'Fetched',
      'ok.switch': 'Switched to {branch}',
      'ok.delete': 'Deleted {branch}',
      'ok.create': 'Created {branch}',
      'error.dirty-worktree': 'The worktree has uncommitted changes',
      'error.operation-in-progress': 'A Git operation is still in progress',
      'error.production-protected': 'The baseline branch cannot be merged or pushed',
      'error.stage-baseline': 'Always branch from production6, never from stage',
      'error.conflicts-present': 'Unresolved conflicts remain',
      'error.branch-already-exists': 'The branch already exists',
      'error.base-ref-not-found': 'The baseline branch does not exist',
      'error.protected-branch': 'Environment branches are protected',
      'error.current-branch': 'The current branch cannot be deleted',
      'error.push-failed': 'Push failed',
      'error.merge-failed': 'Merge failed',
      'error.commit-failed': 'Commit failed',
      'error.fetch-failed': 'Fetch failed',
      'error.nothing-to-commit': 'Nothing to commit',
      'error.no-paths-selected': 'No files selected',
      'error.workspace-unknown': 'Not a registered workspace',
      'error.not-a-repository': 'Not a Git repository',
      'error.transport': 'Cannot reach the host service',
      'error.internal': 'The operation failed',
      'error.no-merge-in-progress': 'No merge to abort',
      'error.invalid-branch-name': 'The branch name does not match the rules',
      'error.delete-failed': 'Deleting the branch failed',
      'error.create-failed': 'Creating the branch failed',
      'error.switch-failed': 'Switching branches failed',
      'error.stage-failed': 'Staging the changes failed',
      'error.git-failed': 'The Git command failed',
      'error.no-remote': 'The repository has no remote',
      'error.detached-head': 'HEAD is detached',
      'error.same-branch': 'Source and target are the same branch',
      'error.missing-source': 'The source branch is missing',
      'error.target-branch-not-found': 'The target branch does not exist',
      'error.bad-request': 'Malformed request',
      'error.aborted': 'The operation was cancelled',
      'error.forbidden': 'Loopback access only',
    }

    const NS = 'branch-flow'

    function interpolate(text, vars) {
      if (!vars) return text
      return text.replace(/\{(\w+)\}/g, function (match, key) {
        return vars[key] === undefined ? match : String(vars[key])
      })
    }

    function makeT(dict) {
      return function (key, vars) {
        return interpolate(dict[key] || key, vars)
      }
    }
    //#endregion

    //#region styles
    // One visual grammar for every control in this plugin: pill geometry, a
    // brand-tinted surface, and a hover that deepens the fill. Colours come
    // from host theme tokens only, mixed with color-mix so light and dark
    // themes both derive their own shades instead of hard-coding two palettes.
    const STYLE = [
      // ── Chip (composer tool row) ────────────────────────────────────
      // The chip lives in the composer tool row (`conversation.input.right`,
      // immediately left of the model selector). It follows the host brand-chip
      // language: a calm tinted capsule that lifts on hover.
      '.bf-chip{display:inline-flex;align-items:center;gap:6px;height:28px;min-width:0;flex:0 1 auto;max-width:min(45vw,420px);padding:0 9px;margin:0 2px 0 0;border:1px solid transparent;border-radius:999px;background:var(--dsw-alias-state-business-tertiary,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px;font-family:inherit;cursor:pointer;white-space:nowrap;box-sizing:border-box;transition:background .16s ease,box-shadow .16s ease,border-color .16s ease,transform .16s ease}',
      '.bf-chip:hover{background:color-mix(in srgb,var(--dsw-alias-state-business-tertiary,var(--dsw-alias-bg-layer-2)) 72%,var(--dsw-alias-brand-primary));border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 26%,transparent);box-shadow:0 1px 2px rgba(0,0,0,.06),0 2px 8px color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-label-primary)}',
      '.bf-chip:active{transform:translateY(.5px)}',
      '.bf-chip:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.bf-chip-dot{width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary);flex:none;box-shadow:0 0 0 2.5px color-mix(in srgb,var(--dsw-alias-state-success-primary) 18%,transparent)}',
      '.bf-chip-dot.is-warn{background:var(--dsw-alias-state-warn-primary);box-shadow:0 0 0 2.5px color-mix(in srgb,var(--dsw-alias-state-warn-primary) 18%,transparent)}',
      '.bf-chip-dot.is-error{background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 2.5px color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,transparent)}',
      '.bf-chip-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-weight:600;letter-spacing:.005em}',
      '.bf-chip-badge{flex:none;min-width:17px;height:17px;padding:0 5px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-primary));font-size:10px;font-weight:600;line-height:17px;text-align:center;box-sizing:border-box}',
      '.bf-chip-badge.is-error{background:var(--dsw-alias-state-error-primary);color:#fff}',
      '.bf-chip-track{flex:none;font-size:11px;font-weight:500;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      // ── Layout helpers ──────────────────────────────────────────────
      '.bf-spacer{flex:1;min-width:8px}',
      '.bf-sep{width:1px;height:12px;background:var(--dsw-alias-border-l1);flex:none}',
      // ── Buttons: one base, three intents ────────────────────────────
      // A single button grammar: pill radius, 1px tinted edge, tinted fill, and a
      // hover that deepens the fill rather than only recolouring the border.
      '.bf-btn{position:relative;display:inline-flex;align-items:center;justify-content:center;gap:6px;height:28px;padding:0 12px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font-size:12px;font-weight:500;line-height:20px;font-family:inherit;cursor:pointer;white-space:nowrap;box-sizing:border-box;transition:background .15s ease,border-color .15s ease,box-shadow .15s ease,transform .12s ease,color .15s ease}',
      '.bf-btn:hover:not(:disabled){border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 30%,var(--dsw-alias-border-l1));background:color-mix(in srgb,var(--dsw-alias-brand-primary) 8%,var(--dsw-alias-bg-layer-2));box-shadow:0 1px 2px rgba(0,0,0,.05)}',
      '.bf-btn:active:not(:disabled){transform:translateY(.5px)}',
      '.bf-btn:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-alias-brand-primary);outline-offset:2px}',
      '.bf-btn:disabled{opacity:.45;cursor:not-allowed;transform:none;box-shadow:none}',
      // Primary: a deep, low-saturation fill rather than a bright brand block.
      // A near-black gradient reads as "premium" and keeps the eye on content;
      // brand colour survives only in the glow and the focus ring.
      '.bf-btn.primary{border-color:transparent;background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-label-primary) 84%,var(--dsw-alias-brand-primary)) 0%,color-mix(in srgb,var(--dsw-alias-label-primary) 94%,var(--dsw-alias-brand-primary)) 100%);color:var(--dsw-alias-bg-base);box-shadow:0 1px 2px rgba(0,0,0,.18),0 3px 12px color-mix(in srgb,#000 22%,transparent);text-shadow:none}',
      '.bf-btn.primary:hover:not(:disabled){background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-label-primary) 88%,var(--dsw-alias-brand-primary)) 0%,color-mix(in srgb,var(--dsw-alias-label-primary) 97%,var(--dsw-alias-brand-primary)) 100%);box-shadow:0 2px 6px rgba(0,0,0,.22),0 6px 20px color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,transparent)}',
      // Danger stays quiet until hovered: it deletes things, it should not shout.
      '.bf-btn.danger{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 5%,transparent)}',
      '.bf-btn.danger:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 38%,transparent);box-shadow:0 1px 6px color-mix(in srgb,var(--dsw-alias-state-error-primary) 16%,transparent)}',
      // ── Overlay, panel, header ──────────────────────────────────────
      '.bf-backdrop{position:fixed;inset:0;background:color-mix(in srgb,#000 34%,transparent);backdrop-filter:blur(2px);pointer-events:auto;z-index:60;animation:bf-fade .16s ease}',
      '@keyframes bf-fade{from{opacity:0}to{opacity:1}}',
      '@keyframes bf-rise{from{opacity:0;transform:translate(-50%,calc(-50% + 8px))}to{opacity:1;transform:translate(-50%,-50%)}}',
      '.bf-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);width:min(880px,92vw);max-height:84vh;display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:none;border-radius:20px;box-shadow:0 32px 80px rgba(0,0,0,.32),0 4px 16px rgba(0,0,0,.14),inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);pointer-events:auto;z-index:61;overflow:hidden;color:var(--dsw-alias-label-primary);font-size:13px;font-family:-apple-system,BlinkMacSystemFont,ui-sans-serif,system-ui,var(--ds-font-family-sans,sans-serif);animation:bf-rise .2s cubic-bezier(.2,.8,.3,1)}',
      // A hairline of brand colour across the header edge ties the sheet together.
      '.bf-head{display:flex;align-items:center;gap:10px;padding:14px 16px 13px;border-bottom:1px solid var(--dsw-alias-border-l1);background:linear-gradient(180deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 5%,transparent),transparent)}',
      '.bf-title{font-size:15px;font-weight:650;color:var(--dsw-alias-label-primary);letter-spacing:.01em;flex:none}',
      '.bf-sub{font-size:12px;color:var(--dsw-alias-label-secondary);flex:none}',
      '.bf-branch-pill{display:inline-flex;align-items:center;gap:6px;height:24px;max-width:220px;padding:0 10px;border-radius:999px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 24%,transparent);background:color-mix(in srgb,var(--dsw-alias-brand-primary) 11%,transparent);color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;font-weight:600;line-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box}',
      '.bf-body{padding:14px 16px;overflow:auto;display:flex;flex-direction:column;gap:12px}',
      // ── Cards ───────────────────────────────────────────────────────
      '.bf-card{position:relative;border:none;border-radius:16px;padding:14px;display:flex;flex-direction:column;gap:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 3%,var(--dsw-alias-bg-layer-1));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-label-primary) 6%,transparent)}',
      // A conflict is the one state that must not look like the others: a red
      // edge and a tinted fill mark the card as blocking before any text is read.
      '.bf-card-conflict{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 7%,var(--dsw-alias-bg-layer-1));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-state-error-primary) 32%,transparent)}',
      '.bf-conflict-dot{flex:none;width:7px;height:7px;border-radius:50%;background:var(--dsw-alias-state-error-primary);box-shadow:0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-error-primary) 18%,transparent)}',
      '.bf-files-conflict{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 5%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 22%,transparent)}',
      '.bf-card-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary);display:flex;align-items:center;gap:8px;letter-spacing:.01em}',
      '.bf-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      // ── File list and toggles ───────────────────────────────────────
      '.bf-files{max-height:170px;overflow:auto;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;padding:4px;background:var(--dsw-alias-bg-layer-2)}',
      '.bf-file{display:flex;align-items:center;gap:8px;padding:4px 8px;border-radius:7px;font-size:12px;cursor:pointer;transition:background .12s ease}',
      '.bf-file:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 7%,transparent)}',
      '.bf-file.bf-file-active{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 11%,transparent)}',
      '.bf-file input[type=checkbox],.bf-file input[type=radio]{accent-color:var(--dsw-alias-brand-primary);cursor:pointer;margin:0;flex:none}',
      '.bf-toggle{height:22px;display:inline-flex;align-items:center;gap:4px;padding:0 9px;border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 22%,var(--dsw-alias-border-l1));border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,transparent);color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-secondary));font-size:11px;font-weight:500;font-family:inherit;cursor:pointer;white-space:nowrap;transition:background .14s ease,border-color .14s ease}',
      '.bf-toggle:hover:not(:disabled){background:color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 36%,transparent)}',
      '.bf-file span.path{flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}',
      '.bf-tag{font-size:10px;font-weight:500;padding:1px 6px;border-radius:999px;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);white-space:nowrap}',
      '.bf-tag.conflict{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 45%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent)}',
      // ── Inputs (iOS-style: filled, no hard border, soft inner shadow) ──
      // iOS fields are flat fills with generous radii and a focus ring that
      // grows outward, never a heavy outline. The native control chrome is
      // removed so `select` matches the text fields instead of the OS widget.
      //
      // Fills use background-color, never the `background` shorthand: the
      // shorthand resets background-image, which would erase the select chevron
      // painted below and let the native arrow show through.
      '.bf-input,.bf-select{appearance:none;-webkit-appearance:none;height:34px;border-radius:10px;border:1px solid transparent;background-color:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);padding:0 11px;font-size:13px;line-height:20px;font-family:-apple-system,BlinkMacSystemFont,ui-sans-serif,system-ui,var(--ds-font-family-sans,sans-serif);box-sizing:border-box;box-shadow:inset 0 1px 2px color-mix(in srgb,#000 4%,transparent);transition:background-color .16s ease,border-color .16s ease,box-shadow .16s ease}',
      '.bf-input::placeholder{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '.bf-input:hover:not(:disabled),.bf-select:hover:not(:disabled){background-color:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,var(--dsw-alias-bg-layer-2))}',
      '.bf-input:focus,.bf-select:focus{outline:none;background-color:var(--dsw-alias-bg-layer-2);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent)}',
      '.bf-input:disabled,.bf-select:disabled{opacity:.5;cursor:not-allowed}',
      '.bf-input.msg{flex:1;min-width:220px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}',
      // A custom chevron replaces the native arrow the appearance reset removed.
      // The right padding reserves its space so long option text never runs under it.
      '.bf-select{padding-right:32px;background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-secondary) 50%),linear-gradient(135deg,var(--dsw-alias-label-secondary) 50%,transparent 50%);background-position:calc(100% - 16px) calc(50% + 1px),calc(100% - 11px) calc(50% + 1px);background-size:5px 5px,5px 5px;background-repeat:no-repeat;cursor:pointer}',
      '.bf-select:focus{background-image:linear-gradient(45deg,transparent 50%,var(--dsw-alias-label-primary) 50%),linear-gradient(135deg,var(--dsw-alias-label-primary) 50%,transparent 50%)}',
      '.bf-select::-ms-expand{display:none}',
      // The popup list is drawn by the OS, not by the select box. Without an
      // explicit surface it falls back to the system dark palette, which is the
      // black flash seen when the list opens and closes.
      '.bf-select option{background-color:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary)}',
      '.bf-select option:checked{background-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,var(--dsw-alias-bg-overlay));color:var(--dsw-alias-label-primary)}',
      // A select that shares the row with a label: it grows, then truncates its
      // own text, so a 50-character branch name never widens the card.
      '.bf-select-grow{flex:1 1 auto;min-width:0;max-width:100%;text-overflow:ellipsis}',
      // The merge route: source → target as two pills. Each pill truncates
      // independently, and the arrow keeps its own space so the row stays tidy.
      '.bf-route{display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:nowrap}',
      '.bf-route-pill{min-width:0;max-width:min(46%,320px);height:24px;padding:0 10px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);color:var(--dsw-alias-label-secondary);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;line-height:24px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-sizing:border-box}',
      '.bf-route-pill.is-target{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary,var(--dsw-alias-brand-primary));font-weight:500}',
      '.bf-route-arrow{flex:none;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:12px;line-height:1}',
      // ── Notes and text ──────────────────────────────────────────────
      '.bf-hint{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-secondary)}',
      '.bf-hint.ok{color:var(--dsw-alias-state-success-primary)}',
      '.bf-hint.err{color:var(--dsw-alias-state-error-primary)}',
      '.bf-list{display:flex;flex-direction:column;max-height:220px;overflow:auto;gap:1px}',
      // Search field: the iOS "inset rounded search" look — flat fill, no
      // border at rest, and a ring that appears only on focus.
      '.bf-search{display:flex;align-items:center;gap:7px;height:34px;padding:0 11px;border:1px solid transparent;border-radius:10px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 6%,var(--dsw-alias-bg-layer-2));box-shadow:inset 0 1px 2px color-mix(in srgb,#000 4%,transparent);transition:background .16s ease,border-color .16s ease,box-shadow .16s ease}',
      '.bf-search:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 9%,var(--dsw-alias-bg-layer-2))}',
      '.bf-search:focus-within{background:var(--dsw-alias-bg-layer-2);border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 55%,transparent);box-shadow:0 0 0 4px color-mix(in srgb,var(--dsw-alias-brand-primary) 15%,transparent)}',
      '.bf-search-icon{flex:none;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:14px;line-height:1}',
      '.bf-search-input{flex:1;min-width:0;height:100%;border:none;outline:none;background:none;color:var(--dsw-alias-label-primary);font-size:13px;font-family:-apple-system,BlinkMacSystemFont,ui-sans-serif,system-ui,var(--ds-font-family-sans,sans-serif);padding:0}',
      '.bf-search-input::placeholder{color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}',
      '.bf-search-clear{flex:none;width:18px;height:18px;display:inline-flex;align-items:center;justify-content:center;padding:0;border:none;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary) 12%,transparent);color:var(--dsw-alias-bg-layer-2);font-size:9px;line-height:1;font-family:inherit;cursor:pointer;transition:background .14s ease}',
      '.bf-search-clear:hover{background:color-mix(in srgb,var(--dsw-alias-label-primary) 22%,transparent)}',
      // Two collapsible groups: a quiet header row that reads as a section, not
      // as another control competing with the branch rows below it.
      '.bf-group{display:flex;flex-direction:column;gap:2px}',
      '.bf-group+.bf-group{margin-top:10px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l1)}',
      '.bf-group-head{display:flex;align-items:center;gap:8px;width:100%;height:26px;padding:0 8px;border:none;border-radius:7px;background:none;color:var(--dsw-alias-label-primary);font-family:inherit;font-size:12px;font-weight:600;line-height:20px;cursor:pointer;text-align:left;transition:background .12s ease}',
      '.bf-group-head:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,transparent)}',
      '.bf-group-caret{flex:none;width:10px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:10px;transition:transform .14s ease}',
      '.bf-group-caret.is-open{transform:rotate(90deg)}',
      '.bf-group-name{flex:none}',
      '.bf-group-count{flex:none;min-width:17px;height:17px;padding:0 5px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 12%,transparent);color:var(--dsw-alias-state-business-primary,var(--dsw-alias-label-secondary));font-size:10px;font-weight:600;line-height:17px;text-align:center;box-sizing:border-box}',
      '.bf-item{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;font-size:12px;transition:background .12s ease}',
      '.bf-item:hover{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 6%,transparent)}',
      '.bf-item .name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.bf-item .meta{color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.bf-notice{padding:9px 12px;border-radius:10px;font-size:12px;line-height:1.5;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2)}',
      '.bf-notice.ok{color:var(--dsw-alias-state-success-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-success-primary) 38%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 9%,transparent)}',
      '.bf-notice.err{color:var(--dsw-alias-state-error-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 9%,transparent)}',
      '.bf-notice.warn{color:var(--dsw-alias-state-warn-primary);border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,transparent);background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 9%,transparent)}',
      '.bf-steps{display:flex;flex-direction:column;gap:3px;font-size:11px;line-height:1.55;color:var(--dsw-alias-label-secondary)}',
      '.bf-close{margin-left:auto}',
      '.bf-mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}',
      // Respect a reduced-motion preference: the lift and rise are decoration.
      '@media (prefers-reduced-motion:reduce){.bf-backdrop,.bf-panel{animation:none}.bf-btn,.bf-chip,.bf-toggle,.bf-input,.bf-select{transition:none}.bf-btn:active:not(:disabled),.bf-chip:active{transform:none}}',
    ].join('\n')

    function Styles() {
      return h('style', { 'data-dsh-plugin': 'branch-flow' }, STYLE)
    }
    //#endregion

    //#region api
    async function post(verb, payload) {
      let response
      try {
        response = await fetch('branch-flow/' + verb, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload || {}),
        })
      } catch (error) {
        return { ok: false, error: { code: 'transport', message: String(error) } }
      }
      let body
      try {
        body = await response.json()
      } catch {
        return { ok: false, error: { code: 'transport', message: 'bad response' } }
      }
      if (body && body.ok === true) return { ok: true, value: body.value }
      return { ok: false, error: (body && body.error) || { code: 'internal', message: 'request failed' } }
    }

    /**
     * Turn one host error into readable text.
     *
     * A generic translation alone hides the useful half: "合并失败" without the
     * git reason leaves the user with nothing to act on. When the host supplied a
     * detail message that adds information beyond the generic label, it is
     * appended rather than discarded.
     */
    function errorText(t, error) {
      if (!error) return t('error.internal')
      const key = 'error.' + error.code
      const copy = t(key)
      const detail = typeof error.message === 'string' ? error.message.trim() : ''
      if (copy === key) return detail || t('error.internal')
      if (detail === '' || detail === copy) return copy
      return copy + '：' + detail
    }

    /** The blocking paths a merge/switch refusal reported, if any. */
    function errorPaths(error) {
      return Array.isArray(error?.paths) ? error.paths.filter(path => typeof path === 'string' && path !== '') : []
    }

    /**
     * Refresh the bar on a bounded, visibility-aware cadence. A hidden tab and
     * an idle window cost nothing; the panel and focus events cover the rest.
     * @param {() => void} onChange - called when the page is visible on a tick.
     * @returns {() => void} the disposer.
     */
    function pollWhileVisible(onChange, intervalMs) {
      let timer = null
      const stop = function () {
        if (timer !== null) { clearInterval(timer); timer = null }
      }
      const start = function () {
        if (timer !== null) return
        timer = setInterval(function () {
          const visibility = typeof document === 'undefined' ? undefined : document.visibilityState
          if (visibility !== undefined && visibility !== 'visible') return
          onChange()
        }, intervalMs)
      }
      const onVisibility = function () {
        if (typeof document === 'undefined') return
        if (document.visibilityState === 'visible') { onChange(); start() }
        else stop()
      }
      start()
      if (typeof document !== 'undefined') document.addEventListener?.('visibilitychange', onVisibility)
      return function () {
        stop()
        if (typeof document !== 'undefined') document.removeEventListener?.('visibilitychange', onVisibility)
      }
    }
    //#endregion

    //#region store
    const store = {
      state: { open: false, path: '', send: null },
      listeners: new Set(),
      set(patch) {
        store.state = Object.assign({}, store.state, patch)
        store.listeners.forEach(function (listener) { listener() })
      },
      subscribe(listener) {
        store.listeners.add(listener)
        return function () { store.listeners.delete(listener) }
      },
    }

    function useStore() {
      const [state, setState] = useState(store.state)
      useEffect(function () {
        const off = store.subscribe(function () { setState(store.state) })
        setState(store.state)
        return off
      }, [])
      return state
    }
    //#endregion

    //#region composer insertion
    const CONFLICT_PROMPT = [
      '合并 {source} 到 {target} 时产生冲突，请按以下步骤处理：',
      '1. 读取下面这些文件里的冲突标记（<<<<<<< / ======= / >>>>>>>），理解两边的意图后合并成一份正确代码；',
      '2. 删除所有冲突标记，不要保留任何一侧的整段代码；',
      '3. 改完后只告诉我每个文件最终保留了哪些逻辑，不要自行 commit、push 或切换分支。',
      '',
      '冲突文件：',
      '{files}',
    ].join('\n')

    function buildConflictPrompt(source, target, files) {
      return CONFLICT_PROMPT
        .replace('{source}', source)
        .replace('{target}', target)
        .replace('{files}', files.map(function (file) { return '- ' + file }).join('\n'))
    }

    /** Insert text into the composer draft; returns whether it landed. */
    function insertIntoComposer(actions, text) {
      if (!actions) return false
      try {
        if (typeof actions.insertText === 'function' && typeof actions.captureInsertion === 'function') {
          return actions.insertText(text, actions.captureInsertion()) === true
        }
        if (typeof actions.setDraft === 'function') {
          actions.setDraft(text)
          return true
        }
      } catch {
        return false
      }
      return false
    }
    //#endregion

    //#region bar
    function BranchBar(props) {
      const t = props.t || makeT(zh)
      const sessionId = props.sessionId
      const cwd = props.useSessions(function (state) {
        if (sessionId === undefined) return undefined
        const sessions = state || {}
        const row = sessions.byId ? sessions.byId[sessionId] : undefined
        return row ? row.cwd : undefined
      })
      const [view, setView] = useState(undefined)
      const [error, setError] = useState(null)
      const open = useStore().open

      const refresh = useCallback(function () {
        if (!cwd) { setView(null); return }
        let live = true
        post('view', { path: cwd }).then(function (result) {
          if (!live) return
          if (result.ok) { setView(result.value); setError(null) }
          else { setView(null); setError(result.error) }
        })
        return function () { live = false }
      }, [cwd])

      useEffect(function () {
        if (!cwd) { setView(null); return undefined }
        return refresh()
      }, [cwd, refresh])

      useEffect(function () {
        if (!cwd) return undefined
        // The bar refreshes on focus and on a 30s visible-tab tick: each tick
        // spawns several git processes, so a hidden tab must cost nothing.
        const stopPolling = pollWhileVisible(function () { refresh() }, 30_000)
        const onFocus = function () { refresh() }
        window.addEventListener('focus', onFocus)
        return function () {
          stopPolling()
          window.removeEventListener('focus', onFocus)
        }
      }, [cwd, refresh])

      // Re-read after the panel closes: it may have moved HEAD.
      useEffect(function () {
        if (!open) refresh()
      }, [open, refresh])

      const actions = props.inputActions
      const send = useCallback(function (text) {
        return insertIntoComposer(actions, text)
      }, [actions])

      const openPanel = function () {
        store.set({ open: true, path: cwd, send: send })
      }

      if (!cwd) return null
      if (view === undefined) return null
      if (view === null) {
        if (error && error.code === 'workspace-unknown') return null
        return null
      }

      const dirty = view.dirtyFiles + view.untrackedFiles
      // One compact chip in the composer tool row, immediately left of the
      // model selector: branch, a state dot, and the ahead/behind distance.
      // The whole chip opens the panel; no separate bar row is rendered.
      return h(React.Fragment, null,
        h(Styles),
        h('button', {
          type: 'button',
          className: 'bf-chip',
          'data-dsh-plugin': 'branch-flow',
          'data-dsh-part': 'chip',
          onClick: openPanel,
          title: t('bar.open') + ' · ' + (view.detached ? t('bar.detached') : view.branch),
          'aria-label': t('bar.open'),
        },
          h('span', {
            className: 'bf-chip-dot'
              + (view.conflicts > 0 ? ' is-error' : dirty > 0 ? ' is-warn' : ''),
          }),
          h('span', { className: 'bf-chip-name' }, view.detached ? t('bar.detached') : view.branch),
          view.conflicts > 0
            ? h('span', { className: 'bf-chip-badge is-error' }, t('bar.conflict', { count: view.conflicts }))
            : dirty > 0
              ? h('span', { className: 'bf-chip-badge' }, dirty)
              : null,
          view.ahead > 0 ? h('span', { className: 'bf-chip-track' }, '↑' + view.ahead) : null,
          view.behind > 0 ? h('span', { className: 'bf-chip-track' }, '↓' + view.behind) : null,
        ),
      )
    }
    //#endregion

    //#region panel
    function BranchPanel(props) {
      const t = props.t || makeT(zh)
      // The translate function is re-created by the locale seat; keeping it in
      // a ref keeps every callback below referentially stable, so the data
      // effects do not re-run (and re-fetch) on every render.
      const tRef = useRef(t)
      tRef.current = t
      const state = useStore()
      const open = state.open
      const path = state.path
      const send = state.send

      const [view, setView] = useState(null)
      const [loading, setLoading] = useState(false)
      const [busy, setBusy] = useState('')
      const [notice, setNotice] = useState(null)
      const [steps, setSteps] = useState([])
      const [selected, setSelected] = useState(null)
      const [message, setMessage] = useState('')
      const [messageTouched, setMessageTouched] = useState(false)
      const [aiBusy, setAiBusy] = useState(false)
      const [newPrefix, setNewPrefix] = useState('feature')
      const [newName, setNewName] = useState('')
      const [newDescription, setNewDescription] = useState('')
      const [nameBusy, setNameBusy] = useState(false)
      const [pushOnCreate, setPushOnCreate] = useState(true)
      const [createdBranch, setCreatedBranch] = useState('')
      const [showUntracked, setShowUntracked] = useState(false)
      const [showLocal, setShowLocal] = useState(true)
      // The remote list is usually the long one (hundreds of branches in an
      // active repository), so it starts collapsed and expands on demand.
      const [showRemote, setShowRemote] = useState(false)
      const [branchQuery, setBranchQuery] = useState('')
      const [mergeTarget, setMergeTarget] = useState('stage')
      const [baselineOverride, setBaselineOverride] = useState('')
      const [baselineQuery, setBaselineQuery] = useState('')
      const [conflict, setConflict] = useState(null)

      // A repository that lacks production6 keeps its chosen baseline across
      // panel openings: the convention is a default, not a hard requirement.
      useEffect(function () {
        if (!path) return
        try {
          const stored = window.localStorage?.getItem('dsh-branch-flow:baseline:' + path)
          if (typeof stored === 'string' && stored !== '') setBaselineOverride(stored)
        } catch {
          // Private-mode storage refusal: the picker still works per session.
        }
      }, [path])
      const requestSeq = useRef(0)

      const refresh = useCallback(function () {
        if (!path) return Promise.resolve(null)
        const seq = requestSeq.current + 1
        requestSeq.current = seq
        setLoading(true)
        return post('view', { path: path }).then(function (result) {
          if (requestSeq.current !== seq) return null
          setLoading(false)
          if (result.ok) {
            setView(result.value)
            return result.value
          }
          setNotice({ kind: 'err', text: errorText(tRef.current, result.error) })
          return null
        })
      }, [path])

      useEffect(function () {
        if (!open) {
          setView(null)
          setNotice(null)
          setSteps([])
          setConflict(null)
          return
        }
        setNotice(null)
        setSteps([])
        setMessageTouched(false)
        refresh().then(function (value) {
          if (value === null) return
          setSelected(new Set(value.files.map(function (file) { return file.path })))
          setMessage('')
          setMergeTarget(value.stageBranch || 'stage')
          // Reopening the panel after a conflict must NOT lose the "finish the
          // merge" entry point. The host reports whether a merge is still open
          // (MERGE_HEAD), which survives the model staging the resolved files —
          // so restore the conflict card from that fact, not from local state.
          if (value.operationInProgress === true && value.operation === 'merge') {
            setConflict({
              source: value.upstream ? value.upstream.replace(/^[^/]+\//, '') : value.branch,
              target: value.branch,
              files: Array.isArray(value.unresolvedPaths) ? value.unresolvedPaths : [],
              resumed: true,
            })
          }
        })
      }, [open, refresh])

      // Keep the merge target valid while the branch list settles: the chosen
      // target must still exist and must not be the source branch.
      useEffect(function () {
        if (view === null) return
        const names = view.branches.map(function (item) { return item.name })
        if (names.indexOf(mergeTarget) === -1 || mergeTarget === view.branch) {
          setMergeTarget(view.stageBranch || 'stage')
        }
      }, [view, mergeTarget])

      // While the panel is open, re-read the repository on a short visible-tab
      // tick so an external commit or switch shows up; a running job owns the
      // screen and suppresses the tick instead of racing it.
      useEffect(function () {
        if (!open || !path) return undefined
        return pollWhileVisible(function () {
          if (busy !== '') return
          refresh().then(function () {})
        }, 10_000)
      }, [open, path, busy, refresh])

      useEffect(function () {
        if (!open) return undefined
        const onKey = function (event) {
          if (event.key === 'Escape') store.set({ open: false })
        }
        window.addEventListener('keydown', onKey)
        return function () { window.removeEventListener('keydown', onKey) }
      }, [open])

      // The commit list shows files git already tracks (modified/added/deleted/
      // renamed). Untracked files are hidden by default because a workspace
      // routinely carries scratch files, caches and build output; the toggle
      // brings them back for the cases where a new file really is the change.
      const allFiles = view ? view.files : []
      const files = showUntracked ? allFiles : allFiles.filter(function (file) { return !file.untracked })
      const hiddenUntracked = allFiles.length - files.length
      const chosen = selected === null ? [] : files.filter(function (file) { return selected.has(file.path) })
      const chosenPaths = chosen.map(function (file) { return file.path })

      const autoMessage = useMemo(function () {
        if (!view) return ''
        if (files.length === 0) return ''
        const paths = chosenPaths.length > 0 ? chosenPaths : files.map(function (file) { return file.path })
        return composeMessage(view, paths, files)
      }, [view, files, chosenPaths.join('\u0000')])

      // A touched field is authoritative even when empty: clearing it disables
      // commit instead of silently falling back to the composed draft.
      const effectiveMessage = messageTouched ? message : (message !== '' ? message : autoMessage)
      const validation = useMemo(function () {
        if (effectiveMessage === '') return null
        return normalizeCommitMessage(effectiveMessage, {
          type: view ? deriveType(view.branch) : 'feat',
          scope: deriveScope(chosenPaths.length > 0 ? chosenPaths : files.map(function (file) { return file.path })),
        })
      }, [effectiveMessage, view, chosenPaths.join('\u0000')])

      // Every hook above this line and none below it: an early return before a
      // hook changes the hook count between renders, which React rejects (the
      // panel then unmounts and the dock entry goes inactive).
      const baselineCandidates = view ? (view.baselineCandidates || []) : []
      const filteredBaselines = useMemo(function () {
        const needle = baselineQuery.trim().toLowerCase()
        if (needle === '') return baselineCandidates
        return baselineCandidates.filter(function (name) { return name.toLowerCase().includes(needle) })
      }, [baselineCandidates.join('\u0000'), baselineQuery])

      // The branch search filters both groups at once. A query is matched as a
      // case-insensitive substring, and each group keeps its own filtered count
      // so a match in the collapsed group is still visible.
      const localBranches = view ? (view.branches || []) : []
      const remoteBranches = view ? (view.remoteBranches || []) : []
      const searchBranches = function (items) {
        const needle = branchQuery.trim().toLowerCase()
        if (needle === '') return items
        return items.filter(function (item) { return item.name.toLowerCase().includes(needle) })
      }
      const filteredLocal = searchBranches(localBranches)
      const filteredRemote = searchBranches(remoteBranches)

      if (!open) return null

      const run = function (label, job) {
        setBusy(label)
        setNotice(null)
        setSteps([])
        return job().finally(function () { setBusy('') })
      }

      const report = function (kind, text) {
        setNotice({ kind: kind, text: text })
      }

      const doCommit = function () {
        if (validation === null || !validation.ok) {
          report('err', t('panel.oneClick.needMessage'))
          return Promise.resolve(null)
        }
        return run(t('panel.job.commit'), function () {
          const all = selected === null || chosen.length === files.length
          return post('commit', {
            path: path,
            message: validation.message,
            all: all,
            paths: chosenPaths,
            // Untracked files enter the commit only when the user expanded the
            // list and left them checked; the default path stages tracked edits.
            includeUntracked: showUntracked,
          }).then(function (result) {
            if (!result.ok) { report('err', errorText(t, result.error)); return null }
            report('ok', t('ok.commit', { commit: result.value.commit }) + ' · ' + result.value.subject)
            setMessage('')
            setMessageTouched(false)
            return result.value
          })
        }).then(function (value) {
          return refresh().then(function () { return value })
        })
      }

      const doPush = function () {
        const branch = view ? view.branch : ''
        if (!branch) { report('err', t('panel.stageDetached')); return Promise.resolve(null) }
        return run(t('panel.job.push'), function () {
          return post('push', {
            path: path,
            branch: branch,
            setUpstream: !view || view.upstream === '',
          }).then(function (result) {
            if (!result.ok) { report('err', errorText(t, result.error)); return null }
            report('ok', t('ok.push', { branch: branch }))
            return result.value
          })
        }).then(function (value) {
          return refresh().then(function () { return value })
        })
      }

      const doMerge = function (source) {
        const wanted = mergeTarget
        return run(t('panel.job.merge'), function () {
          return post('merge', { path: path, source: source, target: wanted, push: true, fetch: true }).then(function (result) {
            if (!result.ok) {
              // A transport/route rejection still may carry blocking paths.
              const paths = errorPaths(result.error)
              if (paths.length > 0) {
                setConflict({ source: source, target: wanted, files: paths })
              }
              report('err', errorText(t, result.error))
              return null
            }
            const value = result.value
            setSteps(value.steps || [])
            if (value.ok === true) {
              report('ok', t('ok.merge', { target: value.target }) + (value.restored ? t('ok.mergeBack', { branch: source }) : ''))
              setConflict(null)
              return value
            }
            if (value.stage === 'conflict') {
              const files = value.conflicts || []
              setConflict({ source: value.source, target: value.target, files: files })
              // State the outcome plainly, then let the card list the files.
              report('err', t('panel.conflict.message', { source: value.source, target: value.target, count: files.length }))
              return null
            }
            // A non-conflict failure keeps its git detail (merge refused, push
            // rejected, dirty tree) so the notice is actionable rather than a
            // bare "合并失败".
            report('err', value.message || t('error.merge-failed'))
            return null
          })
        }).then(function (value) {
          return refresh().then(function () { return value })
        })
      }

      const doOneClick = function () {
        const branch = view ? view.branch : ''
        const wanted = mergeTarget
        return run(t('panel.job.oneClick'), function () {
          const all = selected === null || chosen.length === files.length
          // A clean worktree skips the commit instead of failing on an empty
          // message: the flow is "commit if there is anything to commit".
          const commitStep = files.length === 0
            ? Promise.resolve({ ok: true, skipped: true })
            : post('commit', {
                path: path,
                message: validation ? validation.message : autoMessage,
                all: all,
                paths: chosenPaths,
                // Never sweep untracked files into a one-click commit unless the
                // user explicitly expanded the list; scratch notes and caches
                // must not ride along with a merge.
                includeUntracked: showUntracked,
              })
          return commitStep.then(function (commitResult) {
            if (commitResult.skipped === true) {
              setSteps(function (previous) { return previous.concat(['commit 跳过（工作区干净）']) })
              return { ok: true }
            }
            if (!commitResult.ok && commitResult.error.code !== 'nothing-to-commit') {
              report('err', errorText(t, commitResult.error))
              return null
            }
            setSteps(function (previous) {
              return previous.concat([commitResult.ok ? 'commit ' + commitResult.value.commit : 'commit 跳过（无改动）'])
            })
            if (commitResult.ok) report('ok', t('ok.commit', { commit: commitResult.value.commit }))
            return post('push', { path: path, branch: branch, setUpstream: !view || view.upstream === '' })
          }).then(function (pushResult) {
            if (pushResult === null) return null
            if (!pushResult.ok) { report('err', errorText(t, pushResult.error)); return null }
            setSteps(function (previous) { return previous.concat(['push ' + branch]) })
            return post('merge', { path: path, source: branch, target: wanted, push: true, fetch: true })
          }).then(function (mergeResult) {
            if (mergeResult === null) return null
            if (!mergeResult.ok) {
              const paths = errorPaths(mergeResult.error)
              if (paths.length > 0) setConflict({ source: branch, target: wanted, files: paths })
              report('err', errorText(t, mergeResult.error))
              return null
            }
            const value = mergeResult.value
            setSteps(value.steps || [])
            if (value.ok === true) {
              report('ok', t('ok.merge', { target: value.target }) + (value.restored ? t('ok.mergeBack', { branch: branch }) : ''))
              setConflict(null)
              return value
            }
            if (value.stage === 'conflict') {
              const files = value.conflicts || []
              setConflict({ source: value.source, target: value.target, files: files })
              // Commit and push already happened, so say what did land and what
              // is blocked: a bare "合并失败" would hide both.
              report('err', t('panel.conflict.message', { source: value.source, target: value.target, count: files.length }))
              return null
            }
            // A non-conflict failure keeps its git detail (merge refused, push
            // rejected, dirty tree) so the notice is actionable rather than a
            // bare "合并失败".
            report('err', value.message || t('error.merge-failed'))
            return null
          })
        }).then(function (value) {
          return refresh().then(function () { return value })
        })
      }

      /**
       * Ask the model for a branch name from the plain-language description.
       *
       * The suggestion fills the two editable fields (prefix + description) so the
       * user still confirms the exact name before anything is created — the model
       * proposes, the user decides.
       */
      const doSuggestName = function () {
        const description = newDescription.trim()
        if (description === '') return
        setNameBusy(true)
        setNotice(null)
        post('suggest-branch-name', {
          description: description,
          prefix: newPrefix,
        }).then(function (result) {
          setNameBusy(false)
          if (!result.ok) { report('err', errorText(t, result.error)); return }
          const value = result.value
          if (!value.ok) {
            report('warn', (value.error || t('error.internal')) + (value.raw ? ' · ' + t('panel.create.aiRaw', { raw: value.raw }) : ''))
            return
          }
          const parts = String(value.branch).split('/')
          if (parts.length === 2 && PREFIXES.indexOf(parts[0]) !== -1) {
            setNewPrefix(parts[0])
            setNewName(parts[1])
          } else {
            setNewName(String(value.branch))
          }
          setCreatedBranch('')
          const repaired = (value.issues || []).some(function (item) { return item.code === 'prefix-repaired' })
          report(repaired ? 'warn' : 'ok', t('panel.create.aiSuggested', { branch: value.branch })
            + (repaired ? ' · ' + t('panel.create.aiRepaired') : ''))
        })
      }

      const doAi = function () {
        setAiBusy(true)
        setNotice(null)
        post('draft-message', {
          path: path,
          subject: effectiveMessage,
        }).then(function (result) {
          setAiBusy(false)
          if (!result.ok) { report('err', errorText(t, result.error)); return }
          const value = result.value
          if (!value.ok) {
            report('warn', value.error || t('error.internal'))
            return
          }
          setMessage(value.message)
          setMessageTouched(true)
          const fixable = (value.issues || []).filter(function (item) { return item.level === 'warn' })
          report(fixable.length > 0 ? 'warn' : 'ok', value.message + (fixable.length > 0 ? ' · ' + t('panel.message.fixable') : ' · ' + t('panel.message.valid')))
        })
      }

      const doFetch = function () {
        return run(t('panel.job.fetch'), function () {
          return post('fetch', { path: path }).then(function (result) {
            if (!result.ok) { report('err', errorText(t, result.error)); return null }
            const value = result.value
            // fetch moves remote-tracking refs only; say what the distance is
            // now, otherwise an unchanged screen reads as "the button did nothing".
            if (value.behind > 0) {
              report('warn', t('ok.fetchBehind', { behind: value.behind, ahead: value.ahead, branch: value.branch }))
            } else {
              report('ok', t('ok.fetch') + ' · ' + t('ok.fetchUpToDate', { branch: value.branch }))
            }
            return value
          })
        }).then(function (value) { return refresh().then(function () { return value }) })
      }

      const doPull = function () {
        return run(t('panel.job.pull'), function () {
          return post('pull', { path: path }).then(function (result) {
            if (!result.ok) { report('err', errorText(t, result.error)); return null }
            const value = result.value
            report('ok', value.fastForwarded
              ? t('ok.pullFastForward', { branch: value.branch, upstream: value.upstream })
              : t('ok.pullUpToDate', { branch: value.branch }))
            return value
          })
        }).then(function (value) { return refresh().then(function () { return value }) })
      }

      // Refresh the branch list from the remote: colleagues push new branches,
      // and a plain re-read would only show local refs. Fetch first, then
      // re-read, so a newly pushed branch actually appears.
      const doRefreshBranches = function () {
        return run(t('panel.job.branches'), function () {
          return post('fetch', { path: path })
            .then(function (result) {
              // A network failure must not stop the local re-read: the list the
              // user asked for is still worth showing.
              if (!result.ok) {
                report('warn', t('error.fetch-failed') + ' · ' + t('panel.branch.refreshLocalOnly'))
              }
              return null
            })
        }).then(function () {
          return refresh().then(function (value) {
            if (value !== null && view !== null) {
              report('ok', t('panel.branch.refreshed', { count: (value.branches || []).length }))
            }
            return value
          })
        })
      }

      const doSwitch = function (branch) {
        if (!view || branch === view.branch) return
        // No client-side "clean worktree" gate: git decides whether the switch
        // is safe (it carries untracked files and non-conflicting edits across)
        // and the host reports the exact blocking paths when it refuses.
        run(t('panel.job.switch'), function () {
          return post('switch', { path: path, branch: branch }).then(function (result) {
            if (!result.ok) { report('err', errorText(t, result.error)); return null }
            report('ok', t('ok.switch', { branch: branch }))
            return result.value
          })
        }).then(function (value) { return refresh().then(function () { return value }) })
      }

      const doDelete = function (branch, force) {
        run(t('panel.job.delete') || 'delete', function () {
          return post('delete-branch', { path: path, branch: branch, force: force === true }).then(function (result) {
            if (!result.ok) {
              if (result.error.code === 'delete-failed' && force !== true) {
                if (window.confirm(t('panel.branch.deleteForce'))) return doDelete(branch, true)
                return null
              }
              report('err', errorText(t, result.error))
              return null
            }
            report('ok', t('ok.delete', { branch: branch }))
            return result.value
          })
        }).then(function (value) { return refresh().then(function () { return value }) })
      }

      const doCreate = function () {
        const candidate = (newPrefix + '/' + newName).replace(/\/+$/, '')
        const check = validateBranchName(candidate, { allowEnvBranches: false })
        if (!check.ok) { report('err', t('error.invalid-branch-name')); return }
        run(t('panel.job.create'), function () {
          return post('create-branch', {
            path: path,
            name: check.name,
            baseline: createBaseline,
            // Creating a branch is only half the job: the team also needs it on
            // the remote, so push straight away unless the user unticked it.
            push: pushOnCreate,
          }).then(function (result) {
            if (!result.ok) { report('err', errorText(t, result.error)); return null }
            const value = result.value
            setCreatedBranch(check.name)
            if (pushOnCreate) {
              if (value.pushed === true) {
                report('ok', t('ok.createPushed', { branch: value.branch }))
              } else if (typeof value.pushError === 'string' && value.pushError !== '') {
                report('warn', t('ok.createNoPush', { branch: value.branch, error: value.pushError }))
              } else {
                report('ok', t('ok.create', { branch: value.branch }))
              }
            } else {
              report('ok', t('ok.create', { branch: value.branch }))
            }
            setNewName('')
            setNewDescription('')
            return value
          })
        }).then(function (value) { return refresh().then(function () { return value }) })
      }

      const doContinueMerge = function () {
        run(t('panel.job.finishMerge'), function () {
          // The host stages the resolved files, commits the merge, and pushes the
          // target branch in one step: "model fixed it" should end with the
          // remote updated, not with a second manual click.
          return post('merge-continue', { path: path, push: true }).then(function (result) {
            if (!result.ok) { report('err', errorText(t, result.error)); return null }
            const value = result.value
            setConflict(null)
            if (value.pushed === true) {
              report('ok', t('ok.continuePushed', { commit: value.commit, branch: value.branch }))
            } else if (typeof value.pushError === 'string' && value.pushError !== '') {
              report('warn', t('ok.continueNoPush', { commit: value.commit, error: value.pushError }))
            } else {
              report('ok', t('ok.continue', { commit: value.commit }))
            }
            return value
          })
        }).then(function (value) { return refresh().then(function () { return value }) })
      }

      const doAbortMerge = function () {
        run(t('panel.job.merge'), function () {
          return post('merge-abort', { path: path }).then(function (result) {
            if (!result.ok) { report('err', errorText(t, result.error)); return null }
            setConflict(null)
            report('ok', t('ok.abort'))
            return result.value
          })
        }).then(function (value) { return refresh().then(function () { return value }) })
      }

      const doSendConflict = function () {
        if (!conflict) return
        const text = buildConflictPrompt(conflict.source, conflict.target, conflict.files)
        const landed = typeof send === 'function' ? send(text) : false
        report(landed ? 'ok' : 'warn', landed ? t('panel.conflict.sent') : t('error.transport'))
      }

      const toggleFile = function (filePath) {
        setSelected(function (previous) {
          const next = new Set(previous || [])
          if (next.has(filePath)) next.delete(filePath)
          else next.add(filePath)
          return next
        })
      }

      const busyNow = busy !== ''
      const branch = view ? view.branch : ''
      const target = view ? (view.stageBranch || 'stage') : 'stage'
      const baseline = view ? (view.productionBranch || 'production6') : 'production6'
      // The repository may not carry the configured baseline (production6 is a
      // convention, not a fact in every checkout). When it is missing the panel
      // asks once for an ASCII baseline instead of failing every create.
      const baselineAvailable = view === null ? true : view.baselineAvailable !== false
      const createBaseline = baselineAvailable ? baseline : (baselineOverride || '')
      // Every local branch except the current one is a legal merge target; the
      // protected baseline is refused by the host even if it were listed.
      const mergeTargets = view === null
        ? [target]
        : view.branches
            .map(function (item) { return item.name })
            .filter(function (name) { return name !== branch })
      const mergeBlocked = view === null
        ? 'detached'
        : branch === ''
          ? 'detached'
          : branch === baseline
            ? 'baseline'
            : mergeTargets.length === 0
              ? 'no-target'
              : ''
      const canMerge = mergeBlocked === '' && mergeTarget !== '' && mergeTarget !== branch
      // Full baseline list with a search box: a repository may carry dozens of
      // branches, and the picker must reach every one of them. The filtering
      // hook lives with the other hooks above the early return.

      const chooseBaseline = function (name) {
        setBaselineOverride(name)
        try {
          if (path) window.localStorage?.setItem('dsh-branch-flow:baseline:' + path, name)
        } catch {
          // Storage refusal is not a reason to block the picker.
        }
      }
      const newCheck = validateBranchName(newPrefix + '/' + newName, { allowEnvBranches: false })

      const body = view === null
        ? h('div', { className: 'bf-card' }, h('span', { className: 'bf-hint' }, loading ? t('panel.loading') : t('bar.notRepo')))
        : h(React.Fragment, null,
            conflict !== null
              ? h('div', { className: 'bf-card bf-card-conflict' },
                  h('div', { className: 'bf-card-title' },
                    h('span', { className: 'bf-conflict-dot' }),
                    t('panel.section.conflict'),
                    conflict.files.length > 0
                      ? h('span', { className: 'bf-group-count' }, conflict.files.length)
                      : null,
                  ),
                  conflict.files.length > 0
                    ? h('div', { className: 'bf-hint' }, t('panel.conflict.message', { source: conflict.source, target: conflict.target, count: conflict.files.length }))
                    // Restored from the host: the merge is still open but nothing
                    // is in conflict any more, so only the commit remains.
                    : h('div', { className: 'bf-hint' }, t('panel.conflict.resolvedPending', { target: conflict.target })),
                  conflict.files.length > 0
                    ? h(React.Fragment, null,
                        h('div', { className: 'bf-hint' }, t('panel.conflict.manual')),
                        h('div', { className: 'bf-files bf-files-conflict' }, conflict.files.map(function (file) {
                          return h('div', { key: file, className: 'bf-file' }, h('span', { className: 'path', title: file }, file))
                        })),
                      )
                    : null,
                  h('div', { className: 'bf-row' },
                    conflict.files.length > 0
                      ? h('button', { type: 'button', className: 'bf-btn primary', onClick: doSendConflict, disabled: busyNow, title: t('panel.conflict.sendHint') }, t('panel.conflict.send'))
                      : null,
                    h('button', { type: 'button', className: 'bf-btn primary', onClick: doContinueMerge, disabled: busyNow }, t('panel.conflict.continue')),
                    h('button', { type: 'button', className: 'bf-btn danger', onClick: doAbortMerge, disabled: busyNow }, t('panel.conflict.abort')),
                  ),
                )
              : null,

            h('div', { className: 'bf-card' },
              h('div', { className: 'bf-card-title' },
                t('panel.section.commit'),
                h('span', { className: 'bf-spacer' }),
                hiddenUntracked > 0
                  ? h('button', {
                      type: 'button',
                      className: 'bf-toggle',
                      onClick: function () { setShowUntracked(function (value) { return !value }) },
                      disabled: busyNow,
                      title: t('panel.files.untrackedHint', { count: hiddenUntracked }),
                    }, (showUntracked ? '✓ ' : '') + t('panel.files.untracked', { count: hiddenUntracked }))
                  : null,
              ),
              allFiles.length === 0
                ? h('div', { className: 'bf-hint' }, t('panel.noFiles'))
                : files.length === 0
                  ? h('div', { className: 'bf-hint' }, t('panel.onlyUntracked', { count: hiddenUntracked }))
                  : h(React.Fragment, null,
                      h('div', { className: 'bf-row' },
                        h('span', { className: 'bf-hint' }, t('panel.files', { count: files.length })),
                        h('span', { className: 'bf-spacer' }),
                        h('button', {
                          type: 'button', className: 'bf-btn',
                          onClick: function () { setSelected(new Set(files.map(function (file) { return file.path }))) },
                        }, t('panel.files.all')),
                        h('button', {
                          type: 'button', className: 'bf-btn',
                          onClick: function () { setSelected(new Set()) },
                        }, t('panel.files.none')),
                      ),
                      h('div', { className: 'bf-files' }, files.map(function (file) {
                        const checked = selected !== null && selected.has(file.path)
                        return h('label', { key: file.path, className: 'bf-file' },
                          h('input', {
                            type: 'checkbox',
                            checked: checked,
                            onChange: function () { toggleFile(file.path) },
                          }),
                          h('span', { className: 'path', title: file.path }, file.path),
                          file.conflict ? h('span', { className: 'bf-tag conflict' }, 'conflict') : null,
                          file.untracked ? h('span', { className: 'bf-tag' }, t('panel.file.new')) : h('span', { className: 'bf-tag' }, (file.index || '').trim() || 'M'),
                        )
                      })),
                    ),
              h('div', { className: 'bf-row' },
                h('span', { className: 'bf-hint' }, t('panel.message')),
                h('input', {
                  className: 'bf-input msg',
                  value: messageTouched ? message : autoMessage,
                  placeholder: t('panel.message.placeholder'),
                  onChange: function (event) { setMessage(event.target.value); setMessageTouched(true) },
                  spellCheck: false,
                  disabled: busyNow,
                }),
                h('button', {
                  type: 'button', className: 'bf-btn',
                  onClick: function () { setMessage(autoMessage); setMessageTouched(true) },
                  disabled: busyNow || autoMessage === '',
                }, t('panel.message.auto')),
                h('button', {
                  type: 'button', className: 'bf-btn',
                  onClick: doAi,
                  disabled: busyNow || aiBusy,
                }, aiBusy ? t('panel.message.aiBusy') : t('panel.message.ai')),
              ),
              validation === null
                ? null
                : h('div', {
                    className: 'bf-hint ' + (validation.ok ? (validation.issues.length > 0 ? 'ok' : 'ok') : 'err'),
                  },
                    validation.ok
                      ? (validation.issues.length > 0 ? t('panel.message.fixable') : t('panel.message.valid')) + ' · ' + validation.message
                      : validation.issues.filter(function (item) { return item.level === 'error' })
                          .map(function (item) { return t('panel.message.' + item.code) !== 'panel.message.' + item.code ? t('panel.message.' + item.code) : item.code })
                          .join('、'),
                  ),
              h('div', { className: 'bf-row' },
                h('button', {
                  type: 'button', className: 'bf-btn primary',
                  onClick: doCommit,
                  disabled: busyNow || files.length === 0 || validation === null || !validation.ok,
                }, t('panel.commit')),
                h('button', {
                  type: 'button', className: 'bf-btn',
                  onClick: doPush,
                  disabled: busyNow || branch === '',
                }, view && view.upstream === '' ? t('panel.pushSetUpstream') : t('panel.push')),
              ),
            ),

            h('div', { className: 'bf-card' },
              h('div', { className: 'bf-card-title' }, t('panel.section.merge', { target: mergeTarget })),
              h('div', { className: 'bf-row' },
                h('span', { className: 'bf-hint' }, t('panel.mergeInto')),
                h('select', {
                  className: 'bf-select bf-select-grow',
                  value: mergeTarget,
                  onChange: function (event) { setMergeTarget(event.target.value) },
                  disabled: busyNow,
                  title: mergeTarget,
                }, mergeTargets.map(function (item) {
                  return h('option', { key: item, value: item }, item)
                })),
              ),
              // The route is shown as two pills rather than one long sentence:
              // a long branch name truncates inside its own pill instead of
              // stretching the row and pushing the arrow off-centre.
              h('div', { className: 'bf-route' },
                h('span', { className: 'bf-route-pill', title: branch || t('bar.detached') }, branch || t('bar.detached')),
                h('span', { className: 'bf-route-arrow' }, '→'),
                h('span', { className: 'bf-route-pill is-target', title: mergeTarget }, mergeTarget),
              ),
              h('div', { className: 'bf-hint' },
                mergeBlocked === 'baseline'
                  ? t('panel.stageProtected', { branch: branch })
                  : mergeBlocked === 'detached'
                    ? t('panel.stageDetached')
                    : mergeBlocked === 'no-target'
                      ? t('panel.stageOnStage', { target: target })
                      : ''),
              h('div', { className: 'bf-row' },
                h('button', {
                  type: 'button', className: 'bf-btn primary',
                  onClick: doOneClick,
                  disabled: busyNow || !canMerge,
                  title: t('panel.oneClick.title', { target: mergeTarget }),
                }, t('panel.oneClick', { target: mergeTarget })),
                h('button', {
                  type: 'button', className: 'bf-btn',
                  onClick: function () { doMerge(branch) },
                  disabled: busyNow || !canMerge,
                }, t('panel.merge', { target: mergeTarget })),
                h('button', {
                  type: 'button', className: 'bf-btn',
                  onClick: doPull,
                  disabled: busyNow || branch === '',
                  title: t('panel.pull.title'),
                }, t('panel.pull')),
                h('button', {
                  type: 'button', className: 'bf-btn',
                  onClick: doFetch,
                  disabled: busyNow,
                  title: t('panel.fetch.title'),
                }, t('panel.fetch')),
              ),
              steps.length > 0 ? h('div', { className: 'bf-steps' }, steps.map(function (step, index) {
                return h('div', { key: String(index) }, '· ' + step)
              })) : null,
            ),

            h('div', { className: 'bf-card' },
              h('div', { className: 'bf-card-title' },
                t('panel.section.branches'),
                h('span', { className: 'bf-spacer' }),
                h('button', {
                  type: 'button',
                  className: 'bf-btn',
                  onClick: doRefreshBranches,
                  disabled: busyNow,
                  title: t('panel.branch.refreshHint'),
                }, busy === t('panel.job.branches') ? t('panel.job.branches') : t('panel.branch.refresh')),
              ),

              // One search box for both groups: a repository can carry hundreds
              // of branches, and scrolling two lists to find one is the slow
              // path this exists to remove.
              h('div', { className: 'bf-search' },
                h('span', { className: 'bf-search-icon' }, '⌕'),
                h('input', {
                  className: 'bf-search-input',
                  value: branchQuery,
                  placeholder: t('panel.branch.search'),
                  onChange: function (event) { setBranchQuery(event.target.value) },
                  spellCheck: false,
                  'aria-label': t('panel.branch.search'),
                }),
                branchQuery !== ''
                  ? h('button', {
                      type: 'button',
                      className: 'bf-search-clear',
                      onClick: function () { setBranchQuery('') },
                      title: t('panel.branch.searchClear'),
                      'aria-label': t('panel.branch.searchClear'),
                    }, '✕')
                  : null,
              ),

              // Two explicit groups instead of one list with a caption: local
              // branches are what you work on, remote-only ones are what a
              // colleague pushed and you have not created locally yet.
              h('div', { className: 'bf-group' },
                h('button', {
                  type: 'button',
                  className: 'bf-group-head',
                  onClick: function () { setShowLocal(function (value) { return !value }) },
                  'aria-expanded': showLocal ? 'true' : 'false',
                },
                  h('span', { className: 'bf-group-caret' + (showLocal ? ' is-open' : '') }, '▸'),
                  h('span', { className: 'bf-group-name' }, t('panel.branch.groupLocal')),
                  h('span', { className: 'bf-group-count' }, filteredLocal.length),
                ),
                showLocal
                  ? h('div', { className: 'bf-list' }, filteredLocal.length === 0
                      ? h('div', { className: 'bf-hint' }, branchQuery !== '' ? t('panel.branch.noMatch') : t('panel.branch.empty'))
                      : filteredLocal.map(function (item) {
                          return h('div', { key: item.name, className: 'bf-item' },
                            h('span', { className: 'name', title: item.name }, item.name),
                            item.current ? h('span', { className: 'bf-tag' }, t('panel.branch.current')) : null,
                            item.environment ? h('span', { className: 'bf-tag' }, t('panel.branch.environment')) : null,
                            h('span', { className: 'bf-spacer' }),
                            h('span', { className: 'meta' }, item.updated),
                            item.ahead > 0 ? h('span', { className: 'meta' }, '↑' + item.ahead) : null,
                            item.behind > 0 ? h('span', { className: 'meta' }, '↓' + item.behind) : null,
                            item.current
                              ? null
                              : h('button', {
                                  type: 'button', className: 'bf-btn',
                                  onClick: function () { doSwitch(item.name) },
                                  disabled: busyNow,
                                }, t('panel.branch.switch')),
                            !item.current && !item.protected
                              ? h('button', {
                                  type: 'button', className: 'bf-btn danger',
                                  onClick: function () {
                                    if (!window.confirm(t('panel.branch.deleteConfirm', { branch: item.name }))) return
                                    doDelete(item.name, false)
                                  },
                                  disabled: busyNow,
                                }, t('panel.branch.delete'))
                              : null,
                          )
                        }),
                    )
                  : null,
              ),

              h('div', { className: 'bf-group' },
                h('button', {
                  type: 'button',
                  className: 'bf-group-head',
                  onClick: function () { setShowRemote(function (value) { return !value }) },
                  'aria-expanded': showRemote ? 'true' : 'false',
                },
                  h('span', { className: 'bf-group-caret' + (showRemote ? ' is-open' : '') }, '▸'),
                  h('span', { className: 'bf-group-name' }, t('panel.branch.groupRemote')),
                  h('span', { className: 'bf-group-count' }, filteredRemote.length),
                ),
                showRemote
                  ? h('div', { className: 'bf-list' }, filteredRemote.length === 0
                      ? h('div', { className: 'bf-hint' }, branchQuery !== '' ? t('panel.branch.noMatch') : t('panel.branch.remoteEmpty'))
                      : filteredRemote.map(function (item) {
                          return h('div', { key: 'remote:' + item.name, className: 'bf-item' },
                            h('span', { className: 'name', title: item.name }, item.name),
                            h('span', { className: 'bf-spacer' }),
                            h('span', { className: 'meta' }, item.updated),
                            h('button', {
                              type: 'button', className: 'bf-btn',
                              onClick: function () { doSwitch(item.name) },
                              disabled: busyNow,
                            }, t('panel.branch.switch')),
                          )
                        }),
                    )
                  : null,
              ),
            ),

            h('div', { className: 'bf-card' },
              h('div', { className: 'bf-card-title' }, t('panel.section.create')),

              // Describe the requirement in plain language; the model proposes a
              // rule-conforming name that the user then confirms and creates.
              h('div', { className: 'bf-row' },
                h('input', {
                  className: 'bf-input',
                  style: { flex: '1', minWidth: '200px' },
                  value: newDescription,
                  placeholder: t('panel.create.describePlaceholder'),
                  onChange: function (event) { setNewDescription(event.target.value) },
                  onKeyDown: function (event) {
                    if (event.key === 'Enter' && !busyNow && !nameBusy) {
                      event.preventDefault()
                      doSuggestName()
                    }
                  },
                  spellCheck: false,
                  disabled: busyNow || nameBusy,
                }),
                h('button', {
                  type: 'button', className: 'bf-btn',
                  onClick: doSuggestName,
                  disabled: busyNow || nameBusy || newDescription.trim() === '',
                  title: t('panel.create.aiHint'),
                }, nameBusy ? t('panel.create.aiBusy') : t('panel.create.ai')),
              ),

              h('div', { className: 'bf-row' },
                h('select', {
                  className: 'bf-select',
                  value: newPrefix,
                  onChange: function (event) { setNewPrefix(event.target.value) },
                  disabled: busyNow || nameBusy,
                }, PREFIXES.map(function (prefix) { return h('option', { key: prefix, value: prefix }, prefix + '/') })),
                h('input', {
                  className: 'bf-input',
                  style: { flex: '1', minWidth: '180px' },
                  value: newName,
                  placeholder: t('panel.create.placeholder'),
                  onChange: function (event) { setNewName(event.target.value) },
                  spellCheck: false,
                  disabled: busyNow || nameBusy,
                }),
              ),

              // Confirm row: create from the baseline, switch to it, and push it
              // so the branch exists on the remote immediately.
              h('div', { className: 'bf-row' },
                h('label', { className: 'bf-check' },
                  h('input', {
                    type: 'checkbox',
                    checked: pushOnCreate,
                    onChange: function (event) { setPushOnCreate(event.target.checked) },
                    disabled: busyNow || nameBusy,
                  }),
                  h('span', null, t('panel.create.pushAfterCreate')),
                ),
                h('span', { className: 'bf-spacer' }),
                h('button', {
                  type: 'button', className: 'bf-btn primary',
                  onClick: doCreate,
                  disabled: busyNow || nameBusy || newName.trim() === '' || !newCheck.ok || createBaseline === '' || createdBranch !== '',
                }, createdBranch !== ''
                  ? t('panel.create.created')
                  : t('panel.create.confirm', { baseline: createBaseline || baseline })),
              ),
              baselineAvailable
                ? h('div', { className: 'bf-row' },
                    h('span', { className: 'bf-hint' }, t('panel.create.baseline') + '：'),
                    h('span', { className: 'bf-mono' }, baseline),
                    h('span', { className: 'bf-spacer' }),
                      h('span', { className: 'bf-hint' }, t('panel.create.hint', { baseline: baseline, target: target })),
                    )
                  : h('div', { className: 'bf-row' },
                      h('span', { className: 'bf-hint err' }, t('panel.create.missingBaseline', { baseline: baseline })),
                    ),
              h('div', { className: 'bf-hint' }, t('panel.create.fetchesFirst', { baseline: createBaseline || baseline })),
              !baselineAvailable
                ? h(React.Fragment, null,
                    h('div', { className: 'bf-row' },
                      h('span', { className: 'bf-hint' }, t('panel.create.pickBaseline')),
                      h('input', {
                        className: 'bf-input',
                        style: { flex: '1', minWidth: '160px' },
                        value: baselineQuery,
                        placeholder: t('panel.create.searchBaseline'),
                        onChange: function (event) { setBaselineQuery(event.target.value) },
                        spellCheck: false,
                        disabled: busyNow,
                      }),
                      h('span', { className: 'bf-hint' }, t('panel.create.baselineCount', { shown: filteredBaselines.length, total: (view.baselineCandidates || []).length })),
                    ),
                    h('div', { className: 'bf-files' }, filteredBaselines.length === 0
                      ? h('div', { className: 'bf-hint' }, t('panel.create.noBaselineMatch'))
                      : filteredBaselines.map(function (name) {
                          return h('label', {
                            key: name,
                            className: 'bf-file' + (name === baselineOverride ? ' bf-file-active' : ''),
                          },
                            h('input', {
                              type: 'radio',
                              name: 'bf-baseline',
                              checked: name === baselineOverride,
                              onChange: function () { chooseBaseline(name) },
                              disabled: busyNow,
                            }),
                            h('span', { className: 'path', title: name }, name),
                          )
                        })),
                  )
                : null,
              newName.trim() === ''
                ? null
                : h('div', { className: 'bf-hint ' + (newCheck.ok ? 'ok' : 'err') },
                    (newCheck.ok ? '✓ ' : '✕ ') + newCheck.name
                    + (newCheck.ok ? '' : ' · ' + describeIssues(t, newCheck.issues))),
            ),
          )

      return h(React.Fragment, null,
        h(Styles),
        h('div', { className: 'bf-backdrop', onClick: function () { if (!busyNow) store.set({ open: false }) } }),
        h('div', { className: 'bf-panel', role: 'dialog', 'aria-label': t('panel.title'), 'data-dsh-plugin': 'branch-flow', 'data-dsh-part': 'panel' },
          h('div', { className: 'bf-head' },
            h('span', { className: 'bf-title' }, t('panel.title')),
            view === null ? null : h('span', { className: 'bf-sub' }, t('panel.subtitle', { baseline: baseline, target: target })),
            view === null ? null : h('span', { className: 'bf-branch-pill' }, branch === '' ? t('bar.detached') : branch),
            h('span', { className: 'bf-spacer' }),
            h('button', {
              type: 'button', className: 'bf-btn',
              onClick: function () { refresh() },
              disabled: busyNow,
            }, t('panel.refresh')),
            h('button', {
              type: 'button', className: 'bf-btn bf-close',
              onClick: function () { store.set({ open: false }) },
              disabled: busyNow,
            }, t('panel.close')),
          ),
          notice !== null ? h('div', { style: { padding: '10px 16px 0' } },
            h('div', { className: 'bf-notice ' + (notice.kind === 'ok' ? 'ok' : notice.kind === 'warn' ? 'warn' : 'err') }, notice.text),
          ) : null,
          busyNow ? h('div', { style: { padding: '10px 16px 0' } }, h('div', { className: 'bf-notice' }, busy)) : null,
          h('div', { className: 'bf-body' }, body),
        ),
      )
    }

    function describeIssues(t, issues) {
      const labels = {
        'empty': '分支名不能为空',
        'too-long': '超过 50 个字符',
        'charset': '只允许英文、数字、- 和 /',
        'missing-prefix': '缺少 feature/ 等前缀',
        'bad-prefix': '前缀必须是 feature/、bugfix/、hotfix/、release/',
        'nested': '前缀后只接一段简述',
        'too-short': '简述至少 3 个字符',
        'numeric-word': '不能有纯数字单词',
        'meaningless': '不能是 tmp/aaa/new 之类无意义名称',
        'env-semantic': '禁止自造环境语义（prod/test/uat）',
        'short-word': '单词太短',
      }
      return issues
        .filter(function (item) { return item.level === 'error' })
        .map(function (item) { return labels[item.code] || item.code })
        .filter(function (value, index, all) { return all.indexOf(value) === index })
        .join('、')
    }
    //#endregion

    //#region apply
    function apply(ctx) {
      ctx.effect(function () {
        try {
          return ctx.locale.register(NS, { zh: zh, en: en })
        } catch {
          return function () {}
        }
      }, 'dsh-branch-flow: dictionaries')

      ctx.inject(['slots', 'sessions'], function (scope) {
        // The chip seats in the composer tool row, immediately left of the model
        // selector (`conversation.input.right` renders just before
        // `conversation.input.model`). The dock above the composer stays free.
        try {
          scope.slots.inject('conversation.input.right', function () {
            try {
              return scope.slots.register({
                name: 'conversation.input.right',
                id: 'branch-flow',
                order: 90,
                locale: NS,
              }, BranchBar)
            } catch {
              return function () {}
            }
          })
        } catch {
          // The slot is undeclared in this shell; the chip stays unavailable.
        }

        try {
          scope.slots.inject('shell.overlay', function () {
            try {
              return scope.slots.register({
                name: 'shell.overlay',
                id: 'branch-flow-panel',
                order: 120,
                locale: NS,
              }, BranchPanel)
            } catch {
              return function () {}
            }
          })
        } catch {
          // No frame-wide overlay declared; nothing to render.
        }
      })
    }
    //#endregion

    return {
      inject: ['slots', 'locale'],
      apply: apply,
    }
  },
})
