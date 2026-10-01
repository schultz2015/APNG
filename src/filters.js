function require2dContext(canvas, options) {
    const context = canvas.getContext("2d", options);

    if (!context) {
        throw new Error("浏览器无法创建 Canvas 2D 上下文");
    }

    return context;
}

function createCanvas(width, height, options) {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    return {
        canvas,
        context: require2dContext(canvas, options)
    };
}

function applyBlur(ctx, width, height, sourceData, amount) {
    if (!amount) {
        return sourceData;
    }

    const { canvas: sourceCanvas, context: sourceContext } =
        createCanvas(width, height, { willReadFrequently: true });
    sourceContext.putImageData(
        new ImageData(
            new Uint8ClampedArray(sourceData),
            width,
            height
        ),
        0,
        0
    );

    ctx.save();
    ctx.clearRect(0, 0, width, height);
    ctx.filter = `blur(${amount}px)`;
    ctx.drawImage(
        sourceCanvas,
        -amount,
        -amount,
        width + amount * 2,
        height + amount * 2
    );
    ctx.restore();
    return ctx.getImageData(0, 0, width, height).data;
}

function applyMosaic(ctx, width, height, sourceData, amount) {
    if (!amount) {
        return sourceData;
    }

    const output = ctx.createImageData(width, height);
    const outputData = output.data;
    for (let i = 3; i < outputData.length; i += 4) {
        outputData[i] = 255;
    }

    const cellSize = Math.max(4, Math.round(amount));
    const radius = cellSize / 2;
    const sample = (x, y) => (y * width + x) * 4;

    for (let y = 0; y < height; y += cellSize) {
        for (let x = 0; x < width; x += cellSize) {
            const centerX = Math.min(
                width - 1,
                Math.floor(x + radius)
            );
            const centerY = Math.min(
                height - 1,
                Math.floor(y + radius)
            );
            const sourceIndex = sample(centerX, centerY);

            for (
                let pixelY = y;
                pixelY < Math.min(y + cellSize, height);
                pixelY++
            ) {
                for (
                    let pixelX = x;
                    pixelX < Math.min(x + cellSize, width);
                    pixelX++
                ) {
                    const distanceX = pixelX - (x + radius - 0.5);
                    const distanceY = pixelY - (y + radius - 0.5);

                    if (
                        distanceX * distanceX +
                        distanceY * distanceY >
                        radius * radius
                    ) {
                        continue;
                    }

                    const outputIndex = sample(pixelX, pixelY);
                    outputData.set(
                        sourceData.subarray(sourceIndex, sourceIndex + 4),
                        outputIndex
                    );
                }
            }
        }
    }

    ctx.putImageData(output, 0, 0);
    return outputData;
}

function applyGlass(ctx, width, height, sourceData, amount) {
    if (!amount) {
        return sourceData;
    }

    const { canvas: sourceCanvas, context: sourceContext } =
        createCanvas(width, height, { willReadFrequently: true });
    sourceContext.putImageData(
        new ImageData(
            new Uint8ClampedArray(sourceData),
            width,
            height
        ),
        0,
        0
    );

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.filter = `blur(${Math.max(1, Math.round(amount / 2))}px)`;
    ctx.drawImage(
        sourceCanvas,
        -amount,
        -amount,
        width + amount * 2,
        height + amount * 2
    );
    ctx.restore();

    ctx.fillStyle = `rgba(255, 255, 255, ${Math.min(
        0.48,
        0.12 + amount / 120
    )})`;
    ctx.fillRect(0, 0, width, height);

    ctx.globalAlpha = 0.12;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    return ctx.getImageData(0, 0, width, height).data;
}

