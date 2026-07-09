---
title: Git配置与常用命令备忘
pubDatetime: 2026-07-09
description: 在Windows上从零开始配置Git，减少中间出错
draft: false
featured: false
tags:
  - Git
  - 教程
  - Windows
---
# 快速配置

## 初次使用（如果不是第一次安装GIT可以跳过）

首先从[Git官网](https://git-scm.com/)下载对应的安装包并进行安装，全部**默认**即可

打开命令提示符或者其他终端，添加用户名及邮箱

```bash
## 添加用户名及邮箱
git config --global user.name "NAME OF GITHUB"
git config --global user.email "EMAIL OF GITHUB"
## 例如：git config --global user.name "Linus" & config --global user.email "admin@gmail.com"
```

## 项目初始化

```bash
## 终端中命令行进入或者其他办法，进入项目根路径
## 一定是根路径！！！
cd "<PROJECT_PATH>"
## 初始化本地仓库
git init
```

添加 `.gitignore`在本地，作用是避免上传**隐私文件、大型文件及与项目无关文件**，python项目一般参考写法如下，根据需求修改即可：

```python
__pycache__/
*.pyc
*.pyo
*.pyd
.venv/
venv/
env/
.DS_Store
Thumbs.db
.idea/
.vscode/
checkpoints/
logs/
runs/
outputs/
wandb/
*.ckpt
*.pth
*.pt
*.log
```

请务必保证在完成`.gitignore`内容后，再进行后续步骤！！！

```bash
## 将所有修改添加到本地缓存中
git add .
## 首次提交到本地 commit内容根据提交内容来填，方便提交历史管理
git commit -m "initial commit"
```

如果到这里没有出现任何报错，那么恭喜你，已经完成了本地仓库的构建！

接下来是提交到github的库里面，如果没有建库，可以通过[https://github.com/new](https://github.com/new)进行新仓库的构建，如果不会操作，输入完项目名字直接点击"create"就可以了，不用勾选其他内容，这时我们会得到我们这个项目的库的地址，一般为.git结尾，如“[https://github.com/NAME/PROJECT_NAME.git](https://github.com/Francisco2333/BBDM_update.git)”。

这时候就可以开始添加远程仓库并开始第一次的提交了

```bash
## 添加远程仓库，此处<GIT_URL>应替换为上面获得的库的地址
git remote add origin "<GIT_URL>"
## 如果是第一次使用一般会弹窗让去github登录，用浏览器登录即可

## 如果库是空的，直接提交即可
git push -u origin main
## 如果里面有其它内容，而且确认是第一次提交，可以在最后添加 --force
git push -u origin main --force
```

到这里就完成了第一次的GIT提交

## 后续使用

如果不出意外的话，应该最常用的就是下面这三个命令了

```bash
git add .
git commit -m "<COMMIT_RECORD>"
git push
```

# 命令查询

```bash
查看当前 Git 配置：
git config --list

查看用户名和邮箱：
git config user.name
git config user.email

查看全局配置：
git config --global --list

查看当前仓库状态：
git status

查看远程仓库地址：
git remote -v

查看当前分支：
git branch

查看提交记录：
git log --oneline
```
