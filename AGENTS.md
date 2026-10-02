# AGENTS.md

給在這個 repo 工作的 AI agent 看的規則。專案說明見 `README.md`。

## D1 migration（一定要提醒）

`main` 一 push 就會由 Cloudflare Workers Builds 自動部署，但建置用的 token 沒有 D1 權限，**遠端 migration 不會自動跑**。

只要這次的改動新增或修改了 `migrations/` 底下的檔案，就要在回報時明確提醒使用者：

- 合併到 `main` **之前**先在本機跑：

  ```bash
  npm run db:migrate:remote
  ```

- 順序很重要：新程式碼先部署、schema 還沒更新，線上會直接壞掉。
- 本機開發也要跑一次 `npm run db:migrate:local`。

其他規則：

- 已經套用過的 migration 檔不要改，新增下一個編號的檔案（例如 `0002_xxx.sql`）。
- 不用 FOREIGN KEY。刪除關聯資料由程式處理（見 `worker/db.ts` 的 `deleteMonitor`）。
- 索引會讓每次寫入多算一列；心跳表寫入量大，加索引前先想清楚。

## 驗證

改完程式碼要自己跑，並貼結果：

```bash
npm test
```

```bash
npm run build
```

`npm run build` 會跑 `vue-tsc -b`（前端、Worker、設定檔三份 tsconfig）再 build。

## 版本限制

- TypeScript 固定 6.x：TS 7 沒有 JS API，`vue-tsc` 會壞。
- vitest 固定 4.x：`@cloudflare/vitest-plugin` 還不支援 5.x。`package.json` 的 `overrides` 是為了避開 npm 把 vitest 解析成 5.x 而崩潰，不要隨手拿掉。

## 結構

- `worker/`：Worker（Hono）、`MonitorDO`（每個 monitor 一個 Durable Object）、D1 存取。
- `src/`：Vue 3 SPA（公開狀態頁 `/`、後台 `/admin`）。
- `shared/types.ts`：前後端共用的 API 型別與路由表。改 API 時兩邊一起改。
- `test/`：vitest + `@cloudflare/vitest-plugin`。D1 在測試之間不會重置，測試資料要自己隔離。
