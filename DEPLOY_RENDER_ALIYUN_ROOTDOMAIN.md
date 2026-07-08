# `maiz.xin` 根域名部署说明

这份说明用于把当前试点系统部署到 Render，并绑定阿里云根域名 `maiz.xin`。

## 目标结果

部署完成后，使用下面这些正式地址访问：

- `https://maiz.xin`
- `https://maiz.xin/?viewer=user_4d5987e551`  洋溢
- `https://maiz.xin/?viewer=user_c8b3085c14`  阿勒
- `https://maiz.xin/?viewer=user_d7447e729b`  麦子

## 先说明一个真实限制

当前项目使用 SQLite。

如果你把服务直接部署到 Render 但不挂磁盘，数据会在实例重建后丢失。

因此测试环境至少要做到：

1. Render Web Service 正常部署
2. 给服务挂一个 Persistent Disk
3. 挂载路径使用 `/var/data`

项目里的 [render.yaml](E:/Work/Documents/GEO搜索/render.yaml) 已经预设：

- `startCommand: python server.py`
- `DATA_DIR=/var/data`

所以你在 Render 控制台把磁盘挂到 `/var/data` 即可。

## 第一步：上传代码到 GitHub

Render 最方便的方式是直接从 GitHub 拉代码。

建议仓库名：

- `ai-monthly-report-shared`

当前项目里已经忽略了不该上传的内容：

- 本地数据库
- 截图文件
- 临时提取目录
- cloudflared 二进制目录

建议上传的核心文件：

- [server.py](E:/Work/Documents/GEO搜索/server.py)
- [index.html](E:/Work/Documents/GEO搜索/index.html)
- [app.js](E:/Work/Documents/GEO搜索/app.js)
- [styles.css](E:/Work/Documents/GEO搜索/styles.css)
- [render.yaml](E:/Work/Documents/GEO搜索/render.yaml)
- [requirements.txt](E:/Work/Documents/GEO搜索/requirements.txt)

## 第二步：在 Render 创建服务

1. 打开 Render 控制台
2. 选择 `New +`
3. 选择 `Blueprint`
4. 连接你的 GitHub 仓库
5. 选中这个项目仓库
6. Render 会自动读取 `render.yaml`
7. 创建服务

创建完成后，你会先得到一个 Render 临时域名，例如：

- `https://ai-monthly-report-shared.onrender.com`

先确认它能打开。

## 第三步：给 Render 挂持久化磁盘

在 Render 服务详情页里：

1. 进入服务设置
2. 找到 `Disks`
3. 创建 Persistent Disk
4. Mount Path 填：

```text
/var/data
```

因为项目已经把 `DATA_DIR` 指向 `/var/data`，挂好后数据库就会写进磁盘。

## 第四步：在 Render 绑定根域名

在 Render 服务里：

1. 进入 `Settings`
2. 找到 `Custom Domains`
3. 添加域名：

```text
maiz.xin
```

如果你还想让 `www.maiz.xin` 也可访问，也可以再加：

```text
www.maiz.xin
```

## 第五步：在阿里云配置 DNS

进入阿里云：

1. 打开 `云解析 DNS`
2. 进入域名 `maiz.xin`
3. 添加下面的记录

### 根域名记录

- 记录类型：`A`
- 主机记录：`@`
- 记录值：`216.24.57.1`
- TTL：默认即可

### 可选：`www` 记录

如果你还要 `www.maiz.xin`，再加：

- 记录类型：`CNAME`
- 主机记录：`www`
- 记录值：你的 Render 服务域名，例如：

```text
ai-monthly-report-shared.onrender.com
```

## 第六步：回 Render 验证

回到 Render 服务中的 `Custom Domains`：

1. 点击验证
2. 等待域名状态变为可用
3. 等待 HTTPS 证书自动签发

证书签好后，正式入口就是：

- `https://maiz.xin`

## 第七步：给成员发正式链接

部署成功后，把下面链接发给成员即可：

### 洋溢

```text
https://maiz.xin/?viewer=user_4d5987e551
```

### 阿勒

```text
https://maiz.xin/?viewer=user_c8b3085c14
```

### 麦子

```text
https://maiz.xin/?viewer=user_d7447e729b
```

## 测试建议

上线后优先验证：

1. 麦子是否能看到管理看板和管理维度
2. 洋溢、阿勒是否默认进入自己的身份
3. 员工是否看不到管理入口
4. 新增事项、追加进展、月报生成是否正常
5. 重启 Render 服务后数据是否仍存在

## 当前最可能遇到的问题

### 1. 域名打不开

通常是 DNS 还没生效。

阿里云解析生效可能需要几分钟到几十分钟。

### 2. HTTPS 还没出来

Render 证书签发需要一点时间，先等域名验证通过。

### 3. 数据丢失

通常是没有挂 Persistent Disk，或者挂载路径不是 `/var/data`。

### 4. 页面能打开但身份不对

检查链接里的 `viewer` 参数是否正确。

## 这一步之后

如果后面你希望长期稳定测试，下一步最值得补的是：

1. 真正的登录机制
2. 员工只看自己数据，主管看自己范围，管理层看全量
3. 云数据库替代 SQLite
