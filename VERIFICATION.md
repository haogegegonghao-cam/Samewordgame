# 验收记录

验证日期：2026-10-29。此文严格区分本地实测与真实云端状态。

## 已实测通过

- `pnpm install --frozen-lockfile`：成功。锁定 pnpm 11.25.0，显式允许 esbuild 构建脚本。
- `pnpm build`：成功。Vite 生成可部署的 `dist/`；JS gzip 约 65 KB，CSS gzip 约 6.3 KB，无远程字体或图像。
- `node --test tests/*.test.mjs`：11 项测试通过。
- `node tests/e2e.mjs`：11 项浏览器集成检查通过；两个独立 Chrome BrowserContext 加一个第三人上下文，移动端 viewport 390 × 844，另检查 320 / 360 / 768 像素胜利页。

### 数据库与规则

PGlite 内运行真正的 PostgreSQL，完整执行生产 `supabase/schema.sql`；仅测试 Auth schema 使用本地 JWT claim 辅助函数。测试切换 `authenticated` 角色，实际执行 RLS、权限撤销、PL/pgSQL 和事务。

覆盖：幂等创建／加入；第三人加入、读取、提交和离开均拒绝；客户端直写房间表拒绝；读取私有提交与调用私有辅助函数拒绝；首个词不出现在双方快照或可读表；重复同词提交幂等、改词拒绝；双方确认推进；旧局／旧轮请求拒绝；近义词与大小写差异不获胜；NFKC／空白标准化匹配；双人重开；明确离开关闭房间；房间到期；第 50 轮边界。

PGlite 测试使用单实例的串行事务队列，`Promise.all` 验证交错请求与幂等结果；它不是托管 PostgreSQL 多连接压力测试。

### 浏览器

覆盖：首页及说明弹窗；A 创建、B 输入码加入；第三会话从邀请链接被拒绝；A 提交后 B 的 DOM 与实际 HTTP 快照没有词；刷新后 A 仍锁定；第二人提交才揭晓；双方确认进入下一轮；断网／自动重连保留输入草稿；海洋／天空 → 蓝色／云朵 → 白色／白云 → 雪／雪完整四轮；胜利和双方历史一致；PNG 下载；双人确认重开；刷新恢复新局；同步不关闭对话框；离开后双方房间关闭；新的邀请链接成功加入。

测试专用 HTTP 服务加载同一套 SQL，通过 Supabase JS 客户端通信。Auth 响应和 REST 传输是本地适配器，WebSocket 不可用时实际使用产品的轮询恢复路径。**这不能证明托管 Supabase Auth、云端 Realtime 或跨公网设备已通过验证。**

浏览器报告：[docs/e2e-report.json](docs/e2e-report.json)。外观截图：[首页](docs/home-desktop.png)、[手机胜利页](docs/win-mobile.png)。

## 真实云端验收：已通过

- Supabase Free 组织已确认，项目 `spxiuccpoitidojzchep` 健康，生产迁移执行成功；匿名登录已开启。
- **正式网址**：[同词相遇](https://haogegegonghao-cam.github.io/Samewordgame/)。[成功部署记录](https://github.com/haogegegonghao-cam/Samewordgame/actions/runs/40899892077)。
- **正式网址的 11 项独立浏览器流程检查全部通过**：不是本地适配器，真实访问 GitHub Pages 与 Supabase Cloud，包括四轮相遇、刷新／断网恢复、重开、离开、第三会话拒绝加入、邀请码和邀请链接。桌面 1440 × 1000，手机 390 × 844；胜利页另检查 320 / 360 / 768 像素。[云端浏览器报告](docs/cloud-browser-report.json)。
- **真实 Auth / RPC / Realtime / RLS 安全冒烟测试通过**：三个独立匿名身份；两个房间成员各收到 12 条实时更新事件，第三身份收到 0 条。揭晓前 RPC 快照、直接可读表和实时事件均不含秘密词；私有表读取和直接房间修改拒绝；并发提交、双方推进、精确匹配、共同重开与关闭均通过。[云端 API 报告](docs/cloud-api-report.json)。
- 云端权限再次确认：authenticated 可以读取成员房间，不能直接 UPDATE 房间，不能 USAGE 私有 schema，不能 SELECT 私有猜词表。两表 RLS 均启用；Realtime publication 只有 `public.game_rooms`。
- **GitHub Linux 完整回归通过**：[浏览器与数据库测试记录](https://github.com/haogegegonghao-cam/Samewordgame/actions/runs/40899295478)。已固定 Ubuntu 24.04，以匹配锁定的 Playwright 版本。

首次正式网页验收中，一次刷新收到 GitHub 临时 5xx 错误页，游戏重开本身已成功。待发布稳定后重新完整验收通过；测试脚本对托管端 5xx 的刷新提供最多 3 次有界重试。最终通过的流程未记录 5xx 重试。前端无法控制托管平台自身的临时错误。

Supabase 顾问报告的“私有表无 RLS policy”及“已认证可执行 SECURITY DEFINER RPC”均符合本项目权限设计，已逐项核对；详见 README 的安全说明。验收使用自动化的隔离浏览器会话与手机视口模拟，不声称已经在两台实体手机上手工测试。
