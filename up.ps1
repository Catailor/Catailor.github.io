hexo clean
hexo g
git add .
git commit -m "Site updated at $(Get-Date -Format 'yyyy-MM-dd HH:mm')"
git push