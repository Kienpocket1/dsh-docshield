# DSH-DocShield

Chatbot tra cứu tài liệu nội bộ cho nhiều người dùng, chạy trên DeepSeek Harness (DSH).

| Thư mục | Nội dung |
|---|---|
| [`docshield/`](docshield/README.md) | Plugin DSH: tìm kiếm có trích dẫn kiểm chứng, nạp tài liệu, phiếu hỗ trợ, thẻ giao diện |
| [`gate/`](gate/README.md) | Cổng đăng nhập, đăng ký, quản trị tài khoản đứng trước DSH |
| `container/` | Image Docker cho sandbox |
| `project3/` | Dữ liệu cho Project 3 (agent tự bồi đắp kho tri thức) |

## Chạy
```
E:\Deepseek_Harness\start-9router.cmd          # model chat
E:\Deepseek_Harness\start-gate.cmd docker      # gate + sandbox → http://127.0.0.1:3444
```

## Phát triển
```
cd docshield && npm run build && npm test      # 95 test
cd gate && npm test                            # 39 test
```

Nhánh `per-user-dsh` (tag `s4-per-user-dsh`) giữ kiến trúc "mỗi user một DSH trong container" (S0–S4).
Đang chuyển sang kiến trúc 1 DSH chung + sandbox chỉ chứa công cụ.
