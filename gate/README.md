# dsh-gate

Cổng đăng nhập đa người dùng cho DeepSeek Harness (DSH), thay cho dsh-passwords.

**Ý tưởng:** không lọc một DSH dùng chung, mà cho **mỗi người dùng một tiến trình DSH riêng**. Gate chỉ làm ba việc: xác thực, khởi động DSH của người đó, và chuyển tiếp HTTP + WebSocket tới đúng DSH.

```
Trình duyệt ──► dsh-gate :3444 (đăng nhập, cookie ký, chuyển tiếp)
                  ├─ alice ─► DSH riêng  (DSH_HOME = var/homes/alice)
                  ├─ bob   ─► DSH riêng  (DSH_HOME = var/homes/bob)
                  └─ admin ─► DSH riêng  (DSH_HOME = var/homes/<admin>)
                 dịch vụ embedding bge-m3 dùng chung :3490
```

- **Cách ly phiên:** Bob không thể thấy phiên hay workspace của Alice, vì chúng nằm ở một DSH khác. Gate không cần lọc hay viết lại dữ liệu RPC của DSH.
- **Danh tính rõ ràng:** gate khởi động DSH của từng người kèm một patch (`var/homes/<u>/gate.patch.yml`). Patch này cài `identity` cho DocShield, bật embedding dùng chung, và đặt chế độ agent DocShield làm mặc định. DocShield không còn phải suy ra người dùng từ thư mục của phiên.
- **Không vá DSH:** gate đọc URL `dsh web: …/?token=` mà DSH con in ra, tự đổi token lấy cookie của DSH rồi gắn cookie đó khi chuyển tiếp. Trình duyệt chỉ giữ cookie của gate.

## Chạy

```
E:\Deepseek_Harness\start-gate.cmd
```
Mở http://127.0.0.1:3444. Mỗi DSH riêng khởi động khi người dùng đăng nhập (mất khoảng 10–20 giây) và tự tắt sau 30 phút không có hoạt động.

## Cho máy khác truy cập

| Cách | Lệnh | Ai vào được |
|---|---|---|
| Chỉ máy này (mặc định) | `start-gate.cmd` | http://127.0.0.1:3444 |
| Cùng mạng LAN | `start-gate.cmd lan` + mở cổng 3444 trên tường lửa (loại mạng Private) | `http://<IP máy này>:3444`, HTTP không mã hóa |
| Qua internet bằng link | `start-gate.cmd tunnel` (cần cài `cloudflared`) | `https://….trycloudflare.com`, có HTTPS, không cần mở cổng |

Chế độ tunnel bật `GATE_TRUST_PROXY=1`. Khi đó gate lấy IP thật của người dùng từ header `CF-Connecting-IP`, để chống dò mật khẩu và giới hạn đăng ký theo từng người chứ không gộp chung một IP. Header này chỉ được tin khi request đến từ chính máy này. Cookie cũng được gắn cờ `Secure`. Link quick tunnel đổi mỗi lần chạy; tắt cửa sổ tunnel là ngắt truy cập từ ngoài.

## Chạy mỗi người dùng trong một container (thử nghiệm, sandbox S0–S4)

Đặt `GATE_RUNTIME=docker` thì DSH của mỗi người chạy trong một container Docker riêng (`gate-dsh-<tên>`), không chạy như tiến trình con trên Windows. Cách nhanh nhất:

```
E:\Deepseek_Harness\start-gate.cmd docker            # có thể ghép thêm: tunnel | lan
E:\Deepseek_Harness\start-gate.cmd docker rebuild    # build lại image sau khi sửa code
```

Trước khi bật gate, `bin/ensure-docker.ps1` tự làm các việc sau:
- nếu Docker Desktop đang tắt thì mở nó, sau khi dọn các file `.sock` cũ mà lần tắt máy không sạch để lại (chúng làm Docker Desktop crash khi khởi động);
- chờ engine sẵn sàng;
- build image nếu chưa có.

Lệnh tương đương khi chạy tay:

```
cd E:\Deepseek_Harness\dsh-docshield
npm run build
docker build -f container/Dockerfile -t docshield-dsh:dev .
set GATE_RUNTIME=docker
node gate\bin\gate.mjs serve
```

```
Trình duyệt ─► gate :3444 ─► container gate-dsh-alice (DSH + plugin DocShield mỏng)
                               │  thấy: home (volume dsh-home-alice) + storage/users/alice
                               └─ HTTP + token ─► dịch vụ DocShield :3492 (Windows)
                                                   DB, watcher, nạp tài liệu, tìm kiếm
                                                   └─► embedding bge-m3 :3490
```

