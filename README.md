# Moments

基于 Next.js、Clerk、Cloudflare Workers、D1 和 CloudFlare ImgBed 的自部署个人说说项目。

- `apps/web`：Next.js 前端、Clerk 登录和 ImgBed 上传代理
- `apps/api`：Hono Worker、Clerk JWT 鉴权、D1 数据库和 OpenAPI

## 准备工作

部署前需要：

1. 一个 [Clerk](https://dashboard.clerk.com/) 应用。
2. 一个可用的 [CloudFlare ImgBed](https://cfbed.sanyue.de/) 站点。
3. Cloudflare、Vercel 和 GitHub 账号。
4. 将本仓库 Fork 到自己的 GitHub 账号。

## 1. 准备 Clerk

在 Clerk Dashboard 中取得：

- `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`：Publishable Key。
- `CLERK_SECRET_KEY`：Secret Key。
- `CLERK_JWT_KEY`：API Keys 页面中的 JWT Public Key，选择 PEM 格式。
- `ADMIN_CLERK_USER_ID`：Users 页面中唯一管理员账号的 `user_...` ID，不是用户名或邮箱。

部署前端后，将最终前端域名添加到 Clerk 应用的生产域名配置中。

## 2. 准备 ImgBed

在 ImgBed 管理界面创建 API Token。推荐使用两个 Token：

- Vercel 上传 Token：只授予 `upload` 权限。
- Worker 删除 Token：只授予 `delete` 权限。

也可以使用同时拥有 `upload` 和 `delete` 权限的同一个 Token。`CFBED_BASE_URL` 必须填写自己的 ImgBed 站点源地址，例如 `https://file.example.com`，不要填写文档站地址，也不要带末尾 `/`。

## 3. 部署 Worker 和 D1

在 Cloudflare Dashboard 中创建 Workers Builds 项目并连接 Fork 后的 GitHub 仓库：

| 配置项         | 填写内容            |
| -------------- | ------------------- |
| Root directory | `/`，即仓库根目录 |
| Deploy command | `pnpm deploy:api` |

首次部署会自动创建名为 `moments-db` 的 D1 数据库，并将它绑定为 `DB`，然后执行 `apps/api/migrations` 中的全部迁移；不需要手动填写数据库 ID。后续部署只会执行尚未应用的迁移。

从旧版本升级时也应使用完整的 `pnpm deploy:api`，不要只执行 `wrangler deploy`。当前版本需要应用统计聚合与 D1 Trigger 迁移；无需新增环境变量，也无需手工转换数据，迁移会回填统计数据和随机抽样槽位。

首次部署完成后，在 Worker 的 **Settings → Variables and Secrets** 中添加：

| 变量                    | 类型     | 示例或说明                                                            |
| ----------------------- | -------- | --------------------------------------------------------------------- |
| `ALLOWED_ORIGIN`      | Variable | 最终前端源地址，例如`https://moments.example.com`，不要带末尾 `/` |
| `CLERK_JWT_KEY`       | Variable | Clerk PEM 公钥；可粘贴多行，也可将换行写成`\n`                      |
| `ADMIN_CLERK_USER_ID` | Variable | 唯一管理员的 Clerk`user_...` ID                                     |
| `CFBED_BASE_URL`      | Variable | ImgBed 源地址，例如`https://file.example.com`                       |
| `CFBED_API_TOKEN`     | Secret   | 拥有`delete` 权限的 ImgBed Token                                    |

保存变量后重新部署 Worker，记录其公开地址，例如：

```text
https://moments-api.<subdomain>.workers.dev
```

检查 Worker 和 D1：

```text
GET https://你的-worker-地址/health
GET https://你的-worker-地址/openapi.json
```

`/health` 应返回 `status: "ok"` 和 `database: "ok"`。

站点同时提供标准 RSS 2.0 订阅地址 `https://你的前端域名/rss.xml`，内容范围为最近 20 个亚洲/上海自然日；Worker 也在 `/rss.xml` 提供同一份源数据。

### 使用本地 Wrangler 部署

也可以在仓库根目录执行：

```bash
pnpm install
pnpm --filter @moments/api exec wrangler login
pnpm deploy:api
```

## 4. 部署 Vercel 前端

在 Vercel 导入同一个 GitHub 仓库：

| 配置项           | 填写内容     |
| ---------------- | ------------ |
| Framework Preset | Next.js      |
| Root Directory   | `apps/web` |

添加以下环境变量：

| 变量                                  | 类型         | 示例或说明                                |
| ------------------------------------- | ------------ | ----------------------------------------- |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | 公开         | Clerk Publishable Key，通常以`pk_` 开头 |
| `CLERK_SECRET_KEY`                  | Secret       | Clerk Secret Key，通常以`sk_` 开头      |
| `NEXT_PUBLIC_API_BASE_URL`          | 公开         | Worker 公开源地址，不要带末尾`/`        |
| `CFBED_BASE_URL`                    | 服务端       | ImgBed 源地址，不要带末尾`/`            |
| `CFBED_API_TOKEN`                   | Secret       | 拥有`upload` 权限的 ImgBed Token        |
| `CFBED_UPLOAD_FOLDER`               | 服务端、可选 | 推荐填写`moments`                       |

只有以 `NEXT_PUBLIC_` 开头的变量会进入浏览器代码。不要给 Clerk Secret Key 或 ImgBed Token 添加该前缀。

部署完成后，如果实际前端域名与 Worker 中的 `ALLOWED_ORIGIN` 不同，请更新 `ALLOWED_ORIGIN` 并重新部署 Worker。

## 5. 部署验收

1. 打开前端并使用 `ADMIN_CLERK_USER_ID` 对应的账号登录。
2. 发布一条文字或图片说说。
3. 删除说说并进入回收站。
4. 测试恢复和永久删除。
5. 永久删除带图片的说说后，确认 ImgBed 中的文件也已删除。
6. 编辑说说并移除旧图片，确认图床删除成功后页面与 D1 中都不再保留该图片。

## 本地开发

```powershell
pnpm install
Copy-Item apps/web/.env.example apps/web/.env.local
Copy-Item apps/api/.dev.vars.example apps/api/.dev.vars
pnpm --filter @moments/api db:migrate:local
```

分别启动：

```powershell
pnpm dev:api
pnpm --dir apps/web dev
```

本地前端默认为 `http://localhost:3000`，Worker 默认为 `http://localhost:8787`。本地 D1 数据与远程 D1 相互独立。

## 常用命令

```bash
pnpm check              # Worker 类型、Lint、测试、OpenAPI 和部署预检
pnpm test               # Worker 测试
pnpm openapi:generate   # 重新生成 OpenAPI 文件
```

更详细的后端说明见 [`apps/api/README.md`](apps/api/README.md)。
