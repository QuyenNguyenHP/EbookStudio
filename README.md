# EbookStudio

Trình đọc PDF cá nhân, giao diện tham khảo Local-AI/web-chat và sao chép logo DQ từ dự án đó. Hệ màu dùng gradient từ đúng hai màu thương hiệu của logo: cam `#F44911` và xanh `#0991DF`.

## Chạy

Cần Python 3. Chạy `./start.ps1` trong PowerShell, rồi mở http://127.0.0.1:1997. Có thể chạy trực tiếp `python server.py`. Không dùng `python -m http.server` hoặc mở `index.html` bằng `file://`, vì chức năng lưu PDF vào `Libaries` cần API của `server.py`.

## Chạy nền bằng systemd (Linux)

Hướng dẫn này giả sử mã nguồn được đặt tại `~/EbookStudio`. Tạo thư mục chứa service và bảo đảm thư viện PDF tồn tại:

```bash
mkdir -p ~/.config/systemd/user
mkdir -p ~/EbookStudio/Libaries
```

Tạo `~/.config/systemd/user/ebookstudio.service` với nội dung:

```ini
[Unit]
Description=EbookStudio PDF reader
After=network.target

[Service]
Type=simple
WorkingDirectory=%h/EbookStudio
ExecStart=/usr/bin/python3 %h/EbookStudio/server.py
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
```

Nạp cấu hình, bật dịch vụ khi khởi động và chạy ngay:

```bash
systemctl --user daemon-reload
systemctl --user enable --now ebookstudio
systemctl --user status ebookstudio
```

Ứng dụng sẽ chạy tại http://127.0.0.1:1997. Xem log bằng:

```bash
journalctl --user -u ebookstudio -f
```

Sau khi cập nhật mã nguồn, khởi động lại dịch vụ:

```bash
systemctl --user restart ebookstudio
```

Nếu muốn dịch vụ tiếp tục chạy sau khi đăng xuất và tự khởi động cùng máy, bật `linger` một lần:

```bash
sudo loginctl enable-linger "$USER"
```

Máy chủ hiện chỉ lắng nghe trên `127.0.0.1`, phù hợp khi truy cập ngay trên máy hoặc đặt sau reverse proxy. Không mở trực tiếp cổng này ra Internet nếu chưa bổ sung xác thực và HTTPS.

## Tính năng

- Thư viện là trang chủ. Khi mở ứng dụng, người dùng chọn sách hoặc tài liệu trong gallery rồi mới chuyển sang trình đọc.
- Mở sẵn Ryden_IntroCosmo.pdf; thêm một hoặc nhiều PDF bằng nút Thêm tài liệu PDF. Máy chủ cục bộ lưu tệp vào `C:\Users\duyqu\Desktop\githup\EbookStudio\Libaries`; gallery Thư viện đọc trực tiếp danh sách PDF từ thư mục này.
- Cuộn liên tục qua các trang; ứng dụng chỉ dựng những trang gần vùng nhìn để giữ hiệu năng với tài liệu dài. Có thể nhập số trang để cuộn nhanh đến vị trí cần đọc, phóng to/thu nhỏ, vừa chiều rộng và dùng chế độ tập trung.
- Chế độ **Trang đôi** giữ trang bìa đứng riêng rồi ghép các cặp 2–3, 4–5… để xem trọn các bản trải rộng. Chế độ này tự bật với `Daihatsu Gensets Engine Catalog.pdf` và có thể bật/tắt cho mọi tài liệu từ thanh công cụ.
- Khi bôi đen nội dung PDF, thanh công cụ cạnh đoạn chọn cho phép Tra từ, Highlight hoặc Ghi chú. Chọn lại đúng đoạn đã highlight để bỏ highlight. Bảng tra từ tối giản chỉ hiện từ, IPA, nghĩa, nghe phát âm và lưu từ; hỗ trợ nhập thủ công. Dịch đoạn tối đa 500 byte.
- Lưu từ vựng, ghi chú theo trang, sửa/xóa, tô sáng đoạn đã ghi chú, đánh dấu trang và xuất ghi chú/từ vựng thành Markdown.
- Lưu tiến độ, từ và ghi chú trong localStorage; lưu PDF nhập vào thư mục `Libaries`. Nhận diện tài liệu bằng fingerprint PDF để giữ liên kết tiến độ và ghi chú. Tệp trùng tên được tự thêm hậu tố `(1)`, `(2)` để không ghi đè.

## Dịch vụ và giới hạn

IPA ưu tiên bộ từ điển Anh–Mỹ **125.927 mục từ** lưu tại `public/dictionaries/en-US.json`, từ dự án [ipa-dict](https://github.com/open-dict-data/ipa-dict). Không cần Internet để tra các mục từ này; IPA hiển thị trước khi bản dịch tải xong. Tự chuẩn hóa dấu câu ở đầu/cuối từ, dấu nháy cong, ligature và dấu ngắt từ trong PDF. Các cách đọc khác nhau được giữ nguyên, chưa phân biệt theo ngữ cảnh.

Bộ 20 từ vũ trụ học Anh–Anh và Dictionary API là các nguồn bổ sung khi thiếu mục từ. Màn hình ghi rõ nguồn/giọng và phân biệt lỗi kết nối với từ chưa có dữ liệu. Tra lại rồi lưu một từ đã có sẽ cập nhật IPA/nghĩa, không tạo bản trùng. Bản quyền và nguồn dữ liệu nằm trong `public/dictionaries/ATTRIBUTION.md`.

Kiểm tra IPA: nếu có Node.js, chạy `node tests/pronunciation.test.mjs` (không cần cài npm dependencies).

PDF.js 4.10.38 được lưu tại public/vendor (Apache-2.0, kèm LICENSE), nên đọc PDF không cần CDN. Bản dịch dùng https://mymemory.translated.net/doc/spec.php; IPA dùng dữ liệu cục bộ; https://dictionaryapi.dev/ là nguồn dự phòng. Chỉ văn bản cần tra trực tuyến được gửi tới dịch vụ. Bản dịch trực tuyến cần Internet và chịu hạn mức/độ sẵn sàng của dịch vụ. Không phải mọi từ đều có IPA. Phát âm dùng giọng tiếng Anh của trình duyệt. PDF scan chưa có OCR; hãy nhập từ thủ công. Ghi chú là lớp phủ của ứng dụng, không nhúng vào tệp PDF. Hãy xuất Markdown để sao lưu; xóa dữ liệu trình duyệt sẽ mất dữ liệu đã lưu. Bản dịch thuật ngữ chuyên ngành cần được đối chiếu theo ngữ cảnh.
