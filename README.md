# EbookStudio

Trình đọc PDF cá nhân, giao diện tham khảo Local-AI/web-chat và sao chép logo DQ từ dự án đó. Hệ màu dùng gradient từ đúng hai màu thương hiệu của logo: cam `#F44911` và xanh `#0991DF`.

## Chạy

Cần Python 3. Chạy `./start.ps1` trong PowerShell, rồi mở http://127.0.0.1:1997. Có thể chạy trực tiếp `python server.py`. Không dùng `python -m http.server` hoặc mở `index.html` bằng `file://`, vì chức năng lưu PDF vào `Libaries` cần API của `server.py`.


### Linux / WSL with Python 3.13+

Python 3.13 removed `cgi`. Install the compatibility dependency in a virtual environment:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
python server.py
```

Open http://127.0.0.1:1997. For subsequent runs, activate `.venv` and run `python server.py`.
If Ubuntu/WSL reports that venv is unavailable, run `sudo apt install python3-venv` and retry.
For systemd, use `ExecStart=/home/dq/EbookStudio/.venv/bin/python /home/dq/EbookStudio/server.py` when using this environment.

## Chạy nền bằng systemd (Linux)

Hướng dẫn này giả sử user Linux là `dq` và mã nguồn nằm tại `/home/dq/EbookStudio` (`~/EbookStudio`). Thư mục `Libaries` được Git bỏ qua; clone mới chỉ có `.gitkeep` và chưa có tài liệu. Tạo thư mục và cấp quyền ghi cho service:

```bash
mkdir -p ~/EbookStudio/Libaries
sudo chown -R dq:dq /home/dq/EbookStudio
```

Tạo system service trực tiếp tại `/etc/systemd/system/ebookstudio.service`:

```bash
sudo nano /etc/systemd/system/ebookstudio.service
```

Thêm nội dung sau:

```ini
[Unit]
Description=EbookStudio PDF reader
After=network.target

[Service]
Type=simple
User=dq
Group=dq
WorkingDirectory=/home/dq/EbookStudio
ExecStart=/usr/bin/python3 /home/dq/EbookStudio/server.py
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
```

Nạp cấu hình, bật dịch vụ khi khởi động và chạy ngay:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now ebookstudio
sudo systemctl status ebookstudio
```

Ứng dụng sẽ chạy tại http://127.0.0.1:1997. Xem log bằng:

```bash
sudo journalctl -u ebookstudio -f
```

Sau khi cập nhật mã nguồn, khởi động lại dịch vụ:

```bash
sudo systemctl restart ebookstudio
```

Máy chủ hiện chỉ lắng nghe trên `127.0.0.1`, phù hợp khi truy cập ngay trên máy hoặc đặt sau reverse proxy. Không mở trực tiếp cổng này ra Internet nếu chưa bổ sung xác thực và HTTPS.

Git bỏ qua toàn bộ nội dung runtime trong `Libaries`, ngoại trừ `.gitkeep`. `git pull` và `git reset --hard` không tác động tới các PDF không được theo dõi. Không chạy `git clean -fdx`, vì tùy chọn `-x` cố ý xóa cả file đã được `.gitignore` bảo vệ.

Để cập nhật mã nguồn đang chạy, `git fetch origin` là chưa đủ. Kiểm tra nhánh hiện tại rồi fast-forward working tree, sau đó khởi động lại service:

```bash
cd ~/EbookStudio
git status
git branch --show-current
git pull --ff-only origin main
sudo systemctl daemon-reload
sudo systemctl restart ebookstudio
sudo systemctl status ebookstudio
```

Kiểm tra bằng `sudo journalctl -u ebookstudio -n 20 --no-pager`; log cần hiện `Library: /home/dq/EbookStudio/Libaries`. Sau khi cập nhật giao diện, tải lại trình duyệt bằng `Ctrl+F5`; các tệp HTML, JavaScript và CSS được gửi với `no-cache` để tránh giữ bản cũ.

## Tính năng

