---
title: 无影云切换显卡配置
pubDatetime: 2026-03-26
description: 导出无影云镜像，更换显卡重新部署
draft: false
featured: false
tags:
  - 无影云
  - GPU
  - docker
---
！！图床有问题，后续再添加图片！！

为了能够节省资源占用，一般选择在配置环境时选择较低配置，以便在尽量减少成本的情况下完成服务的调试，而在调试完成之后需要将镜像迁移到新的gpu服务上。

1. 首先将调试完成的镜像保存到个人镜像，也可以在可以在[无影灵构](https://lincore.wuying.aliyun.com/#/workstationConsole)控制台中进行相关操作\
   \**务必先关机！*\*
1. 可以在左侧[灵构镜像](https://lincore.wuying.aliyun.com/#/lincoreImageManagement)中看到相关镜像正在创建，或者已经完成创建\
1. 然后重新选择部署工作站\
   然后依次选择个人镜像，已经创建好的个人镜像，调整所需配置即可\
1. 最后点击立即购买即可完成新镜像部署