function applyPixelArt(ctx, width, height, sourceData, amount) {
    if (amount <= 1) {
        return sourceData;
    }

    const pixelSize = Math.max(2, Math.min(64, Math.round(amount)));
    const pixelWidth = Math.max(1, Math.ceil(width / pixelSize));
    const pixelHeight = Math.max(1, Math.ceil(height / pixelSize));
    const { canvas: pixelCanvas, context: pixelContext } =
        createCanvas(pixelWidth, pixelHeight, {
            willReadFrequently: true
        });

    pixelContext.imageSmoothingEnabled = false;
    const { canvas: sourceCanvas, context: sourceContext } =
        createCanvas(width, height, { willReadFrequently: true });
    sourceContext.putImageData(
        new ImageData(
            new Uint8ClampedArray(sourceData),
            width,
            height
        ),
        0,
        0
    );
    pixelContext.drawImage(
        sourceCanvas,
        0,
        0,
        pixelWidth,
        pixelHeight
    );

    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
        pixelCanvas,
        0,
        0,
        pixelWidth,
        pixelHeight,
        0,
        0,
        width,
        height
    );
    ctx.restore();
    return ctx.getImageData(0, 0, width, height).data;
}

const HALFTONE_PAPERS = Object.freeze({
    warm: { color: [246, 230, 204], dotGain: 1.08 },
    white: { color: [255, 255, 255], dotGain: 1 },
    uncoated: { color: [245, 241, 229], dotGain: 1.1 },
    coated: { color: [255, 255, 255], dotGain: 0.9 }
});

const jitter_strength = 0.04;
const HALFTONE_CHANNEL_JITTER = new WeakMap();
const HALFTONE_ALIGNMENT_MODES = new Set([
    "Dot on Dot",
    "Offset",
    "Rosette"
]);

export function apply_channel_alignment(
    channels,
    base_angle = 45,
    freq = 1,
    mode = "Rosette"
) {
    if (!Array.isArray(channels) || channels.length < 1 || channels.length > 3) {
        throw new RangeError("半色调印刷色版数量必须为 1 到 3 层");
    }
    if (!Number.isFinite(base_angle) || base_angle < 0 || base_angle > 180) {
        throw new RangeError("半色调基础角度必须在 0° 到 180° 之间");
    }
    if (!Number.isFinite(freq) || freq <= 0) {
        throw new RangeError("半色调网点频率必须为正数");
    }
    if (!HALFTONE_ALIGNMENT_MODES.has(mode)) {
        throw new RangeError(`不支持的半色调对齐模式：${mode}`);
    }

    const channelCount = channels.length;
    const period = 1 / freq;
    const jitterDistance = period * jitter_strength;

    return channels.map((channel, index) => {
        if (!channel || typeof channel !== "object") {
            throw new TypeError("半色调印刷通道必须为对象");
        }

        let channelAngle = base_angle;
        let base_offset = [0, 0];

        if (mode === "Rosette") {
            channelAngle =
                (base_angle + index * 180 / channelCount) % 180;
        } else if (mode === "Offset") {
            const offset = index * period / channelCount;
            base_offset = [offset, offset];
        }

        let jitter = HALFTONE_CHANNEL_JITTER.get(channel);
        if (!jitter) {
            jitter = [
                Math.random() * 2 - 1,
                Math.random() * 2 - 1
            ];
            HALFTONE_CHANNEL_JITTER.set(channel, jitter);
        }

        const registrationError = index === 0
            ? [0, 0]
            : jitter.map(value => value * jitterDistance);

        return {
            ...channel,
            angle: channelAngle,
            grid_offset: [
                base_offset[0] + registrationError[0],
                base_offset[1] + registrationError[1]
            ]
        };
    });
}

