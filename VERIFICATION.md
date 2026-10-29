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

## 云端部署进度

- 已创建 Supabase 项目 `spxiuccpoitidojzchep`，状态 ACTIVE_HEALTHY，生产迁移执行成功；公开客户端参数已配置。匿名登录仍需在控制台开启。
- 源码已发布到 GitHub 仓库 `main`；Pages 发布源已设置为 GitHub Actions。公开参数已写入源码，本次无需 Actions Variables；等待新构建发布。
- 需要在部署成功返回的实际 URL 上，再完成两个独立公网设备／会话的云端验收。可用 `E2E_URL=实际网址 pnpm test:e2e` 辅助。

仓库发布和部署状态以最终交付消息与 GitHub Actions 实际结果为准。没有真实部署结果时，不应把预计的 Pages 地址当作已上线网址。

云端权限检查确认：authenticated 可以读取成员房间，不能直接 UPDATE 房间，不能 USAGE 私有 schema，不能 SELECT 私有猜词表。Supabase 顾问报告的“私有表无 RLS policy”及“已认证可执行 SECURITY DEFINER RPC”均符合本项目权限设计，已逐项核对。
