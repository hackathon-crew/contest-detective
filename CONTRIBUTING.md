# 参与贡献

项目按 `Proposal → Issue → 分支 → PR → Review → 合并` 推进：所有改动从 Issue 出发，代码经 PR 合入 main。第一次参与，按本文档顺序读一遍即可跑通流程。

## Fork 与分支

仓库所有者直接在本仓库开分支；其他成员先 fork 到个人账号，开发分支只放在个人 fork 里，再向本仓库提 PR。

```bash
git clone git@github.com:<你的账号>/contest-detective.git
cd contest-detective
git remote add upstream git@github.com:huyanxius/contest-detective.git
```

开新分支前先同步上游：

```bash
git fetch upstream
git checkout main
git rebase upstream/main
git checkout -b <分支名>
```

分支名用 `type/短描述`，如 `feat/search-provider`、`fix/date-conflict`。

## 提 Issue

- 从模板里选类型，不建空白 Issue。较大的需求先用「产品提案」模板写 Proposal，组内讨论定稿后再拆任务。
- 每个 Issue 写清背景、目标和验收标准，禁止「优化一下 XX」这类空泛标题。
- 每个 Issue 指定 owner（assignee），并挂到当前 Milestone；没有 Milestone 的 Issue 不在本轮计划内。
- 关闭 Issue 时注明原因：已被哪个 PR 解决、被哪个 Issue 取代，或组内确认不再需要。

产品提案的状态用标签标记：`proposal`（草案）→ `Proposal-Accepted`（定稿进入开发）/ `Proposal-Denied`（被拒）/ `Proposal-NoPlan`（暂不排期）。影响面大的提案加 `FullSpec`，小改动加 `MiniSpec`。功能完成但用户文档没补的加 `Need-Document`，补完换成 `Documented`。

## 提 PR

- PR 描述里写 `Closes #<issue>`，关联它交付的 Issue。没有关联的 PR，`PR Issue Link` 校验会失败，不能合并。
- 改动范围与 Issue 一致，不夹带无关改动；PR 小而频繁，不攒成几千行的大改。
- 按 PR 模板写清改动原因、改了什么、怎么验证的。没有跑过的验证写「未运行」并说明原因，不写没做过的测试。
- 合并前至少经过一次 Review，作者要能讲清这次改动做了什么、为什么这么做。

## 提交规范

Commit message 只用英文，格式 `type(scope): subject`，subject 用祈使句、首字母小写、结尾不加句号。常用 type：`feat` `fix` `docs` `refactor` `test` `chore` `ci` `build`。一个提交只做一件事：依赖、测试、文档和业务代码分开提交。

## 发版

每个 Milestone 结束时打一个 `vX.Y.Z` tag 并发布 Release，描述里列清本轮交付的功能。部署只部署已发布的版本，不部署未合并的代码。

## 本地密钥

API key 放在本地 `.env` 文件中，`.env` 已被 `.gitignore` 忽略。新增环境变量时同步更新 `.env.example`，只写变量名和说明，不写真实值。
