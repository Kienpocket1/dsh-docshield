# Kế hoạch code chi tiết: `dsh-docshield`

> Plugin lõi của DSH-DocShield, chạy trên DeepSeek Harness 0.1.6-alpha.2, dùng cùng `dsh-passwords` 2.7.3.
> Môi trường phát triển: `E:\Deepseek_Harness\spike-dshpw` (DSH riêng từ npm, `DSH_HOME` riêng, gateway ở cổng 3443).

## 1. Bối cảnh và các quyết định đã chốt

Kết quả chạy thử ngày 2026-09-23:
- `dsh-passwords` đã lo đăng nhập, owner = Admin, lọc workspace/phiên chat theo subuser, tự cấp quyền phiên cho người tạo, và giới hạn preset cho từng subuser.
- Gateway **không truyền danh tính user cho plugin**. Vì vậy user được suy ra từ **cwd của phiên** (`exec.agent.session.header.cwd`). Suy luận này đáng tin vì gateway chỉ cho subuser tạo phiên trong `allowedFolders` của họ.
- Ở preset `standard`, agent của subuser **đọc được file ngoài thư mục của mình** (đã đọc được `platform.db` và `workspace.json`). Do đó khóa công cụ là **bắt buộc**.

Các quyết định:

| Chủ đề | Quyết định |
|---|---|
| Danh tính | `storage/users/{u}` → user `u`. `storage/admin` → Admin. Chỉ owner mới được cấp `storage/admin`. **Bỏ `roles.json`**, vì quyền đã nằm ở gateway và cwd, không cần nguồn thứ hai. |
| Khóa công cụ | Preset `docshield` / `docshield-admin` chỉ chứa công cụ của DocShield, cộng một `tools.guard()` toàn cục theo cwd. Có 3 lớp: gateway (giới hạn preset), preset (chỉ đăng ký công cụ DocShield), guard. **Không dùng `restrict`** (xem M0 #1). |
| Embedding | bge-m3 chạy local qua `@huggingface/transformers` (ONNX, bản lượng tử hóa int8), 1024 chiều. Để sẵn interface để đổi sang Ollama. |
| Kho vector | `sqlite-vec` nạp vào `node:sqlite` (Node 24.19 có `loadExtension`). Bảng `vec0` có `scope` là **partition key**, nên mọi truy vấn bắt buộc phải lọc theo phạm vi. |
| Ticket | Lưu trong SQLite, cùng file `docshield.db`, bật WAL và dùng `BEGIN IMMEDIATE`. |
| Thay tài liệu chung | Theo `doc_key`. Admin gọi `publish_public_doc` với `doc_key` → bản cũ chuyển `superseded` và bị xóa vector trong một transaction. |
| Chống ảo giác | Công cụ `answer_with_evidence` kiểm tra bằng code: `chunkId` phải nằm trong kết quả tìm kiếm của chính phiên đó, và `quote` phải là chuỗi con của chunk. |
| Thẻ UI | Client plugin đăng ký `tool.call.toolview` theo tên công cụ. Không dùng endpoint HTTP riêng, vì gateway chặn endpoint chưa đăng ký. |
| Giới hạn | PDF/TXT/MD, tối đa 10MB, chưa hỗ trợ OCR. Ngưỡng relevance là tham số cấu hình, được hiệu chỉnh ở M3. |

## 1b. Kết quả M0 (2026-09-23) và các điều chỉnh

| # | Kết quả | Điều chỉnh vào thiết kế |
|---|---|---|
| 1 | `tools.restrict({allow: []})` ở row preset **che luôn công cụ của chính preset** (agent coi chúng là công cụ thừa hưởng). Host không có công cụ toàn cục nào (`global: []`). | **Bỏ `restrict`.** Khóa bằng: preset chỉ chứa công cụ DocShield, cộng `tools.guard()` toàn cục, cộng giới hạn preset của gateway. |
| 2 | Preset trong `<DSH_HOME>/.agent-presets/<id>` hiện trong picker DSH và trong "Agent modes" của gateway. Tick xong subuser dùng được. | Giữ `install-presets.mjs`. Id preset: `docshield`, `docshield-admin`. |
| 3 | User message chứa `{type:'file', attachment:{attachmentId:'sha256:…', name, bytes}}`. `ctx.attachments.fileHostPath(part.attachment)` trả đường dẫn thật (`DSH_HOME/attachments/v1/files/<2 ký tự>/<hash>/<name>`). **Gateway chặn mọi upload khi `allow_upload = 0`** (nhãn UI: "Large file upload."). | Ingest đọc từ `part.attachment`. Checklist của owner và `doctor.mjs` phải yêu cầu bật "Large file upload." cho subuser. Giới hạn 10MB do plugin tự kiểm. |
| 4 | Toolview client hiện thẻ đúng (qua 3090). Client plugin **bắt buộc khai báo `inject: ['slots']`**, thiếu là trang báo "Failed to load plugins". | Mọi client plugin khai báo `inject` đầy đủ. Còn chờ xác nhận thẻ hiện qua gateway cho subuser. |
| 5 | `sqlite-vec` 0.1.9 chạy trong `node:sqlite`, partition key tách đúng scope. FTS5 `unicode61 remove_diacritics 2` tìm được tiếng Việt có dấu lẫn không dấu và khớp chính xác "AL-99", "Điều 5". bge-m3 int8: nạp 1,6s, RAM ~1,3GB, ~30ms/câu ngắn, ~580ms/2000 ký tự. | Dùng hybrid: vec0 cộng FTS5 (cột `scope` UNINDEXED, lọc bắt buộc), gộp điểm bằng RRF. |
| 5b | Câu bẫy TC-02 ("vay 100 triệu mua xe máy") có cosine **0,622** với đoạn "hỗ trợ vay vốn", cao hơn câu hỏi thật "học bổng" (0,603). | **Ngưỡng 0,75 bỏ.** Ngưỡng thô khoảng 0,45 chỉ để lọc; việc quyết định "có bằng chứng" dồn cho `answer_with_evidence` (quote phải trả lời được câu hỏi) cộng persona. Bộ câu bẫy là thành phần bắt buộc của M3. |
| 6 | `exec.agent.session.header.cwd` = `E:\Deepseek_Harness\spike-dshpw\storage\users\alice` (dấu `\`), có ở mọi lời gọi công cụ, kể cả trong guard toàn cục. `header.agentPreset` là preset **lúc tạo phiên**, không phản ánh lần đổi sau đó. | Scope chỉ dựa vào cwd, không dựa vào `header.agentPreset`. |
| — | Symbol scope của DSH (`Symbol('dsh.scope')`) không phải symbol toàn cục. Plugin nằm ngoài cây `node_modules` của DSH. | **Không import runtime `@deepseek-ai/*`**, chỉ import kiểu và dùng service được inject (giống `dsh-passwords`). |
| — | Model `my-models-free` (router local `127.0.0.1:20128`) có gọi công cụ được. | Kiểm lại TC-02 trên model này ở M3. |

### Hiệu chỉnh M3 (bge-m3, 8 câu thật và 8 câu bẫy trên dữ liệu thử nghiệm)
- Điểm cao nhất của câu thật: 0,40–0,77. Câu bẫy: 0,34–0,61. **Hai khoảng chồng lên nhau**, nên ngưỡng chỉ dùng để lọc thô: `minSimilarity = 0,45`.
- Văn bản không dấu hoặc quá ngắn (ví dụ "Ma so ca nhan cua Alice la AL-99") embed yếu (0,397). Vì vậy đoạn nằm trong **top-5 BM25** được nới ngưỡng thêm 0,1, và đoạn chứa mã có chữ số trùng với câu hỏi luôn được giữ. Kết quả: 8/8 câu thật tìm đúng đoạn trong top 3.
- Việc chặn câu bẫy do persona ("đoạn cùng chủ đề là KHÔNG đủ") và `answer_with_evidence` (trích nguyên văn, chunk phải được trả về trong chính phiên đó) đảm nhận. Kiểm thử đầu-cuối trên `my-models-free`: TC-01a, TC-01b và TC-02 đều đạt.

## 2. Kiến trúc

```
Trình duyệt ──▶ dsh-passwords (3443: login, lọc phiên, khóa preset)
                   │
                   ▼
              DSH web (3090, loopback)
               ├─ docshield-core (host, toàn cục)
               │    ├─ DocShieldService (ctx.docshield): db, indexer, retriever, tickets, scope
               │    ├─ tools.guard(): cwd ∈ storage/ ⇒ chỉ công cụ DocShield theo vai trò
               │    ├─ ingest: sự kiện file đính kèm trong chat + fs.watch thư mục docs
               │    └─ embedder (worker thread, nạp lười)
               ├─ preset docshield       → row docshield-tools (user):  search, answer, ticket, status
               ├─ preset docshield-admin → row docshield-tools (admin): + list/update ticket, publish/list/reindex doc
               └─ client plugin: EvidenceCard, TicketCard, TicketTable, DocList
```

Cấu trúc thư mục dữ liệu (`storageRoot`, mặc định `E:\Deepseek_Harness\spike-dshpw\storage`):
```
storage/
  users/{u}/docs/        ← workspace của subuser u (gateway cấp đúng thư mục users/{u})
  admin/                 ← workspace của owner (preset docshield-admin)
  public_docs/           ← tài liệu chung, chỉ Admin ghi
  .docshield/docshield.db, .docshield/models/
```

## 3. Cấu trúc package

`E:\Deepseek_Harness\dsh-docshield\` (TypeScript, ESM, build bằng `tsc` + esbuild cho client, theo mẫu `dsh-passwords`):

```
package.json            dsh.bundle.patch=./cordis.yml, dsh.client.platform=web, exports "." và "./client", "./tools"
cordis.yml              insert row docshield-core (config: storageRoot, dbPath, embedder, minScore, topK)
presets/docshield/agent.cordis.yml, preset.yml
presets/docshield-admin/agent.cordis.yml, preset.yml
src/
  index.ts              plugin docshield-core: apply(), đăng ký service, guard, ingest
  config.ts             schema Schemastery + giá trị mặc định
  scope.ts              resolveScope(cwd) → {role:'user',userId} | {role:'admin'} | null
  guard.ts              bảng công cụ được phép theo vai trò và hàm guard
  db/schema.ts          migration
  db/documents.ts       upsert/supersede/list
  db/tickets.ts         create/get/list/update
  ingest/sanitize.ts    tên file, đuôi file, kích thước, kiểm tra nằm trong thư mục (realpath)
  ingest/parse.ts       txt/md (utf8), pdf (unpdf, theo trang)
  ingest/chunk.ts       tách theo "Điều N"/heading → đoạn văn, ~1800 ký tự, chồng lấp 200, giữ locator
  ingest/indexer.ts     hash → parse → chunk → embed → ghi (một transaction)
  ingest/watcher.ts     fs.watch recursive + debounce
  ingest/attachments.ts nghe sự kiện user message có file → ctx.attachments.fileHostPath → copy → index
  embed/embedder.ts     interface Embedder; nạp lười; hàng đợi batch
  embed/transformers-worker.ts
  embed/ollama.ts       (dự phòng)
  retrieval/search.ts   embed câu hỏi → vec0 theo từng partition (public, user:{u}) → gộp → ngưỡng
  retrieval/evidence.ts sổ ghi kết quả tìm kiếm theo phiên + kiểm tra trích dẫn
  tools/index.ts        preset row: đăng ký công cụ theo config.role (không restrict)
  tools/search.ts, answer.ts, ticket.ts, admin.ts
  client/index.tsx      đăng ký toolview
  client/EvidenceCard.tsx, TicketCard.tsx, TicketTable.tsx, DocList.tsx
scripts/
  install-presets.mjs   copy presets/* vào <DSH_HOME>/.agent-presets/
  provision-user.mjs    tạo storage/users/{u}/docs + in hướng dẫn cho owner
  doctor.mjs            đọc platform.db (read-only) để kiểm tra allowedFolders/preset của từng subuser đúng quy ước
  seed-demo.mjs         tạo dữ liệu TC-01/05
tests/                  vitest (xem mục 7)
```

## 4. Thiết kế chi tiết

### 4.1 Scope (`scope.ts`)
- Chuẩn hóa cwd: `path.resolve`, rồi `realpath` nếu tồn tại, so sánh không phân biệt hoa thường trên win32, đổi `\` thành `/`.
- `rel = relative(storageRoot, cwd)`:
  - `users/{u}` hoặc `users/{u}/...` → user `u`, `u` phải khớp `^[A-Za-z0-9_-]{3,32}$` (cùng luật tên của dsh-passwords);
  - `admin` hoặc `admin/...` → Admin;
  - còn lại → `null`.
- `allowedScopes(scope)`: user → `['public', 'user:u']`; Admin → `['public']`. Admin không tìm trong tài liệu của user.

### 4.2 Guard (`guard.ts`, đăng ký toàn cục trong `docshield-core`)
```
guard(exec):
  s = resolveScope(exec.agent?.session.header.cwd)
  if cwd nằm trong storageRoot và s == null → từ chối "Workspace không hợp lệ"
  if s == null → undefined (phiên ngoài DocShield: không can thiệp)
  if exec.name ∉ ALLOWED[s.role] → từ chối "Công cụ không được phép trong DocShield"
```
`ALLOWED.user = {scoped_doc_search, answer_with_evidence, create_support_ticket, check_ticket_status}`. `ALLOWED.admin` gồm thêm `{list_tickets, update_ticket, publish_public_doc, list_documents, reindex_document}`.
Guard vẫn chặn được khi owner lỡ tick `标准模式` cho subuser (kiểm tra ở TC-08).

### 4.3 Presets
`agent.cordis.yml` (docshield):
```yaml
- id: persona
  name: '@deepseek-ai/dsh-persona'
  config: { complete: true, includeRuntimeContext: false, prefix: <luật trả lời tiếng Việt> }
- id: docshield-tools
  name: 'dsh-docshield/tools'
  config: { role: user }
- id: compaction-basic        # giữ để hội thoại dài không vỡ context
  name: '@deepseek-ai/dsh-compaction-basic'
```
`docshield-admin` giống hệt, chỉ khác `role: admin`. `preset.yml` đặt tên hiển thị "DocShield" / "DocShield Admin".

Luật trong persona:
1. Luôn gọi `scoped_doc_search` trước khi trả lời câu hỏi về nội dung.
2. Có kết quả thì trả lời **chỉ** bằng `answer_with_evidence`, trích dẫn đúng câu chữ.
3. Không có kết quả hoặc dưới ngưỡng thì nói "Không tìm thấy thông tin này trong tài liệu hiện hành" và gọi `create_support_ticket`.
4. Không suy diễn, không dùng kiến thức ngoài tài liệu.
5. Không bàn về người dùng khác.

### 4.4 Dữ liệu (`docshield.db`)
```sql
documents(id PK, scope TEXT, doc_key TEXT, filename TEXT, path TEXT, sha256 TEXT, bytes INT,
          version INT, status TEXT CHECK(status IN('active','superseded','failed')), error TEXT,
          created_at, UNIQUE(scope, doc_key, version))
chunks(id PK, document_id FK, ord INT, text TEXT, locator TEXT)   -- locator: "tr.3 · Điều 5"
vec_chunks USING vec0(scope TEXT PARTITION KEY, embedding FLOAT[1024])  -- rowid = chunks.id
tickets(id PK AUTOINCREMENT, user_id TEXT, session_id TEXT, question TEXT, reason TEXT,
        status TEXT CHECK(status IN('open','in_progress','resolved')), admin_reply TEXT,
        created_at, updated_at)                                        -- mã = 'TICK-' || id
```
- WAL, `busy_timeout=5000`, mọi thao tác ghi dùng `BEGIN IMMEDIATE`.
- Supersede: `UPDATE documents SET status='superseded'` cho các bản cùng `(scope, doc_key)` cũ hơn, rồi `DELETE FROM vec_chunks WHERE rowid IN (...)`, trong cùng transaction với việc ghi bản mới.

### 4.5 Ingest
- **Nguồn 1, đính kèm trong chat:** nghe sự kiện phiên có user message chứa file (hình dạng sự kiện xác minh ở M0). Lấy `fileHostPath(ref)` rồi `sanitize`, copy vào `storage/users/{u}/docs/`. Nếu phiên của Admin thì copy vào `public_docs/` với `doc_key` = tên file bỏ đuôi `_vN`. Sau đó `indexer.ingest`. Kết quả được đưa vào context bằng `agent.inject` ("Đã nạp cv_alice.txt, 3 đoạn").
- **Nguồn 2, thả file vào thư mục** (seed demo / Admin): `fs.watch` trên `users/*/docs` và `public_docs`, debounce 1 giây, bỏ qua nếu sha256 không đổi.
- `sanitize`:
  - chỉ lấy `basename`;
  - loại ký tự `<>:"/\|?*`, ký tự điều khiển và `..`;
  - tên tối đa 120 ký tự;
  - đuôi thuộc `{.pdf, .txt, .md}`, dung lượng ≤ 10MB;
  - đích đến, sau khi `realpath`, phải nằm trong thư mục docs của đúng scope. Đây là phần kiểm cho TC-04.
- PDF không trích được chữ thì gán `status='failed'`, `error='PDF scan (chưa hỗ trợ OCR)'`.

### 4.6 Công cụ
| Công cụ | Vai trò | Input → Output (giá trị chuẩn) |
|---|---|---|
| `scoped_doc_search` | user, admin | `{query, k?≤8}` → `{hits:[{chunkId, filename, locator, excerpt, score, scope}], belowThreshold}`. Kết quả được ghi vào sổ theo `sessionId`. |
| `answer_with_evidence` | user, admin | `{answer, citations:[{chunkId, quote}]≥1}` → `{answer, evidence:[{filename, locator, quote}]}`. Báo lỗi nếu `chunkId` chưa từng được trả về trong phiên, nằm ngoài phạm vi, đã superseded, hoặc `quote` không phải chuỗi con của chunk (so sau khi chuẩn hóa khoảng trắng và NFC). |
| `create_support_ticket` | user, admin | `{question, reason}` → `{code, status:'open'}` |
| `check_ticket_status` | user: chỉ ticket của mình; admin: tất cả | `{code}` → `{code, status, admin_reply?, updated_at}` |
| `list_tickets` | admin | `{status?}` → `{tickets:[…]}` |
| `update_ticket` | admin | `{code, status, reply?}` → ticket |
| `publish_public_doc` | admin | `{filename (trong public_docs), doc_key}` → `{doc_key, version, superseded:[…]}` |
| `list_documents` | user: của mình + public; admin: public | → danh sách, gồm cả trạng thái `failed` |
| `reindex_document` | admin | `{doc_key}` |

Mỗi công cụ dùng `output.presentationMeta` để lưu dữ liệu cần cho thẻ, nên xem lại lịch sử vẫn hiển thị đúng.

### 4.7 Client
Đăng ký `tool.call.toolview` theo từng tên công cụ:
- `answer_with_evidence` → **EvidenceCard**: câu trả lời kèm danh sách (tên file · locator · trích dẫn).
- `create_support_ticket` / `check_ticket_status` → **TicketCard** màu vàng: `#TICK-xxx`, trạng thái, nút "Xem tiến độ". Nút này gửi prompt "Kiểm tra ticket TICK-xxx", nên không cần endpoint riêng.
- `list_tickets` → **TicketTable**. `list_documents` → **DocList**.
- `scoped_doc_search` → hàng thu gọn (số kết quả, điểm cao nhất).
- Dữ liệu lỗi hoặc không đúng dạng thì quay về hàng mặc định (fallback), đúng theo hướng dẫn của DSH.

## 5. Thứ tự triển khai

| Mốc | Nội dung | Tiêu chí xong |
|---|---|---|
| **M0: Xác minh kỹ thuật** (0,5–1 ngày) | (1) `tools.restrict({allow: []})` chạy được trong row của preset và liệt kê được công cụ toàn cục mà agent nhìn thấy; (2) preset trong `<DSH_HOME>/.agent-presets` hiện trong mục "Agent modes" của gateway; (3) hình dạng sự kiện file đính kèm và `fileHostPath` hoạt động với subuser; (4) bundle client plugin tải được qua gateway cho subuser; (5) `sqlite-vec` nạp được trong `node:sqlite` trên Windows, bge-m3 int8 chạy được (đo RAM và thời gian); (6) định dạng `header.cwd` trên Windows | Mỗi mục có kết luận. Mục nào thất bại thì chọn phương án thay thế trước khi sang M1 |
| **M1: Khung + an ninh** | package, cordis.yml, scope, guard, 2 preset, tools/index (công cụ giả), install-presets, provision-user, doctor | TC-03, TC-07, TC-08 đạt |
| **M2: Ingest + index** | schema DB, sanitize, parse, chunk, embedder, indexer, watcher, attachments | TC-04 đạt, file thả vào được index |
| **M3: Tìm kiếm + bằng chứng** | search, sổ evidence, `answer_with_evidence`, persona, hiệu chỉnh `minScore` trên bộ mẫu | TC-01 đạt |
| **M4: Ticket + Admin** | ticket, check/list/update, list_documents | TC-02, TC-06 đạt |
| **M5: Thay tài liệu chung** | `publish_public_doc`, supersede | TC-05 đạt |
| **M6: Thẻ UI** | client plugin, 4 thẻ | Kiểm tra trực quan qua gateway với alice và owner |
| **M7: Kiểm thử đầu-cuối + demo** | seed-demo, kịch bản demo, README vận hành | TC-01 đến TC-09 đạt trên môi trường thử nghiệm |

## 6. Phụ thuộc
- `@huggingface/transformers` (bge-m3 ONNX int8, tải model khoảng 570MB vào `storage/.docshield/models`, **cần bạn đồng ý tải khi tới M2**).
- `sqlite-vec` (loadable extension cho Windows x64).
- `unpdf` (trích chữ PDF).
- Dev: `typescript`, `esbuild`, `vitest`.
- Import kiểu từ `@deepseek-ai/dsh-*` 0.1.6-alpha.2 (peerDependencies).

## 7. Kiểm thử
**Unit (vitest):**
- `scope.spec`: đường dẫn Windows/POSIX, hoa thường, symlink, `users/../admin`, tên sai luật.
- `sanitize.spec`: `../public_docs/x.pdf`, `..\..\roles.json`, tên Unicode, đuôi sai, >10MB.
- `chunk.spec`: văn bản có "Điều N", văn bản thường, tiếng Việt có dấu.
- `evidence.spec`: chunk chưa từng tìm, chunk ngoài phạm vi, chunk superseded, quote không khớp, quote khớp sau khi chuẩn hóa.
- `tickets.concurrency.spec`: 5 tiến trình (worker) cùng tạo ticket → đủ 5 mã, không trùng (TC-06).
- `replace.spec`: v1 rồi v2 cùng `doc_key` → tìm kiếm chỉ trả chunk của v2 (TC-05).
- `retrieval.isolation.spec`: dữ liệu của alice không bao giờ xuất hiện khi tìm với scope của bob, ngay cả khi query giống hệt (TC-01).

**Đầu-cuối** (thao tác qua gateway 3443, có checklist trong README):
| TC | Nội dung |
|---|---|
| 01–06 | Như bản thiết kế |
| 07 *(mới)* | Bob yêu cầu agent "đọc file storage/users/alice/docs/cv_alice.txt" → không có công cụ nào đọc được; nếu lách được thì guard từ chối |
| 08 *(mới)* | Owner lỡ tick `标准模式` cho bob → trong workspace bob, các lệnh bash/read vẫn bị guard từ chối |
| 09 *(mới)* | Sidebar của bob không thấy workspace hay phiên của alice (đã đạt ở lần chạy thử, giữ làm regression) |

## 8. Rủi ro và việc cần bạn
- **API key DeepSeek:** cần để chạy M3 trở đi. Bạn tự nhập trong cài đặt model của owner hoặc trong `.env`.
- **Tải model bge-m3 (~570MB):** hỏi lại trước khi tải, ở M2.
- **Model có thể bỏ qua luật, trả lời tự do không qua công cụ.** Code chặn được trích dẫn sai, nhưng không ép được model luôn gọi công cụ. Giảm thiểu bằng persona `complete:true`, kiểm TC-02 với nhiều câu bẫy, và ghi log các lượt trả lời không có evidence hay ticket. Hạn chế này sẽ được ghi rõ trong tài liệu demo.
- **URL token của cổng 3090** vào thẳng DSH, không qua gateway. Không đưa URL này cho người dùng. Cổng 3090 chỉ nghe trên loopback.
- **DSH là bản alpha:** ghim đúng `0.1.6-alpha.2` cho cả DSH và `dsh-passwords` 2.7.3.
- **Owner phải cấp quyền đúng quy ước** (mỗi subuser chỉ `users/{u}`, chỉ preset `DocShield`). `doctor.mjs` sẽ phát hiện cấu hình sai.
