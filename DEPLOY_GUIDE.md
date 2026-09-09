# Hướng dẫn Deploy lên Vercel

## Cách 1: Deploy qua Vercel Dashboard (Khuyên dùng)

### Bước 1: Tạo GitHub Repository
1. Đăng nhập vào GitHub
2. Tạo repository mới với tên: `stremio-vietsub`
3. Copy URL của repository (ví dụ: `https://github.com/username/stremio-vietsub.git`)

### Bước 2: Push code lên GitHub
Trong terminal, chạy các lệnh sau:

```bash
# Thay thế bằng URL repository của bạn
git remote add origin https://github.com/username/stremio-vietsub.git
git branch -M main
git push -u origin main
```

### Bước 3: Deploy lên Vercel
1. Đăng nhập vào [Vercel Dashboard](https://vercel.com/dashboard)
2. Click "Add New Project"
3. Chọn GitHub repository vừa tạo
4. Vercel sẽ tự động phát hiện dự án Node.js
5. Click "Deploy"

### Bước 4: Cấu hình Environment Variables (nếu cần)
Trong Vercel Dashboard:
1. Vào project settings
2. Thêm environment variables nếu cần:
   - `EXTERNAL_URL`: URL của addon (ví dụ: `https://stremio-vietsub-3gzd9kcj4-du-8bf3.vercel.app`)
   - `RATE_LIMIT_WINDOW_MS`: `60000`
   - `RATE_LIMIT_MAX`: `120`

## Cách 2: Deploy qua Vercel CLI

Nếu bạn muốn dùng Vercel CLI:

### Bước 1: Cài đặt và Login
```bash
npm install -g vercel
vercel login
```

### Bước 2: Deploy
```bash
vercel
```

### Bước 3: Production Deploy
```bash
vercel --prod
```

## Sau khi Deploy

### Kiểm tra Addon
1. Lấy URL từ Vercel (ví dụ: `https://stremio-vietsub-xxx.vercel.app`)
2. Test manifest: `https://stremio-vietsub-xxx.vercel.app/manifest.json`
3. Test config page: `https://stremio-vietsub-xxx.vercel.app/configure`

### Cài vào Stremio
1. Mở Stremio
2. Vào Settings → Addons
3. Nhấn "Install Addon"
4. Nhập URL manifest: `https://stremio-vietsub-xxx.vercel.app/manifest.json`
5. Click "Install"

## URL hiện tại của bạn
Dựa trên thông tin bạn cung cấp, URL hiện tại là:
`https://stremio-vietsub-3gzd9kcj4-du-8bf3.vercel.app`

Sau khi deploy thành công, bạn có thể:
- Kiểm tra logs trong Vercel Dashboard
- Monitor performance và errors
- Update code bằng cách push lên GitHub
