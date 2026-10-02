# uptime-flare-plus

跑在 Cloudflare Workers 上的 Uptime Kuma 風格監測服務。

- **HTTP 監測**：method、headers、body、可接受狀態碼、關鍵字（含反向）、逾時、重新導向次數、反向模式。
- **Push 監測**：相容 Uptime Kuma 的 `/api/push/:token?status=up&msg=OK&ping=`。
- **Discord webhook 通知**：異常、恢復，可設定連續異常 N 次後重送。
- **維護時段**：手動、單次、每週固定時段。維護中不通知，也不計入 uptime。
- **事件公告**：Markdown，顯示在狀態頁。
- **公開狀態頁** `/`，**管理介面** `/admin`（由 Cloudflare Access 保護）。

## 架構

| 元件 | 用途 |
|---|---|
| Worker（Hono） | API、push 端點、cron |
| Durable Object `MonitorDO` | 每個 monitor 一個，用 alarm 排程檢查；push 逾時也由 alarm 判斷 |
| D1 | 設定、心跳明細、每日統計 |
| Static Assets | Vue 3 SPA |
| Cron | 每 5 分鐘 watchdog（對齊設定、補回遺失的 alarm）；每天清舊資料 |

每個 monitor 有自己的 alarm，所以 HTTP 檢查最短間隔可以到 20 秒，monitor 數量也不受單次 cron 的 subrequest 上限限制。

> 需要 **Workers Paid** 方案。每次心跳都會寫入 D1，免費方案的每日寫入額度不夠。

## 本機開發

```bash
npm install
```

```bash
copy .dev.vars.example .dev.vars
```

```bash
npm run db:migrate:local
```

```bash
npm run dev
```

- 狀態頁：http://localhost:5173/
- 管理介面：http://localhost:5173/admin
- `.dev.vars` 的 `ACCESS_DEV_BYPASS=true` 只在 `localhost` 生效，正式環境不會略過驗證。

測試與型別檢查：

```bash
npm test
```

```bash
npm run typecheck
```

## 部署

1. 建立 D1，把輸出的 `database_id` 填進 `wrangler.jsonc`：

   ```bash
   npx wrangler d1 create uptime-flare-plus
   ```

2. 套用 migration：

   ```bash
   npm run db:migrate:remote
   ```

3. 部署，二選一：
   - 手動：

     ```bash
     npm run deploy
     ```

   - 自動（Workers Builds，push 到 `main` 就部署）：Dashboard → Workers & Pages → Create application → Import a repository，選這個 repo，設定如下：

     | 欄位 | 值 |
     |---|---|
     | Project name | `uptime-flare-plus`（要跟 `wrangler.jsonc` 的 `name` 一樣） |
     | Production branch | `main` |
     | Build command | `npm run build` |
     | Deploy command | `npx wrangler deploy` |
     | Non-production branch deploy command | `npx wrangler versions upload` |
     | Root directory | 留空 |

     Node 版本由 `.node-version` 指定。建置用的 token 沒有 D1 權限，所以 **migration 不會自動跑**：`migrations/` 有新檔案時，合併到 `main` 之前先在本機跑 `npm run db:migrate:remote`。

4. 在 Cloudflare Dashboard 幫 Worker 綁自訂網域（例如 `status.example.com`）。公開狀態頁的快取（Cache API）只在自訂網域上有效。

5. 設定 Cloudflare Access（見下一節），再設定 secrets：

   ```bash
   npx wrangler secret put ACCESS_TEAM_DOMAIN
   ```

   ```bash
   npx wrangler secret put ACCESS_AUD
   ```

   沒有設定這兩個值時，管理 API 一律回 403。

6. 建議關掉 `workers.dev` 網址（Worker 設定 → Domains & Routes），只留自訂網域。管理 API 本身也會驗 JWT，所以就算沒關，也不會被繞過。

## Cloudflare Access 設定

在 Zero Trust → Access → Applications 新增 **Self-hosted** application：

- 目的地加兩條，都在同一個 application 裡：
  - `status.example.com` + 路徑 `admin`
  - `status.example.com` + 路徑 `api/admin`
- 子路徑會自動包含在內（例如 `/admin/monitors`）。`/api/push/*` 和 `/api/status` 不要加，它們必須公開。
- Policy：只允許你的 email 或群組。
- 建好後到 application 的 Additional settings 複製 **AUD tag**，就是 `ACCESS_AUD`。
- `ACCESS_TEAM_DOMAIN` 填 `https://<team>.cloudflareaccess.com`，也可以只填 `<team>`。
- 如果你把兩個路徑拆成兩個 application，`ACCESS_AUD` 用逗號填兩個 AUD。

Worker 會用 `Cf-Access-Jwt-Assertion` header 驗證 JWT 的簽章、issuer 和 audience。

## Push 監測用法

在管理介面建立 Push 監測後會拿到 push URL。服務要在每個檢查間隔內呼叫一次：

```bash
curl "https://status.example.com/api/push/<token>?status=up&msg=OK&ping="
```

- `status`：`up`（預設）或 `down`。回報 `down` 會立刻判定為異常，不走重試次數。
- `msg`：訊息，預設 `OK`。
- `ping`：延遲毫秒數，可省略。
- 任何 HTTP method 都可以。成功回 `{"ok":true}`，token 不存在或 monitor 已暫停回 404。
- 超過「間隔 + 1 秒」沒收到 push，就依重試次數先標 pending，用完才標 down 並通知。

## 已知限制

- Workers 的 `fetch` 不能忽略 TLS 憑證錯誤，所以沒有「忽略 TLS」選項。
- 檢查從 Durable Object 所在的 Cloudflare 機房發出，沒有多地區檢查。
- 只有 HTTP 與 Push 兩種監測類型。
- Uptime 計算：`up / (up + down)`。pending 和維護中都不計入。