- **Image** (`container/Dockerfile`): Node 24, DSH 0.1.6-alpha.2 và DocShield (không kèm model). Container chạy bằng user `node`, không phải root.
- **Container chỉ thấy** home của mình (volume `dsh-home-<tên>`) và **đúng thư mục của mình** (`storage/users/<tên>`, admin: `storage/admin`). Container không thấy DB, không thấy thư mục của người khác, không thấy phần còn lại của ổ đĩa.
- **Dịch vụ DocShield** (`scripts/docshield-server.mjs`, cổng `GATE_DOCSHIELD_PORT`, mặc định 3492) do gate chạy. Đây là tiến trình **duy nhất** mở DB. Nó theo dõi toàn bộ kho và nhận lời gọi công cụ cùng file đính kèm từ các container.
- **Token:** mỗi lần khởi động container, gate sinh một token ngẫu nhiên và đăng ký token đó với dịch vụ, kèm danh tính của tài khoản. Khi container dừng, gate thu hồi token.
  - Dịch vụ xác định người gọi **chỉ từ token**. Container tự khai là admin cũng không được.
  - Đăng ký token cần khóa quản trị. Khóa này sinh mới mỗi lần gate chạy và chỉ gate cùng dịch vụ biết.
  - Dịch vụ khởi động lại thì gate đăng ký lại token của các container đang chạy.
- **Giới hạn tài nguyên:** 1 GB RAM, 2 CPU, tối đa 512 tiến trình (đổi bằng `GATE_DOCKER_MEMORY`, `GATE_DOCKER_CPUS`). Mỗi container dùng khoảng 130 MB khi rảnh.
- **Cổng:** chỉ mở trên `127.0.0.1` của máy này. Cookie của DSH vẫn chặn mọi truy cập không đi qua gate.
- **API key của model không vào container** (S2): gate chạy một **proxy model** (`GATE_LLM_PORT`, mặc định 3494, chỉ nghe trên 127.0.0.1) và chỉ proxy giữ key thật. Trong settings của container, `baseURL` của mỗi provider trỏ về `http://host.docker.internal:<cổng>/llm/<provider>`, còn biến key (`apiKeyEnv`, ví dụ `NIEN_ROUTER_API_KEY`) chứa **token của container**. Proxy chỉ nhận token của container đang chạy, thay bằng key thật rồi chuyển tiếp nguyên luồng stream. Container dừng thì token mất hiệu lực. `/template` và home không chứa key hay khóa ký nào; mỗi container tự sinh khóa ký cookie riêng. Provider không có `baseURL` + key thì không được proxy.
- **Chặn mạng** (S3, `container/firewall.mjs` + `start.sh`): container khởi động bằng root **chỉ để** cài `iptables`, rồi `exec` sang user `node`. Sau bước này trong container không còn tiến trình root nào, mọi capability bị bỏ (bounding set rỗng) và `no_new_privs` bật, nên agent không gỡ được tường lửa. Kết nối ra ngoài chỉ được tới `host.docker.internal` ở **đúng 2 cổng**: dịch vụ DocShield và proxy model. Bị chặn: gate, 9Router, embedding, các cổng khác của máy, container của người khác, LAN, internet và DNS. IPv6 tắt. Cài tường lửa lỗi thì container không khởi động. `GATE_DOCKER_INTERNET=1` cho phép thêm DNS và internet công cộng, nhưng vẫn chặn máy chủ và LAN.
- **Agent có lại đủ công cụ** (S4): container dùng preset **DocShield + công cụ** (`docshield-harness`, admin: `docshield-admin-harness`). Preset này gồm toàn bộ công cụ của preset Standard của DSH (shell, đọc/ghi/sửa file, tìm file, job, skill, lập kế hoạch, subagent…) cộng các công cụ DocShield, và được `container/make-harness-presets.mjs` sinh lúc build image từ đúng bản DSH trong image. Riêng plugin-manager bị bỏ. Câu hỏi về nội dung tài liệu vẫn bắt buộc tra bằng DocShield và có trích dẫn. Guard của DocShield chỉ cho các công cụ này chạy khi có `allowOtherTools`; tùy chọn này chỉ hợp lệ cùng `serviceUrl`, tức chỉ trong container. Chế độ chạy thẳng trên Windows vẫn khóa công cụ. Bên trong container, bash và file vẫn đi qua sandbox `workspace-write` của DSH (Landlock, kiểm tra được `full`) và vẫn hỏi duyệt như DSH bình thường. File agent tạo trong `docs/` được dịch vụ DocShield tự nạp.
- **Tắt đột ngột:** container còn sót từ lần gate bị tắt ngang sẽ được xóa khi gate khởi động lại.


## Thiết lập lần đầu

Khi chưa có tài khoản nào, cửa sổ gate in ra một **mã thiết lập** dùng một lần, và mọi trang đều chuyển về `/gate/setup`. Nhập mã đó cùng tên và mật khẩu để tạo **admin** đầu tiên; gate đăng nhập luôn cho bạn. Có tài khoản rồi thì trang này tự khóa. Nhập sai mã nhiều lần cũng bị khóa tạm, giống như đăng nhập sai.

## Tự đăng ký và quản trị trên web

