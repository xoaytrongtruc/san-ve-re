# ✈ Săn Vé Rẻ

**🌐 Xem demo:** https://xoaytrongtruc.github.io/san-ve-re/ · **⬇ Tải extension:** [san-ve-re-extension.zip](https://github.com/xoaytrongtruc/san-ve-re/releases/latest/download/san-ve-re-extension.zip)

Chrome Extension quét giá **mọi hãng** trên airbookingonline.com cho **nhiều chặng × nhiều ngày**, chỉ ra chuyến rẻ nhất từng chặng trong tuần.

## Cài đặt (1 lần, ~30 giây)

1. Mở `chrome://extensions`.
2. Bật **Developer mode** (góc trên bên phải).
3. Giải nén `san-ve-re-extension.zip` (hoặc clone repo), bấm **Load unpacked**, chọn thư mục `extension`.
4. Ghim icon ✈ lên thanh công cụ (biểu tượng 🧩 → 📌).

## Dùng

1. Đăng nhập airbookingonline.com như bình thường (giữ đăng nhập, không cần mở tab).
2. Bấm icon ✈ → dashboard mở ra.
3. Chọn chặng, ngày bắt đầu, số ngày → **🔍 Quét giá**.

Dashboard có:
- **Vé rẻ nhất** của cả đợt quét, số tiền tiết kiệm khi chọn đúng ngày
- **Thẻ từng chặng** kèm ▲▼ so với lần quét trước (lịch sử giá tự lưu)
- **Biểu đồ giá rẻ nhất mỗi ngày**, **bản đồ giá** chặng × ngày (★ ngày rẻ nhất)
- **Tra cứu chuyến**: lọc theo chặng, ngày, buổi, bay thẳng, hãng; sắp xếp theo giá, giờ bay hoặc thời gian bay
- Xuất CSV (Excel) và JSON, giao diện sáng/tối

## Cách hoạt động

```
Dashboard (extension) ──executeScript──► tab airbookingonline.com (đã đăng nhập)
   reCAPTCHA v3 của trang → POST /CreateProBooking (vé 1 chiều, từng ngày)
   → Result.aspx chứa Postresult([token × 5 nguồn]) → POST /ApiSearch/ × 5 song song
   → JSON vài MB rút gọn thành danh sách chuyến → trả về dashboard
```

Giá = `SumPrice + SumTaxSales`, đúng con số trang hiển thị (đã gồm thuế phí). Dữ liệu chỉ lưu trong `chrome.storage` trên máy bạn, không gửi đi đâu ngoài airbookingonline.com.

## Lỗi thường gặp

| Hiện tượng | Xử lý |
|---|---|
| "Chưa đăng nhập" / "Phiên đăng nhập đã hết" | Bấm **🔑 Mở trang đăng nhập**, đăng nhập, rồi Quét lại (ô đã có giữ trong cache 30 phút) |
| Nhiều ô ⚠ "reCAPTCHA… từ chối" | Giảm **Song song** xuống 1–2, đợi vài phút |
| Sửa code xong không thấy đổi | `chrome://extensions` → bấm ⟳ ở Săn Vé Rẻ |

## Cấu trúc

| Đường dẫn | Nội dung |
|---|---|
| `extension/` | Chrome Extension (MV3): dashboard + hàm quét tiêm vào tab airbookingonline |
| `docs/` | Bản web cho GitHub Pages, build bằng `node scripts/build-web.js` (chỉ xem, dữ liệu mẫu hoặc file JSON) |
| `legacy/` | Bản cũ: userscript + server Node, không còn dùng |
