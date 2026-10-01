# DSH-DocShield — ghi chú cho agent

Người dùng viết tiếng Việt; trả lời tiếng Việt.

## Bố cục máy (ngoài repo)
- `E:\Deepseek_Harness\spike-dshpw\` là môi trường chạy thật dù tên "spike": `dsh\` (DSH 0.1.6-alpha.2 cài từ npm), `dsh-home\` (profile + template), `storage\` (**dữ liệu thật** của người dùng). Không đổi tên/di chuyển: workspace và phiên DSH lưu theo đường dẫn tuyệt đối.
- `E:\Deepseek_Harness\deepseek-harness\` là mã nguồn DSH gốc — chỉ đọc, không sửa.
- `E:\Deepseek_Harness\start-gate.cmd` (CRLF — sửa bằng Edit, không dùng `sed -i`, vì sed của Git Bash đổi sang LF).
- `E:\Deepseek_Harness\_archive\` chứa đồ cũ (dsh-passwords mode, spike M0–M3).

## Bẫy
- Profile DSH nạp DocShield qua junction `spike-dshpw\dsh-home\profiles\web\node_modules\dsh-docshield` → `dsh-docshield\docshield`. Đổi chỗ package thì sửa cả junction, `package.json` và `pnpm-lock.yaml` của profile.
- Home trong `gate/var/homes/<u>` có junction `node_modules` trỏ về profile trên. Xóa home: `cmd /c rmdir` junction trước, **không** `rm -rf` xuyên qua nó.
- Không bao giờ mount DB SQLite của Windows vào container Linux (WAL qua 2 hệ điều hành = hỏng DB).
- `docker.exe` không có trong PATH của shell: dùng `E:\Docker\DockerDesktop\resources\bin\docker.exe`.
- Docker Desktop hỏng sau khi tắt máy không sạch ("sailor-ingest.sock / engine.sock cannot be accessed"): tắt tiến trình docker, đổi tên `%LOCALAPPDATA%\Docker\run` và `%LOCALAPPDATA%\docker-secrets-engine`, mở lại. `gate/bin/ensure-docker.ps1` tự làm việc này.
- `gate/var/`, `gate/var-test/` chứa tài khoản, khóa cookie, API key — đã gitignore, không bao giờ commit.
- Không tự bật/tắt gate hay DSH của người dùng; hỏi trước.
- Repo GitHub là public: không đưa báo cáo LaTeX (`E:\Deepseek_Harness\bao-cao\`) hay dữ liệu thật vào.
