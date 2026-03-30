---
title: recursion
date: 2026-03-31 00:09:18
category: algorithm
tags:
---

## 递归的独特视角：以汉诺塔为例

所有的递归完全可以用**数学归纳法**来理解，以经典递归题汉诺塔为例：
首先定义可结束的问题 hanota(n, A, B, C) 表示为 n 个 A 盘最终移到 C

- 当 n = 1 时，移 A 到 C
- 当 n = k 时，假设 move(n, A, B, C) 可以做到
- 当 n = k + 1 时，对 A 盘上面的 k 个来说，要移到 B 盘，那么显然要 move(n - 1, A, C, B) （即以 C 盘中转到 B）
- 对于剩下的一个从 A 转到 C
- 再将 k 个盘从 B 转到 C，即 move(n - 1, B, A, C)

see? 其实还算很清晰简单的