function applyHalftone(
    ctx,
    width,
    height,
    sourceData,
    amount,
    {
        baseAngle = 45,
        channels = [],
        paper = "uncoated"
    } = {}
) {
    if (!Array.isArray(channels) || channels.length > 3) {
        throw new RangeError("半色调印刷色版数量必须为 0 到 3 层");
    }
    if (!amount) {
        return sourceData;
    }

    const paperProfile = HALFTONE_PAPERS[paper];
    if (!paperProfile) {
        throw new RangeError(`不支持的半色调纸张：${paper}`);
    }

    if (!Number.isFinite(baseAngle) || baseAngle < 0 || baseAngle > 180) {
        throw new RangeError("半色调基础角度必须在 0° 到 180° 之间");
    }

    const cellSize = Math.max(2, Math.round(amount));

    /*
     * 无 channel 时也使用与 channel 完全相同的旋转网格。
     *
     * angle 控制的是“网点网格”的方向，而不是圆点自身的旋转。
     * 因此采样区域、网点中心、网点排列都会随 angle 一起旋转。
     *
     * 每个网格：
     *   - 颜色 = 原图该网格的平均 RGB
     *   - 面积 = 原图该网格的平均亮度对应的 density
     *   - 位置 = angle 旋转后的网格中心
     */
    if (channels.length === 0) {
        const angle = baseAngle;
        const output = ctx.createImageData(width, height);
        const outputData = output.data;
        const [paperRed, paperGreen, paperBlue] = paperProfile.color;

        const radians = (angle % 180) * Math.PI / 180;
        const cosine = Math.cos(radians);
        const sine = Math.sin(radians);

        // 与 channel 模式完全一致：把图像坐标旋转到网格坐标系。
        const gridBounds = [
            [0, 0],
            [width - 1, 0],
            [0, height - 1],
            [width - 1, height - 1]
        ].map(([x, y]) => ({
            x: x * cosine + y * sine,
            y: -x * sine + y * cosine
        }));

        const minGridX = Math.floor(
            Math.min(...gridBounds.map(point => point.x)) / cellSize
        );
        const minGridY = Math.floor(
            Math.min(...gridBounds.map(point => point.y)) / cellSize
        );
        const maxGridX = Math.floor(
            Math.max(...gridBounds.map(point => point.x)) / cellSize
        );
        const maxGridY = Math.floor(
            Math.max(...gridBounds.map(point => point.y)) / cellSize
        );

        const gridWidth = maxGridX - minGridX + 1;
        const gridHeight = maxGridY - minGridY + 1;
        const cellCount = gridWidth * gridHeight;

        const redTotals = new Float32Array(cellCount);
        const greenTotals = new Float32Array(cellCount);
        const blueTotals = new Float32Array(cellCount);
        const luminanceTotals = new Float32Array(cellCount);
        const alphaTotals = new Float32Array(cellCount);

        // ------------------------------------------------------------
        // 1. 按旋转后的网格采样原图。
        // ------------------------------------------------------------
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelIndex = (y * width + x) * 4;
                const alpha = sourceData[pixelIndex + 3] / 255;

                if (!alpha) {
                    continue;
                }

                const gridX = Math.floor(
                    (x * cosine + y * sine) / cellSize
                ) - minGridX;
                const gridY = Math.floor(
                    (-x * sine + y * cosine) / cellSize
                ) - minGridY;
                const index = gridX * gridHeight + gridY;

                if (index < 0 || index >= cellCount) {
                    continue;
                }

                const red = sourceData[pixelIndex];
                const green = sourceData[pixelIndex + 1];
                const blue = sourceData[pixelIndex + 2];
                const luminance =
                    0.299 * red +
                    0.587 * green +
                    0.114 * blue;

                redTotals[index] += red * alpha;
                greenTotals[index] += green * alpha;
                blueTotals[index] += blue * alpha;
                luminanceTotals[index] += luminance * alpha;
                alphaTotals[index] += alpha;
            }
        }

        // ------------------------------------------------------------
        // 2. 先铺满纸张颜色。
        // ------------------------------------------------------------
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelIndex = (y * width + x) * 4;
                outputData[pixelIndex] = paperRed;
                outputData[pixelIndex + 1] = paperGreen;
                outputData[pixelIndex + 2] = paperBlue;
                outputData[pixelIndex + 3] = sourceData[pixelIndex + 3];
            }
        }

        const maxRadius =
            cellSize * 0.48 * paperProfile.dotGain;

        // ------------------------------------------------------------
        // 3. 根据旋转后的网格中心生成彩色网点。
        // ------------------------------------------------------------
        for (let gridX = minGridX; gridX <= maxGridX; gridX++) {
            for (let gridY = minGridY; gridY <= maxGridY; gridY++) {
                const localGridX = gridX - minGridX;
                const localGridY = gridY - minGridY;
                const cellIndex =
                    localGridX * gridHeight + localGridY;
                const alphaTotal = alphaTotals[cellIndex];

                if (!alphaTotal) {
                    continue;
                }

                const averageRed =
                    redTotals[cellIndex] / alphaTotal;
                const averageGreen =
                    greenTotals[cellIndex] / alphaTotal;
                const averageBlue =
                    blueTotals[cellIndex] / alphaTotal;
                const luminance =
                    luminanceTotals[cellIndex] / alphaTotal;

                // 暗部墨量高，网点面积大；亮部网点小。
                const density = Math.max(
                    0,
                    Math.min(1, 1 - luminance / 255)
                );

                const radius = Math.min(
                    cellSize * 0.5,
                    maxRadius * Math.sqrt(density)
                );

                if (radius <= 0.01) {
                    continue;
                }

                // 先在旋转后的网格坐标系得到网点中心，
                // 再旋转回原图坐标系。这里与 channel 模式完全一致。
                const centerU =
                    (gridX + 0.5) * cellSize;
                const centerV =
                    (gridY + 0.5) * cellSize;

                const centerX =
                    centerU * cosine - centerV * sine;
                const centerY =
                    centerU * sine + centerV * cosine;

                const startX = Math.max(
                    0,
                    Math.floor(centerX - radius - 1)
                );
                const endX = Math.min(
                    width - 1,
                    Math.ceil(centerX + radius + 1)
                );
                const startY = Math.max(
                    0,
                    Math.floor(centerY - radius - 1)
                );
                const endY = Math.min(
                    height - 1,
                    Math.ceil(centerY + radius + 1)
                );

                for (let y = startY; y <= endY; y++) {
                    for (let x = startX; x <= endX; x++) {
                        const distanceX = x - centerX;
                        const distanceY = y - centerY;
                        const distance = Math.sqrt(
                            distanceX * distanceX +
                            distanceY * distanceY
                        );

                        const coverage = Math.max(
                            0,
                            Math.min(1, radius + 0.5 - distance)
                        );

                        if (!coverage) {
                            continue;
                        }

                        const pixelIndex = (y * width + x) * 4;

                        outputData[pixelIndex] =
                            paperRed +
                            (averageRed - paperRed) * coverage;
                        outputData[pixelIndex + 1] =
                            paperGreen +
                            (averageGreen - paperGreen) * coverage;
                        outputData[pixelIndex + 2] =
                            paperBlue +
                            (averageBlue - paperBlue) * coverage;
                        outputData[pixelIndex + 3] =
                            sourceData[pixelIndex + 3];
                    }
                }
            }
        }

        ctx.putImageData(output, 0, 0);
        return outputData;
    }

    const output = ctx.createImageData(width, height);
    const outputData = output.data;
    const [paperRed, paperGreen, paperBlue] = paperProfile.color;

    for (let index = 0; index < outputData.length; index += 4) {
        outputData[index] = paperRed;
        outputData[index + 1] = paperGreen;
        outputData[index + 2] = paperBlue;
        outputData[index + 3] = sourceData[index + 3];
    }

    for (const channel of channels) {
        const {
            angle,
            color,
            grid_offset: gridOffset = [0, 0]
        } = channel;
        if (
            !Number.isFinite(angle) ||
            angle < 0 ||
            angle > 180 ||
            !/^#[\da-f]{6}$/i.test(color) ||
            !Array.isArray(gridOffset) ||
            gridOffset.length !== 2 ||
            !gridOffset.every(Number.isFinite)
        ) {
            throw new RangeError("半色调色版的角度、偏移或油墨颜色无效");
        }

        const [offsetX, offsetY] = gridOffset;
        const radians = (angle % 180) * Math.PI / 180;
        const cosine = Math.cos(radians);
        const sine = Math.sin(radians);
        const gridBounds = [
            [0, 0],
            [width - 1, 0],
            [0, height - 1],
            [width - 1, height - 1]
        ].map(([x, y]) => ({
            x: x * cosine + y * sine - offsetX,
            y: -x * sine + y * cosine - offsetY
        }));
        const minGridX = Math.floor(
            Math.min(...gridBounds.map(point => point.x)) / cellSize
        );
        const minGridY = Math.floor(
            Math.min(...gridBounds.map(point => point.y)) / cellSize
        );
        const maxGridX = Math.floor(
            Math.max(...gridBounds.map(point => point.x)) / cellSize
        );
        const maxGridY = Math.floor(
            Math.max(...gridBounds.map(point => point.y)) / cellSize
        );
        const gridHeight = maxGridY - minGridY + 1;
        const cellCount = (maxGridX - minGridX + 1) * gridHeight;
        const densityTotals = new Float32Array(cellCount);
        const alphaTotals = new Float32Array(cellCount);
        const [inkRed, inkGreen, inkBlue] = [
            1, 3, 5
        ].map(offset => Number.parseInt(color.slice(offset, offset + 2), 16));
        const absorbRed = 1 - inkRed / 255;
        const absorbGreen = 1 - inkGreen / 255;
        const absorbBlue = 1 - inkBlue / 255;
        const absorbTotal = absorbRed + absorbGreen + absorbBlue;
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const pixelIndex = (y * width + x) * 4;
                const alpha = sourceData[pixelIndex + 3] / 255;
                if (!alpha) {
                    continue;
                }

                const gridX = Math.floor(
                    (x * cosine + y * sine - offsetX) / cellSize
                ) - minGridX;
                const gridY = Math.floor(
                    (-x * sine + y * cosine - offsetY) / cellSize
                ) - minGridY;
                const index = gridX * gridHeight + gridY;
                const density = absorbTotal
                    ? (
                        (255 - sourceData[pixelIndex]) * absorbRed +
                        (255 - sourceData[pixelIndex + 1]) * absorbGreen +
                        (255 - sourceData[pixelIndex + 2]) * absorbBlue
                    ) / (255 * absorbTotal)
                    : 0;
                densityTotals[index] += density * alpha;
                alphaTotals[index] += alpha;
            }
        }

        const maxRadius = cellSize * 0.48 * paperProfile.dotGain;
        const inkTransmittance = [
            inkRed / 255,
            inkGreen / 255,
            inkBlue / 255
        ];

        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const index = (y * width + x) * 4;
                const gridX = Math.floor(
                    (x * cosine + y * sine - offsetX) / cellSize
                ) - minGridX;
                const gridY = Math.floor(
                    (-x * sine + y * cosine - offsetY) / cellSize
                ) - minGridY;
                const cellIndex = gridX * gridHeight + gridY;
                const alphaTotal = alphaTotals[cellIndex];
                const density = alphaTotal
                    ? densityTotals[cellIndex] / alphaTotal
                    : 0;
                const radius = Math.min(
                    cellSize * 0.5,
                    maxRadius * Math.sqrt(Math.max(0, density))
                );
                const centerU =
                    (gridX + minGridX + 0.5) * cellSize + offsetX - 0.5;
                const centerV =
                    (gridY + minGridY + 0.5) * cellSize + offsetY - 0.5;
                const centerX = centerU * cosine - centerV * sine;
                const centerY = centerU * sine + centerV * cosine;
                const distanceX = x - centerX;
                const distanceY = y - centerY;
                const distance = Math.sqrt(
                    distanceX * distanceX + distanceY * distanceY
                );
                const coverage = Math.max(
                    0,
                    Math.min(1, radius + 0.5 - distance)
                );

                for (let colorChannel = 0; colorChannel < 3; colorChannel++) {
                    const transmittance =
                        1 - coverage * (1 - inkTransmittance[colorChannel]);
                    outputData[index + colorChannel] *= transmittance;
                }
            }
        }
    }

    ctx.putImageData(output, 0, 0);
    return outputData;
}

