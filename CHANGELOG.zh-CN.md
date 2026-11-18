# 变更记录

[English](CHANGELOG.md) · 中文

这里记录所有值得注意的变更。版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## 0.2.0 — 2026-10-29

### 修复

**面板不再越用越慢，也不再拖住整个客户端。**

根因既不在 git，也不在仓库规模。原来每次 git 调用都走宿主的 `ctx.subprocess.spawn`，它为每个子进程单独起一个 Electron runner 进程、再挂一个 Windows Job 对象。在 Windows 11 上实测，这个开销是**固定每次约 1.3 秒**，而裸 `git status` 只要 25–130 毫秒。一次 `view` 需要 5 次这样的调用，一次合并约 14 次，面板又是每 10 秒轮询一次——于是单次刷新 6.7 秒，并发请求互相排队，表现就是整个客户端卡死。

- `lib/git.js` —— `gitRunner` 改为用 `node:child_process.spawn` 直接起 `git`：固定 argv 数组、不经 shell、`cwd` 仍是已经校验过的工作区根。保留 1 MiB 输出上限、60 秒超时终止与 `AbortSignal` 支持，并设置 `GIT_TERMINAL_PROMPT=0` 与 `GIT_PAGER=cat`，保证凭据或分页提示永远不会挂住请求。
- `index.js` —— `inject` 不再声明 `subprocess`，只保留 `webServer` 与 `workspaceRegistry`。
- `view()` —— spawn 从 12 次降到 5 次：一次 `rev-parse` 同时取出仓库根与所有操作标记，分支名/HEAD/upstream/领先落后全部来自一次 `status --porcelain=v2 --branch`，一次 `for-each-ref` 同时覆盖本地与远端分支。
- 未跟踪文件改用 `--untracked-files=normal` 而不是 `all`。一堆构建产物或 `__pycache__` 会折叠成一行，几千个文件之后 payload 仍稳定在 1 KB 左右，而不是膨胀到 3 MB。
- `client.js` —— 轮询加了 in-flight 守卫，慢请求不会被下一次轮询叠加。结果按签名比对，未变化时直接跳过 `setView`，分支行不会重渲染。合并目标下拉限 40 项并按当前分支 / 目标分支 / stage 优先排列，不再把仓库里每一个分支都渲染成选项。

### 实测

| 场景 | 修复前 | 修复后 |
| --- | --- | --- |
| 大仓库（9 个本地 / 423 个远端分支） | 6726 毫秒 | 372–395 毫秒 |
| 中等仓库（18 个本地 / 9 个远端分支） | 9323 毫秒 | 259–260 毫秒 |
| 8 个并发 `view` | 每个 4.85 秒 | 每个 0.91–0.97 秒 |
| 宿主 subprocess runner 进程数 | 每次调用一个 | 0 |

安全边界未变，且已重新验证：工作区校验（未注册路径返回 `workspace-unknown`）、回环围栏、非 JSON 请求返回 `415`、`-D` 或 `--upload-pack` 这类参数返回 `invalid-ref-name`。

### 新增

- `scripts/verify-status-parser.mjs` —— 针对真实 `git status --porcelain=v2` 输出的 26 条断言：干净、已修改、已暂存重命名、未跟踪目录折叠与展开、领先/落后、分叉、冲突行。
- 测量脚本：`measure-view.mjs`、`soak-view.mjs`、`simulate-poll.mjs`、`measure-branch-cost.mjs`、`measure-untracked-cost.mjs`、`watch-handles.mjs`。

### 文档

- 拆分为 `README.md`（英文，默认展示）与 `README.zh-CN.md`，补充界面截图、插件市场收录条目与 180×180 图标。

## 0.1.0 — 2026-10-22

首个打 tag 的版本。