- Thư viện là trang chủ. Clone mới không có tài liệu; người dùng tự tải PDF lên `Libaries`. Trang đầu của mỗi PDF được render đúng tỷ lệ và fit vào thẻ để làm ảnh bìa; ảnh chỉ được tạo khi thẻ đi vào vùng nhìn và được cache trong phiên. Chủ đề, vị trí sách và thứ tự các hàng được lưu tại `Libaries/library.json`, với localStorage làm bản dự phòng khi máy chủ không khả dụng. Người dùng có thể tìm nhanh theo tên sách/tài liệu rồi chọn nội dung trong gallery để chuyển sang trình đọc. Form **Chủ đề mới** tạo các hàng sách; có thể kéo tay nắm ở tiêu đề để sắp xếp chủ đề và kéo thả trực tiếp thẻ sách vào hàng mong muốn để phân loại hoặc đổi vị trí. Hàng **Chưa phân loại** luôn nằm cuối. Có thể xóa PDF khỏi thư viện sau bước xác nhận; tệp bị xóa được chuyển vào `Libaries/.Trash` để có thể khôi phục.
- Thêm một hoặc nhiều PDF bằng nút Thêm tài liệu PDF. Máy chủ lưu tệp trực tiếp vào thư mục `Libaries`; gallery Thư viện đọc danh sách PDF từ thư mục này.
- Cuộn liên tục qua các trang; ứng dụng chỉ dựng những trang gần vùng nhìn để giữ hiệu năng với tài liệu dài. Nếu PDF cung cấp Outline/Bookmarks, nút **Mục lục** hiển thị các heading nhiều cấp và cho phép chuyển thẳng tới phần tương ứng. Thanh navigation cũng có nút về Thư viện, trang trước/trang sau, nhập số trang và phím tắt `Alt+←` / `Alt+→`; chế độ trang đôi tự chuyển theo từng cặp. Có thể phóng to/thu nhỏ ngay tại điểm đang xem, vừa chiều rộng và dùng chế độ tập trung. Khi tài liệu phóng lớn hơn khung đọc, kéo vùng nền bằng con trỏ bàn tay để di chuyển; vẫn có thể bôi đen trực tiếp trên chữ.
- Chế độ **Trang đôi** giữ trang bìa đứng riêng rồi ghép các cặp 2–3, 4–5… để xem trọn các bản trải rộng. Chế độ này tự bật với `Daihatsu Gensets Engine Catalog.pdf` và có thể bật/tắt cho mọi tài liệu từ thanh công cụ.
- Khi bôi đen nội dung PDF, từ hoặc cụm từ được tra và dịch ngay; thanh công cụ cạnh đoạn chọn tiếp tục cho phép Highlight hoặc Ghi chú. Chọn lại đúng đoạn đã highlight để bỏ highlight. Bảng tra từ tối giản chỉ hiện từ, IPA, nghĩa, nghe phát âm và lưu từ; hỗ trợ nhập thủ công. Dịch đoạn tối đa 500 byte. Chế độ tập trung ẩn sidebar thư viện, mở rộng PDF toàn màn hình nhưng vẫn giữ bảng Tra từ, Ghi chú và Từ đã lưu ở bên phải.
- Lưu từ vựng, ghi chú theo trang, sửa/xóa, tô sáng đoạn đã ghi chú, đánh dấu trang và xuất ghi chú/từ vựng thành Markdown.
- Ghi chú và từ vựng được lưu vào `Libaries/reader-data.json` qua API backend; khi mở trang sẽ đọc lại từ file này. Lần đầu chưa có file, dữ liệu từ trình duyệt đang mở được tự chuyển sang backend. Hãy mở bằng trình duyệt có dữ liệu cũ trước. Tiến độ, dấu trang và highlight riêng vẫn nằm trong localStorage. PDF nhập vào được lưu trong `Libaries`. Nhận diện tài liệu bằng fingerprint PDF để giữ liên kết tiến độ và ghi chú. Tệp trùng tên được tự thêm hậu tố `(1)`, `(2)` để không ghi đè.

Backend ghi JSON qua file tạm rồi thay thế nguyên tử. Nếu tab khác đã thay đổi dữ liệu, thao tác lưu bị từ chối để tránh ghi đè; giao diện yêu cầu xuất thay đổi hiện tại rồi tải lại trang. Khi lưu lỗi, bản dự phòng nằm ở localStorage với khóa `ebookstudio-reader-recovery`; giao diện không báo lưu thành công. Sao lưu `Libaries/reader-data.json` cùng các PDF. Dữ liệu dùng chung cho các trình duyệt truy cập cùng server; chưa có tài khoản riêng.

Kiểm tra lưu trữ: `python -m unittest discover -s tests -p test_reader_data.py` và `node tests/reader-data.test.mjs`.

## Dịch vụ và giới hạn

IPA ưu tiên bộ từ điển Anh–Mỹ **125.927 mục từ** lưu tại `public/dictionaries/en-US.json`, từ dự án [ipa-dict](https://github.com/open-dict-data/ipa-dict). Không cần Internet để tra các mục từ này; IPA hiển thị trước khi bản dịch tải xong. Tự chuẩn hóa dấu câu ở đầu/cuối từ, dấu nháy cong, ligature và dấu ngắt từ trong PDF. Các cách đọc khác nhau được giữ nguyên, chưa phân biệt theo ngữ cảnh.

Bộ 20 từ vũ trụ học Anh–Anh và Dictionary API là các nguồn bổ sung khi thiếu mục từ. Màn hình ghi rõ nguồn/giọng và phân biệt lỗi kết nối với từ chưa có dữ liệu. Tra lại rồi lưu một từ đã có sẽ cập nhật IPA/nghĩa, không tạo bản trùng. Bản quyền và nguồn dữ liệu nằm trong `public/dictionaries/ATTRIBUTION.md`.

Kiểm tra IPA: nếu có Node.js, chạy `node tests/pronunciation.test.mjs` (không cần cài npm dependencies).

PDF.js 4.10.38 được lưu tại public/vendor (Apache-2.0, kèm LICENSE), nên đọc PDF không cần CDN. Bản dịch dùng https://mymemory.translated.net/doc/spec.php; IPA dùng dữ liệu cục bộ; https://dictionaryapi.dev/ là nguồn dự phòng. Chỉ văn bản cần tra trực tuyến được gửi tới dịch vụ. Bản dịch trực tuyến cần Internet và chịu hạn mức/độ sẵn sàng của dịch vụ. Không phải mọi từ đều có IPA. Phát âm dùng giọng tiếng Anh của trình duyệt. PDF scan chưa có OCR; hãy nhập từ thủ công. Ghi chú là lớp phủ của ứng dụng, không nhúng vào tệp PDF. Hãy xuất Markdown để sao lưu; xóa dữ liệu trình duyệt sẽ mất tiến độ, dấu trang và highlight riêng; ghi chú và từ vựng đã lưu thành công vẫn còn trong file JSON backend. Bản dịch thuật ngữ chuyên ngành cần được đối chiếu theo ngữ cảnh.
