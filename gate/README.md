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
