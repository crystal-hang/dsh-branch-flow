# dsh-branch-flow

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%3E%3D0.2.1--rc.2-4c6ef5)](https://github.com/crystal-hang/dsh-branch-flow)
[![Version](https://img.shields.io/github/v/tag/crystal-hang/dsh-branch-flow?label=version&sort=semver)](https://github.com/crystal-hang/dsh-branch-flow/tags)
[![Runtime deps](https://img.shields.io/badge/runtime%20deps-0-brightgreen)](package.json)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey)](#安装)

分支流程面板（DSH Web GUI 插件）。常驻在输入框上方的一条状态条，点开是完整的分支 / 提交 / 合并面板。

它替你做掉「改完代码后手动 commit、写提交信息、切分支、拉最新、合并、push」这一串机械动作，并且把手写的分支名和提交信息按团队规范即时校验。

## 截图

> 📷 **截图待补充。** 建议按下面三张补齐（放进 `docs/` 目录），然后把本段替换为对应的 `![说明](docs/文件名)`：
>
> | 位置 | 建议内容 | 文件名 |
> |---|---|---|
> | 1 | 输入框内的分支徽标（状态点 + 领先/落后） | `docs/screenshot-chip.png` |
> | 2 | 展开后的面板（提交 / 合并 / 分支列表三张卡片） | `docs/screenshot-panel.png` |
> | 3 | 冲突时的红色卡片（文件清单 + 三个按钮） | `docs/screenshot-conflict.png` |
>
> 不想放截图就保留这段文字占位——它不会产生破图。

## 安装

这是一个 DSH profile bundle。三种安装方式任选：

```sh
# 1) 从 GitHub 安装（推荐，可锁定版本）
dsh plugin --profile <profile> add github:crystal-hang/dsh-branch-flow#v0.1.0

# 2) 从 GitHub 安装最新 main
dsh plugin --profile <profile> add github:crystal-hang/dsh-branch-flow

# 3) 从本地目录安装（开发/自用）
dsh plugin --profile <profile> add link:/path/to/dsh-branch-flow

# 4) 从 npm 安装（若已发布）
dsh plugin --profile <profile> add dsh-branch-flow
```

也可以把整个目录交给 `plugin_manager` 的 `install_bundle`（`target` 传绝对路径）。

> 用 `#v0.1.0` 这类 tag 安装时，`npm install` 会把仓库切到该 tag 的提交，因此版本可复现；不写 tag 则跟随 `main` 最新提交，适合跟进开发。

安装后需要**刷新页面**，徽标出现在输入框内、模型选择器左侧。

### 版本

当前版本见 [`package.json`](package.json) 的 `version` 字段与 [Releases](https://github.com/crystal-hang/dsh-branch-flow/releases)。升级时把上面的 tag 换成新版本号即可。

### 依赖

- DSH `>=0.2.1-rc.2`（`dsh.engines.dsh`）
- 宿主需提供 `webServer`、`subprocess`、`workspaceRegistry` 三个服务
- AI 功能（生成分支名 / 提交信息）需要宿主装配了 `llm` 与 `agentDefaultModel`；缺失时会明确报错而不是静默失败

## 界面

- **状态徽标**（输入框内，模型选择器紧邻左侧）：分支名 + 状态点（绿=干净、黄=有改动、红=有冲突）+ 改动数 + `↑`/`↓` 领先落后；点它打开面板。输入框上方那一行不再占用。
- **面板**：提交改动 → 推送分支 → 合并到指定分支（标题不带序号），另有分支列表与新建分支。所有操作都是你点按钮触发，插件不注册任何模型工具。
- **分支列表分成两个可折叠分组**：
  - **本地分支**（默认展开）：可切换 / 删除。
  - **远端分支**（**默认折叠**）：同事已推、你本地还没建过的分支（`origin/*` 里有、`refs/heads` 里没有）。一个活跃仓库可能有几百个，所以默认收起；点「切换」会自动建本地跟踪分支（`git switch -c <名> --track origin/<名>`）。
  - 两组各带自己的数量徽章（标题只写组名和数量，没有额外说明文字）。
- **分支搜索**：一个输入框同时过滤两组（大小写不敏感的子串匹配），带一键清空。搜索时两组始终可展开，即使某个分组被折叠，它的数量徽章也会显示命中数，让你知道去展开它。
- **刷新分支**：标题栏按钮，先 `git fetch --prune` 再重新读取，所以同事新推的分支立刻出现。
- 每个分支行只显示 **分支名 + 标签 + 相对时间**（不再显示 commit hash）。
- **提交改动只列已纳入 Git 的文件**（修改 / 新增 / 删除 / 重命名）。未跟踪文件默认隐藏——工作区里常有 `AGENTS.md`、`__pycache__/*.pyc`、构建产物这类没进 Git 的东西；卡片右上角显示「未纳入 Git 的文件 N 个」，需要提交新文件时点一下展开。

徽标挂在 `conversation.input.right`，宿主把它渲染在 `conversation.input.model` 之前，所以它就在模型选择器左边、同一行的按钮尺寸（28px 高）。

徽标宽度**随内容自适应**（`flex: 0 1 auto`，不写死宽度），上限是 `min(45vw, 420px)`——420px 足够放规则允许的 50 字符分支名，45vw 保证窄窗口下不过界。只有真的放不下时才在末尾省略，且鼠标悬停会显示完整分支名。

样式只引用宿主主题变量（`--dsw-*`），亮/暗主题自动跟随。

## 视觉规范

控件统一成一套语法：**胶囊几何 + 品牌色淡底 + hover 加深填充**（不再只是换边框颜色）。

- **按钮**：28px 高、全圆角、1px 描边、品牌色 8% 淡底；hover 时描边加深、底色加深并浮起 1px 阴影，按下有 0.5px 位移。
- **主按钮**（提交 / 一键 / 合并 / 创建）：唯一的饱和面，品牌色上下渐变 + 边框透明 + 品牌色投影，hover 加深并扩大光晕。
- **危险按钮**（删除 / 放弃合并）：平时只是淡红描边淡底，hover 才加强——它执行具有破坏性的操作，不该一直很抢眼。
- **状态徽标**：品牌色淡底胶囊，状态点是绿/黄/红并带同色柔光。
- **输入框 / 下拉 / 搜索框（iOS 风格）**：去掉系统控件外观（`appearance:none`），改成**填充式无边框**——6% 中性淡底 + 10px 大圆角 + 轻微内阴影；聚焦时底色变实、长出一圈 4px 半透明品牌光环，而不是描粗边框。下拉列表用 CSS 画的自定义箭头（去掉系统箭头），并留出 30px 让位。
- **面板 / 卡片**：面板 20px 圆角、深投影 + 内描边；卡片 16px 圆角、无硬边框，靠 3% 中性淡底和 1px 内描边分层。
- **提示条**：成功/警告/错误各自带对应色的淡底与描边。

字体栈统一用系统字体（`-apple-system, BlinkMacSystemFont, ui-sans-serif, system-ui`），这是 iOS 观感的一半——同一套几何配系统字体才不显得像网页控件。

所有颜色都用 `color-mix()` 从**主题 token** 派生（例如 `color-mix(in srgb, var(--dsw-alias-brand-primary) 8%, var(--dsw-alias-bg-layer-2))`），没有写死任何一套浅色/深色配色，所以亮暗主题都会各自算出合适色阶。`prefers-reduced-motion` 下动画与位移全部关闭。

## 分支规则（创建时强制）

1. 一律小写，单词之间用 `-`；禁止下划线、驼峰、空格。
2. 只允许英文、数字、`-`、`/`；禁止中文与特殊符号。
3. 单名不超过 50 字符。
4. 除 `production6`、`stage` 外禁止自造环境语义名（`prod`、`test`、`uat`、`release2`、`dev2`…）。
5. 必须表达环境或目的；`test1`、`aaa`、`tmp`、`new` 之类会被拒绝。
6. 一律用层级前缀：`feature/`、`bugfix/`、`hotfix/`、`release/`，后面接英文简述。

**统一基线**：新分支只从最新 `production6` 切出，面板拒绝从 `stage` 切出（`error.stage-baseline`）。创建前会先 `fetch --prune`，再从 `origin/production6` 起分支。

> 若某个仓库根本没有 `production6`（例如历史仓库用 `master`），面板不会假装可以创建：它明确提示「当前仓库没有 production6」，并给出该仓库**全部**分支的可搜索列表（带「显示 N / M」计数），你选一次基线后按仓库记住（`localStorage`）。基线是已存在的引用，不再套用新分支的命名规则，所以 `预生产分支` 这类历史名字也能作为基线。

**新建分支会先拉最新代码**：执行 `git fetch --prune`，再从 `origin/<基线>`（远端存在时优先用它，否则用本地基线）切出并检出，所以新分支一定基于最新远端基线，不会落后。

**AI 生成分支名**：在「新建分支」里用一句话描述需求（如「给学员列表加导出功能」），点「AI 生成分支名」或直接回车，插件调用默认模型把它翻译成合规分支名，例如 `feature/student-list-export`。生成结果会填进前缀 + 简述两个输入框，**仍可手动修改**，确认后点创建。

生成结果始终过一遍规则校验：

- 模型回 markdown 代码块、引号、`git switch -c` 前缀、大写、下划线都会被清洗；
- 前缀不在白名单（如 `feat/`、`perf/`）时自动补成 `feature/`，并在提示里说明「前缀已按规范修正」；
- 你在表单里选定的前缀优先——模型给了别的前缀也会被改回来；
- 中文、纯散文、`feature/test` 这类无意义名会被拒绝并说明原因。

**创建后自动推送**：创建卡片有「创建后推送到远端」勾选项（默认开）。勾选时执行 `git switch -c <名> <基线>` + `git push --set-upstream origin <名>`，新分支立刻在远端可用；推送失败不会撤销本地分支，只单独报告原因。

## 提交信息规范

`<type>(<scope>): <subject>`，type 限定为
`feat` `fix` `refactor` `perf` `docs` `style` `test` `build` `ci` `chore` `revert`。

面板对输入实时校验并自动纠正可纠正的偏差：

- 全角 `（）：` 自动换成半角；
- 中文 type（新增 / 修复 / 重构 / 优化 / 文档…）映射到对应 type；
- 漏写 `type(scope):` 前缀时按分支前缀补齐（`feature/`→`feat`，`bugfix/`→`fix`，`hotfix/`→`fix`，`release/`→`chore`）；
- scope 只保留字母数字与 `_ . -`，为空时从改动文件的目录推断；
- 去掉句尾句号，压平换行，超长给出提示。

提交信息有两个来源，都不合规时会拒提交：

- **按改动生成**：纯本地、零调用，从分支目的 + 改动目录拼一条合规的草稿；
- **AI 优化**：调用你在设置里选的默认 Provider/模型（Host `llm` 服务）重写，返回结果同样过一遍规则校验，并显示原始输出与纠正结果。

## 一键流程

面板上不再列步骤说明（按钮标签已经点明「提交 → 推送 → 合并」），行为是：

1. 暂存并提交勾选的文件（工作区干净则跳过提交）；
2. 推送当前分支（没有上游则自动设置上游）；
3. 拉取最新代码 → 切到目标分支 → 追平远端 → 合并本分支 → 推送目标分支 → 切回你原来的分支。

底层命令依次是 `git add` → `git commit -m <规范信息>` → `git push [--set-upstream]` → `git fetch --prune` → `git switch <目标>` → `git merge --ff-only origin/<目标>` → `git merge <源分支>` → `git push <目标>` → `git switch <原分支>`。

合并能快进就快进，否则生成一个合并提交（不强制 `--no-ff`）。

`production6` 只作基线：目标分支选它会被拒绝（`error.production-protected`），面板也不提供删除它的入口。

## 拉取远端 vs 拉取并更新本地

这两个按钮不是一回事，面板把它们分开：

- **拉取远端**（`git fetch --prune`）：只更新 `origin/*` 这些远端跟踪引用，**不动你的本地分支和工作区文件**。所以它经常看起来「没生效」——代码确实还是旧的。面板会把结果显示出来：「远端有新提交：xxx 落后 N 个、领先 M 个，点『拉取并更新本地』把代码更新下来」。
- **拉取并更新本地**（fetch + `git merge --ff-only`）：把本地分支快进到远端最新，这才真正改你的代码。已分叉时拒绝（`error.diverged`），不会偷偷改写历史；工作区有已跟踪改动时也拒绝。

## 切换 / 合并的前置条件

**未跟踪文件不阻止任何操作。** `AGENTS.md`、`__pycache__/*.pyc`、构建产物这类没进 Git 的东西，git 会原样带过分支切换；把它们当「未提交改动」直接拒绝，会让只剩缓存和草稿的工作区永远切不动、合不了。

**切换分支不设「工作区必须干净」的前置门槛**，交给 git 自己判断：

- 改动与目标分支不冲突 → 照常切换，改动跟着走；
- 会覆盖目标分支的改动 → git 拒绝，插件转成 `tracked-changes-would-be-overwritten` 并列出被挡住的文件名。

**合并要求已跟踪文件没有未提交改动**（合并会移动 HEAD，带着半成品合并容易出错），报错给出具体文件数；有冲突或进行中的 Git 操作会先被拦下。

## 冲突处理

合并冲突时**不回滚**，仓库停在合并中间态，面板显示冲突文件，并给三个动作：

- **把修复请求发进输入框**：把冲突文件清单与修复要求写进当前会话的输入框（走宿主提供的 `inputActions.insertText`），你回车让模型改；
- **冲突已解决，继续合并**：`git add -A` + `git commit --no-edit` 完成合并（仍有冲突标记时会拒绝）；
- **放弃合并**：`git merge --abort`。

## 安全边界

**它不收集、不上传任何数据。** 全部远端访问只有一处：`git fetch` / `git push` 到你自己配置的 `origin`。没有遥测、没有统计上报、没有外部 HTTP 请求（唯一的 `fetch` 是浏览器发回本机宿主的相对路径 `branch-flow/*`）。

**它能做的事**（也就是代码审计时需要关注的权限面）：

| 能力 | 范围 |
|---|---|
| 执行进程 | 只执行 `git`，且用 `argv` 数组传给 `spawn`，**不经过 shell**，因此没有命令注入 |
| 读取文件 | 只用 `existsSync` 判断 git 目录下的操作标记（`MERGE_HEAD` 等）是否存在 |
| 写入文件 | **没有**。插件不写任何文件，git 自己写仓库 |
| 网络 | 只对 `origin` 执行 git 的 fetch/push；不访问第三方服务 |
| 运行时依赖 | **零 npm 依赖**：宿主端只用 `node:fs`/`node:path`，浏览器端只 `require('react')`（宿主提供） |

**访问围栏**（均有回归测试）：

- 宿主 `/branch-flow/*` 只接受**已注册工作区**的路径（`realpath` 精确比对），浏览器不能让宿主对任意目录跑 git；
- 只接受本机回环访问；带 `X-Forwarded-For` / `CF-Connecting-IP` 的请求一律拒绝；要求 `content-type: application/json`（挡住跨站表单）；
- **分支名不能变成 git 选项**：以 `-` 开头或含控制字符的 ref 名直接拒绝（`invalid-ref-name`），避免 `-D`、`--upload-pack=…` 这类参数注入；
- 提交信息、分支名在**客户端与宿主两侧**都校验，宿主侧是权威；
- 插件不注册模型工具，模型无法自行提交或推送；AI 只在**你点按钮**时被调用，只发送分支名/提交信息草稿或需求描述；
- 刷新靠窗口聚焦 + 可见标签页轮询（面板 10s、徽标 30s），隐藏标签页不产生任何 git 进程；不常驻 SSE 连接。

**关于你的仓库内容**：插件不知道、也不读取你的源码。它只运行 git 命令并把**结果摘要**（分支名、文件路径、提交信息、相对时间）发给面板显示。唯一会把内容发给模型的情形是「AI 生成提交信息」，此时会发送 staged diff 的片段（已截断到 12 KB）——不使用该按钮就不会发生。

## 注意事项

使用前请了解这几点：

1. **它以你的权限运行。** 安装插件等于允许这段代码在你的机器上执行 git 命令。本插件把能力限制在「对已注册工作区执行 git」，并有回归测试覆盖，但它仍是一个拥有你账号权限的程序——和所有 DSH 插件一样，装之前应当信任来源。

2. **`git push` 会真的改动远端。** 「一键」和「推送」都会推送到你配置的 `origin`，「合并」在成功后会推送目标分支。**第一次使用建议先在测试仓库验证**，确认分支名、合并方向和推送目标都符合预期，再用于正式仓库。`production6` 作为基线受保护（不能作为合并目标、不能删除），但 `stage` 等目标分支的推送是真实的。

3. **AI 功能会把内容发给模型服务商。** 点「AI 优化」（提交信息）会发送 staged diff 片段（最多 12 KB）给你配置的默认模型；点「AI 生成分支名」只发送你输入的需求描述，不含代码。如果 diff 里有密钥、令牌、内网地址等敏感内容，请改用「按改动生成」（纯本地拼接）或手写提交信息。

4. **许可证是 MIT。** 你可以自由使用、修改、再分发，包括商用；作者不为使用后果提供担保。如果你再分发，请保留 `LICENSE` 文件中的版权声明。

## 配置

在 profile 的 `cordis.patch.yml` 里覆盖（都可省略，默认值如下）：

```yaml
- id: branch-flow
  name: dsh-branch-flow
  config:
    baseline: production6   # 统一基线
    target: stage           # 默认合并目标（面板里可改）
    remote: origin
    pushAfterMerge: true    # 合并成功后是否自动推送目标分支
```

## 结构

```
index.js                 Host 入口：读配置、装配路由
lib/rules.js             分支名 / 提交信息规则（宿主机权威实现）
lib/git.js               真实 git 语义：view / commit / push / merge / 冲突 / 建分支
lib/routes.js            /branch-flow/* 路由 + 工作区信任围栏
lib/message.js           AI 提交信息（Host llm 服务）
lib/branch-name.js       AI 分支名（Host llm 服务）+ 回复规范化
lib/loopback.js          回环 + 同源围栏
client.js                浏览器半侧：徽标与面板（单文件 bundle）
locale/{zh,en}.json      插件管理页的标题与描述
icon.svg                 插件图标
scripts/verify-git.mjs   在真实临时仓库里跑全部 git 动词
scripts/verify-client.mjs 用最小 React 驱动渲染徽标与面板
scripts/verify-css.mjs   校验样式表平衡与控件几何
scripts/verify-hooks.mjs 校验组件没有 hook 顺序错误
scripts/verify-branch-name.mjs 校验 AI 分支名的规范化与拒绝规则
scripts/probe-view.mjs   只读打印某个仓库的面板视图
```

## 自检

```sh
node scripts/verify-git.mjs         # 建仓、提交、推送、合并、冲突、保护分支、未跟踪文件、建分支+推送
node scripts/verify-client.mjs      # 渲染徽标 / 面板、冲突态、缺基线兜底、对齐变量
node scripts/verify-css.mjs         # CSS 规则平衡、按钮/输入框/下拉样式契约
node scripts/verify-hooks.mjs       # 组件里没有「提前 return 之后还调 hook」的顺序错误
node scripts/verify-branch-name.mjs # AI 分支名的清洗、前缀修正、拒绝规则
```

五个脚本都以退出码表示结果。
