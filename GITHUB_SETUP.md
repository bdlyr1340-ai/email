# رفع المشروع إلى GitHub

من الكمبيوتر داخل مجلد المشروع:

```bash
git init
git add .
git commit -m "Initial digital store"
git branch -M main
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin main
```

بعد أي تعديل لاحق:

```bash
git add .
git commit -m "Update store"
git push
```

Railway سينشر التحديث الجديد من GitHub، بينما تبقى المنتجات والطلبات والمخزون في PostgreSQL.
