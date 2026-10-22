# 截图索引

README 引用的界面截图。修改界面后按同样的文件名替换即可，README 无需改动。

| 文件 | 拍的是什么 |
|---|---|
| [`screenshot-chip.png`](screenshot-chip.png) | 输入框内、模型选择器左侧的分支徽标。显示分支名 `master`、1 处改动、落后 23 个提交 |
| [`screenshot-panel.png`](screenshot-panel.png) | 点开徽标后的完整面板：提交改动、合并到指定分支、分支列表（本地 18 / 远端 9）、新建分支 |
| [`screenshot-conflict.png`](screenshot-conflict.png) | 分支处于冲突状态时的徽标：状态点变红，并标出「1 个冲突」 |

## 重新截图时

- 宽度 1280–1600px，PNG，单张控制在 300 KB 内；
- 用测试仓库，分支名和文件路径不要出现真实项目信息；
- 文件名保持不变，直接替换本目录下的同名文件即可。

```sh
git add docs/*.png
git commit -m "docs: 更新界面截图"
git push
```