- **Đăng ký** (`/gate/register`, có link ở trang đăng nhập): người dùng tự chọn tên và mật khẩu. Tài khoản mới ở trạng thái *chờ duyệt*: chưa đăng nhập được và chưa có DSH riêng. Tên dành riêng (`admin`, `root`, `public`…) bị chặn. Mỗi IP gửi tối đa 5 đơn mỗi giờ, và tổng số đơn chờ duyệt không vượt quá 50.
- **Quản trị** (`/gate/admin`, nút "Quản trị" trên thanh đầu trang, chỉ admin thấy):
  - duyệt hoặc từ chối đơn đăng ký;
  - khóa hoặc mở khóa tài khoản;
  - cấp hoặc bỏ quyền admin;
  - đặt lại mật khẩu;
  - bật hoặc tắt tự đăng ký;
  - xem nhật ký.

  Khi khóa, đổi vai trò hoặc đặt lại mật khẩu, phiên đăng nhập cũ của người đó mất hiệu lực ngay và DSH riêng của họ bị tắt. Admin không tự khóa hay tự hạ quyền mình được, và hệ thống luôn còn ít nhất một admin.
- **Đặt lại mật khẩu:** gate sinh một mật khẩu tạm và hiện **một lần** cho admin. Lần đăng nhập sau, người dùng bị bắt đổi mật khẩu mới trước khi dùng tiếp.
- **Đổi mật khẩu** (`/gate/password`): ai cũng dùng được. Các phiên đăng nhập khác của người đó bị đăng xuất.

## Tài khoản (dòng lệnh, chạy trong thư mục này)

| Lệnh | Việc |
|---|---|
| `node bin/gate.mjs user add <tên> [--role admin]` | Tạo tài khoản; hỏi mật khẩu 2 lần (tối thiểu 8 ký tự) |
| `node bin/gate.mjs user passwd <tên>` | Đổi mật khẩu; mọi phiên đăng nhập cũ bị hủy |
| `node bin/gate.mjs user disable\|enable <tên>` | Khóa hoặc mở khóa tài khoản |
| `node bin/gate.mjs user approve\|reject <tên>` | Duyệt hoặc từ chối đơn tự đăng ký |
| `node bin/gate.mjs user list` | Liệt kê tài khoản |
| `node bin/gate.mjs audit [n]` | Xem n dòng nhật ký gần nhất (đăng nhập, sai mật khẩu, đổi mật khẩu…) |

Tên tài khoản của người dùng chính là tên thư mục `storage/users/<tên>`. Tài khoản `--role admin` làm việc trong `storage/admin` với chế độ DocShield Admin.

## Bảo mật

- Mật khẩu băm bằng scrypt (N=16384, r=8, p=1).
- Cookie `gate_session` được ký HMAC-SHA256, có HttpOnly, SameSite=Lax và hết hạn sau 12 giờ. Cookie mang `credential_version`, nên khi đổi mật khẩu hoặc khóa tài khoản thì mọi cookie cũ mất hiệu lực.
- Form đăng nhập có CSRF (double-submit).
- Sai 5 lần thì khóa tạm, thời gian khóa tăng dần 1 → 5 → 15 → 60 phút. Một IP sai quá 50 lần trong 15 phút cũng bị khóa. Người dùng không tồn tại vẫn tốn thời gian kiểm tra như người dùng có thật, để không lộ tên tài khoản.
- Chưa đăng nhập thì mọi trang bị chuyển sang trang đăng nhập; mọi `/api/*` và WebSocket trả 401.
- Tham số `next` chỉ chấp nhận đường dẫn tương đối, để chặn chuyển hướng ra ngoài.
- Gate và các DSH con chỉ nghe trên 127.0.0.1. Gọi thẳng vào cổng của DSH con mà không có cookie thì DSH tự chặn.

## Giới hạn hiện tại

- Mỗi DSH riêng vẫn cho người dùng tự chọn thư mục làm workspace. DocShield đã khóa danh tính theo tài khoản và guard vẫn chặn mọi công cụ ngoài DocShield. Tuy vậy, muốn trả lại shell/đọc file cho agent (để DSH đúng nghĩa là "harness") thì phải có **sandbox theo người dùng** trước: tài khoản Windows riêng hoặc container chỉ mount thư mục của người đó. Sandbox có sẵn của DSH chỉ giới hạn ghi, không giới hạn đọc.
- Tài liệu chung (`public_docs`) chỉ được nạp khi DSH của admin đang chạy, vì mỗi DSH chỉ nạp phần của mình để không nạp trùng.
- Mỗi DSH riêng tốn khoảng 140 MB RAM khi rảnh. Model bge-m3 chỉ nạp một lần, trong dịch vụ embedding dùng chung.

## Phát triển

```
npm test                 # node:test, không có dependency ngoài
GATE_VAR_DIR=... GATE_PORT=... GATE_IDLE_MINUTES=... node bin/gate.mjs serve
```
Thư mục `var/` chứa `gate.db`, `secret.key` và các DSH home; không đưa lên git. Mỗi home chứa một **junction** `profiles/web/node_modules` trỏ tới profile mẫu. Khi xóa home, gỡ junction bằng `rmdir` trước, **không** dùng `rm -rf` xuyên qua junction.
