# Hướng dẫn Deploy lên Vercel - Chi tiết

## Bước 1: Đăng nhập vào Vercel Dashboard
1. Truy cập: https://vercel.com/dashboard
2. Đăng nhập với tài khoản của bạn

## Bước 2: Tìm hoặc tạo project
1. Nếu đã có project `stremio-vietsub`:
   - Click vào project đó
   - Vào Settings → Git
   - Kiểm tra xem đã kết nối với GitHub chưa

2. Nếu chưa có project:
   - Click "Add New Project"
   - Chọn GitHub repository: `dinoleeht3m-stack/stremio-vietsub`
   - Click "Import"

## Bước 3: Cấu hình Build Settings
Vercel sẽ tự động detect Node.js project. Kiểm tra:
- **Framework Preset**: Node.js
- **Build Command**: (để trống)
- **Output Directory**: (để trống)
- **Install Command**: `npm install`

## Bước 4: Cấu hình Environment Variables (nếu cần)
Trong Project Settings → Environment Variables:
- `EXTERNAL_URL`: `https://stremio-vietsub-3gzd9kcj4-du-8bf3.vercel.app`
- `RATE_LIMIT_WINDOW_MS`: `60000`
- `RATE_LIMIT_MAX`: `120`

## Bước 5: Deploy
1. Click "Deploy"
2. Đợi deployment hoàn thành (thường mất 1-2 phút)
3. Sau khi deploy thành công, bạn sẽ nhận được URL mới

## Bước 6: Test Addon
1. Lấy URL từ Vercel (ví dụ: `https://stremio-vietsub-xxx.vercel.app`)
2. Test manifest: `https://stremio-vietsub-xxx.vercel.app/manifest.json`
3. Test config page: `https://stremio-vietsub-xxx.vercel.app/configure`

## Bước 7: Cài vào Stremio
1. Mở Stremio
2. Settings → Addons → Install Addon
3. Nhập URL manifest mới
4. Click "Install"

## Troubleshooting

### Nếu deployment fail:
1. Kiểm tra logs trong Vercel Dashboard
2. Đảm bảo `package.json` có scripts đúng
3. Kiểm tra dependencies trong `package.json`

### Nếu URL cũ không hoạt động:
1. URL mới sẽ được tạo sau khi deploy thành công
2. Cập nhật URL trong Stremio settings

### Nếu muốn sử dụng URL cũ:
1. Trong Vercel Dashboard → Domains
2. Có thể thêm custom domain hoặc redirect

## Lưu ý
- Deploy tự động sẽ diễn ra khi bạn push code mới lên GitHub
- Có thể enable auto-deploy trong Vercel settings
- Logs và metrics có thể xem trong Vercel Dashboard