const FILTERS = Object.freeze({
    blur: {
        label: "全局模糊",
        description: "柔化整张图像。",
        apply: applyBlur
    },
    mosaic: {
        label: "圆球马赛克",
        description: "以圆形采样单元生成马赛克效果。",
        apply: applyMosaic
    },
    glass: {
        label: "毛玻璃蒙版",
        description: "柔化图像并叠加半透明高光。",
        apply: applyGlass
    },
    pixelArt: {
        label: "像素画艺术",
        description: "降低采样分辨率并放大像素块。",
        apply: applyPixelArt
    },
    halftone: {
        label: "半色调网点",
        description: "以原图平均颜色绘制网点，明暗控制圆点大小。",
        apply: applyHalftone
    }
});

export function getFrameFilterOptions() {
    return Object.entries(FILTERS).map(([value, { label, description }]) => ({
        value,
        label,
        description
    }));
}

export function applyFrameFilter(
    ctx,
    width,
    height,
    {
        type = "blur",
        amount = 0,
        colorLevelCount = 16,
        downsampleFactor = 1,
        filterQualityPercent = 100,
        filterOptions = {}
    } = {}
) {
    if (
        !ctx ||
        !ctx.canvas ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width <= 0 ||
        height <= 0 ||
        width > ctx.canvas.width ||
        height > ctx.canvas.height
    ) {
        throw new RangeError("滤镜画布尺寸无效");
    }

    if (!Number.isFinite(amount) || amount < 0) {
        throw new RangeError("滤镜强度必须是非负数");
    }
    if (
        !Number.isFinite(colorLevelCount) ||
        !Number.isFinite(downsampleFactor) ||
        !Number.isFinite(filterQualityPercent)
    ) {
        throw new RangeError("颜色量化、降采样和质量参数必须是有效数字");
    }
    if (!filterOptions || typeof filterOptions !== "object") {
        throw new TypeError("滤镜专属参数必须是对象");
    }
    const definition = Object.prototype.hasOwnProperty.call(FILTERS, type)
        ? FILTERS[type]
        : null;
    if (!definition) {
        throw new RangeError(`不支持的滤镜类型：${type}`);
    }

    const sourceData = definition.apply(
        ctx,
        width,
        height,
        ctx.getImageData(0, 0, width, height).data,
        amount,
        filterOptions
    );

    if (
        type === "halftone" &&
        (!filterOptions.channels || filterOptions.channels.length === 0)
    ) {
        return;
    }

    // Apply shared color quantization and downsampling after the selected effect.
    const output = ctx.createImageData(width, height);
    const outputData = output.data;
    const quality = Math.max(
        10,
        Math.min(100, filterQualityPercent)
    ) / 100;
    const levels = Math.max(
        2,
        Math.min(256, Math.round(colorLevelCount * quality))
    );
    const step = 255 / (levels - 1);
    const sampleSize = Math.max(
        1,
        Math.min(64, Math.round(downsampleFactor))
    );

    for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
            const sampleX = Math.min(
                width - 1,
                Math.floor(x / sampleSize) * sampleSize
            );
            const sampleY = Math.min(
                height - 1,
                Math.floor(y / sampleSize) * sampleSize
            );
            const sourceIndex = (sampleY * width + sampleX) * 4;
            const outputIndex = (y * width + x) * 4;

            for (let channel = 0; channel < 3; channel++) {
                outputData[outputIndex + channel] =
                    Math.round(sourceData[sourceIndex + channel] / step) *
                    step;
            }
            outputData[outputIndex + 3] = sourceData[sourceIndex + 3];
        }
    }

    ctx.putImageData(output, 0, 0);
}
