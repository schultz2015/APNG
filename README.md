# APNG 涩涩合成工具

一个基于浏览器的 APNG 动画合成与拆帧工具，用来 QQ 发图。

在线使用：[https://schultz2015.github.io/APNG/](https://schultz2015.github.io/APNG/)

## 功能

- 上传、拖拽或粘贴图片
- 调整图片帧顺序
- 设置帧延迟、输出尺寸和图片适配方式
- 支持全局模糊、圆球马赛克和毛玻璃蒙版
- 调整滤镜强度、颜色量化、色带质量和降采样倍率
- 预览滤镜首帧并放大查看效果
- 在线预览并下载 APNG
- 将 PNG 或 APNG 拆解为独立 PNG 帧

## 本地运行

```bash
npm install
npm run dev
```

然后打开终端中显示的本地地址。

## 构建

```bash
npm run build
```

构建产物位于 `dist/` 目录。
