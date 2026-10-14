# dsh-learn-agent-preset-model

DeepSeek Harness（DSH）的学习教练 agent 预设。你说「我想学会 X」，它会：

1. 问清目标，定一个能检验的终点考核；
2. 问你会不会这门课要用到的其他技能（比如学 Spring Boot 先问 Java），不会的让你选先补、边学边补、先单独学一门还是跳过；
3. 出几道题摸清你的起点；
4. 排一条不超过 10 节的路线，只细化眼前这一节；
5. 每一节按内容选教法（示范例题 / 第一性原理 / 诊断纠偏 / 练习批改），用费曼检验收尾，拿到「学会了」的证据才往下走；
6. 讲新概念时，拿你已经会的技能打比方（「Spring 的依赖注入 ≈ 你会的 Vue 的 provide/inject」），并且一定讲清哪里不一样；
7. 把进度、疑问、错题记在文件里。隔天开新会话问「下一步学啥」，它知道你上次学到哪、学得怎样、还有什么没解决。

它会跨课程记一份「你会什么」的画像，下一门课就不用再问一遍。只记你自己说的、做题验证过的和学完的；你说自己会的，没做题验证前最多算「会一点」。每次记录都会告诉你，说「删掉这条」就删。

只用 DSH 官方插件，不依赖第三方插件。打开 DSH 的「自动化任务」后，还能每天定时提醒复习。

## 安装

前提：DSH 桌面版已经打开过一次（初始化了 profile）。下面的 `dsh` 在 macOS 上是 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`。

1. 把本仓库放到一个固定位置，例如 `~/.dsh/local-plugins/dsh-learn-preset/`。
2. 完全退出 DSH 桌面版。
3. 安装（建议先备份 `~/.dsh/profiles/desktop/`）：

   ```bash
   dsh plugin --profile desktop add ~/.dsh/local-plugins/dsh-learn-preset
   ```

4. 打开 DSH，新建会话时选预设「学习教练」。

卸载：退出 DSH 后运行 `dsh plugin --profile desktop remove dsh-learn-preset`。学习档案不会被删。

可选：想在别的预设的会话里也能问「我下一步学啥」，按 [docs/实现方案.md](docs/实现方案.md) §5.5 在 `~/.dsh/AGENTS.md` 里手动加一句。

## 用法

- 第一次：直接说想学什么。
- 之后任何一天：开一个「学习教练」会话，说「继续」或「下一步学啥」。
- 想停：说「今天到这」，它会记下这次学了什么、下次从哪开始。直接关窗口也行，每一步做完都已经记过了。
- 每轮回复最后一行是位置条，告诉你在第几节第几步、下一步做什么。
- 画像：问「你记得我什么」查看；说「我其实不会 X」直接改低，说「我会 X」它会出一道题再改高；「别记 X 了」「先别用画像」「全部删掉」都可以直接说。

## 加 skill

不用改配置，两种方式任选：

- 跟它说：「把 X skill 也加进来，所有课都用」或「这门课加一个出题的 skill」。
- 手动放文件夹（含 `SKILL.md`）：
  - 所有课程都用 → `~/.dsh/learn-skills/`
  - 只给某门课用 → `~/.dsh/learning/<课程名>/skills/`

skill 的 `name` 只能用小写字母、数字和连字符。

## 数据在哪

`~/.dsh/learning/`：每门课一个目录，`state.json` 是进度，`log.md` 是给人看的学习日记。整个目录是一个 git 仓库，每次记录自动提交，可以回看和回滚。不要手改 `state.json`，所有读写都通过包里的 `bin/learn` 脚本。

画像在 `~/.dsh/learning/profile.json`，只存技能名、程度和证据（哪道题、哪门课），不存姓名、联系方式。它不进 git 历史，清空就是真删。删课程不影响画像，删画像不影响课程进度。

## 文档

- [docs/方法论.md](docs/方法论.md)：怎么教——流程、先修问答、五种教法、选教法和换教法的规则、学习者画像，以及做画像前调研的开源项目。
- [docs/实现方案.md](docs/实现方案.md)：怎么落地——插件清单、进度脚本、跨会话接续、实测结果。

## 目录

```
package.json        DSH bundle 声明
cordis.patch.yml    预设：人设 + 插件列表
bin/                进度脚本 learn.mjs 和启动器 learn / learn.ps1
skills/             4 个流程 skill + 5 个教法 skill
docs/               方法论、实现方案
```
